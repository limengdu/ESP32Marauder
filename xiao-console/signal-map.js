import { renderSignalPlot } from './signal-plot.js?v=1';

const STORAGE_PREFIX = 'xiao.signal-map.v1.';
const ADDRESS = /^(?:[\da-f]{2}:){5}[\da-f]{2}$/i;
const byId = (id) => document.getElementById(`map-${id}`);

function validPosition(system, x, y) {
  return Number.isFinite(x) && Number.isFinite(y) &&
    (system === 'geo' ? Math.abs(x) <= 180 && Math.abs(y) <= 90
      : system === 'indoor' && Math.abs(x) <= 1000000 && Math.abs(y) <= 1000000);
}

function validSignal(radio, rssi) {
  return Number.isInteger(rssi) && rssi >= -127 && rssi <= (radio === 'ble' ? 20 : 0);
}

function validPoint(p) {
  return p && ['wifi', 'ble'].includes(p.radio) && typeof p.address === 'string' && ADDRESS.test(p.address) &&
    typeof p.name === 'string' && validSignal(p.radio, p.rssi) &&
    validPosition(p.system, p.x, p.y) && Number.isFinite(Date.parse(p.time));
}

/** Pair the next matching radio observation with the position of an explicit recording request. */
export function setupSignalMap({ translate: t, exportCsv, scan, stop }) {
  const radio = byId('radio');
  const target = byId('target');
  const position = byId('position');
  const x = byId('x');
  const y = byId('y');
  const points = new Map();
  const live = { wifi: new Map(), ble: new Map() };
  let device = {};
  let pending = null;
  let message = '';
  let params = {};
  let optionsDirty = true;
  let plotDirty = true;
  let storageFailed = false;
  let lastReading = null;
  const system = () => position.value === 'indoor' ? 'indoor' : 'geo';
  const listening = () => device.ready && device.task === 'scanning' &&
    device.taskKind === (radio.value === 'wifi' ? 'beacon' : 'bleSurvey');
  const currentPoints = () => [...points.values()].filter((p) =>
    p.radio === radio.value && p.address === target.value && p.system === system()).sort((a, b) => a.time.localeCompare(b.time));

  function loadPoint(key, value) {
    if (!key?.startsWith(STORAGE_PREFIX)) return;
    if (value === null) points.delete(key);
    else {
      try {
        const point = JSON.parse(value);
        if (validPoint(point)) points.set(key, point);
      } catch { return; }
    }
    optionsDirty = plotDirty = true;
  }

  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(STORAGE_PREFIX)) loadPoint(key, localStorage.getItem(key));
    }
  } catch { storageFailed = true; }
  window.addEventListener('storage', (event) => {
    if (event.key === null) { points.clear(); optionsDirty = plotDirty = true; }
    else loadPoint(event.key, event.newValue);
    render();
  });

  function updateOptions() {
    const previous = target.value;
    const names = new Map(live[radio.value]);
    let latest;
    for (const p of points.values()) {
      if (p.radio !== radio.value) continue;
      if (!names.get(p.address)) names.set(p.address, p.name);
      if (p.system === system() && (!latest || latest.time < p.time)) latest = p;
    }
    const options = [...names].map(([address, name]) => [address, name ? `${name} · ${address}` : address]);
    options.sort((a, b) => a[1].localeCompare(b[1]));
    target.replaceChildren(new Option(t('mapPick'), ''), ...options.map(([address, label]) => new Option(label, address)));
    if (names.has(previous)) target.value = previous;
    else if (latest) target.value = latest.address;
    if (target.value !== previous) plotDirty = true;
    optionsDirty = false;
  }

  function renderPoints() {
    const visible = currentPoints();
    byId('count').textContent = t('mapCount', { count: visible.length });
    byId('export').disabled = byId('clear').disabled = !visible.length;
    byId('details').hidden = !visible.length;
    renderSignalPlot(byId('plot'), visible, system(), t);
    const labelX = t(system() === 'indoor' ? 'mapX' : 'mapLon');
    const labelY = t(system() === 'indoor' ? 'mapY' : 'mapLat');
    byId('x-label').textContent = byId('col-x').textContent = labelX;
    byId('y-label').textContent = byId('col-y').textContent = labelY;
    byId('rows').replaceChildren(...visible.slice().reverse().map((p) => {
      const row = document.createElement('tr');
      for (const value of [new Date(p.time).toLocaleString(device.locale), p.x, p.y, p.rssi]) {
        const cell = document.createElement('td');
        cell.textContent = value;
        row.append(cell);
      }
      return row;
    }));
    plotDirty = false;
  }

  function render() {
    if (optionsDirty) updateOptions();
    if (plotDirty) renderPoints();
    const active = listening();
    const idle = device.task === 'idle';
    const automatic = position.value === 'browser';
    const coordsValid = automatic || validPosition(system(), x.valueAsNumber, y.valueAsNumber);
    byId('coordinates').hidden = automatic;
    byId('scan').textContent = t(active ? 'mapStop' : 'mapListen');
    byId('scan').disabled = !device.ready || device.busy || (!active && !idle);
    byId('record').disabled = !active || device.busy || !target.value || !coordsValid || !!pending;
    radio.disabled = !!device.ready && !idle;
    target.disabled = position.disabled = x.disabled = y.disabled = !!pending;
    const hint = !device.ready ? 'mapConnect' : !active ? (idle ? 'mapStartHint' : 'mapOtherTask')
      : !target.value ? 'mapSelectHint' : !coordsValid ? 'mapCoordHint' : 'mapReady';
    let text = t(message || hint, params);
    if (active && lastReading) text += ` · ${t('mapLatest', { rssi: lastReading.rssi, time: new Date(lastReading.time).toLocaleTimeString(device.locale) })}`;
    if (storageFailed) text += ` ${t('mapStorageFailed')}`;
    if (byId('status').textContent !== text) byId('status').textContent = text;
  }

  function finish(key = '', values = {}) {
    clearTimeout(pending?.timer);
    pending = null;
    message = key;
    params = values;
  }

  // Each saved point has its own key so simultaneous tabs can append independently.
  // 每个测点独立保存，多个标签页可同时追加。
  function save(sample) {
    const key = STORAGE_PREFIX + crypto.randomUUID();
    points.set(key, sample);
    try { localStorage.setItem(key, JSON.stringify(sample)); }
    catch { storageFailed = true; }
    plotDirty = true;
    finish('mapRecorded', { rssi: sample.rssi, x: sample.x, y: sample.y });
    render();
  }

  function observe(kind, mac, rawName, rssi, channel = null) {
    if (!ADDRESS.test(mac) || !validSignal(kind, rssi)) return;
    const address = mac.toLowerCase();
    const name = (rawName || '').trim().slice(0, 80);
    const sources = live[kind];
    if (!sources.has(address) || (name && sources.get(address) !== name)) {
      sources.set(address, name || sources.get(address) || '');
      if (radio.value === kind) optionsDirty = true;
    }
    if (radio.value !== kind || target.value !== address) return;
    const time = Date.now();
    lastReading = { rssi, time };
    if (!pending?.coords || !listening() || pending.address !== address || device.busy) return;
    const { coords, source } = pending;
    save({ radio: kind, address, name: sources.get(address), channel, rssi, time: new Date(time).toISOString(),
      system: system(), source, ...coords });
  }

  function record() {
    if (byId('record').disabled || pending) return;
    const request = { address: target.value, source: position.value, coords: null, timer: 0 };
    pending = request;
    const waitForSignal = (coords) => {
      if (pending !== request) return;
      if (!validPosition(system(), coords.x, coords.y)) { finish('mapLocationFailed'); render(); return; }
      request.coords = coords;
      message = 'mapWaiting';
      request.timer = setTimeout(() => { if (pending === request) { finish('mapTimeout'); render(); } }, 30000);
      render();
    };
    if (position.value !== 'browser') { waitForSignal({ x: x.valueAsNumber, y: y.valueAsNumber }); return; }
    message = 'mapLocating';
    render();
    const failed = () => { if (pending === request) { finish('mapLocationFailed'); render(); } };
    if (!navigator.geolocation) { failed(); return; }
    navigator.geolocation.getCurrentPosition((fix) => {
      if (Date.now() - fix.timestamp > 15000) { failed(); return; }
      waitForSignal({ x: fix.coords.longitude, y: fix.coords.latitude, accuracy: fix.coords.accuracy });
    }, failed, { enableHighAccuracy: true, maximumAge: 0, timeout: 12000 });
  }

  byId('record').addEventListener('click', record);
  byId('scan').addEventListener('click', () => {
    finish();
    if (listening()) stop();
    else scan(radio.value);
    render();
  });
  for (const field of [radio, target, position, x, y]) {
    field.addEventListener(field === x || field === y ? 'input' : 'change', () => {
      finish();
      if (field === radio) { target.value = ''; optionsDirty = true; }
      if (field === position) { x.value = ''; y.value = ''; }
      if (field === radio || field === target) lastReading = null;
      if (field !== x && field !== y) plotDirty = true;
      render();
    });
  }
  byId('export').addEventListener('click', () => {
    const rows = currentPoints();
    if (!rows.length) return;
    const axes = system() === 'geo' ? ['Longitude', 'Latitude'] : ['X (m)', 'Y (m)'];
    exportCsv('xiao-signal-map', [['Time (UTC)', 'Radio', 'Address', 'Name', 'Channel', 'RSSI (dBm)', 'Coordinate system', ...axes, 'Source', 'Accuracy (m)'],
      ...rows.map((p) => [p.time, p.radio, p.address, p.name, p.channel, p.rssi, p.system, p.x, p.y, p.source, p.accuracy])]);
  });
  byId('clear').addEventListener('click', () => {
    if (!window.confirm(t('mapConfirmClear', { target: target.value }))) return;
    for (const [key, p] of points) {
      if (p.address !== target.value || p.radio !== radio.value || p.system !== system()) continue;
      try { localStorage.removeItem(key); } catch { storageFailed = true; }
      points.delete(key);
    }
    finish();
    optionsDirty = plotDirty = true;
    render();
  });

  return {
    observe,
    update(next) {
      if (device.locale !== next.locale || device.translations !== next.translations) optionsDirty = plotDirty = true;
      device = next;
      if (!listening()) {
        if (pending) finish('mapCancelled');
        lastReading = null;
      }
      render();
    },
    scanFailed(key) { finish(key); render(); },
    resetLive() {
      live.wifi.clear(); live.ble.clear(); lastReading = null;
      finish();
      optionsDirty = true;
    },
  };
}
