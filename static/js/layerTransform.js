// Maps between a floorplan layer's own normalized (0..1) image coordinates
// and pixel coordinates within the (untransformed) plan container, honoring
// the layer's offset/scale/rotation relative to the site plan. Kept in one
// place because the pin-placement click handler and the direction-arrow
// overlay both need exactly the same math, just in opposite directions.
export function getTransform(activeFp, containerEl) {
  const CW = containerEl.clientWidth;
  const CH = containerEl.clientHeight;

  if (!activeFp || activeFp.is_site_plan) {
    return {
      toLocal: (px, py) => ({ x: px / CW, y: py / CH }),
      toScreen: (nx, ny) => ({ x: nx * CW, y: ny * CH }),
    };
  }

  const cx = activeFp.offset_x * CW;
  const cy = activeFp.offset_y * CH;
  const Wp = activeFp.scale * CW;
  const Hp = Wp * (activeFp.height_px / activeFp.width_px);
  const rad = (activeFp.rotation_deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  return {
    toLocal(px, py) {
      const dx = px - cx;
      const dy = py - cy;
      // inverse rotation
      const rx = dx * cos + dy * sin;
      const ry = -dx * sin + dy * cos;
      return { x: (rx + Wp / 2) / Wp, y: (ry + Hp / 2) / Hp };
    },
    toScreen(nx, ny) {
      const ox = nx * Wp - Wp / 2;
      const oy = ny * Hp - Hp / 2;
      const rx = ox * cos - oy * sin;
      const ry = ox * sin + oy * cos;
      return { x: cx + rx, y: cy + ry };
    },
  };
}
