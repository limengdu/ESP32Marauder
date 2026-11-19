const SVG_NS = 'http://www.w3.org/2000/svg';
const COLORS = ['#539e98', '#3b817c', '#25655f', '#134a45', '#08302d'];
const MIN_DBM = -100;
const DBM_STEP = 15;
const POINT_SPACING = 30;
const observers = new WeakMap();

const messages = {
  signalPlotTitle: 'Signal measurement locations',
  signalPlotEmpty: 'No measurements to plot.',
  signalPlotOrientation: 'North ↑ · East →',
  signalPlotLegend: 'Latest signal (dBm)',
  signalPlotIndoor: 'East {x} m, north {y} m',
  signalPlotGeo: 'Longitude {x}°, latitude {y}°',
  signalPlotReading: 'Samples {count} · Latest {rssi} dBm · {time} · {location}',
};

function svg(name, attributes = {}, text = '') {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  if (text) node.textContent = text;
  return node;
}

function html(name, className, text = '') {
  const node = document.createElement(name);
  node.className = className;
  node.textContent = text;
  return node;
}

function signalColor(rssi) {
  const end = COLORS.length - 1;
  const step = Math.max(0, Math.min(end, (rssi - MIN_DBM) / DBM_STEP));
  const index = Math.floor(step);
  if (index === step) return COLORS[index];
  const channels = [1, 3, 5].map((offset) => {
    const start = parseInt(COLORS[index].slice(offset, offset + 2), 16);
    const next = parseInt(COLORS[index + 1].slice(offset, offset + 2), 16);
    return Math.round(start + (next - start) * (step - index));
  });
  return `rgb(${channels.join(', ')})`;
}

/**
 * Project WGS84 surface positions onto the local east and north tangent axes.
 * 将 WGS84 椭球面上的测量位置投影到本地的正东、正北切线轴。
 */
function project(samples) {
  const radians = Math.PI / 180;
  const eccentricitySquared = 6.6943799901413165e-3;
  const first = samples[0].point;
  let west = 0;
  let east = 0;
  let south = first.y;
  let north = first.y;
  for (const sample of samples) {
    let offset = sample.point.x - first.x;
    if (offset > 180) offset -= 360;
    if (offset < -180) offset += 360;
    sample.east = offset;
    west = Math.min(west, offset);
    east = Math.max(east, offset);
    south = Math.min(south, sample.point.y);
    north = Math.max(north, sample.point.y);
  }
  const centerLongitude = (west + east) / 2;
  const centerLatitude = (north + south) * radians / 2;
  const sinCenter = Math.sin(centerLatitude);
  const cosCenter = Math.cos(centerLatitude);
  for (const sample of samples) {
    const longitude = (sample.east - centerLongitude) * radians;
    const latitude = sample.point.y * radians;
    const sin = Math.sin(latitude);
    const radius = 6378137 / Math.sqrt(1 - eccentricitySquared * sin ** 2);
    const horizontal = Math.abs(sample.point.y) === 90 ? 0 : radius * Math.cos(latitude);
    const vertical = radius * (1 - eccentricitySquared) * sin;
    sample.east = horizontal * Math.sin(longitude);
    sample.north = vertical * cosCenter - horizontal * Math.cos(longitude) * sinCenter;
  }
}

function measurements(points, system) {
  const samples = [];
  for (const point of points) {
    if (!point || typeof point.time !== 'string' || ![point.x, point.y, point.rssi].every(Number.isFinite)) continue;
    if (system === 'geo' && (Math.abs(point.x) > 180 || Math.abs(point.y) > 90)) continue;
    const time = Date.parse(point.time);
    if (Number.isFinite(time)) samples.push({ point, time, east: point.x, north: point.y });
  }
  if (system === 'geo' && samples.length) project(samples);
  // Equal timestamps retain the last input reading first.
  // 时间相同时，靠后的输入记录排在前面。
  return samples.reverse().sort((a, b) => b.time - a.time);
}

/**
 * Group colliding marks around the newest actual observation in screen space.
 * 在屏幕上将重叠的读数归入最近的标记，各标记位于组内最新的实测坐标。
 */
function groupSamples(samples, position, selected) {
  const cells = new Map();
  const groups = [];
  let selectedGroup;
  for (const sample of samples) {
    const { x, y } = position(sample);
    const col = Math.floor(x / POINT_SPACING);
    const row = Math.floor(y / POINT_SPACING);
    let closest;
    let distance = POINT_SPACING ** 2;
    for (let i = col - 1; i <= col + 1; i++) {
      for (let j = row - 1; j <= row + 1; j++) {
        for (const group of cells.get(`${i},${j}`) ?? []) {
          const squared = (x - group.x) ** 2 + (y - group.y) ** 2;
          if (squared < distance) {
            distance = squared;
            closest = group;
          }
        }
      }
    }
    if (!closest) {
      closest = { x, y, latest: sample, count: 0 };
      groups.push(closest);
      const key = `${col},${row}`;
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key).push(closest);
    }
    closest.count++;
    if (sample === selected) selectedGroup = closest;
  }
  return { groups, selectedGroup };
}

