const STOPS = [0x1c554c, 0x176962, 0x168f80, 0x36b7a5, 0x8aeed7, 0xdcfff3];
const DEFAULT_DOMAIN = [-100, -20];
const NEIGHBORS = 12;
const LINE_WIDTH = 5;

// Six equally spaced sRGB anchors across the active display range.
// 六个 sRGB 颜色锚点等距分布在当前显示范围内。
const ramp = new Uint32Array((STOPS.length - 1) * 256 + 1);
for (let i = 1; i < STOPS.length; i++) {
  const a = STOPS[i - 1], b = STOPS[i];
  for (let j = 0; j <= 256; j++) {
    let rgb = 0;
    for (const shift of [16, 8, 0]) {
      const start = (a >> shift) & 255;
      rgb |= Math.round(start + (((b >> shift) & 255) - start) * j / 256) << shift;
    }
    ramp[(i - 1) * 256 + j] = rgb;
  }
}

function displayDomain(domain) {
  return Number.isFinite(domain?.[0]) && Number.isFinite(domain?.[1]) && domain[0] < domain[1]
    ? domain : DEFAULT_DOMAIN;
}

function color(rssi, domain) {
  const t = Math.max(0, Math.min(1, (rssi - domain[0]) / (domain[1] - domain[0])));
  return ramp[Math.round(t * (ramp.length - 1))];
}

/** Map dBm to a CSS hex color, clamped to [minDbm, maxDbm] (default -100 to -20).
 * 将 dBm 映射为 CSS 十六进制颜色；范围外取端点色，默认范围为 -100 至 -20。
 */
export function signalColor(rssi, domain) {
  return `#${color(rssi, displayDomain(domain)).toString(16).padStart(6, '0')}`;
}

function setPixel(data, index, rssi, domain) {
  const rgb = color(rssi, domain);
  data[index] = rgb >> 16;
  data[index + 1] = (rgb >> 8) & 255;
  data[index + 2] = rgb & 255;
  data[index + 3] = 255;
}

function texture(ctx, width, height) {
  const canvas = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(width, height)
    : ctx.canvas.ownerDocument.createElement('canvas');
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  return canvas.getContext('2d');
}

function turn(a, b, c) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

/** Monotone chains around the sorted samples. 沿已排序的测点构建凸包的两条边链。 */
function convexHull(points) {
  const hull = [];
  function append(p, base) {
    while (hull.length >= base + 2 && turn(hull.at(-2), hull.at(-1), p) <= 0) hull.pop();
    hull.push(p);
  }
  for (const p of points) append(p, 0);
  const base = hull.length - 1;
  for (let i = points.length - 2; i >= 0; i--) append(points[i], base);
  hull.pop();
  return hull;
}

// Sample the piecewise linear dBm profile along the segment, at device-pixel resolution.
// 在线段方向按设备像素采样分段线性 dBm 曲线，横向宽度保持不变。
function drawLine(ctx, points, axis, scale, domain) {
  const a = points[0], b = points.at(-1);
  const dx = b.x - a.x, dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  const count = Math.max(2, Math.min(8192, Math.ceil(length * scale) + 1));
  const strip = texture(ctx, count, 1);
  const image = strip.createImageData(count, 1);
  let end = 1;
  for (let i = 0; i < count; i++) {
    const at = a[axis] + (b[axis] - a[axis]) * i / (count - 1);
    while (end < points.length - 1 && points[end][axis] <= at) end++;
    const p = points[end - 1], q = points[end];
    const t = q[axis] === p[axis] ? 1 : Math.max(0, Math.min(1, (at - p[axis]) / (q[axis] - p[axis])));
    setPixel(image.data, i * 4, p.rssi + t * (q.rssi - p.rssi), domain);
  }
  strip.putImageData(image, 0, 0);
  ctx.transform(dx / length, dy / length, -dy / length, dx / length, a.x, a.y);
  ctx.drawImage(strip.canvas, 0.5, 0, count - 1, 1, 0, -LINE_WIDTH / 2, length, LINE_WIDTH);
}

/** Inverse-square IDW; dense surveys use the nearest samples with a smooth radial cutoff.
 * 平方反距离加权；密集测点使用近邻，权重随距离平滑降至零。
 */
