"""Compact visual descriptor used to suggest which pin a photo belongs to.

Two blocks, each unit-normalised so a plain dot product between two
descriptors is a weighted sum of two cosine similarities:

* **structure** — a 16x16 grayscale thumbnail, mean-subtracted and scaled to
  unit norm. A dot product between two of these is normalised cross
  correlation, which measures "shot from the same place, framed the same
  way" while ignoring overall brightness and contrast. That matters here:
  the same corner of a building photographed in March and in August differs
  mostly in exposure and weather, not in layout.
* **colour** — a 4x4x4 RGB histogram, square-rooted (Hellinger) and
  normalised, which survives reframing and catches "same materials, same
  light" when the structure block disagrees.

Computed from the stored 400px thumbnail rather than the original, so a
full pass over a few thousand photos is seconds rather than minutes.
"""

import numpy as np
from PIL import Image, ImageOps

# Bump this when the maths below changes: cached vectors record the kind
# they were produced by, so old ones get recomputed instead of being
# silently compared against incompatible new ones.
DESCRIPTOR_KIND = "gray16+rgb666/v2"

GRID = 16
# 6 bins per channel rather than 4: at 4, unrelated images with broadly
# similar palettes collapse into the same handful of bins often enough to
# be matched to the wrong pin. Widening the histogram removed every
# wrong-pin case on the calibration set at no measurable cost.
BINS = 6
STRUCTURE_DIMS = GRID * GRID
COLOUR_DIMS = BINS ** 3
DIMS = STRUCTURE_DIMS + COLOUR_DIMS

# how much each block counts toward the final similarity
STRUCTURE_WEIGHT = 0.62
COLOUR_WEIGHT = 0.38


def _unit(vec: np.ndarray) -> np.ndarray:
    norm = float(np.linalg.norm(vec))
    return vec / norm if norm > 1e-6 else np.zeros_like(vec)


def compute_descriptor(image_path) -> bytes | None:
    """Descriptor for one image, or None if it can't be read."""
    try:
        with Image.open(image_path) as im:
            im = ImageOps.exif_transpose(im)
            rgb = im.convert("RGB")
            gray = np.asarray(rgb.convert("L").resize((GRID, GRID), Image.BILINEAR), dtype=np.float32)
            small = np.asarray(rgb.resize((32, 32), Image.BILINEAR), dtype=np.float32)
    except Exception:
        return None

    structure = _unit(gray.ravel() - gray.mean())

    idx = np.minimum((small / 256.0 * BINS).astype(np.int32), BINS - 1)
    flat = (idx[..., 0] * BINS + idx[..., 1]) * BINS + idx[..., 2]
    hist = np.bincount(flat.ravel(), minlength=COLOUR_DIMS).astype(np.float32)
    colour = _unit(np.sqrt(hist / max(float(hist.sum()), 1.0)))

    # fold the block weights into the vectors so similarity is one dot
    # product rather than two plus bookkeeping
    weighted = np.concatenate(
        [structure * np.sqrt(STRUCTURE_WEIGHT), colour * np.sqrt(COLOUR_WEIGHT)]
    ).astype(np.float32)
    return weighted.tobytes()


def to_array(blob: bytes) -> np.ndarray | None:
    vec = np.frombuffer(blob, dtype=np.float32)
    return vec if vec.size == DIMS else None
