import { drawSignalField, signalColor } from './signal-field.js?v=1';

const SVG_NS = 'http://www.w3.org/2000/svg';
const observers = new WeakMap();

function svg(name, attributes = {}, text = '') {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  node.textContent = text;
  return node;
}

function html(name, className, text = '') {
  const node = document.createElement(name);
  node.className = className;
  node.textContent = text;
  return node;
}

/** Project WGS84 positions onto local east and north axes, including across the date line. */
function project(sites) {
  const radians = Math.PI / 180;
  const eccentricitySquared = 6.6943799901413165e-3;
  const first = sites[0].point;
  let west = 0;
  let east = 0;
  let south = first.y;
  let north = first.y;
  for (const site of sites) {
    let offset = site.point.x - first.x;
    if (offset > 180) offset -= 360;
    if (offset < -180) offset += 360;
    site.east = offset;
    west = Math.min(west, offset);
    east = Math.max(east, offset);
    south = Math.min(south, site.point.y);
    north = Math.max(north, site.point.y);
  }
  const centerLongitude = (west + east) / 2;
  const centerLatitude = (north + south) * radians / 2;
  const sinCenter = Math.sin(centerLatitude);
  const cosCenter = Math.cos(centerLatitude);
  for (const site of sites) {
    const longitude = (site.east - centerLongitude) * radians;
    const latitude = site.point.y * radians;
    const sin = Math.sin(latitude);
    const radius = 6378137 / Math.sqrt(1 - eccentricitySquared * sin ** 2);
    const horizontal = Math.abs(site.point.y) === 90 ? 0 : radius * Math.cos(latitude);
    const vertical = radius * (1 - eccentricitySquared) * sin;
    site.east = horizontal * Math.sin(longitude);
    site.north = vertical * cosCenter - horizontal * Math.cos(longitude) * sinCenter;
  }
}

/** Keep the latest reading at each physical location, independently of screen size. */
function measuredSites(points, system) {
  const locations = new Map();
  for (const point of points) {
    const time = Date.parse(point?.time);
    if (!point || ![point.x, point.y, point.rssi, time].every(Number.isFinite)) continue;
    if (system === 'geo' && (Math.abs(point.x) > 180 || Math.abs(point.y) > 90)) continue;
    const key = `${point.x},${point.y}`;
    const site = locations.get(key);
    if (site) {
      site.count++;
      if (time >= site.time) Object.assign(site, { point, time });
    } else locations.set(key, { point, time, count: 1, east: point.x, north: point.y });
  }
  const sites = [...locations.values()].sort((a, b) => a.time - b.time);
  if (sites.length && system === 'geo') project(sites);
  return sites;
}

function niceDistance(limit) {
  const power = 10 ** Math.floor(Math.log10(limit));
  const step = limit / power;
  return (step >= 5 ? 5 : step >= 2 ? 2 : 1) * power;
}

// Grid lines, compass and scale share the same metres-per-pixel transform as the observations.
// 网格、方向和比例尺与测点共用同一个米制坐标变换。
function drawGrid(layer, view, t) {
  const { width, height, scale, px, py, eastAt, northAt } = view;
  const major = niceDistance(Math.min(115, width / 4) * scale);
  let path = '';
  const stepPixels = major / scale;
  const firstX = px(Math.ceil(eastAt(0) / major) * major);
  const firstY = py(Math.floor(northAt(0) / major) * major);
  for (let x = firstX; x <= width; x += stepPixels) path += `M${x} 0V${height}`;
  for (let y = firstY; y <= height; y += stepPixels) path += `M0 ${y}H${width}`;
  layer.append(svg('path', { class: 'field-grid', d: path }));
  const [factor, unit] = major >= 1000 ? [0.001, 'km'] : major >= 1 ? [1, 'm'] : major >= 0.01 ? [100, 'cm'] : [1000, 'mm'];
  const distance = `${Number((major * factor).toPrecision(3))} ${unit}`;
  layer.append(svg('path', { class: 'field-scale', d: `M16 ${height - 18}v4h${stepPixels}v-4` }),
    svg('text', { class: 'field-axis-label', x: 16, y: height - 23 }, t('mapGridDistance', { distance })));
  const compass = svg('g', { transform: `translate(${width - 20} 19)`, 'aria-hidden': true });
  compass.append(svg('text', { class: 'field-axis-label', 'text-anchor': 'middle', y: 0 }, 'N'),
    svg('path', { class: 'field-north', d: 'M0 5l-4 12 4-3 4 3z' }));
  layer.append(compass);
}

