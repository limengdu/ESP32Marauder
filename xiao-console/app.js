import { setupMonitor } from './monitor.js?v=10';
import { hasRadioObservation, setupFunctions } from './functions.js?v=14';
import { setupCapture } from './capture.js?v=10';
import { SerialPcapDecoder } from './pcap.js?v=10';

const BAUD_RATE = 115200;
const USB_FILTERS = [{ usbVendorId: 0x303a }, { usbVendorId: 0x2886 }];
const STARTUP_PROBE_MS = 3000;
const STARTUP_TIMEOUT_MS = 45000;
const COMMAND_TIMEOUT_MS = 4000;
const LOG_LIMIT = 5000;
const WIFI_LIVE_TASKS = new Set(['wifi', 'dual', 'beacon']);

const MAC = '(?:[0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}';
const NETWORK_LINE = new RegExp(`^(-?\\d+) Ch: (\\d+) (${MAC}) ESSID: (.*?)(?:\\s+[0-9A-F]{2} [0-9A-F]{2})?\\s*$`);
const STATION_LINE = new RegExp(`^\\d+: (?:ap: (${MAC}) -> sta: (${MAC})|sta: (${MAC}) -> ap: (${MAC}))`);
const LIST_LINE = /^\[(\d+)\]\[CH:(\d+)\] (.*) (-?\d+)( \(selected\))?$/;
const BLE_LIST_LINE = /^\[(\d+)\]\[RSSI:(-?\d+)\] (.*)$/;
const INFO_LINE = /^\s*(ESSID|BSSID|Channel|RSSI|Frames|Stations|Brand|Security): ?(.*)$/;
const IPV4_LINE = /^\d{1,3}(?:\.\d{1,3}){3}$/;
const LAN_LIST_LINE = /^\[(\d+)\]\s+(\d{1,3}(?:\.\d{1,3}){3})$/;
const MOTION_HISTORY_LIMIT = 180;
const CSI_START_FAILED = /^(?:Invalid AP index|CSI motion (?:needs|could not|start failed))/;
const CSI_SELF_TEST_END = /^CSI self-test (complete\b|failed:)(.*)$/;
const BAND_TIE_DB = 3;
const MOTION_PLOT = { left: 8, right: 632, top: 16, bottom: 156, width: 640, height: 180 };
const MOTION_BADGE = {
  STILL: 'online', MOTION: 'motion', POSSIBLE: 'waiting', CALIBRATING: 'waiting',
  'LOW DATA': 'error', UNKNOWN: 'waiting',
};
const MOTION_STATES = new Set(Object.keys(MOTION_BADGE));
const BOOT_LINE = /^(?:ESP-ROM:|rst:0x|ESP-IDF version is:)/;
const VERSION_LINE = /^\s*(v\d+\.\d+\.\d+\S*)\s*$/;

const LOCALE_KEY = 'xiao-console-locale';
const FALLBACK_TEXT = {
  ...Object.fromEntries([...document.querySelectorAll('[data-i18n]')].map((node) => [node.dataset.i18n, node.textContent])),
  ...Object.fromEntries([...document.querySelectorAll('[data-placeholder]')].map((node) => [node.dataset.placeholder, node.placeholder])),
  disconnected: 'Disconnected', connecting: 'Connecting', starting: 'Starting', connected: 'Connected',
  deviceHint: 'Connect your device to get started.', deviceStarting: 'Waiting for the firmware to start.',
  deviceReady: 'Your device is ready to scan.', deviceLost: 'The connection closed. Reconnect to continue.',
  idle: 'Idle', scanning: 'Scanning', stopping: 'Stopping', loading: 'Loading results',
  taskNote: 'Ready when you are', scanningNote: 'Stop when you are ready to see the results',
  scanningRemaining: 'Scanning · {seconds}s', scanningNoteTimed: 'Auto-stops in {seconds}s, or stop anytime',
  scanDuration: 'Scan duration', elapsedTimed: 'Scanning {seconds}s / {total}s',
  unknown: 'Unknown', gpsMissing: 'Not connected', gpsFound: 'Connected',
  noResults: 'No results yet', resultCount: 'Showing {shown} of {total} networks',
  elapsed: 'Scanning for {seconds}s', loadingDetails: 'Loading details {done}/{total}',
  emptyText: 'Connect your device to begin exploring.', emptyReady: 'Start a scan to discover nearby networks.',
  emptyScanning: 'Collecting networks. Stop the scan to see the results.',
  emptyNoNetworks: 'No networks were found. Try scanning again.', emptySearch: 'No matching networks.',
  hiddenNetwork: 'Hidden network', unsupported: 'This browser does not support serial connections. Use Chrome or Edge from a local address.',
  connectFailed: 'Could not connect: {error}', connectionLost: 'The device connection was interrupted: {error}',
  startupTimeout: 'Still waiting for the device. Check the serial monitor, or reconnect.',
  listTimeout: 'Reading results timed out. Check the serial monitor.', writeFailed: 'Could not send: {error}',
  portOpened: 'Port opened. Waiting for the device.', portClosed: 'Connection closed.',
  scanStarted: 'Scan started.', scanStopped: 'Reading scan results.', listDone: 'Results are ready.',
  deviceRestarted: 'The device restarted. Waiting for it to be ready again.',
  deviceReadyWifi: 'Ready · Wi-Fi: {network}',
  busyNote: 'Waiting for the current device step to finish. Controls re-enable automatically.',
  taskUnknownNote: 'Use Stop task or Check serial connection to confirm the board is idle.',
  runningCommand: 'Running command', joiningWifi: 'Joining Wi-Fi',
  checkingWifi: 'Checking Wi-Fi', disconnectingWifi: 'Disconnecting Wi-Fi', syncingDevice: 'Syncing device',
  language: 'Language',
};

const elements = Object.fromEntries([
  'connect', 'disconnect', 'notice', 'firmware', 'task', 'task-note', 'gps', 'count', 'start', 'stop', 'search',
  'result-caption', 'network-rows', 'empty', 'empty-text', 'sort-signal', 'log', 'command-form', 'command',
  'clear-log', 'device-badge', 'device-detail', 'top-dot', 'top-status', 'monitor-status', 'log-count',
  'refresh-results', 'export-results', 'network-detail', 'detail-name', 'detail-fields', 'monitor-stop',
  'task-inline', 'band-filter', 'band-count-24', 'band-count-5', 'motion-reading', 'signal-reading', 'scan-duration',
  'wifi-status-card', 'wifi-status-dot', 'wifi-status-badge', 'wifi-status-detail', 'wifi-status-refresh',
  'wifi-disconnect', 'lan-hosts-reading',
].map((id) => [id, document.getElementById(id)]));

const state = {
  text: { ...FALLBACK_TEXT },
  port: null,
  reader: null,
  writer: null,
  keepReading: false,
  connection: 'disconnected',
  task: 'idle',
  pending: '',
  logOffset: 0,
  bootSeen: false,
  gps: 'unknown',
  firmware: '',
  expectVersion: false,
  probeId: '',
  probeTimer: 0,
  startupTimer: 0,
  scanStartedAt: 0,
  scanDuration: 0,
  scanEndsAt: 0,
  scanTimer: 0,
  networks: new Map(),
  waiter: null,
  info: null,
  progress: null,
  sortAscending: false,
  locale: 'en',
  messages: [],
  notice: null,
  busy: false,
  busyKey: '',
  session: 0,
  operation: null,
  readTask: null,
  closing: false,
  taskKind: '',
  currentCommand: '',
  wifiStatus: null,
  lanHosts: new Set(),
  lanHostsChecked: false,
  listEntries: new Map(),
  infoIndex: null,
  selectedNetwork: '',
  commandHistory: [],
  bluetooth: new Map(),
  historyIndex: 0,
  motionSelfTest: false,
  motionReading: '',
  motionSample: null,
  motionHistory: [],
  bandSnapshot: null,
  signalReading: '',
};

/**
 * Translate a message key and fill {name} placeholders.
 * 翻译文案键，并填充 {name} 占位符。
 */
function t(key, params = {}) {
  const template = state.text[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? ''));
}

const monitor = setupMonitor();
const functions = setupFunctions({ translate: t, execute: runAction });
const capture = setupCapture({ translate: t, start: startCapture, download: downloadFile });
let captureTimer = 0;
let scanStopTimer = 0;
let temporarySettings = null;
let serialPcap = null;
const localeFiles = new Map();
let localeRequest = 0;

/**
 * Load one locale and refresh every visible page message.
 * 加载一种语言，并刷新页面上所有可见文字。
 */
async function setLocale(locale) {
  const selected = locale === 'zh-CN' ? 'zh-CN' : 'en';
  const request = ++localeRequest;
  let text;
  try {
    if (!localeFiles.has(selected)) {
      localeFiles.set(selected, fetch(`${selected}.json`, { cache: 'no-store' }).then((response) => {
        if (!response.ok) throw new Error(`Locale HTTP ${response.status}`);
        return response.json();
      }));
    }
    text = await localeFiles.get(selected);
  } catch (error) {
    localeFiles.delete(selected);
    console.warn('Locale unavailable', error);
    if (selected !== 'en') return setLocale('en');
    text = FALLBACK_TEXT;
  }
  if (request !== localeRequest) return;
  state.locale = selected;
  state.text = { ...FALLBACK_TEXT, ...text };
  document.documentElement.lang = state.locale;
  document.querySelectorAll('[data-i18n]').forEach((node) => {
    node.textContent = t(node.dataset.i18n);
  });
  document.querySelectorAll('[data-placeholder]').forEach((node) => {
    node.placeholder = t(node.dataset.placeholder);
    node.setAttribute('aria-label', node.placeholder);
  });
  document.querySelectorAll('[data-locale]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.locale === state.locale));
  });
  document.querySelectorAll('[data-label]').forEach((node) => {
    node.setAttribute('aria-label', t(node.dataset.label));
  });
  state.messages.forEach((message) => {
    message.node.textContent = t(message.key, message.params);
  });
  if (state.notice) showNotice(state.notice.key, state.notice.params);
  try {
    localStorage.setItem(LOCALE_KEY, state.locale);
  } catch (error) {
    console.warn('Locale preference unavailable', error);
  }
  render();
}

function showNotice(key = '', params = {}) {
  state.notice = key ? { key, params } : null;
  elements.notice.textContent = key ? t(key, params) : '';
  elements.notice.hidden = !key;
}

/**
 * Mask Wi-Fi password arguments before showing or exporting serial lines.
 * 在展示或导出串口日志前，对 Wi-Fi 密码参数做脱敏处理。
 */
