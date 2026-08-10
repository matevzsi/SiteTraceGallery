const SVG_NS = "http://www.w3.org/2000/svg";

// Compass convention: 0deg = up (north), increases clockwise — matches
// EXIF GPSImgDirection / typical camera heading semantics.

export function headingToXY(deg, radius) {
  const rad = (deg * Math.PI) / 180;
  return { dx: radius * Math.sin(rad), dy: -radius * Math.cos(rad) };
}

export function xyToHeading(dx, dy) {
  const rad = Math.atan2(dx, -dy);
  let deg = (rad * 180) / Math.PI;
  if (deg < 0) deg += 360;
  return deg;
}

export function svgEl(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

export function clientPointToSvg(svg, clientX, clientY) {
  const pt = svg.createSVGPoint();
  pt.x = clientX;
  pt.y = clientY;
  const ctm = svg.getScreenCTM();
  if (!ctm) return { x: 0, y: 0 };
  const local = pt.matrixTransform(ctm.inverse());
  return { x: local.x, y: local.y };
}