function drawExamplePlan(layer, { px, py }) {
  const walls = [
    [[-0.6, -0.55], [12.6, -0.55], [12.6, 6.55], [-0.6, 6.55], [-0.6, -0.55]],
    [[5.1, 6.55], [5.1, 2.5]], [[5.1, 1.4], [5.1, -0.55]],
    [[9.1, 6.55], [9.1, 4.4]], [[9.1, 3.3], [9.1, 1.5], [12.6, 1.5]],
  ];
  const d = walls.map((wall) => wall.map(([x, y], i) => `${i ? 'L' : 'M'}${px(x)} ${py(y)}`).join(' ')).join(' ');
  layer.append(svg('path', { class: 'field-walls', d }));
}

// Markers, interpolated values and the legend share the latest measured level at each site.
// 测点、热区和图例共用各位置最新读数的最小值和最大值。
function signalDomain(sites) {
  if (!sites.length) return null;
  let low = sites[0].point.rssi, high = low;
  for (const { point } of sites) {
    low = Math.min(low, point.rssi);
    high = Math.max(high, point.rssi);
  }
  return [low, high];
}

function legend(t, domain) {
  const box = html('div', 'field-legend');
  if (!domain) return box;
  const [low, high] = domain;
  const ramp = html('div', 'field-ramp');
  ramp.setAttribute('aria-hidden', 'true');
  const labels = html('div', 'field-ticks');
  if (low === high) {
    ramp.style.backgroundColor = signalColor(low, domain);
    labels.append(html('span', '', String(low)));
  } else {
    const span = high - low;
    const stops = Array.from({ length: 6 }, (_, i) => signalColor(low + span * i / 5, domain));
    ramp.style.backgroundImage = `linear-gradient(90deg, ${stops.join(',')})`;
    const ticks = span > 2 ? [low, (low + high) / 2, high] : Array.from({ length: span + 1 }, (_, i) => low + i);
    for (const tick of ticks) labels.append(html('span', '', String(tick)));
  }
  box.append(html('strong', '', t('signalPlotLegend')), ramp, labels);
  return box;
}