function interpolator(points) {
  if (points.length <= 128) return (x, y) => {
    const base = points[0].rssi;
    let total = 0, weights = 0;
    for (const p of points) {
      const d2 = (x - p.x) ** 2 + (y - p.y) ** 2;
      if (d2 === 0) return p.rssi;
      const w = 1 / d2;
      total += w * (p.rssi - base);
      weights += w;
    }
    return base + total / weights;
  };

  // A balanced kd-tree shares one index array; each interval's midpoint is its root.
  // 平衡 kd 树共用一张索引表，每段的中间元素为该子树的根节点。
  const order = Uint32Array.from(points, (_, i) => i);
  function partition(lo, hi, byY) {
    if (hi - lo <= 1) return;
    const axis = byY ? 'y' : 'x';
    order.subarray(lo, hi).sort((i, j) => points[i][axis] - points[j][axis]);
    const mid = (lo + hi) >>> 1;
    partition(lo, mid, !byY);
    partition(mid + 1, hi, !byY);
  }
  partition(0, order.length, false);
  const distances = new Float64Array(NEIGHBORS + 1);
  const readings = new Float64Array(NEIGHBORS + 1);
  let x, y, exact;
  function nearest(lo, hi, byY) {
    if (lo >= hi || exact !== undefined) return;
    const mid = (lo + hi) >>> 1;
    const p = points[order[mid]];
    const dx = x - p.x, dy = y - p.y;
    const d2 = dx * dx + dy * dy;
    if (d2 === 0) { exact = p.rssi; return; }
    const delta = byY ? dy : dx;
    if (delta < 0) nearest(lo, mid, !byY);
    else nearest(mid + 1, hi, !byY);
    if (d2 < distances[0]) {
      // Max-heap root: the outer radius of the current neighborhood.
      // 最大堆的堆顶记录当前近邻范围的外缘。
      let i = 0;
      for (let child = 1; child < distances.length; child = i * 2 + 1) {
        if (child + 1 < distances.length && distances[child + 1] > distances[child]) child++;
        if (distances[child] <= d2) break;
        distances[i] = distances[child]; readings[i] = readings[child];
        i = child;
      }
      distances[i] = d2; readings[i] = p.rssi;
    }
    if (delta * delta <= distances[0]) {
      if (delta < 0) nearest(mid + 1, hi, !byY);
      else nearest(lo, mid, !byY);
    }
  }
  return (px, py) => {
    x = px; y = py; exact = undefined;
    distances.fill(Infinity);
    nearest(0, order.length, false);
    if (exact !== undefined) return exact;
    const radius2 = distances[0];
    let base = 0, total = 0, weights = 0;
    for (let i = 1; i < distances.length; i++) {
      const w = (1 - distances[i] / radius2) ** 2 / distances[i];
      if (!weights) base = readings[i];
      total += w * (readings[i] - base);
      weights += w;
    }
    if (weights) return base + total / weights;
    // At an equidistant ring center, average all tied samples.
    // 在等距圆环的中心，取全部等距测点的平均值。
    let sum = 0, count = 0;
    for (const p of points) if ((px - p.x) ** 2 + (py - p.y) ** 2 <= radius2) { sum += p.rssi; count++; }
    return sum / count;
  };
}

/** Marching squares; the bilinear saddle selects the pairing in four-crossing cells.
 * 行进方格提取等值线；四边均有交点时，按双线性鞍点决定连接方式。
 */
function contours(ctx, field, cols, rows, left, top, sx, sy, low, high, domain) {
  // Select round dBm levels (1, 2 or 5 times a power of ten) strictly inside both ranges.
  // 取显示范围与实测范围内部的整刻度，间距为 1、2 或 5 乘以十的整数次幂。
  const span = domain[1] - domain[0], target = span / 5;
  const power = 10 ** Math.floor(Math.log10(target));
  const factor = target / power;
  const step = (factor < 1.5 ? 1 : factor < 3.5 ? 2 : factor < 7.5 ? 5 : 10) * power;
  const first = Math.floor(Math.max(domain[0], low) / step) + 1;
  const end = Math.ceil(Math.min(domain[1], high) / step);
  const edges = new Float64Array(8);
  ctx.lineWidth = 1;
  ctx.lineCap = 'round';
  for (let i = 0; i < Math.min(8, end - first); i++) {
    const level = (first + i) * step;
    const path = new Path2D();
    function segment(a, b) {
      path.moveTo(edges[a], edges[a + 1]);
      path.lineTo(edges[b], edges[b + 1]);
    }
    for (let j = 0; j < rows - 1; j++) {
      const y = top + j * sy;
      for (let i = 0; i < cols - 1; i++) {
        const k = j * cols + i;
        const a = field[k] - level, b = field[k + 1] - level;
        const c = field[k + cols + 1] - level, d = field[k + cols] - level;
        if ((a >= 0) === (b >= 0) && (a >= 0) === (c >= 0) && (a >= 0) === (d >= 0)) continue;
        const x = left + i * sx;
        let n = 0;
        if ((a >= 0) !== (b >= 0)) { edges[n++] = x + sx * a / (a - b); edges[n++] = y; }
        if ((b >= 0) !== (c >= 0)) { edges[n++] = x + sx; edges[n++] = y + sy * b / (b - c); }
        if ((c >= 0) !== (d >= 0)) { edges[n++] = x + sx * d / (d - c); edges[n++] = y + sy; }
        if ((d >= 0) !== (a >= 0)) { edges[n++] = x; edges[n++] = y + sy * a / (a - d); }
        if (n === 8 && a * c < b * d) { segment(0, 6); segment(2, 4); }
        else { segment(0, 2); if (n === 8) segment(4, 6); }
      }
    }
    ctx.strokeStyle = level <= domain[0] + span * 0.4 ? 'rgba(205, 255, 244, 0.36)' : 'rgba(9, 38, 39, 0.40)';
    ctx.stroke(path);
  }
}

