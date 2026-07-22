// Helpers for drawing National Weather Service surface-analysis front symbols
// along a screen-space polyline (cold-front triangles, warm-front semicircles,
// stationary alternating pips, occluded pips, and plain troughs).

export const FRONT_STYLES = {
  cold: { color: '#2166ac', label: 'Cold front' },
  warm: { color: '#b2182b', label: 'Warm front' },
  occluded: { color: '#762a83', label: 'Occluded front' },
  stationary: { color: '#2166ac', label: 'Stationary front' },
  trough: { color: '#d59a12', label: 'Trough' },
};

// Total pixel length of a screen polyline.
function polylineLength(points) {
  let len = 0;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i][0] - points[i - 1][0];
    const dy = points[i][1] - points[i - 1][1];
    len += Math.hypot(dx, dy);
  }
  return len;
}

// Sample evenly spaced points along the polyline, returning position and the
// unit tangent at each sample.
function sampleAlong(points, spacing, startOffset) {
  const samples = [];
  if (points.length < 2) return samples;
  let target = startOffset;
  let acc = 0;
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1];
    const [x1, y1] = points[i];
    const segLen = Math.hypot(x1 - x0, y1 - y0);
    if (segLen === 0) continue;
    const tx = (x1 - x0) / segLen;
    const ty = (y1 - y0) / segLen;
    while (target <= acc + segLen) {
      const t = target - acc;
      samples.push({ x: x0 + tx * t, y: y0 + ty * t, tx, ty });
      target += spacing;
    }
    acc += segLen;
  }
  return samples;
}

// Rotate a unit tangent 90° to get a normal. side = +1 or -1 chooses which
// side of the line the symbol bulges toward.
function normal(tx, ty, side) {
  return [side * ty, side * -tx];
}

function trianglePath(s, size, side) {
  const [nx, ny] = normal(s.tx, s.ty, side);
  const bx0 = s.x - s.tx * size;
  const by0 = s.y - s.ty * size;
  const bx1 = s.x + s.tx * size;
  const by1 = s.y + s.ty * size;
  const ax = s.x + nx * size * 1.4;
  const ay = s.y + ny * size * 1.4;
  return `M${bx0},${by0}L${bx1},${by1}L${ax},${ay}Z`;
}

function semicirclePath(s, size, side) {
  const [nx, ny] = normal(s.tx, s.ty, side);
  const sweep = side > 0 ? 1 : 0;
  const bx0 = s.x - s.tx * size;
  const by0 = s.y - s.ty * size;
  const bx1 = s.x + s.tx * size;
  const by1 = s.y + s.ty * size;
  // Bulge slightly by nudging control via arc; keep radius = size.
  void nx; void ny;
  return `M${bx0},${by0}A${size},${size} 0 0 ${sweep} ${bx1},${by1}`;
}

/**
 * Draw a single front onto a d3 selection `g`.
 * @param {object} g - d3 selection (a <g> element).
 * @param {Array<[number,number]>} pts - screen-space points [x,y].
 * @param {string} type - one of cold|warm|occluded|stationary|trough.
 * @param {number} scale - overall symbol size multiplier (responsive).
 */
export function drawFront(g, pts, type, scale = 1) {
  if (!pts || pts.length < 2) return;
  const style = FRONT_STYLES[type] || FRONT_STYLES.trough;
  const color = style.color;
  const lineStr = 'M' + pts.map((p) => `${p[0]},${p[1]}`).join('L');
  const size = 4.2 * scale;
  const spacing = 22 * scale;

  if (type === 'trough') {
    g.append('path')
      .attr('d', lineStr)
      .attr('fill', 'none')
      .attr('stroke', color)
      .attr('stroke-width', 1.6 * scale)
      .attr('stroke-dasharray', `${6 * scale},${5 * scale}`);
    return;
  }

  // Base line for the front.
  g.append('path')
    .attr('d', lineStr)
    .attr('fill', 'none')
    .attr('stroke', color)
    .attr('stroke-width', 1.8 * scale)
    .attr('stroke-linejoin', 'round');

  const samples = sampleAlong(pts, spacing, spacing * 0.6);

  if (type === 'cold') {
    samples.forEach((s) => {
      g.append('path').attr('d', trianglePath(s, size, 1)).attr('fill', color);
    });
  } else if (type === 'warm') {
    samples.forEach((s) => {
      g.append('path')
        .attr('d', semicirclePath(s, size, 1))
        .attr('fill', color)
        .attr('stroke', color)
        .attr('stroke-width', 0.5 * scale);
    });
  } else if (type === 'occluded') {
    // Alternate triangle and semicircle on the same side, both purple.
    samples.forEach((s, i) => {
      if (i % 2 === 0) {
        g.append('path').attr('d', trianglePath(s, size, 1)).attr('fill', color);
      } else {
        g.append('path')
          .attr('d', semicirclePath(s, size, 1))
          .attr('fill', color)
          .attr('stroke', color)
          .attr('stroke-width', 0.5 * scale);
      }
    });
  } else if (type === 'stationary') {
    // Blue triangles on one side, red semicircles on the other, alternating.
    samples.forEach((s, i) => {
      if (i % 2 === 0) {
        g.append('path')
          .attr('d', trianglePath(s, size, 1))
          .attr('fill', FRONT_STYLES.cold.color);
      } else {
        g.append('path')
          .attr('d', semicirclePath(s, size, -1))
          .attr('fill', FRONT_STYLES.warm.color)
          .attr('stroke', FRONT_STYLES.warm.color)
          .attr('stroke-width', 0.5 * scale);
      }
    });
  }
}

export { polylineLength };
