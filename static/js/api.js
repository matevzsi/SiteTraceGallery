const JSON_HEADERS = { "Content-Type": "application/json" };

async function handle(res) {
  if (res.status === 204) return null;
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* no body */
  }
  if (!res.ok) {
    const err = new Error((body && body.error) || `HTTP ${res.status}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

export const api = {
  // floorplans
  listFloorplans: () => fetch("/api/floorplans").then(handle),
  createFloorplan: (formData) =>
    fetch("/api/floorplans", { method: "POST", body: formData }).then(handle),
  replaceFloorplanImage: (id, formData) =>
    fetch(`/api/floorplans/${id}/image`, { method: "POST", body: formData }).then(handle),
  updateFloorplan: (id, fields) =>
    fetch(`/api/floorplans/${id}`, {
      method: "PATCH",
      headers: JSON_HEADERS,
      body: JSON.stringify(fields),
    }).then(handle),
  deleteFloorplan: (id) =>
    fetch(`/api/floorplans/${id}`, { method: "DELETE" }).then(handle),

  // pins
  listAllPins: () => fetch(`/api/pins`).then(handle),
  listPins: (floorplanId) => fetch(`/api/floorplans/${floorplanId}/pins`).then(handle),
  createPin: (floorplanId, fields) =>
    fetch(`/api/floorplans/${floorplanId}/pins`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify(fields),
    }).then(handle),
  updatePin: (id, fields) =>
    fetch(`/api/pins/${id}`, {
      method: "PATCH",
      headers: JSON_HEADERS,
      body: JSON.stringify(fields),
    }).then(handle),
  deletePin: (id, photosDecision) =>
    fetch(`/api/pins/${id}${photosDecision ? `?photos=${photosDecision}` : ""}`, {
      method: "DELETE",
    }).then(handle),

  // photos
  unassignedPhotos: (offset = 0, limit = 60) =>
    fetch(`/api/photos/unassigned?offset=${offset}&page_size=${limit}`).then(handle),
  pinPhotos: (pinId) => fetch(`/api/pins/${pinId}/photos`).then(handle),
  getPhoto: (id) => fetch(`/api/photos/${id}`).then(handle),
  updatePhoto: (id, fields) =>
    fetch(`/api/photos/${id}`, {
      method: "PATCH",
      headers: JSON_HEADERS,
      body: JSON.stringify(fields),
    }).then(handle),
  bulkAssign: (photoIds, pinId) =>
    fetch(`/api/photos/bulk-assign`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ photo_ids: photoIds, pin_id: pinId }),
    }).then(handle),
  deletePhoto: (id) => fetch(`/api/photos/${id}`, { method: "DELETE" }).then(handle),
  bulkDeletePhotos: (photoIds) =>
    fetch(`/api/photos/bulk-delete`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ photo_ids: photoIds }),
    }).then(handle),
  startImport: (sourceDir) =>
    fetch(`/api/photos/import`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ source_dir: sourceDir }),
    }).then(handle),
  importStatus: (jobId) => fetch(`/api/photos/import/${jobId}`).then(handle),
};

export function photoUrl(filename) {
  return `/media/photos/${encodeURIComponent(filename)}`;
}
export function thumbUrl(filename) {
  return `/media/thumbnails/${encodeURIComponent(filename)}`;
}
export function floorplanUrl(filename) {
  return `/media/floorplans/${encodeURIComponent(filename)}`;
}
