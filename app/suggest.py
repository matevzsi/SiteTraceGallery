"""Suggest which pin each unassigned photo probably belongs to.

The reference set is every photo already assigned to a pin — the app learns
from the sorting the user has already done rather than from any model of
what a "kitchen" looks like. Each unassigned photo is scored against every
reference photo and takes the pin of its best match, if that match clears a
confidence floor.

Two signals, both cheap and both local:

* **visual** similarity from the cached descriptor (see utils/descriptor).
  Scored as the *best* single match within a pin, not the average: a pin
  accumulates photos across months of construction, so an average washes
  out the one shot that actually looks like the query.
* **time proximity** to the pin's photos. Site photography goes in bursts —
  you walk to a spot, take several frames, walk on — so two photos taken a
  minute apart are almost certainly the same place, whatever the framing.

Deliberately no GPS: handset accuracy is 5-10m while pins inside a building
are metres apart, so it would confidently group the wrong things.
"""

import datetime
import os

import numpy as np

from .utils.descriptor import DESCRIPTOR_KIND, compute_descriptor, to_array

VISUAL_WEIGHT = 0.72
TIME_WEIGHT = 0.28

# A photo needs to beat this to be suggested at all; everything else is
# reported as unmatched rather than guessed at. Suggestions the user has to
# undo are worse than no suggestion — a missed photo just shows up under
# "No suggestion", a wrongly grouped one can get bulk-assigned to the wrong
# pin. So this sits above the noise rather than between the two.
#
# Calibrated against a set with four known locations: genuine matches scored
# 0.52-0.72 on visual similarity alone, unrelated images 0.28-0.46. Real
# photos usually also pick up the time component, which pushes true matches
# further clear. This is the knob to turn if suggestions come out too timid
# (lower) or too eager (raise).
MIN_SCORE = 0.50


def _time_score(gap_seconds: float) -> float:
    if gap_seconds <= 60:
        return 1.0
    if gap_seconds <= 300:
        return 0.7
    if gap_seconds <= 1800:
        return 0.4
    return 0.0


def _epoch(value) -> float:
    if not value:
        return float("nan")
    if isinstance(value, datetime.datetime):
        return value.timestamp()
    try:
        return datetime.datetime.fromisoformat(str(value).replace("Z", "")).timestamp()
    except ValueError:
        return float("nan")


def ensure_descriptors(db, rows, thumbnails_dir: str) -> int:
    """Compute and cache any missing descriptors. Returns how many were built.

    Descriptors are derived data, so a photo whose thumbnail has gone missing
    is simply skipped — it drops out of suggestions rather than breaking them.
    """
    have = {
        r["photo_id"]
        for r in db.execute(
            "SELECT photo_id FROM photo_embeddings WHERE kind = ?", (DESCRIPTOR_KIND,)
        ).fetchall()
    }
    built = 0
    for row in rows:
        if row["id"] in have:
            continue
        blob = compute_descriptor(os.path.join(thumbnails_dir, row["thumbnail_path"]))
        if blob is None:
            continue
        db.execute(
            """INSERT INTO photo_embeddings (photo_id, kind, vector) VALUES (?, ?, ?)
               ON CONFLICT(photo_id) DO UPDATE SET kind = excluded.kind, vector = excluded.vector""",
            (row["id"], DESCRIPTOR_KIND, blob),
        )
        built += 1
    if built:
        db.commit()
    return built


def _load_matrix(db, rows):
    """Descriptor matrix for `rows`, plus the rows that actually had one."""
    ids = [r["id"] for r in rows]
    if not ids:
        return np.zeros((0, 0), dtype=np.float32), []
    placeholders = ",".join("?" for _ in ids)
    blobs = {
        r["photo_id"]: r["vector"]
        for r in db.execute(
            f"SELECT photo_id, vector FROM photo_embeddings WHERE kind = ? AND photo_id IN ({placeholders})",
            (DESCRIPTOR_KIND, *ids),
        ).fetchall()
    }
    vectors = []
    kept = []
    for row in rows:
        vec = to_array(blobs[row["id"]]) if row["id"] in blobs else None
        if vec is None:
            continue
        vectors.append(vec)
        kept.append(row)
    if not vectors:
        return np.zeros((0, 0), dtype=np.float32), []
    return np.vstack(vectors), kept