function redactSerialText(text) {
  return String(text).replace(/^([>#\s]*join\s+-a\s+\d+\s+-p\s+).*$/i, '$1[redacted]');
}

/**
 * Append one line to the console, keeping the newest LOG_LIMIT lines.
 * 向终端追加一行，只保留最新的 LOG_LIMIT 行。
 */
function appendLog(text, kind = 'in', key = '', params = {}) {
  const placeholder = elements.log.querySelector('.log-placeholder');
  if (placeholder) placeholder.remove();
  const visibleText = kind === 'system' ? text : redactSerialText(text);
  const line = document.createElement('div');
  line.className = `log-line ${kind}`;
  line.dataset.timestamp = new Date().toISOString();
  line.textContent = kind === 'out' ? `› ${visibleText}` : visibleText;
  elements.log.append(line);
  if (key) state.messages.push({ node: line, key, params });
  while (elements.log.childElementCount > LOG_LIMIT) {
    const removed = elements.log.firstElementChild;
    const messageIndex = state.messages.findIndex((message) => message.node === removed);
    if (messageIndex >= 0) state.messages.splice(messageIndex, 1);
    removed.remove();
  }
  monitor.lineAdded();
  elements['log-count'].textContent = String(elements.log.childElementCount);
}

/**
 * Render the board's current Wi-Fi association state and IP details inside the LAN section.
 * 在局域网区域展示开发板当前的 Wi-Fi 连接状态及 IP 信息。
 */
function renderWifiStatus(ready) {
  const card = elements['wifi-status-card'];
  const dot = elements['wifi-status-dot'];
  const badge = elements['wifi-status-badge'];
  const detail = elements['wifi-status-detail'];
  const refresh = elements['wifi-status-refresh'];
  const disconnectButton = elements['wifi-disconnect'];
  if (!ready) {
    card.className = 'wifi-status-card';
    dot.className = 'dot';
    badge.className = 'badge';
    badge.textContent = t('disconnected');
    detail.textContent = t('wifiStatusDisconnectedHint');
    refresh.disabled = true;
    disconnectButton.hidden = true;
    disconnectButton.disabled = true;
    return;
  }
  const info = state.wifiStatus;
  if (info?.state === 'connecting') {
    const progressDots = state.pending.match(/^Connecting to WiFi(\.+)/)?.[1] ?? '';
    const dots = progressDots ? ` ${progressDots}` : '';
    card.className = 'wifi-status-card connecting';
    dot.className = 'dot waiting';
    badge.className = 'badge waiting';
    badge.textContent = t('wifiConnectingBadge');
    detail.textContent = info.ssid
      ? t('wifiConnectingTarget', { ssid: info.ssid, dots })
      : t('wifiConnectingSaved', { dots });
  } else if (info?.state === 'connected') {
    const parts = [];
    if (info.ssid) parts.push(`${t('wifiFieldSsid')}: ${info.ssid}`);
    if (info.ip) parts.push(`IP: ${info.ip}`);
    if (info.gateway) parts.push(`${t('wifiFieldGateway')}: ${info.gateway}`);
    if (info.netmask) parts.push(`${t('wifiFieldNetmask')}: ${info.netmask}`);
    if (!info.ssid && info.mac) parts.push(`MAC: ${info.mac}`);
    card.className = 'wifi-status-card connected';
    dot.className = 'dot online';
    badge.className = 'badge online';
    badge.textContent = t('wifiConnectedBadge');
    detail.textContent = parts.join(' · ') || t('wifiConnectedNoIp');
  } else if (info?.state === 'failed') {
    const reasonKeys = {
      noSaved: 'lanJoinNoSaved',
      savedFailed: 'wifiFailedSavedDetail',
      addFailed: 'lanJoinAddFailed',
      timeout: 'wifiFailedTimeoutDetail',
    };
    card.className = 'wifi-status-card failed';
    dot.className = 'dot error';
    badge.className = 'badge error';
    badge.textContent = t('wifiFailedBadge');
    detail.textContent = t(reasonKeys[info.reason] ?? 'wifiFailedPasswordDetail', { ssid: info.ssid || 'Wi-Fi' });
  } else {
    card.className = 'wifi-status-card';
    dot.className = 'dot';
    badge.className = 'badge';
    badge.textContent = t('wifiNotConnectedBadge');
    detail.textContent = t('wifiStatusIdleHint');
  }
  const controlsReady = !state.busy && state.task === 'idle';
  const showDisconnect = info?.state === 'connected';
  refresh.disabled = !controlsReady;
  disconnectButton.hidden = !showDisconnect;
  disconnectButton.disabled = !showDisconnect || !controlsReady;
}

function renderLanHosts() {
  const output = elements['lan-hosts-reading'];
  const activeLan = state.taskKind === 'lan' && state.task !== 'idle';
  const visible = activeLan || state.lanHostsChecked || state.lanHosts.size > 0;
  output.hidden = !visible;
  if (!visible) return;
  if (state.lanHosts.size > 0) {
    output.textContent = t('lanHostsSummary', { count: state.lanHosts.size, hosts: [...state.lanHosts].join(', ') });
  } else if (activeLan) {
    output.textContent = t('lanHostsScanning');
  } else {
    output.textContent = t('lanHostsEmpty');
  }
}

/**
 * Sync buttons, badges and status cards with the current state.
 * 根据当前状态同步按钮、标签和状态卡片。
 */
function renderStatus() {
  const { connection, task } = state;
  const ready = connection === 'ready';
  const statusKey = { disconnected: 'disconnected', connecting: 'connecting', starting: 'starting', ready: 'connected' }[connection];
  const tone = ready ? 'online' : connection === 'disconnected' ? '' : 'waiting';

  elements['device-badge'].textContent = t(statusKey);
  elements['device-badge'].className = `badge ${tone}`;
  elements['top-status'].textContent = t(statusKey);
  elements['top-dot'].className = `dot ${tone}`;
  elements['monitor-status'].textContent = `${t(statusKey)} · ${BAUD_RATE}`;
  const wifiSummary = ready && state.wifiStatus?.state === 'connected'
    ? (state.wifiStatus.ssid && state.wifiStatus.ip
      ? `${state.wifiStatus.ssid} (${state.wifiStatus.ip})`
      : state.wifiStatus.ssid || state.wifiStatus.ip)
    : '';
  elements['device-detail'].textContent = ready
    ? (wifiSummary ? t('deviceReadyWifi', { network: wifiSummary }) : t('deviceReady'))
    : connection === 'disconnected' ? t('deviceHint') : t('deviceStarting');
  elements.connect.hidden = connection !== 'disconnected';
  elements.disconnect.hidden = connection === 'disconnected';

  elements.firmware.textContent = state.firmware || '—';
  elements.gps.textContent = t({ unknown: 'unknown', missing: 'gpsMissing', found: 'gpsFound' }[state.gps]);
  const remaining = task === 'scanning' && state.scanEndsAt > 0
    ? Math.max(0, Math.ceil((state.scanEndsAt - Date.now()) / 1000))
    : 0;
  const taskLabel = task === 'scanning' && state.scanDuration > 0
    ? t('scanningRemaining', { seconds: remaining })
    : state.busy && task === 'idle'
      ? t(state.busyKey || 'runningCommand')
      : t(task);
  elements.task.textContent = taskLabel;
  elements['task-inline'].textContent = taskLabel;
  elements['task-inline'].className = `badge${task !== 'idle' || state.busy ? ' waiting' : ''}`;
  elements['task-inline'].hidden = !ready;
  elements['task-note'].textContent = task === 'scanning'
    ? (state.scanDuration > 0 ? t('scanningNoteTimed', { seconds: remaining }) : t('scanningNote'))
    : task === 'taskUnknown'
      ? t('taskUnknownNote')
      : state.busy
        ? t('busyNote')
        : t('taskNote');

  elements.start.disabled = !ready || state.busy || task !== 'idle';
  elements.stop.disabled = !ready || state.busy || task === 'idle' || task === 'startingScan';
  elements['monitor-stop'].disabled = !ready || state.busy || task === 'startingScan';
  elements.stop.textContent = t(state.taskKind === 'wifi' || state.taskKind === 'beacon' ? 'stopScan' : 'stopTask');
  elements.command.disabled = !ready || state.busy;
  elements['command-form'].querySelector('button').disabled = !ready || state.busy;
  elements['refresh-results'].disabled = !ready || state.busy || task !== 'idle';
  elements['export-results'].disabled = !state.networks.size;
  document.getElementById('export-bluetooth').disabled = !state.bluetooth.size;
  functions.update({ ready, busy: state.busy, task, taskKind: state.taskKind, gps: state.gps, networks: state.networks, wifiConnected: state.wifiStatus?.state === 'connected', wifiSsid: state.wifiStatus?.ssid ?? '' });
  elements['motion-reading'].textContent = state.motionReading || t('waitingReading');
  elements['signal-reading'].textContent = state.signalReading || t('waitingReading');
  renderWifiStatus(ready);
  renderLanHosts();
  capture.update({ ready, busy: state.busy, task, networks: state.networks });
}

function signalTone(rssi) {
  if (rssi >= -60) return 'strong';
  if (rssi >= -75) return 'medium';
  return 'weak';
}

function cell(text, className = '') {
  const node = document.createElement('td');
  if (className) node.className = className;
  node.textContent = text;
  return node;
}

/**
 * Render the filtered and sorted network table.
 * 渲染经过搜索和排序后的网络表格。
 */
function renderNetworks() {
  const query = elements.search.value.trim().toLowerCase();
  const all = [...state.networks.values()];
  const isBand = (network, band) => network.channel > 0 && (network.channel > 14 ? '5' : '2.4') === band;
  const band = elements['band-filter'].value;
  elements['band-count-24'].textContent = String(all.filter((network) => isBand(network, '2.4')).length);
  elements['band-count-5'].textContent = String(all.filter((network) => isBand(network, '5')).length);
  const shown = all
    .filter((network) => !band || isBand(network, band))
    .filter((network) => !query || network.name.toLowerCase().includes(query) || network.bssid.includes(query))
    .sort((a, b) => (state.sortAscending ? a.rssi - b.rssi : b.rssi - a.rssi));

  const rows = shown.map((network) => {
    const row = document.createElement('tr');
    const nameCell = document.createElement('td');
    const nameWrap = document.createElement('div');
    const dot = document.createElement('span');
    const name = document.createElement('span');
    nameWrap.className = 'network-name';
    dot.className = `network-dot ${signalTone(network.rssi)}`;
    name.textContent = network.hidden ? t('hiddenNetwork') : network.name;
    if (network.hidden) name.className = 'muted-name';
    nameWrap.append(dot, name);
    nameCell.append(nameWrap);

    const signalCell = document.createElement('td');
    const pill = document.createElement('span');
    pill.className = `signal-pill ${signalTone(network.rssi)}`;
    pill.textContent = `${network.rssi} dBm`;
    signalCell.append(pill);

    const band = network.channel > 14 ? '5 GHz' : '2.4 GHz';
    row.append(
      nameCell,
      cell(network.bssid.toUpperCase(), 'mono'),
      cell(`${network.channel} · ${band}`),
      signalCell,
      cell(String(Math.max(network.clients.size, network.stations))),
      cell(network.security === 'Open' ? t('securityOpen') : network.security === 'Unknown' ? t('securityUnknown') : network.security || '—'),
    );
    const actionCell = document.createElement('td');
    const view = document.createElement('button');
    view.type = 'button';
    view.className = 'network-detail-button';
    view.textContent = t('viewDetails');
    view.addEventListener('click', () => {
      state.selectedNetwork = network.bssid;
      renderDetails();
    });
    actionCell.append(view);
    row.append(actionCell);
    return row;
  });

  elements['network-rows'].replaceChildren(...rows);
  elements.count.textContent = state.scanStartedAt || state.listEntries.size ? String(state.networks.size) : '—';
  elements.empty.hidden = rows.length > 0;

  let emptyKey = 'emptyText';
  if (state.connection === 'ready') emptyKey = 'emptyReady';
  if (state.task === 'scanning') emptyKey = 'emptyScanning';
  if (state.connection === 'ready' && state.task === 'idle' && state.scanStartedAt) emptyKey = 'emptyNoNetworks';
  if (all.length && (query || band)) emptyKey = 'emptySearch';
  elements['empty-text'].textContent = t(emptyKey);

  if (state.task === 'scanning' && WIFI_LIVE_TASKS.has(state.taskKind)) {
    const elapsed = Math.floor((Date.now() - state.scanStartedAt) / 1000);
    elements['result-caption'].textContent = state.scanDuration > 0
      ? t('elapsedTimed', { seconds: Math.min(elapsed, state.scanDuration), total: state.scanDuration })
      : t('elapsed', { seconds: elapsed });
  } else if (state.task === 'loading' && state.progress) {
    elements['result-caption'].textContent = t('loadingDetails', state.progress);
  } else {
    elements['result-caption'].textContent = all.length ? t('resultCount', { shown: shown.length, total: all.length }) : t('noResults');
  }
}

function renderDetails() {
  const network = state.networks.get(state.selectedNetwork);
  elements['network-detail'].hidden = !network;
  if (!network) return;
  elements['detail-name'].textContent = network.hidden ? t('hiddenNetwork') : network.name;
  const values = [
    ['address', network.bssid.toUpperCase()], ['index', network.index ?? '—'],
    ['channel', `${network.channel} · ${network.channel > 14 ? '5 GHz' : '2.4 GHz'}`],
    ['signal', `${network.rssi} dBm`], ['security', network.security || '—'],
    ['frames', network.frames ?? '—'], ['clients', network.stations || 0],
    ['brand', network.brand || '—'], ['associatedDevices', [...network.clients].join('\n') || '—'],
  ];
  elements['detail-fields'].replaceChildren(...values.flatMap(([key, value]) => {
    const label = document.createElement('dt');
    const content = document.createElement('dd');
    label.textContent = t(key).replace(' ↕', '');
    content.textContent = String(value);
    return [label, content];
  }));
}

function renderBluetooth() {
  const section = document.getElementById('bluetooth-results');
  section.hidden = !state.bluetooth.size;
  document.getElementById('bluetooth-rows').replaceChildren(...[...state.bluetooth.values()].sort((a, b) => b.rssi - a.rssi).map((device) => {
    const row = document.createElement('tr');
    row.append(cell(device.index), cell(device.name), cell(`${device.rssi} dBm`));
    return row;
  }));
}

/**
 * Read one CSI status line into a motion sample.
 * 把一行 CSI 状态读成一条动作样本。
 */
function parseCsi(line) {
  if (!line.startsWith('CSI motion |')) return null;
  const fields = {};
  for (const part of line.split(' | ').slice(1)) {
    const cut = part.indexOf('=');
    if (cut > 0) fields[part.slice(0, cut)] = part.slice(cut + 1);
  }
  const motion = Number(fields.motion);
  const rate = Number(String(fields.rate ?? '').replace('/s', ''));
  const state = MOTION_STATES.has(fields.state) ? fields.state : 'UNKNOWN';
  if (!Number.isFinite(motion)) return null;
  return {
    state,
    motion,
    scored: ['STILL', 'POSSIBLE', 'MOTION'].includes(state) && rate > 0,
    reliability: Number(fields.reliability),
    rate,
    calibration: Number(String(fields.calibration ?? '').replace('%', '')),
    ap: (fields.AP ?? '').replace(/^"|"$/g, ''),
    channel: Number(fields.channel),
    targetFrames: Number(fields.target_frames),
    legacyFrames: Number(fields.legacy_11b),
    allCallbacks: Number(fields.csi_callbacks),
    targetCallbacks: Number(fields.target_csi),
    at: Date.now(),
  };
}

/**
 * Keep the newest motion samples for the live chart.
 * 保留最新的动作样本，供实时曲线使用。
 */
function pushMotionSample(sample) {
  const last = state.motionHistory.at(-1);
  if (last && sample.at - last.at < 400 && last.scored === sample.scored && last.motion === sample.motion && last.state === sample.state) return;
  state.motionSample = sample;
  state.motionHistory.push(sample);
  if (state.motionHistory.length > MOTION_HISTORY_LIMIT) state.motionHistory.shift();
}

/**
 * Map a sample index and score onto the chart view box.
 * 把样本序号和分数映射到曲线图的坐标。
 */
function motionPoint(index, count, value) {
  const x = count <= 1
    ? (MOTION_PLOT.left + MOTION_PLOT.right) / 2
    : MOTION_PLOT.left + (index / (count - 1)) * (MOTION_PLOT.right - MOTION_PLOT.left);
  const clamped = Math.max(0, Math.min(100, value));
  const y = MOTION_PLOT.bottom - (clamped / 100) * (MOTION_PLOT.bottom - MOTION_PLOT.top);
  return [x, y];
}

/**
 * Place a chart marker over the SVG as it is drawn on screen.
 * 把标记放到屏幕上实际画出的曲线位置。
 */
function motionNode(id) {
  return document.getElementById(id);
}

/**
 * Place a chart marker over the SVG as it is drawn on screen.
 * 把标记放到屏幕上实际画出的曲线位置。
 */
function placeMotionMarker(marker, x, y) {
  const chart = motionNode('motion-chart').getBoundingClientRect();
  const canvas = document.querySelector('.motion-canvas').getBoundingClientRect();
  if (!chart.width || !canvas.width) return;
  marker.style.left = `${chart.left - canvas.left + (x / MOTION_PLOT.width) * chart.width}px`;
  marker.style.top = `${chart.top - canvas.top + (y / MOTION_PLOT.height) * chart.height}px`;
}

let motionHoverRatio = null;

/**
 * Draw the motion score for the current sensing session.
 * 画出当前感应过程的动作分数。
 */
function motionStateLabel(stateName) {
  const key = stateName === 'LOW DATA' ? 'motionStateLOW_DATA' : `motionState${stateName}`;
  const label = t(key);
  return label === key ? t('motionStateUNKNOWN') : label;
}

/**
 * Draw each run of usable scores and leave a break where samples are missing.
 * 把每段有效分数画出来，缺样本的位置留空。
 */
function motionPaths(samples) {
  const line = [];
  const area = [];
  let run = [];
  const closeRun = () => {
    if (!run.length) return;
    line.push(`M ${run.map(([x, y]) => `${x} ${y}`).join(' L ')}`);
    area.push(`M ${run[0][0]} ${MOTION_PLOT.bottom} L ${run.map(([x, y]) => `${x} ${y}`).join(' L ')} L ${run.at(-1)[0]} ${MOTION_PLOT.bottom} Z`);
    run = [];
  };
  samples.forEach((sample, index) => {
    if (!sample.scored) {
      closeRun();
      return;
    }
    run.push(motionPoint(index, samples.length, sample.motion));
  });
  closeRun();
  return { line: line.join(' '), area: area.join(' ') };
}

/**
 * Choose the next sentence for the current sensing step.
 * 按当前感应步骤选择下一句提示。
 */
function motionGuide(latest) {
  if (state.connection !== 'ready') return t('motionConnect');
  if (state.taskKind !== 'csi') {
    if (latest) return t('motionLastReading');
    return t('motionWaiting');
  }
  if (!latest) return t('motionAwaitReading');
  if (latest.state === 'CALIBRATING' && latest.rate > 0) return t('motionCalibrating', { percent: latest.calibration });
  if (latest.rate === 0 && latest.allCallbacks > 0 && latest.targetCallbacks === 0) {
    return t('motionOtherCsi', { channel: latest.channel });
  }
  if (latest.rate === 0 && latest.targetFrames > 0) {
    return t(latest.legacyFrames === latest.targetFrames ? 'motionLegacyOnly' : 'motionRadioSeen', { count: latest.targetFrames, channel: latest.channel });
  }
  if (!latest.scored) return t(latest.rate > 0 ? 'motionNoScore' : 'motionNoData');
  return t('motionReady', { state: motionStateLabel(latest.state), ap: latest.ap, channel: latest.channel });
}

function renderMotion() {
  const samples = state.motionHistory;
  const latest = state.motionSample;
  const paths = motionPaths(samples);
  motionNode('motion-line').setAttribute('d', paths.line);
  motionNode('motion-area').setAttribute('d', paths.area);
  const lastScored = [...samples].reverse().find((sample) => sample.scored);
  const dot = motionNode('motion-dot');
  if (lastScored) {
    const [x, y] = motionPoint(samples.lastIndexOf(lastScored), samples.length, lastScored.motion);
    dot.hidden = false;
    placeMotionMarker(dot, x, y);
  } else dot.hidden = true;

  const badge = motionNode('motion-state');
  badge.className = `badge${latest ? ` ${MOTION_BADGE[latest.state] ?? 'waiting'}` : ''}`;
  badge.textContent = latest && state.taskKind !== 'csi' ? t('motionHistoryLabel') : latest ? motionStateLabel(latest.state) : '—';
  const score = latest?.scored ? String(latest.motion) : '—';
  motionNode('motion-score').textContent = score;
  motionNode('motion-reliability').textContent = latest?.scored ? String(latest.reliability) : '—';
  motionNode('motion-rate').textContent = latest ? String(latest.rate) : '—';
  motionNode('motion-calibration').textContent = latest ? `${latest.calibration}%` : '—';
  const calibrating = latest?.state === 'CALIBRATING';
  motionNode('motion-cal').hidden = !calibrating;
  if (calibrating) motionNode('motion-cal-fill').style.width = `${Math.max(0, Math.min(100, latest.calibration))}%`;
  motionNode('motion-summary').textContent = motionGuide(latest);
  const stop = motionNode('motion-stop');
  stop.hidden = state.taskKind !== 'csi';
  stop.disabled = state.busy || state.connection !== 'ready';
  renderMotionHover();
}

/**
 * Show the sample under the pointer.
 * 显示指针所在位置的样本。
 */
function renderMotionHover() {
  const samples = state.motionHistory;
  const tip = motionNode('motion-tip');
  const cross = motionNode('motion-cross');
  if (motionHoverRatio == null || !samples.length) {
    tip.hidden = true;
    cross.hidden = true;
    return;
  }
  const canvas = document.querySelector('.motion-canvas').getBoundingClientRect();
  const chart = motionNode('motion-chart').getBoundingClientRect();
  if (!chart.width || !canvas.width) {
    tip.hidden = true;
    cross.hidden = true;
    return;
  }
  const localX = motionHoverRatio * canvas.width - (chart.left - canvas.left);
  const ratio = Math.max(0, Math.min(1, localX / chart.width));
  const index = Math.round(ratio * (samples.length - 1));
  const sample = samples[index];
  const [x] = motionPoint(index, samples.length, sample.scored ? sample.motion : 0);
  cross.hidden = false;
  placeMotionMarker(cross, x, MOTION_PLOT.top);
  tip.hidden = false;
  const tipLeft = chart.left - canvas.left + (x / MOTION_PLOT.width) * chart.width;
  tip.style.left = `${Math.min(canvas.width - 90, Math.max(90, tipLeft))}px`;
  tip.textContent = sample.scored
    ? t('motionTip', {
      time: new Date(sample.at).toLocaleTimeString(state.locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      state: motionStateLabel(sample.state),
      motion: sample.motion,
      reliability: sample.reliability,
    })
    : t('motionGapTip', {
      time: new Date(sample.at).toLocaleTimeString(state.locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      rate: sample.rate,
    });
}

/**
 * Group named networks and keep the strongest signal on each band.
 * 按网络名称分组，并保留每个频段上最强的信号。
 */
function bandGroups() {
  const groups = new Map();
  for (const network of state.networks.values()) {
    if (network.hidden || !network.name || !network.channel) continue;
    const key = network.name.trim().toLowerCase();
    const group = groups.get(key) ?? { key, name: network.name, band24: null, band5: null };
    const slot = network.channel > 14 ? 'band5' : 'band24';
    if (!group[slot] || network.rssi > group[slot].rssi) group[slot] = { rssi: network.rssi, channel: network.channel };
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => {
    const bothA = a.band24 && a.band5 ? 1 : 0;
    const bothB = b.band24 && b.band5 ? 1 : 0;
    if (bothA !== bothB) return bothB - bothA;
    const best = (group) => Math.max(group.band24?.rssi ?? -200, group.band5?.rssi ?? -200);
    return best(b) - best(a);
  });
}

/**
 * Describe which band is stronger for one network name.
 * 说明同一个网络名称在哪个频段上更强。
 */
function bandWinner(group) {
  if (group.band24 && group.band5) {
    const delta = group.band5.rssi - group.band24.rssi;
    if (Math.abs(delta) < BAND_TIE_DB) return 'bandTie';
    return delta > 0 ? 'band5Stronger' : 'band24Stronger';
  }
  return group.band5 ? 'bandOnly5' : 'bandOnly24';
}

/**
 * Build one band cell with its signal, channel and saved-spot change.
 * 生成一个频段单元格，包含信号、频道和相对已记录位置的变化。
 */
function bandCell(reading, saved) {
  const wrap = document.createElement('div');
  wrap.className = 'band-cell';
  if (!reading) {
    wrap.classList.add('is-missing');
    wrap.textContent = '—';
    return wrap;
  }
  const pill = document.createElement('span');
  pill.className = `signal-pill ${signalTone(reading.rssi)}`;
  pill.textContent = `${reading.rssi} dBm`;
  const channel = document.createElement('span');
  channel.className = 'band-ch';
  channel.textContent = t('bandChannel', { channel: reading.channel });
  wrap.append(pill, channel);
  if (Number.isFinite(saved)) {
    const delta = reading.rssi - saved;
    const note = document.createElement('span');
    note.className = `band-delta${delta > 0 ? ' up' : delta < 0 ? ' down' : ''}`;
    note.textContent = `(${delta > 0 ? '+' : ''}${delta})`;
    wrap.append(note);
  }
  return wrap;
}

/**
 * Render the same-name comparison for the two Wi-Fi bands.
 * 渲染同名网络在两个 Wi-Fi 频段上的对比。
 */
function renderBandCompare() {
  const groups = bandGroups();
  const hasGroups = groups.length > 0;
  motionNode('band-compare').hidden = !hasGroups;
  motionNode('band-compare-empty').hidden = hasGroups;
  motionNode('save-band-snapshot').disabled = !hasGroups;
  motionNode('clear-band-snapshot').hidden = !state.bandSnapshot;
  const both = groups.filter((group) => group.band24 && group.band5).length;
  const note = motionNode('band-snapshot-note');
  note.hidden = !hasGroups;
  if (hasGroups) {
    const summary = t('bandCompareSummary', {
      both,
      only24: groups.filter((group) => group.band24 && !group.band5).length,
      only5: groups.filter((group) => group.band5 && !group.band24).length,
    });
    note.textContent = state.bandSnapshot
      ? `${summary} ${t('bandSnapshotNote', { time: new Date(state.bandSnapshot.at).toLocaleTimeString(state.locale, { hour: '2-digit', minute: '2-digit' }) })}`
      : summary;
  }
  const saved = state.bandSnapshot?.rows;
  motionNode('band-compare-rows').replaceChildren(...groups.map((group) => {
    const row = document.createElement('div');
    row.className = 'band-row';
    const name = document.createElement('div');
    name.className = 'band-name';
    name.textContent = group.name;
    name.title = group.name;
    const winner = document.createElement('div');
    winner.className = 'band-winner';
    winner.textContent = t(bandWinner(group));
    const previous = saved?.get(group.key);
    row.append(
      name,
      bandCell(group.band24, previous?.rssi24),
      bandCell(group.band5, previous?.rssi5),
      winner,
    );
    return row;
  }));
}

function render() {
  renderStatus();
  renderNetworks();
  renderDetails();
  renderBluetooth();
  renderBandCompare();
  renderMotion();
}

function renderSoon() {
  render();
  requestAnimationFrame(renderMotion);
}

/**
 * Write one command line to the device.
 * 向设备写入一行命令。
 */
async function sendCommand(command, { echo = true, logText = command } = {}) {
  if (!state.writer) return false;
  try {
    await state.writer.write(new TextEncoder().encode(`${command}\n`));
    if (echo) appendLog(logText, 'out');
    return true;
  } catch (error) {
    showNotice('writeFailed', { error: error.message });
    return false;
  }
}

/**
 * Wait for the command prompt or a specified asynchronous firmware reply.
 * 等待命令提示符或指定的异步固件回显。
 */
async function executeCommand(command, { timeout = COMMAND_TIMEOUT_MS, echo = true, logText = command, joinSsid, untilLine } = {}) {
  if (!state.writer) throw new Error('The serial port is closed');
  if (state.waiter) throw new Error('Another command is pending');
  let echoed = state.taskKind === 'gps' && command === 'stopscan';
  state.currentCommand = logText;
  const lines = [];
  const session = state.session;
  const response = new Promise((resolve) => {
    const waiter = {
      match(event) {
        if (event.type === 'prompt') return echoed && !untilLine;
        const stopEcho = command === 'stopscan' && (event.line.includes('#stopscan') || /^(?:Stopping (?:WiFi|GPS)|END OF NMEA STREAM)/.test(event.line));
        if (event.line === `#${command}` || event.line === `#${logText}` || event.line.endsWith(`> #${command}`) || stopEcho) {
          echoed = true;
          if (stopEcho && !event.line.endsWith('#stopscan') && lines.length < LOG_LIMIT) lines.push(event.line);
          return false;
        }
        const finished = untilLine?.(event.line);
        if ((echoed || finished) && lines.length < LOG_LIMIT) lines.push(event.line);
        return finished;
      },
      resolve(value) {
        if (state.waiter !== waiter) return;
        clearTimeout(timer);
        state.waiter = null;
        resolve(value);
      },
    };
    const timer = setTimeout(() => {
      // An acknowledged join can proceed to the separate IP check after a missing prompt.
      // 入网命令已确认目标时，即使结束提示符缺失也可继续核实 IP。
      waiter.resolve(echoed && joinSsid && lines.includes(`Using SSID: ${joinSsid}`));
    }, timeout);
    state.waiter = waiter;
    sendCommand(command, { echo, logText }).then((sent) => { if (!sent) waiter.resolve(false); });
  });
  try {
    if (!(await response) || session !== state.session) throw new Error(t('commandTimeout', { command: logText }));
    return lines;
  } finally {
    if (state.currentCommand === logText) state.currentCommand = '';
  }
}

function notify(event) {
  if (state.waiter && state.waiter.match(event)) state.waiter.resolve(event);
}

function cancelOperation() {
  state.session += 1;
  state.waiter?.resolve(false);
  state.operation = null;
  state.busy = false;
  state.busyKey = '';
  state.progress = null;
}

/**
 * Run one device operation and release its controls on completion.
 * 执行一个设备操作，完成后释放操作控件。
 */
async function withOperation(action, busyKey = 'runningCommand') {
  if (state.busy) { showNotice('busyOperation'); return; }
  if (state.connection !== 'ready') return;
  const operation = Symbol('device-operation');
  const session = state.session;
  state.operation = operation;
  state.busy = true;
  state.busyKey = busyKey;
  showNotice('');
  render();
  try {
    await action();
  } catch (error) {
    if (session === state.session) showNotice('operationFailed', { error: error.message });
  } finally {
    if (state.operation === operation) {
      state.busy = false;
      state.busyKey = '';
      state.operation = null;
      if (state.task === 'loading' || state.task === 'stopping' || state.task === 'startingScan') state.task = 'idle';
      render();
    }
  }
}

function clearStartupTimers() {
  clearTimeout(state.probeTimer);
  clearTimeout(state.startupTimer);
}

function sendProbe() {
  state.probeId = `xiao-${Date.now()}`;
  sendCommand(`protocolinfo --machine ${state.probeId}`, { echo: false });
}

function markReady() {
  if (state.connection === 'ready') return;
  clearStartupTimers();
  state.connection = 'ready';
  showNotice('');
  render();
  queueMicrotask(() => {
    if (state.connection === 'ready' && !state.busy && state.task === 'idle') {
      withOperation(async () => {
        const lines = await executeCommand('gps -g fix', { echo: false });
        state.gps = lines.some((line) => /^Fix:/.test(line)) ? 'found' : 'missing';
        await syncWifiStatus();
        await readResults();
        state.bluetooth.clear();
        await executeCommand('list -b', { echo: false });
      }, 'syncingDevice');
    }
  });
}

/**
 * Treat a boot banner as a device restart and wait for the prompt again.
 * 把启动日志视为设备重启，重新等待命令提示符。
 */
function handleBoot() {
  const wasReady = state.connection === 'ready';
  cancelOperation();
  state.bootSeen = true;
  resetDeviceResults();
  state.connection = 'starting';
  state.gps = 'unknown';
  state.expectVersion = false;
  clearScanStopTimer();
  stopScanTimer();
  clearTimeout(captureTimer);
  capture.finish(true);
  temporarySettings = null;
  state.task = 'idle';
  clearTimeout(state.probeTimer);
  clearTimeout(state.startupTimer);
  state.startupTimer = setTimeout(() => showNotice('startupTimeout'), STARTUP_TIMEOUT_MS);
  if (wasReady) showNotice('deviceRestarted');
  render();
}

function upsertNetwork(bssid, values) {
  const key = bssid.toLowerCase();
  const network = state.networks.get(key) ?? { bssid: key, name: '', hidden: false, rssi: -100, channel: 0, clients: new Set(), stations: 0, security: '' };
  Object.assign(network, values);
  state.networks.set(key, network);
  return network;
}

function handleStation(match) {
  const ap = (match[1] || match[4]).toLowerCase();
  const station = (match[2] || match[3]).toLowerCase();
  if (parseInt(station.slice(0, 2), 16) & 1) return;
  const network = state.networks.get(ap);
  if (network) network.clients.add(station);
}

/**
 * Collect one `info -a` block and merge it into the matching network.
 * 收集一段 `info -a` 输出，并合并到对应的网络。
 */
function handleInfo(key, value) {
  if (!Number.isInteger(state.infoIndex)) return;
  if (key === 'ESSID') state.info = {};
  if (!state.info) return;
  state.info[key] = value.trim();
  if (key !== 'Security') return;
  const info = state.info;
  state.info = null;
  if (info.BSSID && new RegExp(`^${MAC}$`).test(info.BSSID)) {
    const bssid = info.BSSID.toLowerCase();
    const name = info.ESSID || '';
    const network = upsertNetwork(bssid, {
      name, hidden: !name || name.toLowerCase() === bssid,
      channel: Number(info.Channel), rssi: Number(info.RSSI),
      stations: Number(info.Stations) || 0, security: info.Security,
      frames: Number(info.Frames) || 0, brand: info.Brand || '', index: state.infoIndex,
    });
    state.resultSeen?.add(network.bssid);
  }
}

/**
 * Parse one complete device line and update the UI state.
 * 解析设备输出的一整行，并更新界面状态。
 */
function handleLine(rawLine, logOffset = 0) {
  const line = rawLine.replace(/\r$/, '').replace(/^(?:> )+/, '');
  if (!line.trim()) return;
  const display = rawLine.slice(logOffset).replace(/\r$/, '');
  if (display) appendLog(display);
  notify({ type: 'line', line });

  if (line.startsWith('@MARAUDER:')) {
    try {
      const message = JSON.parse(line.slice('@MARAUDER:'.length));
      if (message.command === 'protocolinfo' && message.status === 'success' && message.tx === state.probeId) {
        if (message.firmware) state.firmware = message.firmware;
        markReady();
      }
    } catch (error) {
      console.warn('Invalid machine message', error);
    }
    return;
  }

  if (BOOT_LINE.test(line)) {
    handleBoot();
    return;
  }
  if (line === 'GPS Not Found') state.gps = 'missing';
  if (/GPS found|GPS recovered/.test(line)) state.gps = 'found';
  if (line.includes('ESP32 Marauder')) state.expectVersion = true;
  const version = state.expectVersion && line.match(VERSION_LINE);
  if (version) {
    state.firmware = version[1];
    state.expectVersion = false;
  }
  const scanStarted = /^(?:Scanning for APs and Stations\.|Starting.*\. Stop with |Getting GPS Data\.|CSI motion started:)/;
  const started = state.motionSelfTest ? line.startsWith('CSI motion started:') : scanStarted.test(line);
  if (state.task === 'startingScan' && started) {
    const now = Date.now();
    if (state.taskKind === 'csi') {
      state.motionReading = '';
      state.motionSample = null;
      state.motionHistory = [];
    }
    if (WIFI_LIVE_TASKS.has(state.taskKind)) {
      state.scanStartedAt = now;
      state.networks.clear();
      state.listEntries.clear();
    }
    state.scanEndsAt = state.scanDuration > 0 ? now + state.scanDuration * 1000 : 0;
    stopScanTimer();
    if (state.scanDuration > 0 || WIFI_LIVE_TASKS.has(state.taskKind)) {
      state.scanTimer = setInterval(tickScanProgress, 1000);
    }
    state.task = 'scanning';
  }
  const selfTestEnd = state.motionSelfTest && line.match(CSI_SELF_TEST_END);
  if (selfTestEnd) {
    stopScanTimer();
    state.scanDuration = 0;
    state.scanEndsAt = 0;
    state.task = 'idle';
    state.taskKind = '';
    state.motionSelfTest = false;
    showNotice(selfTestEnd[1] === 'complete' ? 'motionSelfTestComplete' : 'motionSelfTestFailed', { reason: selfTestEnd[2].trim() });
  }
  if (line.startsWith('CSI motion |')) {
    state.motionReading = line;
    const sample = parseCsi(line);
    if (sample && (state.taskKind === 'csi' || state.currentCommand === 'csimotion status')) pushMotionSample(sample);
  }
  if (state.taskKind === 'signal' && / RSSI: -?\d+$/.test(line)) state.signalReading = line;
  const tryingWifi = line.match(/^(?:Using SSID|Trying saved WiFi): (.*)$/);
  if (tryingWifi && state.wifiStatus?.state === 'connecting') state.wifiStatus.ssid = tryingWifi[1].trim();
  const savedWifi = line.match(/^Connected to saved WiFi: (.*)$/);
  if (savedWifi) {
    state.wifiStatus = { ...(state.wifiStatus ?? {}), state: 'connected', ssid: savedWifi[1].trim(), reason: '' };
  }
  if (state.taskKind === 'lan' && IPV4_LINE.test(line)) state.lanHosts.add(line);
  else if (state.currentCommand === 'list -i') {
    const hostMatch = line.match(LAN_LIST_LINE);
    if (hostMatch) state.lanHosts.add(hostMatch[2]);
  }

  let match = line.match(NETWORK_LINE);
  if (match) {
    const bssid = match[3].toLowerCase();
    const name = match[4].replace(/\0/g, '').trim();
    const existing = state.networks.get(bssid);
    const resolvedName = name || existing?.name || '';
    upsertNetwork(bssid, {
      rssi: Number(match[1]),
      channel: Number(match[2]),
      name: resolvedName,
      hidden: !resolvedName || resolvedName.toLowerCase() === bssid,
      ...(state.taskKind === 'beacon' ? { frames: (existing?.frames ?? 0) + 1 } : {}),
    });
  } else if ((match = line.match(STATION_LINE))) {
    handleStation(match);
  } else if ((match = line.match(LIST_LINE))) {
    state.listEntries.set(Number(match[1]), { channel: Number(match[2]), name: match[3], rssi: Number(match[4]), selected: !!match[5] });
  } else if ((match = line.match(BLE_LIST_LINE))) {
    state.bluetooth.set(Number(match[1]), { index: Number(match[1]), rssi: Number(match[2]), name: match[3] });
  } else if ((match = line.match(INFO_LINE))) {
    handleInfo(match[1], match[2]);
  }
  scheduleRender();
}

let renderScheduled = false;
function scheduleRender() {
  if (renderScheduled) return;
  renderScheduled = true;
  requestAnimationFrame(() => {
    renderScheduled = false;
    renderSoon();
  });
}

function consumePrompt() {
  notify({ type: 'prompt' });
  if (state.connection === 'starting') {
    markReady();
    if (!state.firmware) sendProbe();
  }
}

/**
 * Split the serial stream into lines and recognize prompts before streamed output.
 * 将串口数据切成行，并识别连续输出前的命令提示符。
 */
function handleChunk(text) {
  elements.log.querySelector('.log-tail')?.remove();
  state.pending += text;
  const lines = state.pending.split('\n');
  for (const [index, raw] of lines.entries()) {
    let line = raw;
    // Split inline join progress when followed directly by a saved-Wi-Fi result or prompt.
    // 当同一行内连接进度后直接紧跟已保存 Wi-Fi 连接结果或提示符时，拆分为独立行处理。
    const joinedResult = index < lines.length - 1 && line.match(/^\r*(Connecting to WiFi\.*)(Connected to saved WiFi: .*)$/);
    if (joinedResult) {
      handleLine(joinedResult[1], state.logOffset);
      line = joinedResult[2];
      state.logOffset = Math.max(0, state.logOffset - joinedResult[1].length);
    }
    const prompt = line.match(/^\r*(Connecting to WiFi\.*|Started WiFi)?(?:> )+/);
    if (prompt) {
      if (prompt[1]) handleLine(prompt[1], state.logOffset);
      consumePrompt();
      line = line.slice(prompt[0].length);
      state.logOffset = Math.max(0, state.logOffset - prompt[0].length);
    }
    if (index === lines.length - 1) state.pending = line;
    else {
      handleLine(line, state.logOffset);
      state.logOffset = 0;
    }
  }
  if (state.pending.length > 32768) {
    handleLine(state.pending, state.logOffset);
    state.pending = '';
    state.logOffset = 0;
  } else if (state.pending.slice(state.logOffset).trim()) {
    const tail = document.createElement('div');
    tail.className = 'log-line log-tail';
    tail.dataset.timestamp = new Date().toISOString();
    tail.textContent = redactSerialText(state.pending.slice(state.logOffset));
    elements.log.append(tail);
    monitor.lineAdded();
    if (state.wifiStatus?.state === 'connecting') scheduleRender();
  }
}

async function readLoop() {
  const decoder = new TextDecoder();
  serialPcap = new SerialPcapDecoder({
    onText: (bytes) => handleChunk(decoder.decode(bytes, { stream: true })),
    onHeader: (bytes) => capture.header(bytes),
    onRecord: (bytes) => capture.record(bytes),
    onError: () => capture.error(),
  });
  let failure = null;
  while (state.port?.readable && state.keepReading) {
    let reader;
    try {
      reader = state.port.readable.getReader();
    } catch (error) {
      failure = error;
      break;
    }
    state.reader = reader;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (capture.active) serialPcap.push(value);
        else handleChunk(decoder.decode(value, { stream: true }));
      }
    } catch (error) {
      failure = error;
    } finally {
      reader.releaseLock();
      if (state.reader === reader) state.reader = null;
    }
    if (failure) break;
  }
  serialPcap.finish();
  handleChunk(decoder.decode());
  if (failure && state.keepReading) queueMicrotask(() => handleLost(failure));
}

/**
 * Open the selected serial port and wait for the firmware prompt.
 * 打开用户选择的串口，并等待固件命令提示符。
 */
async function connect() {
  if (!('serial' in navigator)) {
    showNotice('unsupported');
    return;
  }
  try {
    const knownPorts = (await navigator.serial.getPorts()).filter((port) => USB_FILTERS.some((filter) => filter.usbVendorId === port.getInfo().usbVendorId));
    const port = knownPorts.length === 1 ? knownPorts[0] : await navigator.serial.requestPort({ filters: USB_FILTERS });
    state.connection = 'connecting';
    render();
    await port.open({ baudRate: BAUD_RATE, bufferSize: 65536 });
    resetDeviceResults();
    Object.assign(state, { port, writer: port.writable.getWriter(), keepReading: true, pending: '', logOffset: 0, bootSeen: false, firmware: '', gps: 'unknown', connection: 'starting' });
    appendLog(t('portOpened'), 'system', 'portOpened');
    state.probeTimer = setTimeout(sendProbe, STARTUP_PROBE_MS);
    state.startupTimer = setTimeout(() => showNotice('startupTimeout'), STARTUP_TIMEOUT_MS);
    render();
    state.readTask = readLoop();
  } catch (error) {
    state.connection = 'disconnected';
    if (error.name !== 'NotFoundError') showNotice('connectFailed', { error: error.message });
    render();
  }
}

async function closePort() {
  if (state.closing) return;
  state.closing = true;
  clearTimeout(captureTimer);
  clearScanStopTimer();
  capture.finish(true);
  temporarySettings = null;
  state.keepReading = false;
  cancelOperation();
  clearStartupTimers();
  stopScanTimer();
  state.scanDuration = 0;
  state.scanEndsAt = 0;
  try { await state.reader?.cancel(); } catch (error) { console.warn(error); }
  try { await state.readTask; } catch (error) { console.warn(error); }
  try { state.writer?.releaseLock(); } catch (error) { console.warn(error); }
  try { await state.port?.close(); } catch (error) { console.warn(error); }
  Object.assign(state, { port: null, reader: null, writer: null, readTask: null, connection: 'disconnected', task: 'idle', pending: '', logOffset: 0, closing: false });
}

async function disconnect() {
  await closePort();
  appendLog(t('portClosed'), 'system', 'portClosed');
  showNotice('');
  render();
}

async function handleLost(error) {
  await closePort();
  showNotice('connectionLost', { error: error?.message ?? '' });
  render();
}

function resetDeviceResults() {
  state.networks.clear();
  state.listEntries.clear();
  state.bluetooth.clear();
  state.lanHosts.clear();
  state.lanHostsChecked = false;
  state.wifiStatus = null;
  state.scanStartedAt = 0;
  state.scanDuration = 0;
  state.scanEndsAt = 0;
  state.selectedNetwork = '';
  state.motionSelfTest = false;
  state.motionReading = '';
  state.motionSample = null;
  state.motionHistory = [];
  state.bandSnapshot = null;
  state.signalReading = '';
  state.info = null;
  state.infoIndex = null;
  state.taskKind = '';
}

function stopScanTimer() {
  clearInterval(state.scanTimer);
  state.scanTimer = 0;
}

function clearScanStopTimer() {
  clearTimeout(scanStopTimer);
  scanStopTimer = 0;
}

function tickScanProgress() {
  renderStatus();
  if (WIFI_LIVE_TASKS.has(state.taskKind)) renderNetworks();
}

/**
 * Schedule an automatic `stopscan` when a timed scan completes.
 * 为定时扫描注册倒计时，到期后自动执行 `stopscan`。
 */
function scheduleScanAutoStop(session, delayMs) {
  clearScanStopTimer();
  const trigger = () => {
    scanStopTimer = 0;
    if (session !== state.session || state.connection !== 'ready' || state.task !== 'scanning') return;
    if (state.busy) {
      scanStopTimer = setTimeout(trigger, 250);
      return;
    }
    stopScan();
  };
  scanStopTimer = setTimeout(trigger, delayMs);
}

async function startScan() {
  const duration = Number(elements['scan-duration']?.value || 0);
  return runAction('scanall', { task: 'wifi', duration });
}

/**
 * Read the device's current AP list and authoritative network details.
 * 读取设备当前的网络列表及网络详情。
 */
async function readResults() {
  const session = state.session;
  state.task = 'loading';
  state.listEntries.clear();
  state.resultSeen = new Set();
  render();
  await executeCommand('list -a');
  const indexes = [...state.listEntries.keys()];
  let completed = true;
  for (const [position, index] of indexes.entries()) {
    if (session !== state.session || state.connection !== 'ready') throw new Error('Operation cancelled');
    state.progress = { done: position + 1, total: indexes.length };
    state.infoIndex = index;
    state.info = null;
    renderNetworks();
    try {
      await executeCommand(`info -a ${index}`, { echo: false });
    } catch (error) {
      if (session !== state.session) throw error;
      completed = false;
      showNotice('partialResults');
      break;
    }
  }
  if (completed) {
    state.networks.forEach((network, key) => {
      if (!state.resultSeen.has(key)) state.networks.delete(key);
    });
  }
  state.infoIndex = null;
  state.progress = null;
  state.task = 'idle';
  appendLog(t('listDone'), 'system', 'listDone');
  render();
}

async function refreshResults() {
  if (state.task !== 'idle') { showNotice('stopFirst'); return; }
  return withOperation(readResults);
}

/**
 * Stop the active task and retrieve the matching result list.
 * 停止正在运行的任务，并读取对应结果。
 */
async function stopScan() {
  return withOperation(async () => {
    clearScanStopTimer();
    const kind = state.taskKind;
    const session = state.session;
    state.task = 'stopping';
    render();
    try {
      const lines = await executeCommand('stopscan', { timeout: 8000 });
      if (!lines.some((line) => /^(?:Stopping (?:WiFi|GPS)|END OF NMEA STREAM)/.test(line))) throw new Error(t('stopUnconfirmed'));
    } catch (error) {
      if (session === state.session && kind === 'csi' && state.task === 'idle') return;
      if (session === state.session) {
        clearTimeout(captureTimer);
        stopScanTimer();
        state.scanDuration = 0;
        state.scanEndsAt = 0;
        state.task = 'taskUnknown';
      }
      throw error;
    }
    clearTimeout(captureTimer);
    if (capture.active) {
      const started = Date.now();
      await new Promise((resolve) => setTimeout(resolve, 1500));
      while (serialPcap.inside && Date.now() - started < 10000 && state.connection === 'ready') {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      if (session !== state.session) return;
      serialPcap.finish();
    }
    capture.finish();
    try {
      await restoreObservationSettings();
    } catch (error) {
      if (session === state.session) {
        stopScanTimer();
        state.scanDuration = 0;
        state.scanEndsAt = 0;
        state.task = 'taskUnknown';
      }
      throw error;
    }
    stopScanTimer();
    state.scanDuration = 0;
    state.scanEndsAt = 0;
    state.task = 'idle';
    state.taskKind = '';
    state.motionSelfTest = false;
    if (kind === 'wifi' || kind === 'dual') await readResults();
    else if (kind === 'beacon') {
      // `sniffbeacon` streams beacons over serial without writing to firmware `list -a`.
      // `sniffbeacon` 仅通过串口实时输出信标，不会写入固件的 `list -a` 列表。
      appendLog(t('listDone'), 'system', 'listDone');
    }
    else if (kind === 'ble') {
      state.task = 'loading';
      state.bluetooth.clear();
      await executeCommand('list -b');
      state.task = 'idle';
      monitor.open();
    }
    else if (kind === 'lan') {
      state.task = 'loading';
      state.lanHosts.clear();
      state.lanHostsChecked = true;
      await executeCommand('list -i');
      state.task = 'idle';
    }
  });
}

function observationSettingValues(lines) {
  const values = {};
  let name = '';
  for (const line of lines) {
    const setting = line.match(/^Name: (SavePCAP|ChanHop)$/);
    if (setting) name = setting[1];
    const value = line.match(/^Value: (true|false|1|0)$/i);
    if (name && value) { values[name] = /^(true|1)$/i.test(value[1]); name = ''; }
  }
  return values;
}

async function restoreObservationSettings() {
  if (!temporarySettings) return;
  const settings = temporarySettings;
  if (!Object.keys(settings).length) { temporarySettings = null; return; }
  for (const [name, value] of Object.entries(settings)) {
    await executeCommand(`settings -s ${name} ${value ? 'enable' : 'disable'}`, { timeout: 8000 });
  }
  const current = observationSettingValues(await executeCommand('settings', { timeout: 8000 }));
  if (Object.entries(settings).some(([name, value]) => current[name] !== value)) throw new Error(t('captureRestoreFailed'));
  temporarySettings = null;
}

/**
 * Start a serial capture using the selected network's current device index.
 * 使用所选网络当前的设备索引启动串口抓包。
 */
async function startCapture({ bssid, mode, duration }) {
  if (!['packetcount', 'sniffbeacon', 'sniffprobe', 'sniffraw'].includes(mode)) return;
  if (state.task !== 'idle') { showNotice('stopFirst'); return; }
  return withOperation(async () => {
    const session = state.session;
    try {
      if (state.wifiStatus?.state === 'connected') await releaseWifiConnection();
      else await executeCommand('stopscan', { timeout: 8000 });
      await readResults();
      const target = state.networks.get(bssid);
      if (!target || !state.listEntries.has(target.index)) throw new Error(t('captureNetworkChanged'));
      if (mode === 'packetcount') {
        const stations = await executeCommand('list -c', { echo: false });
        const selectedStation = new RegExp(`^\\s+\\[\\d+\\] ${MAC} \\(selected\\)$`);
        if (stations.some((line) => selectedStation.test(line))) throw new Error(t('captureStationsSelected'));
        const changes = [...state.listEntries].filter(([index, entry]) => entry.selected !== (index === target.index)).map(([index]) => index);
        if (changes.length) await executeCommand(`select -a ${changes.join(',')}`, { timeout: 8000 });
        state.listEntries.clear();
        await executeCommand('list -a');
        if (!state.listEntries.has(target.index) || [...state.listEntries].some(([index, entry]) => entry.selected !== (index === target.index))) throw new Error(t('captureSelectionFailed'));
      }
      const original = observationSettingValues(await executeCommand('settings', { timeout: 8000 }));
      if (original.SavePCAP === undefined || original.ChanHop === undefined) throw new Error(t('captureSettingsFailed'));
      temporarySettings = {};
      if (!original.SavePCAP) {
        temporarySettings.SavePCAP = false;
        await executeCommand('settings -s SavePCAP enable', { timeout: 8000 });
      }
      if (original.ChanHop) {
        temporarySettings.ChanHop = true;
        await executeCommand('settings -s ChanHop disable', { timeout: 8000 });
      }
      const current = observationSettingValues(await executeCommand('settings', { timeout: 8000 }));
      if (!current.SavePCAP || current.ChanHop !== false) throw new Error(t('captureSettingsFailed'));
      if (mode !== 'packetcount') await executeCommand(`channel -s ${target.channel}`);
      serialPcap.newFile();
      capture.begin();
      clearScanStopTimer();
      stopScanTimer();
      state.scanDuration = duration > 0 ? duration : 0;
      state.scanEndsAt = 0;
      state.taskKind = 'capture';
      state.task = 'startingScan';
      render();
      await executeCommand(`${mode} -serial`, { timeout: 8000 });
      if (state.task !== 'scanning') throw new Error(t('notConfirmed'));
      await executeCommand(`channel -s ${target.channel}`);
      if (duration > 0) captureTimer = setTimeout(() => stopScan(), Math.max(0, state.scanEndsAt ? state.scanEndsAt - Date.now() : duration * 1000));
    } catch (error) {
      if (session === state.session) {
        try {
          await executeCommand('stopscan', { timeout: 8000 });
          capture.finish(true);
          await restoreObservationSettings();
          clearTimeout(captureTimer);
          stopScanTimer();
          state.scanDuration = 0;
          state.scanEndsAt = 0;
          state.task = 'idle';
          state.taskKind = '';
        } catch (recoveryError) {
          if (session === state.session) {
            clearTimeout(captureTimer);
            stopScanTimer();
            state.scanDuration = 0;
            state.scanEndsAt = 0;
            state.task = 'taskUnknown';
          }
          throw new Error(`${error.message} ${recoveryError.message}`);
        }
      }
      throw error;
    }
  });
}

/**
 * Confirm a device index still refers to the access point selected in the UI.
 * 确认固件编号仍然对应界面上选择的接入点。
 */
async function checkNetwork(index, bssid, observedOnly = false) {
  const lines = await executeCommand(`info -a ${index}`, { echo: false });
  const details = Object.fromEntries(lines.map((line) => line.match(INFO_LINE)).filter(Boolean).map(([, key, value]) => [key, value.trim()]));
  if (details.BSSID?.toLowerCase() !== bssid) throw new Error(t('captureNetworkChanged'));
  if (observedOnly && !hasRadioObservation({ rssi: Number(details.RSSI), frames: Number(details.Frames) })) {
    throw new Error(t('motionScanRequired'));
  }
  return details;
}

/**
 * Verify the live CLI session with a unique protocol request.
 * 使用唯一的协议请求核对当前串口会话。
 */
async function resync() {
  const tx = `gui-${Date.now()}`;
  const lines = await executeCommand(`protocolinfo --machine ${tx}`, { timeout: 8000 });
  const message = lines.find((line) => line.startsWith('@MARAUDER:'));
  const reply = message && JSON.parse(message.slice('@MARAUDER:'.length));
  if (reply?.tx !== tx || reply?.command !== 'protocolinfo' || reply?.status !== 'success') throw new Error(t('resyncFailed'));
  if (reply.firmware) state.firmware = reply.firmware;
  showNotice(state.task === 'taskUnknown' ? 'resyncNeedsStop' : 'resyncDone');
}

async function setUpDualBand() {
  const original = observationSettingValues(await executeCommand('settings'));
  if (original.ChanHop === undefined) throw new Error(t('captureSettingsFailed'));
  if (original.ChanHop) return;
  temporarySettings = { ChanHop: false };
  await executeCommand('settings -s ChanHop enable');
  const current = observationSettingValues(await executeCommand('settings'));
  if (!current.ChanHop) throw new Error(t('captureSettingsFailed'));
}

/**
 * Generate a deterministic locally-administered unicast MAC for a manually entered SSID.
 * 为手动输入的 SSID 生成不与已知设备冲突的本地管理单播 MAC 地址。
 */
function syntheticMacForSsid(ssid, salt = 0) {
  let hash = (0x811c9dc5 ^ salt) >>> 0;
  for (let i = 0; i < ssid.length; i++) {
    hash ^= ssid.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  const bytes = [0x02];
  for (let i = 0; i < 5; i++) {
    hash = Math.imul(hash ^ (i + 1 + salt), 0x45d9f3b) >>> 0;
    bytes.push((hash >>> 24) & 0xff);
  }
  return bytes.map((byte) => byte.toString(16).padStart(2, '0')).join(':');
}

/**
 * Extract firmware version and IPv4 station details from `info` output lines.
 * 从 `info` 输出行中提取固件版本和 IPv4 连接信息。
 */
function parseDeviceInfo(lines) {
  const details = { version: '', ip: '', gateway: '', netmask: '', mac: '' };
  for (const line of lines) {
    const version = line.match(/^Version:\s*(\S+)/);
    if (version) details.version = version[1];
    const ip = line.match(/^IP address:\s*(\S+)/);
    if (ip) details.ip = ip[1];
    const gateway = line.match(/^Gateway:\s*(\S+)/);
    if (gateway) details.gateway = gateway[1];
    const netmask = line.match(/^Netmask:\s*(\S+)/);
    if (netmask) details.netmask = netmask[1];
    const mac = line.match(/^MAC:\s*(\S+)/);
    if (mac) details.mac = mac[1];
  }
  return details;
}

function applyDeviceInfo(lines, fallbackSsid = '') {
  const details = parseDeviceInfo(lines);
  if (details.version && !state.firmware) state.firmware = details.version;
  const connected = Boolean(details.ip && details.ip !== '0.0.0.0');
  const ssid = fallbackSsid || (state.wifiStatus?.state === 'connected' ? state.wifiStatus.ssid : '');
  state.wifiStatus = connected
    ? { state: 'connected', ssid, ip: details.ip, gateway: details.gateway, netmask: details.netmask, mac: details.mac, reason: '' }
    : { state: 'disconnected', ssid: '', ip: '', gateway: '', netmask: '', mac: '', reason: '' };
  return connected;
}

/**
 * Query `info` for active Wi-Fi IP details and reset `SHOW_INFO` mode with `stopscan`.
 * 通过 `info` 读取当前 Wi-Fi 地址信息，并用 `stopscan` 恢复空闲命令状态。
 */
async function syncWifiStatus({ ssid = '', echo = false } = {}) {
  const lines = await executeCommand('info', { echo, timeout: 6000 });
  await executeCommand('stopscan', { echo: false, timeout: 6000 });
  return applyDeviceInfo(lines, ssid);
}

async function refreshWifiStatus() {
  if (state.task !== 'idle') { showNotice('stopFirst'); return; }
  return withOperation(async () => {
    const connected = await syncWifiStatus({ echo: false });
    showNotice(connected ? 'wifiStatusSyncedConnected' : 'wifiStatusSyncedDisconnected', {
      ip: state.wifiStatus?.ip ?? '',
    });
  }, 'checkingWifi');
}

async function releaseWifiConnection() {
  await executeCommand('stopscan -f', { echo: false, timeout: 8000 });
  await executeCommand('stopscan', { echo: false, timeout: 6000 });
  state.wifiStatus = { state: 'disconnected', ssid: '', ip: '', gateway: '', netmask: '', mac: '', reason: '' };
}

async function disconnectWifi() {
  if (state.task !== 'idle') { showNotice('stopFirst'); return; }
  return withOperation(async () => {
    await executeCommand('stopscan -f', { timeout: 8000 });
    await executeCommand('stopscan', { echo: false, timeout: 6000 });
    state.wifiStatus = { state: 'disconnected', ssid: '', ip: '', gateway: '', netmask: '', mac: '', reason: '' };
    showNotice('wifiDisconnected');
  }, 'disconnectingWifi');
}

/**
 * Join a Wi-Fi network using an existing firmware index or a manual SSID registration.
 * 使用固件已有编号或临时登记手动输入的 SSID 来连接并保存 Wi-Fi。
 */
async function joinWifi(operation) {
  state.wifiStatus = { state: 'connecting', ssid: operation.ssid, ip: '', gateway: '', netmask: '', mac: '', reason: '' };
  render();
  let index = operation.network ? state.networks.get(operation.network)?.index : null;
  try {
    if (Number.isInteger(index) && index >= 0) {
      await checkNetwork(index, operation.network);
    } else {
      state.listEntries.clear();
      await executeCommand('list -a', { echo: false });
      const existing = [...state.listEntries.entries()].find(([, entry]) => entry.name === operation.ssid);
      if (existing) {
        index = existing[0];
      } else {
        const candidate = (operation.network ? state.networks.get(operation.network) : null)
          ?? [...state.networks.values()].find((network) => network.name === operation.ssid)
          ?? null;
        const channel = candidate?.channel > 0 ? candidate.channel : 1;
        const candidateBssid = candidate?.bssid && !(Number.isInteger(candidate.index) && candidate.index >= 0)
          ? candidate.bssid
          : '';
        let clearAddedSelection = false;
        for (let attempt = 0; attempt < 4; attempt++) {
          let salt = attempt;
          let mac = attempt === 0 && candidateBssid ? candidateBssid : syntheticMacForSsid(operation.ssid, salt);
          while ((attempt > 0 || !candidateBssid) && state.networks.has(mac)) {
            salt += 10;
            mac = syntheticMacForSsid(operation.ssid, salt);
          }
          const addLines = await executeCommand(`add -a -b ${mac} -ch ${channel} -e ${operation.quotedSsid}`);
          const added = addLines.map((line) => line.match(/^Added AP \[(\d+)\]\[CH:\d+\] .*?(\(selected\))?$/)).find(Boolean);
          if (added) {
            index = Number(added[1]);
            clearAddedSelection = Boolean(added[2]);
            break;
          }
          const duplicate = addLines.map((line) => line.match(/^AP already exists at \[(\d+)\]: (.*)$/)).find(Boolean);
          if (duplicate && duplicate[2] === operation.ssid) {
            index = Number(duplicate[1]);
            break;
          }
        }
        if (!Number.isInteger(index)) {
          state.wifiStatus = { state: 'failed', ssid: operation.ssid, ip: '', gateway: '', netmask: '', mac: '', reason: 'addFailed' };
          throw new Error(t('lanJoinAddFailed'));
        }
        if (clearAddedSelection) {
          // Clear the default selected flag set by `add -a` to preserve existing capture target selection.
          // 清除 `add -a` 默认附加的选中标记，保持原有的抓包目标选择状态。
          await executeCommand(`select -a ${index}`, { echo: false });
        }
      }
    }
    // The CLI retains an empty quoted password between arguments.
    const joinCommand = operation.quotedPassword === '""' ? `join -p "" -a ${index}` : `join -a ${index} -p ${operation.quotedPassword}`;
    const lines = await executeCommand(joinCommand, {
      timeout: operation.timeout ?? 25000,
      logText: `join -a ${index} -p [redacted]`,
      joinSsid: operation.ssid,
    });
    const failed = lines.some((line) => line.includes('Could not connect to WiFi network') || line.includes('You did not provide the proper args'));
    if (failed) {
      state.wifiStatus = { state: 'failed', ssid: operation.ssid, ip: '', gateway: '', netmask: '', mac: '', reason: 'passwordFailed' };
      showNotice('lanJoinPasswordFailed');
      return;
    }
    const connected = await syncWifiStatus({ ssid: operation.ssid });
    if (connected) {
      showNotice('lanJoinDoneWithIp', { ssid: operation.ssid, ip: state.wifiStatus.ip });
    } else {
      state.wifiStatus = { state: 'failed', ssid: operation.ssid, ip: '', gateway: '', netmask: '', mac: '', reason: 'passwordFailed' };
      showNotice('lanJoinPasswordFailed');
    }
  } catch (error) {
    if (state.wifiStatus?.state === 'connecting') {
      state.wifiStatus = { state: 'failed', ssid: operation.ssid, ip: '', gateway: '', netmask: '', mac: '', reason: 'timeout' };
    }
    throw error;
  }
}

/**
 * Join a saved Wi-Fi profile on the board and verify the resulting IPv4 address.
 * 连接开发板中已保存的 Wi-Fi 凭据，并核实分配到的 IPv4 地址。
 */
async function joinSavedWifi(operation) {
  state.wifiStatus = { state: 'connecting', ssid: '', ip: '', gateway: '', netmask: '', mac: '', reason: '' };
  render();
  let lines;
  try {
    lines = await executeCommand('join -s', { timeout: operation.timeout ?? 60000 });
  } catch (error) {
    if (state.wifiStatus?.state === 'connecting') {
      state.wifiStatus = { state: 'failed', ssid: state.wifiStatus.ssid || '', ip: '', gateway: '', netmask: '', mac: '', reason: 'timeout' };
    }
    throw error;
  }
  if (lines.some((line) => line.includes('There are no saved WiFi credentials'))) {
    state.wifiStatus = { state: 'failed', ssid: '', ip: '', gateway: '', netmask: '', mac: '', reason: 'noSaved' };
    showNotice('lanJoinNoSaved');
    return;
  }
  const savedMatch = lines.map((line) => line.match(/Connected to saved WiFi: (.*)$/)).find(Boolean);
  if (!savedMatch) {
    state.wifiStatus = { state: 'failed', ssid: state.wifiStatus?.ssid || '', ip: '', gateway: '', netmask: '', mac: '', reason: 'savedFailed' };
    showNotice('lanJoinFailed');
    return;
  }
  const ssid = savedMatch[1].trim();
  const hasIp = await syncWifiStatus({ ssid });
  if (!hasIp) {
    state.wifiStatus = { state: 'connected', ssid, ip: '', gateway: '', netmask: '', mac: '', reason: '' };
  }
  showNotice(state.wifiStatus.ip ? 'lanJoinDoneWithIp' : 'lanJoinDone', { ssid, ip: state.wifiStatus.ip });
}

/** Register an explicitly supplied radio target and verify its address and channel on the board. */
async function motionRadioIndex({ bssid, channel, quotedSsid }) {
  const lines = await executeCommand(`add -a -b ${bssid} -ch ${channel}${quotedSsid ? ` -e ${quotedSsid}` : ''}`);
  const added = lines.map((line) => line.match(/^Added AP \[(\d+)\]\[CH:\d+\] .* \(selected\)$/)).find(Boolean);
  const existing = lines.map((line) => line.match(/^AP already exists at \[(\d+)\]:/)).find(Boolean);
  if (!added && !existing) throw new Error(t('motionRegisterFailed'));
  const index = Number((added ?? existing)[1]);
  if (added) await executeCommand(`select -a ${index}`, { echo: false });
  const details = await checkNetwork(index, bssid);
  if (Number(details.Channel) !== channel) throw new Error(t('motionChannelChanged', { channel: details.Channel }));
  return index;
}

const WIFI_RAW_SCAN_TASKS = new Set(['wifi', 'dual', 'beacon', 'observe', 'csi', 'signal']);

async function runAction(command, operation = {}) {
  if (!functions.permitted(operation)) return;
  if (command === 'stopscan') return stopScan();
  const busyKey = operation.action === 'joinWifi' || command === 'join -s' ? 'joiningWifi' : 'runningCommand';
  return withOperation(async () => {
    const session = state.session;
    if (operation.action === 'resync') return resync();
    if (operation.action === 'joinWifi') return joinWifi(operation);
    if (command === 'join -s') return joinSavedWifi(operation);
    const currentWifi = command === 'csimotion connected';
    if (currentWifi) {
      const help = await executeCommand('csimotion', { echo: false });
      if (!help.some((line) => /^csimotion\b.*\bconnected\b/.test(line))) throw new Error(t('motionConnectedUnsupported'));
      if (operation.join) await joinWifi(operation.join);
      if (state.wifiStatus?.state !== 'connected') return;
      showNotice('');
    }
    const selfTest = command === 'csimotion selftest';
    if (operation.radioTarget) {
      const index = await motionRadioIndex(operation.radioTarget);
      command = selfTest ? `csimotion selftest ${index} ${operation.radioTarget.quotedSsid}` : `csimotion start ${index}`;
    }
    const index = operation.network ? state.networks.get(operation.network)?.index : null;
    if (operation.network && !Number.isInteger(index)) throw new Error(t('captureNetworkChanged'));
    if (operation.network && !command.startsWith('info -a ')) await checkNetwork(index, operation.network, operation.field?.observedOnly);
    if (command === 'list -b') state.bluetooth.clear();
    if (command === 'list -a') state.listEntries.clear();
    if (command === 'list -i') {
      state.lanHosts.clear();
      state.lanHostsChecked = true;
    }
    if (command.startsWith('info -a ')) { state.infoIndex = index; state.info = null; }
    if (operation.task === 'signal') state.signalReading = '';
    if (operation.task === 'lan') {
      state.lanHosts.clear();
      state.lanHostsChecked = false;
    }
    const duration = operation.task && Number(operation.duration) > 0 ? Number(operation.duration) : 0;
    try {
      if (operation.task && WIFI_RAW_SCAN_TASKS.has(operation.task) && state.wifiStatus?.state === 'connected' && !currentWifi && !selfTest) {
        await releaseWifiConnection();
      }
      if (operation.action === 'dual') await setUpDualBand();
      if (operation.task) {
        clearScanStopTimer();
        stopScanTimer();
        state.scanDuration = duration;
        state.scanEndsAt = 0;
        state.taskKind = operation.task;
        state.motionSelfTest = selfTest;
        state.task = 'startingScan';
        render();
      }
      const lines = await executeCommand(command, {
        timeout: selfTest ? 20000 : operation.timeout ?? 8000,
        logText: operation.redactedCommand ?? command,
        untilLine: selfTest ? (line) => line.startsWith('CSI motion started:') || CSI_SELF_TEST_END.test(line) || CSI_START_FAILED.test(line) : undefined,
      });
      if (selfTest && state.task === 'idle') return;
      if (currentWifi && state.task === 'scanning') state.wifiStatus = { state: 'disconnected' };
      if (operation.task === 'csi' && lines.some((line) => CSI_START_FAILED.test(line))) {
        state.task = 'idle';
        state.taskKind = '';
        state.motionSelfTest = false;
        if (currentWifi) await syncWifiStatus();
        showNotice('motionStartFailed');
        return;
      }
      if (command === 'nmea') state.task = 'scanning';
      if (command === 'info') {
        applyDeviceInfo(lines);
        await executeCommand('stopscan', { echo: false, timeout: 6000 });
      } else if (command === 'clearlist -a') {
        state.networks.clear();
        state.listEntries.clear();
        state.scanStartedAt = 0;
      } else if (command === 'clearlist -c') {
        state.networks.forEach((network) => { network.clients.clear(); network.stations = 0; });
      }
      if (operation.task && state.task !== 'scanning') {
        clearScanStopTimer();
        stopScanTimer();
        state.scanDuration = 0;
        state.scanEndsAt = 0;
        if (operation.task === 'lan') {
          state.task = 'idle';
          state.taskKind = '';
          state.wifiStatus = { state: 'disconnected', ssid: '', ip: '', gateway: '', netmask: '', mac: '', reason: '' };
          showNotice('lanNeedWifi');
        } else {
          state.task = 'taskUnknown';
          showNotice('notConfirmed');
        }
      } else if (operation.task && state.task === 'scanning' && duration > 0 && !selfTest) {
        scheduleScanAutoStop(session, Math.max(0, state.scanEndsAt ? state.scanEndsAt - Date.now() : duration * 1000));
      }
    } catch (error) {
      if (session === state.session && (operation.task || temporarySettings)) {
        clearScanStopTimer();
        stopScanTimer();
        state.scanDuration = 0;
        state.scanEndsAt = 0;
        state.task = 'taskUnknown';
      }
      throw error;
    } finally {
      if (session === state.session) state.infoIndex = null;
    }
  }, busyKey);
}

function downloadFile(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Save CSV cells with numeric values and escaped spreadsheet text.
 * 保存表格数值，并转义电子表格中的文本单元格。
 */
function exportCsv(name, rows) {
  const quote = (value) => {
    let text = String(value ?? '');
    if (/^\s*[=+@-]/.test(text) && !/^-?\d+(?:\.\d+)?$/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  downloadFile(`${name}-${Date.now()}.csv`, '﻿' + rows.map((row) => row.map(quote).join(',')).join('\r\n'), 'text/csv;charset=utf-8');
}

function exportResults() {
  const rows = [['SSID', 'BSSID', 'Channel', 'RSSI', 'Security', 'Observed links'],
    ...[...state.networks.values()].map((network) => [network.name, network.bssid, network.channel, network.rssi, network.security, network.stations])];
  exportCsv('xiao-networks', rows);
}

function exportBluetooth() {
  const rows = [['Device index', 'Name or address', 'RSSI'],
    ...[...state.bluetooth.values()].map((device) => [device.index, device.name, device.rssi])];
  exportCsv('xiao-bluetooth', rows);
}

function exportLog() {
  const lines = [...elements.log.querySelectorAll('.log-line')].map((line) => `[${line.dataset.timestamp}] ${line.textContent}`);
  downloadFile(`xiao-serial-${Date.now()}.log`, lines.join('\n'), 'text/plain;charset=utf-8');
}

async function submitCommand(event) {
  event.preventDefault();
  const command = elements.command.value.trim();
  if (!command) return;
  const operation = functions.manual(command);
  if (!operation) { showNotice('commandUnavailable'); return; }
  if (!functions.permitted(operation)) { showNotice('commandNotReady'); return; }
  elements.command.value = '';
  state.commandHistory.push(command);
  if (state.commandHistory.length > 100) state.commandHistory.shift();
  state.historyIndex = state.commandHistory.length;
  return runAction(command, operation);
}

elements['monitor-stop'].addEventListener('click', stopScan);
elements['refresh-results'].addEventListener('click', refreshResults);
elements['export-results'].addEventListener('click', exportResults);
document.getElementById('export-bluetooth').addEventListener('click', exportBluetooth);
document.getElementById('export-log').addEventListener('click', exportLog);
document.getElementById('detail-close').addEventListener('click', () => { state.selectedNetwork = ''; renderDetails(); });
elements.command.addEventListener('keydown', (event) => {
  if (!['ArrowUp', 'ArrowDown'].includes(event.key) || !state.commandHistory.length) return;
  event.preventDefault();
  state.historyIndex = Math.max(0, Math.min(state.commandHistory.length, state.historyIndex + (event.key === 'ArrowUp' ? -1 : 1)));
  elements.command.value = state.commandHistory[state.historyIndex] || '';
});
const navigationLinks = [...document.querySelectorAll('.nav-link')];
const views = [...document.querySelectorAll('[data-view]')];
const viewScroll = new Map();
let currentView = '';

/**
 * Switch workspace sections and restore each section's scroll position.
 * 切换工作台内容，并恢复各内容区的滚动位置。
 */
function showView() {
  const requested = location.hash.slice(1);
  const selected = views.some((view) => view.id === requested) ? requested : 'functions';
  if (selected === currentView) return;
  const content = document.getElementById('workspace-content');
  if (currentView) viewScroll.set(currentView, content.scrollTop);
  views.forEach((view) => { view.hidden = view.id !== selected; });
  navigationLinks.forEach((link) => {
    const active = link.hash === `#${selected}`;
    link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  if (selected !== 'networks') {
    state.selectedNetwork = '';
    renderDetails();
  }
  currentView = selected;
  content.scrollTop = viewScroll.get(selected) || 0;
}

const viewLinks = [...document.querySelectorAll('a[href^="#"]')].filter((link) => views.some((view) => link.hash === `#${view.id}`));
viewLinks.forEach((link) => link.addEventListener('click', (event) => {
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  if (link.dataset.resultBand) {
    elements['band-filter'].value = link.dataset.resultBand;
    renderNetworks();
  }
  event.preventDefault();
  if (location.hash !== link.hash) history.pushState(null, '', link.hash);
  showView();
  if (link.dataset.jumpTarget) {
    requestAnimationFrame(() => document.getElementById(link.dataset.jumpTarget)?.scrollIntoView({ block: 'start' }));
  }
}));
document.querySelectorAll('[data-jump]').forEach((button) => {
  button.addEventListener('click', () => document.getElementById(button.dataset.jump).scrollIntoView({ block: 'start' }));
});
elements['band-filter'].addEventListener('change', renderNetworks);
window.addEventListener('hashchange', showView);
window.addEventListener('popstate', showView);
showView();
requestAnimationFrame(() => {
  if (!viewScroll.size) document.getElementById('workspace-content').scrollTop = 0;
});
elements.connect.addEventListener('click', connect);
elements.disconnect.addEventListener('click', disconnect);
elements.start.addEventListener('click', startScan);
elements.stop.addEventListener('click', stopScan);
motionNode('save-band-snapshot').addEventListener('click', () => {
  const groups = bandGroups();
  if (!groups.length) return;
  state.bandSnapshot = {
    at: Date.now(),
    rows: new Map(groups.map((group) => [group.key, { rssi24: group.band24?.rssi ?? null, rssi5: group.band5?.rssi ?? null }])),
  };
  renderBandCompare();
});
motionNode('clear-band-snapshot').addEventListener('click', () => {
  state.bandSnapshot = null;
  renderBandCompare();
});
const motionCanvas = document.querySelector('.motion-canvas');
motionCanvas.addEventListener('pointermove', (event) => {
  const rect = motionCanvas.getBoundingClientRect();
  motionHoverRatio = rect.width ? (event.clientX - rect.left) / rect.width : null;
  renderMotionHover();
});
motionCanvas.addEventListener('pointerleave', () => {
  motionHoverRatio = null;
  renderMotionHover();
});
motionNode('motion-stop').addEventListener('click', stopScan);
elements['wifi-status-refresh'].addEventListener('click', refreshWifiStatus);
elements['wifi-disconnect'].addEventListener('click', disconnectWifi);
elements.search.addEventListener('input', renderNetworks);
elements['command-form'].addEventListener('submit', submitCommand);
elements['clear-log'].addEventListener('click', () => {
  elements.log.replaceChildren();
  state.messages = [];
  state.logOffset = state.pending.length;
  monitor.clear();
  elements['log-count'].textContent = '0';
});
elements['sort-signal'].addEventListener('click', () => {
  state.sortAscending = !state.sortAscending;
  renderNetworks();
});
navigator.serial?.addEventListener('disconnect', (event) => {
  if (event.target === state.port) handleLost(new Error('USB device removed'));
});

document.querySelectorAll('[data-locale]').forEach((button) => {
  button.addEventListener('click', () => setLocale(button.dataset.locale));
});

let savedLocale = 'en';
try {
  savedLocale = localStorage.getItem(LOCALE_KEY) || 'en';
} catch (error) {
  console.warn('Locale preference unavailable', error);
}
await setLocale(savedLocale);
if (!('serial' in navigator)) showNotice('unsupported');
render();