function drawArea(ctx, points, left, top, right, bottom, low, high, domain) {
  const width = right - left, height = bottom - top;
  if (width <= 0 || height <= 0) return;
  const hull = convexHull(points);
  const path = new Path2D();
  path.moveTo(hull[0].x, hull[0].y);
  for (let i = 1; i < hull.length; i++) path.lineTo(hull[i].x, hull[i].y);
  path.closePath();
  if (low === high || high <= domain[0] || low >= domain[1]) {
    ctx.fillStyle = signalColor(low, domain);
    ctx.fill(path);
    return;
  }
  ctx.clip(path);

  // Fill and contours share grid nodes; the hull is clipped at full canvas resolution.
  // 填色和等值线共用采样网格，凸包边缘按画布的实际分辨率裁切。
  const budget = points.length <= 128 ? 20000 : 12000;
  const step = Math.max(3, Math.max(width, height) / 384, Math.sqrt(width * height / budget));
  const cols = Math.ceil(width / step) + 1, rows = Math.ceil(height / step) + 1;
  const sx = width / (cols - 1), sy = height / (rows - 1);
  const sample = interpolator(points);
  const tile = texture(ctx, cols, rows);
  const image = tile.createImageData(cols, rows);
  const field = new Float64Array(cols * rows);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const k = j * cols + i;
      field[k] = sample(left + i * sx, top + j * sy);
      setPixel(image.data, k * 4, field[k], domain);
    }
  }
  tile.putImageData(image, 0, 0);
  ctx.drawImage(tile.canvas, 0.5, 0.5, cols - 1, rows - 1, left, top, width, height);
  contours(ctx, field, cols, rows, left, top, sx, sy, low, high, domain);
}

/** Redraw a transparent canvas in CSS pixels (y down); return empty, point, line or area.
 * The optional [minDbm, maxDbm] controls color and contours; interpolation uses measured dBm.
 * 重绘专用透明画布；坐标为 CSS 像素，y 轴向下。可选范围控制颜色及等值线，插值使用实测 dBm。
 */
export function drawSignalField(canvas, sites, width, height, domain) {
  domain = displayDomain(domain);
  const scale = Math.min(globalThis.devicePixelRatio || 1, 3, 8192 / Math.max(width, height),
    Math.sqrt(8000000 / (width * height)));
  const w = Math.max(0, Math.round(width * scale)) || 0, h = Math.max(0, Math.round(height * scale)) || 0;
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.save();
  try {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (w && h) ctx.setTransform(w / width, 0, 0, h / height, 0, 0);
    ctx.imageSmoothingEnabled = true;
    const valid = sites.filter(p => p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.rssi));
    if (!valid.length) return 'empty';
    let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
    for (const p of valid) {
      left = Math.min(left, p.x); right = Math.max(right, p.x);
      top = Math.min(top, p.y); bottom = Math.max(bottom, p.y);
    }
    if (left === right && top === bottom) return 'point';
    const axis = right - left >= bottom - top ? 'x' : 'y';
    const second = axis === 'x' ? 'y' : 'x';
    valid.sort((a, b) => a[axis] - b[axis] || a[second] - b[second]);
    const points = valid.filter((p, i) => p.x !== valid[i + 1]?.x || p.y !== valid[i + 1]?.y);
    const a = points[0], b = points.at(-1);
    // Only floating-point roundoff counts as collinear; thin measurable triangles keep their hull.
    // 仅在浮点舍入误差内视为共线，可分辨的窄三角形保留其凸包。
    const error = 16 * Number.EPSILON * Math.max(1, Math.abs(left), Math.abs(right), Math.abs(top), Math.abs(bottom));
    const tolerance = error * Math.hypot(b.x - a.x, b.y - a.y);
    if (points.every(p => Math.abs(turn(a, b, p)) <= tolerance)) {
      if (w && h) drawLine(ctx, points, axis, scale, domain);
      return 'line';
    }
    if (w && h) {
      let low = Infinity, high = -Infinity;
      for (const p of points) { low = Math.min(low, p.rssi); high = Math.max(high, p.rssi); }
      drawArea(ctx, points, Math.max(0, left), Math.max(0, top), Math.min(width, right), Math.min(height, bottom), low, high, domain);
    }
    return 'area';
  } finally { ctx.restore(); }
}
