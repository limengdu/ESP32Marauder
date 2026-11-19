const MAX_BYTES = 32 * 1024 * 1024;

/**
 * Manage the capture form and complete PCAP records held in this page.
 * 管理抓包表单以及页面中保存的完整 PCAP 数据包。
 */
export function setupCapture({ translate, start, download }) {
  const form = document.getElementById('capture-form');
  const network = document.getElementById('capture-network');
  const mode = document.getElementById('capture-mode');
  const duration = document.getElementById('capture-duration');
  const startButton = document.getElementById('capture-start');
  const saveButton = document.getElementById('capture-save');
  const status = document.getElementById('capture-status');
  let parts = [];
  let bytes = 0;
  let packets = 0;
  let active = false;
  let problem = '';
  let signature = '';
  let hasNetworks = false;
  let canStart = false;

  function render() {
    status.textContent = problem ? translate(problem) : bytes ? translate('captureProgress', { packets, size: (bytes / 1024).toFixed(1) }) : translate(active ? 'captureWaiting' : hasNetworks ? 'captureReady' : 'captureNeedNetworks');
    startButton.disabled = !canStart || !network.value;
    saveButton.disabled = active || !packets;
  }

  network.addEventListener('change', render);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!startButton.disabled) start({ bssid: network.value, mode: mode.value, duration: Number(duration.value) });
  });
  saveButton.addEventListener('click', () => download(`xiao-capture-${Date.now()}.pcap`, new Blob(parts, { type: 'application/vnd.tcpdump.pcap' }), 'application/vnd.tcpdump.pcap'));

  return {
    update({ ready, busy, task, networks }) {
      const entries = [...networks.values()].filter((item) => Number.isInteger(item.index) && item.channel > 0);
      hasNetworks = entries.length > 0;
      const next = JSON.stringify([translate('chooseNetwork'), translate('channel'), entries.map((item) => [item.bssid, item.name, item.channel])]);
      if (signature !== next) {
        const previous = network.value;
        signature = next;
        network.replaceChildren(new Option(translate('chooseNetwork'), ''), ...entries.map((item) => {
          const option = document.createElement('option');
          option.value = item.bssid;
          option.textContent = `${item.name || item.bssid} · ${translate('channel')} ${item.channel}`;
          return option;
        }));
        if (entries.some((item) => item.bssid === previous)) network.value = previous;
      }
      canStart = ready && !busy && task === 'idle' && hasNetworks;
      render();
    },
    begin() { parts = []; bytes = 0; packets = 0; active = true; problem = ''; render(); },
    header(data) { if (active && !parts.length) { parts.push(data); bytes += data.length; render(); } },
    record(data) {
      if (!active || !parts.length || problem) return;
      if (bytes + data.length > MAX_BYTES) { problem = 'captureLimit'; render(); return; }
      parts.push(data); bytes += data.length; packets += 1; render();
    },
    error() { if (active) { problem = 'capturePartial'; render(); } },
    finish(interrupted = false) { if (active && interrupted && !problem) problem = 'capturePartial'; active = false; render(); },
    get active() { return active; },
  };
}