def suggest_pins(db, photo_ids, thumbnails_dir: str) -> dict:
    photo_ids = [int(p) for p in photo_ids]
    if not photo_ids:
        return {"groups": [], "unmatched": [], "computed": 0, "reference_photos": 0}

    placeholders = ",".join("?" for _ in photo_ids)
    queries = db.execute(
        f"SELECT * FROM photos WHERE id IN ({placeholders}) AND pin_id IS NULL", photo_ids
    ).fetchall()

    references = db.execute(
        """SELECT ph.*, p.label AS pin_label, p.floorplan_id, f.name AS floorplan_name
           FROM photos ph
           JOIN pins p ON p.id = ph.pin_id
           JOIN floorplans f ON f.id = p.floorplan_id"""
    ).fetchall()

    if not queries or not references:
        return {
            "groups": [],
            "unmatched": [r["id"] for r in queries],
            "computed": 0,
            "reference_photos": len(references),
        }

    computed = ensure_descriptors(db, list(queries) + list(references), thumbnails_dir)
    q_matrix, q_rows = _load_matrix(db, queries)
    r_matrix, r_rows = _load_matrix(db, references)
    if not len(q_rows) or not len(r_rows):
        return {
            "groups": [],
            "unmatched": [r["id"] for r in queries],
            "computed": computed,
            "reference_photos": len(references),
        }

    # every query against every reference in one product; the descriptor
    # blocks are pre-weighted so this is already the blended similarity
    visual = q_matrix @ r_matrix.T
    np.clip(visual, 0.0, 1.0, out=visual)

    q_times = np.array([_epoch(r["taken_at"]) for r in q_rows], dtype=np.float64)
    r_times = np.array([_epoch(r["taken_at"]) for r in r_rows], dtype=np.float64)
    gaps = np.abs(q_times[:, None] - r_times[None, :])
    gaps = np.nan_to_num(gaps, nan=np.inf)
    time_component = np.select(
        [gaps <= 60, gaps <= 300, gaps <= 1800], [1.0, 0.7, 0.4], default=0.0
    )

    scores = VISUAL_WEIGHT * visual + TIME_WEIGHT * time_component

    # collapse reference columns down to one column per pin, keeping the best
    pin_ids = sorted({r["pin_id"] for r in r_rows})
    pin_meta = {}
    columns = []
    for pin_id in pin_ids:
        cols = [i for i, r in enumerate(r_rows) if r["pin_id"] == pin_id]
        columns.append(scores[:, cols].max(axis=1))
        first = r_rows[cols[0]]
        pin_meta[pin_id] = {
            "pin_id": pin_id,
            "label": first["pin_label"] or f"(unlabeled #{pin_id})",
            "floorplan_id": first["floorplan_id"],
            "floorplan_name": first["floorplan_name"],
        }
    per_pin = np.column_stack(columns)

    best_idx = per_pin.argmax(axis=1)
    best_score = per_pin.max(axis=1)

    grouped: dict[int, list[tuple[int, float]]] = {}
    unmatched = []
    for i, row in enumerate(q_rows):
        if best_score[i] < MIN_SCORE:
            unmatched.append(row["id"])
            continue
        pin_id = pin_ids[int(best_idx[i])]
        grouped.setdefault(pin_id, []).append((row["id"], float(best_score[i])))

    # queries whose descriptor couldn't be built at all still belong somewhere
    scored_ids = {r["id"] for r in q_rows}
    unmatched.extend(r["id"] for r in queries if r["id"] not in scored_ids)

    groups = []
    for pin_id, entries in grouped.items():
        groups.append(
            {
                **pin_meta[pin_id],
                "photo_ids": [pid for pid, _ in entries],
                "score": round(sum(s for _, s in entries) / len(entries), 3),
            }
        )
    # most trustworthy groups first, so the ones worth accepting wholesale
    # are the ones the user reaches first
    groups.sort(key=lambda g: (-g["score"], -len(g["photo_ids"])))

    return {
        "groups": groups,
        "unmatched": unmatched,
        "computed": computed,
        "reference_photos": len(r_rows),
    }
