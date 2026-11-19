const channelChoices = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 32, 36, 40, 44, 48, 52, 56, 60, 64, 68, 72, 76, 80, 84, 88, 92, 96, 100, 104, 108, 112, 116, 120, 124, 128, 132, 136, 140, 144, 149, 153, 157, 161, 165, 169, 173, 177].map(String);
const scanDurationChoices = [15, 30, 60, 120, 300];
const target = { label: 'captureNetwork', networks: true };
const operationGroups = {
  wifiBasic: [
    { id: 'wifiApScan', command: 'sniffbeacon', task: 'beacon', defaultDuration: 30 },
    { id: 'wifiScan', command: 'scanall', task: 'wifi', defaultDuration: 30 },
    { id: 'sniffprobe', command: 'sniffprobe', task: 'observe', defaultDuration: 30 },
    { id: 'sniffraw', command: 'sniffraw', task: 'observe', defaultDuration: 30 },
    { id: 'packetcount', command: 'packetcount', task: 'observe', defaultDuration: 30 },
  ],
  wifiLists: [
    { id: 'wifiResults', command: 'list -a' },
    { id: 'wifiStations', command: 'list -c' },
    { id: 'wifiProbes', command: 'list -p' },
    { id: 'wifiInfo', command: 'info -a', field: target },
    { id: 'wifiSelect', command: 'select -a', field: target },
    { id: 'wifiClear', command: 'clearlist', field: { label: 'resultList', choices: [['-a', 'apAndStations'], ['-c', 'stationList']] }, confirm: true },
  ],
  radioControl: [
    { id: 'channelRead', command: 'channel' },
    { id: 'channelSet', command: 'channel -s', field: { label: 'channel', choices: channelChoices } },
    { id: 'channelHop', command: 'settings -s ChanHop', field: { label: 'channelHop', choices: ['enable', 'disable'] } },
  ],
  group_ble: [
    { id: 'bleScan', command: 'sniffbt', task: 'ble', defaultDuration: 30 },
    { id: 'bleResults', command: 'list -b' },
  ],
  deviceControl: [
    { id: 'stopTask', command: 'stopscan', during: 'any' },
    { id: 'resync', command: 'protocolinfo --machine', action: 'resync', during: 'recovery' },
    { id: 'deviceInfo', command: 'info' },
    { id: 'deviceSettings', command: 'settings' },
  ],
  dualBand: [
    { id: 'dualScan', command: 'scanall', task: 'dual', action: 'dual', defaultDuration: 30 },
    { id: 'dualStop', command: 'stopscan', action: 'dualStop', during: 'dual' },
  ],
  motion: [
    { id: 'motionStart', command: 'csimotion start', field: { ...target, observedOnly: true }, task: 'csi' },
    { id: 'motionStatus', command: 'csimotion status', during: 'csiOrIdle' },
    { id: 'motionRecalibrate', command: 'csimotion recalibrate', during: 'csi' },
  ],
  lan: [
    { id: 'lanJoinPassword', command: 'join -a', action: 'joinWifi', field: { label: 'scannedNetworkOptional', networks: true, includeAllNamed: true, emptyLabel: 'manualNetworkOption' }, ssid: { label: 'wifiSsid', placeholder: 'wifiSsidPlaceholder' }, password: { label: 'wifiPassword', placeholder: 'wifiPasswordPlaceholder' }, lan: true, timeout: 25000 },
    { id: 'lanJoin', command: 'join -s', lan: true, timeout: 65000 },
    { id: 'lanArp', command: 'arpscan', task: 'lan', lan: true, defaultDuration: 60 },
    { id: 'lanPing', command: 'pingscan', task: 'lan', lan: true, defaultDuration: 30 },
    { id: 'lanList', command: 'list -i' },
    { id: 'lanStop', command: 'stopscan', during: 'lan' },
  ],
  detectors: [
    { id: 'detectDisconnect', command: 'sniffdeauth', task: 'observe', defaultDuration: 30 },
    { id: 'detectSae', command: 'sniffsae', task: 'observe', defaultDuration: 30 },
    { id: 'detectPine', command: 'sniffpinescan', task: 'observe', defaultDuration: 30 },
    { id: 'detectMulti', command: 'sniffmultissid', task: 'observe', defaultDuration: 30 },
    { id: 'bleSkimmers', command: 'sniffskim', task: 'observe', defaultDuration: 30 },
    { id: 'detectBluetooth', command: 'sniffbt -t', field: { label: 'bleType', choices: [['airtag', 'AirTag'], ['ibeacon', 'iBeacon'], ['flock', 'Flock'], ['flipper', 'Flipper'], ['meta', 'Meta']] }, task: 'observe', defaultDuration: 30 },
    { id: 'remoteIdScan', command: 'remoteid scan', task: 'observe', defaultDuration: 30 },
    { id: 'remoteIdList', command: 'remoteid list' },
  ],
  signalFind: [
    { id: 'signalFindWifi', command: 'foxhunt -w', field: target, task: 'signal' },
  ],
  group_gps: [
    { id: 'gpsRead', command: 'gps -g', gps: true, field: { label: 'gpsField', choices: ['fix', 'sat', 'lat', 'lon', 'alt', 'accuracy', 'date', 'text', 'nmea'] } },
    { id: 'gpsLive', command: 'gpsdata', task: 'gps', gps: true },
    { id: 'gpsNmea', command: 'nmea', task: 'gps', gps: true },
  ],
};