function drawScale(plot, metersPerPixel, width, height) {
  const target = Math.min(100, width / 3) * metersPerPixel;
  const power = 10 ** Math.floor(Math.log10(target));
  const step = target / power;
  const meters = (step >= 5 ? 5 : step >= 2 ? 2 : 1) * power;
  const length = meters / metersPerPixel;
  const label = meters >= 1000 ? `${Number((meters / 1000).toPrecision(3))} km` : `${Number(meters.toPrecision(3))} m`;
  plot.append(svg('path', { class: 'signal-plot-scale', d: `M16 ${height - 18} v4 h${length} v-4` }),
    svg('text', { class: 'signal-plot-distance', x: 24 + length, y: height - 11 }, label));
}

function legend(text) {
  const box = html('div', 'signal-plot-legend');
  const ramp = html('div', 'signal-plot-ramp');
  const ticks = html('div', 'signal-plot-ticks');
  const stops = COLORS.map((color, i) => `${color} ${(i + 0.5) * 100 / COLORS.length}%`);
  ramp.style.backgroundImage = `linear-gradient(to right, ${stops.join(', ')})`;
  ramp.setAttribute('aria-hidden', 'true');
  COLORS.forEach((_, i) => {
    const bound = i === 0 ? '≤' : i === COLORS.length - 1 ? '≥' : '';
    ticks.append(html('span', 'signal-plot-tick', `${bound}${MIN_DBM + i * DBM_STEP}`));
  });
  box.append(html('strong', 'signal-plot-legend-title', text('signalPlotLegend')), ramp, ticks);
  return box;
}

/**
 * Render one source in a dedicated div. The caller supplies its coordinate system and translations.
 * 在专用容器内绘制单一来源的读数，由调用方提供坐标系和翻译。
 */
export function renderSignalPlot(container, points, system, translate) {
  if (system !== 'indoor' && system !== 'geo') throw new RangeError('Unknown signal plot coordinate system');
  function text(key, params = {}) {
    const value = translate?.(key, params);
    if (typeof value === 'string' && value && value !== key) return value;
    return messages[key].replace(/\{(\w+)\}/g, (_, name) => String(params[name]));
  }

  const samples = measurements(points, system);
  const figure = html('figure', 'signal-plot');
  figure.setAttribute('aria-label', text('signalPlotTitle'));
  observers.get(container)?.disconnect();
  observers.delete(container);
  container.replaceChildren(figure);
  if (!samples.length) {
    figure.append(html('p', 'signal-plot-empty', text('signalPlotEmpty')), legend(text));
    return;
  }

  const plot = svg('svg', { class: 'signal-plot-map', role: 'group', 'aria-label': text('signalPlotTitle') });
  const detail = html('p', 'signal-plot-detail');
  figure.append(html('div', 'signal-plot-orientation', text('signalPlotOrientation')), plot, legend(text), detail);
  let west = samples[0].east;
  let east = west;
  let south = samples[0].north;
  let north = south;
  for (const sample of samples) {
    west = Math.min(west, sample.east);
    east = Math.max(east, sample.east);
    south = Math.min(south, sample.north);
    north = Math.max(north, sample.north);
  }
  let selected = samples[0];
  let lastWidth = 0;
  let lastHeight = 0;

  function draw() {
    const width = plot.clientWidth || 320;
    const height = plot.clientHeight || 220;
    if (width === lastWidth && height === lastHeight) return;
    lastWidth = width;
    lastHeight = height;
    const restoreFocus = plot.contains(document.activeElement);
    const innerWidth = Math.max(1, width - 36);
    const innerHeight = Math.max(1, height - 64);
    const metersPerPixel = Math.max((east - west) / innerWidth, (north - south) / innerHeight) || 1 / 24;
    const { groups, selectedGroup } = groupSamples(samples, (sample) => ({
      x: width / 2 + ((sample.east - west) - (east - west) / 2) / metersPerPixel,
      y: 18 + innerHeight / 2 - ((sample.north - south) - (north - south) / 2) / metersPerPixel,
    }), selected);
    plot.replaceChildren();
    plot.setAttribute('viewBox', `0 0 ${width} ${height}`);
    drawScale(plot, metersPerPixel, width, height);
    let current;
    for (const group of groups) {
      const { point } = group.latest;
      const location = text(system === 'geo' ? 'signalPlotGeo' : 'signalPlotIndoor', { x: point.x, y: point.y });
      const label = text('signalPlotReading', { count: group.count, rssi: point.rssi, time: point.time, location });
      const mark = svg('g', { class: 'signal-plot-point', transform: `translate(${group.x} ${group.y})`,
        tabindex: 0, role: 'img', 'aria-label': label });
      mark.append(svg('title', {}, label), svg('circle', { r: 14, class: 'signal-plot-hit' }),
        svg('circle', { r: group.count > 1 ? 13 : 6, fill: signalColor(point.rssi), class: 'signal-plot-dot' }));
      if (group.count > 1) {
        mark.append(svg('circle', { r: 9, class: 'signal-plot-center' }),
          svg('text', { class: 'signal-plot-count', y: 3.5 }, group.count > 99 ? '99+' : String(group.count)));
      }
      function select() {
        current?.classList.remove('is-current');
        current = mark;
        mark.classList.add('is-current');
        selected = group.latest;
        detail.textContent = label;
      }
      mark.addEventListener('focus', select);
      mark.addEventListener('click', select);
      plot.append(mark);
      if (group === selectedGroup) {
        select();
        if (restoreFocus) mark.focus({ preventScroll: true });
      }
    }
  }

  draw();
  if (typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver(draw);
    observer.observe(plot);
    observers.set(container, observer);
  }
}