/** Render the map and return a lightweight setter for the proposed indoor recording position. */
export function renderSignalPlot(container, points, system, t, { example = false, title = '', onPick } = {}) {
  observers.get(container)?.disconnect();
  observers.delete(container);
  const sites = measuredSites(points, system);
  const domain = signalDomain(sites);
  const figure = html('figure', 'signal-plot');
  figure.setAttribute('aria-label', t('signalPlotTitle'));
  const head = html('header', 'field-head');
  const identity = html('div', 'field-identity');
  identity.append(html('span', 'field-meta', t(example ? 'mapSimulated' : 'mapMeasuredSites', { count: sites.length })),
    html('strong', 'field-title', title));
  const reading = html('div', 'field-reading');
  const value = html('strong', 'field-value', '—');
  reading.append(value, html('small', '', 'dBm'));
  head.append(identity, reading);
  const stage = html('div', 'field-stage');
  const field = html('canvas', 'field-canvas');
  field.setAttribute('aria-hidden', 'true');
  const plot = svg('svg', { class: 'signal-plot-map', role: 'group', 'aria-label': t('signalPlotTitle') });
  if (onPick) plot.classList.add('can-pick');
  stage.append(field, plot);
  const foot = html('div', 'field-foot');
  const guide = html('p', 'field-guide');
  foot.append(guide, legend(t, domain));
  const detail = html('figcaption', 'signal-plot-detail');
  figure.append(head, stage, foot, detail);
  container.replaceChildren(figure);

  let selected = sites.at(-1);
  let cursor;
  let proposed = {};
  let fitProposed = false;
  let view;
  function positionCursor() {
    if (!cursor || !view) return;
    const { east, north } = proposed;
    const visible = onPick && [east, north].every(Number.isFinite) &&
      !sites.some((site) => site.east === east && site.north === north);
    cursor.style.display = visible ? '' : 'none';
    if (visible) cursor.setAttribute('transform', `translate(${view.px(east)} ${view.py(north)})`);
  }
  function moveCursor(east, north, typed = false) {
    const refit = fitProposed || (typed && onPick && (!view || view.px(east) < 14 || view.px(east) > view.width - 14 ||
      view.py(north) < 14 || view.py(north) > view.height - 14));
    proposed = { east, north };
    fitProposed = Boolean(refit && typed && onPick && Number.isFinite(east) && Number.isFinite(north) &&
      Math.abs(east) <= 1000000 && Math.abs(north) <= 1000000);
    if (refit) draw(true);
    else positionCursor();
  }
  function draw(force = false) {
    const width = stage.clientWidth;
    const height = stage.clientHeight;
    if (!width || !height || (!force && view?.width === width && view.height === height)) return;
    const focus = plot.contains(document.activeElement);
    const anchor = sites[0] || (fitProposed ? proposed : { east: 0, north: 0 });
    let west = anchor.east, east = west, south = anchor.north, north = south;
    for (const site of sites) {
      west = Math.min(west, site.east); east = Math.max(east, site.east);
      south = Math.min(south, site.north); north = Math.max(north, site.north);
    }
    if (fitProposed) {
      west = Math.min(west, proposed.east); east = Math.max(east, proposed.east);
      south = Math.min(south, proposed.north); north = Math.max(north, proposed.north);
    }
    const innerWidth = Math.max(1, width - Math.min(100, width * 0.22));
    const innerHeight = Math.max(1, height - Math.min(92, height * 0.24));
    const scale = Math.max((east - west) / innerWidth, (north - south) / innerHeight) || 6 / innerHeight;
    const centerX = (west + east) / 2, centerY = (south + north) / 2;
    const px = (x) => width / 2 + (x - centerX) / scale;
    const py = (y) => height / 2 - (y - centerY) / scale;
    view = { width, height, scale, px, py, eastAt: (x) => centerX + (x - width / 2) * scale, northAt: (y) => centerY - (y - height / 2) * scale };
    plot.setAttribute('viewBox', `0 0 ${width} ${height}`);
    plot.replaceChildren();
    const pixels = sites.map((site) => ({ x: px(site.east), y: py(site.north), rssi: site.point.rssi }));
    const mode = drawSignalField(field, pixels, width, height, domain);
    figure.dataset.coverage = mode;
    guide.textContent = t({ empty: 'mapFieldEmpty', point: 'mapFieldPoint', line: 'mapFieldLine', area: 'mapFieldArea' }[mode]);
    drawGrid(plot, view, t);
    if (example) drawExamplePlan(plot, view);
    let current;
    const callout = svg('g', { class: 'field-callout', 'aria-hidden': true });
    const tag = svg('text', { x: 8, y: 15 });
    callout.append(svg('rect', { width: 65, height: 23, rx: 5 }), tag);
    for (const [i, site] of sites.entries()) {
      const { point } = site;
      const { x, y } = pixels[i];
      const location = t(system === 'geo' ? 'signalPlotGeo' : 'signalPlotIndoor', { x: point.x, y: point.y });
      const label = example ? `${location} · ${point.rssi} dBm` : t('signalPlotReading', { count: site.count, rssi: point.rssi,
        time: new Date(site.time).toLocaleTimeString(document.documentElement.lang), location });
      const mark = svg('g', { class: 'signal-plot-point', transform: `translate(${x} ${y})`, tabindex: 0, role: 'button', 'aria-label': label });
      mark.append(svg('title', {}, label), svg('circle', { r: 13, class: 'field-hit' }),
        svg('circle', { r: 9, class: 'field-halo' }), svg('circle', { r: 5.5, class: 'field-dot', fill: signalColor(point.rssi, domain) }));
      if (sites.length <= 5 && !pixels.some((other, j) => i !== j && Math.abs(other.x - x) < 75 && Math.abs(other.y - y) < 28)) {
        const left = x + 65 > width;
        mark.append(svg('text', { class: 'field-site-label', x: left ? -10 : 10, y: -11,
          'text-anchor': left ? 'end' : 'start' }, `${point.rssi} dBm`));
      }
      function select() {
        current?.classList.remove('is-current');
        current = mark;
        mark.classList.add('is-current');
        selected = site;
        value.textContent = point.rssi;
        tag.textContent = `${point.rssi} dBm`;
        callout.setAttribute('transform', `translate(${Math.max(2, Math.min(width - 67, x + 11))} ${Math.max(2, y - 31)})`);
        detail.textContent = label;
      }
      const activate = () => { select(); onPick?.(point.x, point.y); };
      mark.addEventListener('pointerenter', select);
      mark.addEventListener('focus', select);
      mark.addEventListener('click', (event) => { event.stopPropagation(); activate(); });
      mark.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activate(); }
      });
      plot.append(mark);
      if (site === selected) { select(); if (focus) mark.focus({ preventScroll: true }); }
    }
    if (sites.length) plot.append(callout);
    cursor = svg('g', { class: 'field-cursor', 'aria-hidden': true });
    cursor.append(svg('circle', { r: 8 }), svg('path', { d: 'M-13 0h7m12 0h7M0 -13v7m0 12v7' }));
    plot.append(cursor);
    positionCursor();
    if (!sites.length) detail.textContent = t(onPick ? 'mapFieldPick' : 'signalPlotEmpty');
  }
  if (onPick) plot.addEventListener('click', (event) => {
    if (!view) return;
    const rect = plot.getBoundingClientRect();
    const east = view.eastAt((event.clientX - rect.left) * view.width / rect.width);
    const north = view.northAt((event.clientY - rect.top) * view.height / rect.height);
    const decimals = Math.min(9, Math.max(0, -Math.floor(Math.log10(view.scale * 2))));
    onPick(Number(east.toFixed(decimals)), Number(north.toFixed(decimals)));
  });
  draw();
  if (typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver(() => draw());
    observer.observe(stage);
    observers.set(container, observer);
  }
  return moveCursor;
}