/** A measured RSSI or received frame identifies an observed AP in device results. */
export function hasRadioObservation({ rssi, frames }) {
  return (Number.isFinite(rssi) && rssi > -127 && rssi < 0) || frames > 0;
}

function activeFor(operation, task, taskKind) {
  switch (operation.during) {
    case 'any': return true;
    case 'recovery': return task === 'idle' || task === 'taskUnknown';
    case 'csi': return task === 'scanning' && taskKind === 'csi';
    case 'csiOrIdle': return task === 'idle' || (task === 'scanning' && taskKind === 'csi');
    case 'dual': return taskKind === 'dual' && task !== 'idle';
    case 'lan': return taskKind === 'lan' && task !== 'idle';
    default: return task === 'idle';
  }
}

/**
 * Render independent command forms and validate their device arguments.
 * 生成独立命令表单，并校验发给设备的参数。
 */
export function setupFunctions({ translate, execute }) {
  const controls = [];
  const lanConsent = document.getElementById('lan-authorized');
  let device = { ready: false, busy: false, task: 'idle', taskKind: '', networks: new Map(), wifiConnected: false, wifiSsid: '' };

  const utf8 = new TextEncoder();

  function choices(field) {
    if (!field) return [];
    if (!field.networks) return field.choices.map((choice) => Array.isArray(choice) ? choice : [choice, choice]);
    const networks = [...device.networks.values()];
    if (field.includeAllNamed) {
      return networks
        .filter(({ hidden, name }) => !hidden && name)
        .sort((a, b) => {
          const aIndexed = Number.isInteger(a.index) && a.index >= 0;
          const bIndexed = Number.isInteger(b.index) && b.index >= 0;
          if (aIndexed !== bIndexed) return aIndexed ? -1 : 1;
          if (aIndexed) return a.index - b.index;
          return (b.rssi ?? -100) - (a.rssi ?? -100);
        })
        .map(({ index, bssid, name, channel, rssi }) => [
          bssid,
          Number.isInteger(index) && index >= 0 ? `[${index}] ${name}` : `${name} (Ch ${channel || '?'} · ${rssi} dBm)`,
        ]);
    }
    return networks
      .filter((network) => Number.isInteger(network.index) && network.index >= 0 && (!field.observedOnly || hasRadioObservation(network)))
      .sort((a, b) => a.index - b.index)
      .map(({ index, bssid, name, channel }) => {
        const label = `[${index}] ${name || bssid}`;
        return [bssid, field.observedOnly ? `${label} · ${translate('bandChannel', { channel })} · ${bssid}` : label];
      });
  }

  /**
   * Format a CLI argument for Marauder's quote-aware command parser.
   * 为 Marauder 支持引号的命令行解析器格式化参数。
   */
  function quoteCliValue(value, maxBytes = 63, alwaysQuote = false) {
    if (!value || /[\r\n]/.test(value)) return null;
    if (value.includes('"') && value.includes("'")) return null;
    if (utf8.encode(value).length > maxBytes) return null;
    if (!alwaysQuote && !/[\s"']/.test(value)) return value;
    return value.includes('"') ? `'${value}'` : `"${value}"`;
  }

  /**
   * Build the join operation preview and payload from a picked network or manual SSID.
   * 根据所选扫描网络或手动输入的 SSID 生成 Wi-Fi 连接预览与执行参数。
   */
  function resolveJoinWifi(operation, value, secret = '', manualSsid = '') {
    const picked = value ? device.networks.get(value) : null;
    const ssid = manualSsid.trim() || (picked && !picked.hidden ? picked.name : '');
    const quotedSsid = quoteCliValue(ssid, 32);
    const quotedPassword = quoteCliValue(secret, 63);
    const matchedIndexed = picked && Number.isInteger(picked.index) && picked.index >= 0 && picked.name === ssid
      ? picked
      : [...device.networks.values()].find((network) => Number.isInteger(network.index) && network.index >= 0 && network.name === ssid) ?? null;
    const passwordMask = quotedPassword ? '••••••' : '<password>';
    const preview = !quotedSsid
      ? `${operation.command} <index> -p ${passwordMask}`
      : matchedIndexed
        ? `${operation.command} ${matchedIndexed.index} -p ${passwordMask}`
        : `add -a -e ${quotedSsid} + ${operation.command} <index> -p ${passwordMask}`;
    if (!quotedSsid || !quotedPassword) return { request: null, preview };
    return {
      preview,
      request: {
        command: operation.command,
        preview,
        operation: {
          ...operation,
          network: matchedIndexed?.bssid ?? picked?.bssid ?? '',
          ssid,
          quotedSsid,
          quotedPassword,
          redactedCommand: `${operation.command} <index> -p [redacted]`,
        },
      },
    };
  }

  function resolve(operation, value, secret = '', manualSsid = '') {
    if (operation.action === 'joinWifi') return resolveJoinWifi(operation, value, secret, manualSsid).request;
    if (!operation.field) return { command: operation.command, operation };
    if (operation.field.networks) {
      const network = device.networks.get(value);
      if (!network || !Number.isInteger(network.index) || network.index < 0) return null;
      if (operation.field.observedOnly && !hasRadioObservation(network)) return null;
      return { command: `${operation.command} ${network.index}`, operation: { ...operation, network: value } };
    }
    if (!choices(operation.field).some(([id]) => value === id)) return null;
    return { command: `${operation.command} ${value}`, operation };
  }

  /** Resolve a CSI target to a measured AP, a supplied radio address, or an explicit join. */
  function resolveMotion({ operation, select, motion }) {
    const mode = select.value;
    const input = motion.motionTarget.value;
    const connected = { command: 'csimotion connected', operation };
    if (mode === 'connected') return { request: device.wifiConnected ? connected : null };
    if (mode === 'join') {
      const quotedSsid = quoteCliValue(input, 32);
      const secret = motion.motionPassword.value;
      const quotedPassword = secret ? quoteCliValue(secret) : '""';
      return {
        hint: 'motionJoinHint',
        request: quotedSsid && quotedPassword ? {
          ...connected, operation: { ...operation, join: { ssid: input, quotedSsid, quotedPassword } },
        } : null,
      };
    }
    const selfTest = mode === 'selftest';
    if (!selfTest && mode !== 'manual') return { request: resolve(operation, mode) };
    const address = (selfTest ? motion.motionBssid.value : input).trim().toLowerCase();
    const isAddress = /^(?:[\da-f]{2}:){5}[\da-f]{2}$/.test(address);
    const unicast = isAddress && !(parseInt(address.slice(0, 2), 16) & 1) && address !== '00:00:00:00:00:00';
    if (selfTest) {
      const ssid = motion.motionSsid.value;
      const quotedSsid = /[\x00-\x1f\x7f]/.test(ssid) ? null : quoteCliValue(ssid, 32, true);
      const channel = motion.motionChannel.value;
      const command = 'csimotion selftest';
      return {
        hint: 'motionSelfTestHint', showChannel: true,
        request: quotedSsid && unicast && channelChoices.includes(channel) ? {
          command, preview: `${command} <index> ${quotedSsid}`,
          operation: { ...operation, radioTarget: { bssid: address, channel: Number(channel), quotedSsid }, duration: 60 },
        } : null,
      };
    }
    if (!input) return { hint: 'motionManualHint' };
    if (isAddress && !unicast) {
      return { hint: 'motionInvalidAddress' };
    }
    const matches = [...device.networks.values()].filter((ap) => hasRadioObservation(ap) &&
      (isAddress ? ap.bssid === address : !ap.hidden && ap.name === input));
    if (matches.length > 1) return { hint: 'motionSeveralTargets' };
    const ap = matches[0];
    if (ap && Number.isInteger(ap.index) && ap.index >= 0) return { request: resolve(operation, ap.bssid) };
    if (!ap && !isAddress) {
      if (device.wifiConnected && input === device.wifiSsid) return { request: connected };
      return { hint: 'motionNameMissing' };
    }
    const bssid = ap?.bssid ?? address;
    const measuredChannel = ap && channelChoices.includes(String(ap.channel));
    const channel = measuredChannel ? ap.channel : Number(motion.motionChannel.value);
    const target = { bssid, channel };
    return {
      showChannel: !measuredChannel,
      hint: 'motionAddressHint',
      request: channelChoices.includes(String(channel)) ? {
        command: operation.command, operation: { ...operation, radioTarget: target },
        preview: `${bssid} · ${translate('bandChannel', { channel })}`,
      } : null,
    };
  }

  function permitted(operation) {
    return device.ready && !device.busy && activeFor(operation, device.task, device.taskKind) &&
      (!operation.gps || device.gps === 'found') && (!operation.lan || lanConsent.checked);
  }

  function updateControls() {
    for (const control of controls) {
      const { operation, select, ssidInput, passwordInput, preview, run, confirm } = control;
      if (select && operation.field.networks) {
        const defaultOptionKey = operation.field.emptyLabel ?? 'chooseNetwork';
        const options = choices(operation.field);
        if (control.motion) {
          options.unshift(['manual', translate('motionManualOption')], ['join', translate('motionJoinOption')], ['selftest', translate('motionSelfTestOption')]);
          if (device.wifiConnected) options.unshift(['connected', [translate('motionCurrentOption'), device.wifiSsid].filter(Boolean).join(' · ')]);
        }
        const signature = JSON.stringify([translate(defaultOptionKey), options]);
        if (control.signature !== signature) {
          const previous = select.value;
          control.signature = signature;
          select.replaceChildren(new Option(translate(defaultOptionKey), ''), ...options.map(([id, label]) => new Option(label, id)));
          if (options.some(([id]) => id === previous)) select.value = previous;
        }
      }
      if (control.motion) {
        const { motionTarget, motionChannel, motionPassword, motionSsid, motionBssid } = control.motion;
        const joining = select.value === 'join';
        const selfTest = select.value === 'selftest';
        control.description.hidden = selfTest;
        motionSsid.parentElement.hidden = !selfTest;
        motionBssid.parentElement.hidden = !selfTest;
        motionTarget.parentElement.hidden = select.value !== 'manual' && !joining;
        motionTarget.previousElementSibling.textContent = translate(joining ? 'wifiSsid' : 'motionTargetName');
        motionPassword.parentElement.hidden = !joining;
        if (!joining) motionPassword.value = '';
        const { request, hint, showChannel } = resolveMotion(control);
        motionChannel.parentElement.hidden = !showChannel;
        control.hint.textContent = hint ? translate(hint) : '';
        control.hint.hidden = !hint;
        preview.textContent = request?.preview ?? request?.command ?? '';
        run.disabled = !request || !permitted(operation);
        continue;
      }
      if (operation.action === 'joinWifi') {
        const resolved = resolveJoinWifi(operation, select?.value, passwordInput?.value ?? '', ssidInput?.value ?? '');
        preview.textContent = resolved.preview;
        run.disabled = !resolved.request || !permitted(operation);
        continue;
      }
      const request = resolve(operation, select?.value, passwordInput?.value ?? '', ssidInput?.value ?? '');
      preview.textContent = operation.action === 'resync'
        ? `${operation.command} <id>`
        : request?.preview ?? request?.command ?? `${operation.command} <index>`;
      run.disabled = !request || !permitted(operation) || (confirm && !confirm.checked);
    }
  }

  function text(tag, key) {
    const element = document.createElement(tag);
    element.dataset.i18n = key;
    element.textContent = translate(key);
    return element;
  }

  function createCard(operation) {
    const form = document.createElement('form');
    form.className = 'operation-card';
    form.dataset.operation = operation.id;
    const description = text('p', operation.hint ?? `${operation.id}Hint`);
    description.className = 'operation-desc';
    form.append(text('h3', operation.id), description);

    let select;
    let ssidInput;
    let durationSelect;
    let passwordInput;
    let confirm;
    if (operation.field) {
      const label = document.createElement('label');
      label.className = 'operation-field';
      select = document.createElement('select');
      if (!operation.field.networks) {
        for (const [value, key] of choices(operation.field)) {
          const option = text('option', key);
          option.value = value;
          select.append(option);
        }
      }
      label.append(text('span', operation.field.label), select);
      form.append(label);
    }
    let motion;
    if (operation.id === 'motionStart') {
      form.append(document.getElementById('motion-target-inputs').content.cloneNode(true));
      motion = form.elements;
      motion.motionChannel.append(...channelChoices.map((value) => new Option(value, value)));
      motion.motionTarget.addEventListener('input', () => { motion.motionChannel.value = ''; });
      select.addEventListener('change', () => { motion.motionChannel.value = ''; });
    }
    if (operation.ssid) {
      const label = document.createElement('label');
      label.className = 'operation-field';
      ssidInput = document.createElement('input');
      ssidInput.type = 'text';
      ssidInput.autocomplete = 'off';
      ssidInput.spellcheck = false;
      ssidInput.dataset.placeholder = operation.ssid.placeholder;
      ssidInput.placeholder = translate(operation.ssid.placeholder);
      label.append(text('span', operation.ssid.label), ssidInput);
      form.append(label);
      if (select) {
        select.addEventListener('change', () => {
          if (select.value) {
            const network = device.networks.get(select.value);
            if (network && !network.hidden && network.name) ssidInput.value = network.name;
          }
          updateControls();
        });
        ssidInput.addEventListener('input', () => {
          if (!select.value) return;
          const network = device.networks.get(select.value);
          if (!network || network.name !== ssidInput.value.trim()) select.value = '';
        });
      }
    }
    if (Number.isFinite(operation.defaultDuration)) {
      // Timed scan duration stays client-side and schedules `stopscan` when elapsed.
      // 定时扫描时长仅在网页端计时，到点后自动发送 `stopscan` 停止任务。
      const label = document.createElement('label');
      label.className = 'operation-field';
      durationSelect = document.createElement('select');
      for (const seconds of scanDurationChoices) {
        durationSelect.append(new Option(`${seconds} s`, String(seconds)));
      }
      const untilStopped = text('option', 'captureUntilStopped');
      untilStopped.value = '0';
      durationSelect.append(untilStopped);
      durationSelect.value = String(operation.defaultDuration);
      label.append(text('span', 'scanDuration'), durationSelect);
      form.append(label);
    }
    if (operation.password) {
      const label = document.createElement('label');
      label.className = 'operation-field';
      passwordInput = document.createElement('input');
      passwordInput.type = 'password';
      passwordInput.autocomplete = 'off';
      passwordInput.dataset.placeholder = operation.password.placeholder;
      passwordInput.placeholder = translate(operation.password.placeholder);
      label.append(text('span', operation.password.label), passwordInput);
      form.append(label);
    }
    if (operation.confirm) {
      const label = document.createElement('label');
      label.className = 'operation-check';
      confirm = document.createElement('input');
      confirm.type = 'checkbox';
      label.append(confirm, text('span', 'confirmClear'));
      form.append(label);
    }
    const actions = document.createElement('div');
    actions.className = 'operation-actions';
    const preview = document.createElement('code');
    const run = text('button', motion ? 'motionStart' : 'runAction');
    run.className = 'button secondary';
    if (!motion) run.setAttribute('aria-labelledby', `${operation.id}-run ${operation.id}-title`);
    run.id = `${operation.id}-run`;
    form.querySelector('h3').id = `${operation.id}-title`;
    run.type = 'submit';
    actions.append(preview, run);
    form.append(actions);
    const control = { operation, select, ssidInput, passwordInput, preview, run, confirm, motion, description, hint: form.querySelector('[data-motion-hint]') };
    controls.push(control);
    form.addEventListener('input', updateControls);
    form.addEventListener('change', updateControls);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const request = motion ? resolveMotion(control).request : resolve(operation, select?.value, passwordInput?.value ?? '', ssidInput?.value ?? '');
      if (!request || !permitted(operation) || (confirm && !confirm.checked)) return;
      if (passwordInput) passwordInput.value = '';
      if (motion) motion.motionPassword.value = '';
      if (confirm) confirm.checked = false;
      const payload = durationSelect ? { ...request.operation, duration: Number(durationSelect.value) } : request.operation;
      execute(request.command, payload);
      updateControls();
    });
    return form;
  }

  for (const [group, operations] of Object.entries(operationGroups)) {
    document.querySelector(`[data-operation-group="${group}"]`).append(...operations.map(createCard));
  }
  lanConsent.addEventListener('change', updateControls);
  updateControls();

  return {
    update(next) {
      if (!next.ready) {
        lanConsent.checked = false;
        for (const { passwordInput, motion } of controls) {
          if (passwordInput) passwordInput.value = '';
          if (motion) motion.motionPassword.value = '';
        }
      }
      device = next;
      updateControls();
    },
    manual(command) {
      for (const { operation } of controls) {
        if (operation.confirm || operation.action || operation.password) continue;
        if (!operation.field && operation.command === command) return operation;
        if (!operation.field) continue;
        for (const [value] of choices(operation.field)) {
          const request = resolve(operation, value);
          if (request?.command === command) return request.operation;
        }
      }
      return null;
    },
    permitted,
  };
}
