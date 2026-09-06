const $ = id => document.getElementById(id);
const history = [];
let latest = null;
const hostedDemo = window.SCADA_RUNTIME?.driver === 'browser-demo';
let controlToken = hostedDemo ? 'browser-demo-control-enabled' : '';
let tagsLoaded = false;
const browserDemo = hostedDemo ? createBrowserDemo() : null;

const setText = (id, value) => { $(id).textContent = value; };
const toggleClass = (node, name, on) => node?.classList.toggle(name, Boolean(on));

function toast(message, error = false) {
  const node = $('toast');
  node.textContent = message;
  toggleClass(node, 'error', error);
  toggleClass(node, 'show', true);
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => toggleClass(node, 'show', false), 2800);
}

function render(state) {
  latest = state;
  const isDemo = state.mode === 'demo';
  setText('sourceBadge', isDemo ? 'DEMO ENGINE' : 'M221 MODBUS TCP');
  toggleClass($('sourceBadge'), 'demo', isDemo);
  toggleClass($('connectionBadge'), 'online', state.connected);
  $('connectionBadge').innerHTML = `<i></i>${state.connected ? (isDemo ? 'DEMO ONLINE' : 'PLC ONLINE') : 'PLC OFFLINE'}`;
  setText('latencyValue', state.latencyMs ?? '—');
  setText('lastUpdate', state.timestamp ? `UPDATED ${new Date(state.timestamp).toLocaleTimeString('id-ID')}` : 'NO UPDATE');
  setText('endpointValue', isDemo ? 'LOCAL PROCESS MODEL · :3210' : `${state.source?.host || '—'}:${state.source?.port || '—'} · U${state.source?.unitId || '—'}`);
  setText('profileValue', isDemo ? 'DEMONSTRATION' : 'SCHNEIDER LIVE');
  setText('writeValue', hostedDemo ? 'LOCAL DEMO' : state.writeEnabled ? 'TOKEN REQUIRED' : 'DISABLED');

  if (!state.data) {
    renderOffline(state);
    renderControls(state, null);
    return;
  }

  const data = state.data;
  setText('modeBadge', data.system.autoMode ? 'AUTO' : 'MANUAL');
  const process = data.system.esdTrip
    ? ['ESD TRIP', 'Local field reset required', 'bad']
    : data.system.commonAlarm
      ? ['ALARMED', 'Inspect active event list', 'bad']
      : data.system.systemRun
        ? ['RUNNING', `Transfer aligned to ${data.sequence.route}`, 'good']
        : data.system.processPermissive
          ? ['READY', 'Permissives healthy · awaiting start', '']
          : ['NOT READY', 'One or more permissives are open', 'warn'];

  setText('processState', process[0]);
  setText('processDetail', process[1]);
  $('processState').className = process[2];
  setText('routeValue', data.sequence.route);
  setText('routePhase', data.sequence.divertActive ? 'DIVERT ACTIVE' : data.sequence.busy ? 'ANALYSING' : data.sequence.resetActive ? 'RESETTING' : 'SEQUENCE IDLE');
  setText('flowValue', format(data.measurements.flowRate, 1));
  setText('pressureValue', format(data.measurements.dischargePressure, 2));
  setText('bswValue', format(data.measurements.bsw, 2));
  setText('pipeSuction', format(data.measurements.suctionPressure, 2));
  setText('demandValue', data.system.autoDemand ? 'AUTO' : data.system.manualDemand ? 'MANUAL' : 'NONE');
  setText('esdValue', data.system.esdTrip ? 'TRIPPED' : 'HEALTHY');
  $('esdValue').className = data.system.esdTrip ? 'bad' : 'good';

  updateEquipment(data.equipment);
  updateRoutes(data);
  updateTank('sales', data.measurements.salesLevel);
  updateTank('reprocess', data.measurements.reprocessLevel);
  updateTank('slop', data.measurements.slopLevel);
  setText('salesCount', formatInteger(data.counters.sales));
  setText('reprocessCount', formatInteger(data.counters.reprocess));
  setText('slopCount', formatInteger(data.counters.slop));

  toggleClass(document.querySelector('[data-pipe="feed"]'), 'flowing', data.system.systemRun);
  toggleClass(document.querySelector('[data-pipe="transfer"]'), 'flowing', data.system.systemRun);
  toggleClass(document.querySelector('[data-pipe="discharge"]'), 'flowing', data.system.systemRun);
  toggleClass(document.querySelector('[data-pipe="manifold"]'), 'flowing', data.system.systemRun);

  renderAlarms(data.alarms);
  renderPermissives(data);
  renderControls(state, data);
  updateTrend(data.measurements.flowRate, data.measurements.dischargePressure);
}

function renderOffline(state) {
  setText('modeBadge', 'MODE —');
  setText('processState', 'NO DATA');
  $('processState').className = 'bad';
  setText('processDetail', state.error || 'Start the PLC/emulator or use the demo launcher');
  for (const [id, value] of [['routeValue', '—'], ['routePhase', 'SEQUENCE IDLE'], ['flowValue', '—'], ['pressureValue', '—'], ['bswValue', '—'], ['pipeSuction', '—'], ['demandValue', '—'], ['esdValue', 'NO DATA'], ['salesCount', '—'], ['reprocessCount', '—'], ['slopCount', '—']]) setText(id, value);
  document.querySelectorAll('[data-unit]').forEach(node => node.classList.remove('running', 'fault', 'selected'));
  document.querySelectorAll('[data-pipe]').forEach(node => node.classList.remove('flowing'));
  updateTank('sales', null); updateTank('reprocess', null); updateTank('slop', null);
  $('alarms').innerHTML = `<p>${escapeHtml(state.error || 'PLC offline / no data')}</p>`;
  setText('alarmStamp', 'NO DATA');
  $('alarmRibbon').hidden = true;
  $('permissives').innerHTML = '<div class="permit"><span>DATA QUALITY</span><span>OFFLINE</span></div>';
}

function updateEquipment(equipment) {
  for (const item of equipment) {
    const card = document.querySelector(`[data-unit="${item.id}"]`);
    if (!card) continue;
    toggleClass(card, 'running', item.running);
    toggleClass(card, 'fault', !item.healthy);
    for (const [signal, value] of [['command', item.command], ['running', item.running], ['healthy', item.healthy]]) {
      toggleClass(card.querySelector(`[data-signal="${signal}"]`), 'on', value);
    }
  }
}

function updateRoutes(data) {
  document.querySelectorAll('[data-route]').forEach(card => {
    const selected = card.dataset.route === data.sequence.route;
    toggleClass(card, 'selected', selected);
    toggleClass(card, 'flowing', selected && data.system.systemRun);
  });
}

function updateTank(name, value) {
  const percent = Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
  $(`${name}Fill`).style.height = `${percent}%`;
  setText(`${name}Level`, format(value, 1));
}

function renderAlarms(alarms) {
  setText('alarmStamp', `${alarms.length} ACTIVE`);
  $('alarmRibbon').hidden = alarms.length === 0;
  if (alarms.length) {
    setText('alarmRibbonCode', alarms[0].code);
    setText('alarmRibbonText', alarms[0].message);
    setText('alarmRibbonCount', `${alarms.length} ACTIVE`);
  }
  $('alarms').innerHTML = alarms.length
    ? alarms.map(alarm => `<article class="alarm ${escapeHtml(alarm.severity)}"><b>${escapeHtml(alarm.code)} · ${escapeHtml(alarm.address)}</b><small>${escapeHtml(alarm.message)}</small></article>`).join('')
    : '<div class="no-alarm">NO ACTIVE EVENTS</div>';
}

function renderPermissives(data) {
  const rows = [
    ['PROCESS PERMISSIVE', data.system.processPermissive],
    ['ESD CHAIN', !data.system.esdTrip],
    ['PUMP PROOF', !data.diagnostics.pumpProofFail],
    ['SALES VALVE', !data.diagnostics.salesValveFail],
    ['REPROCESS VALVE', !data.diagnostics.reprocessValveFail],
    ['SLOP VALVE', !data.diagnostics.slopValveFail],
    ['SLOP TANK HH', !data.system.slopTankHH],
    ['COMMON ALARM', !data.system.commonAlarm]
  ];
  $('permissives').innerHTML = rows.map(([label, ok]) => `<div class="permit ${ok ? 'ok' : ''}"><span>${label}</span><span>${ok ? 'HEALTHY' : 'NOT OK'}</span></div>`).join('');
}

function renderControls(state, data) {
  const enabled = state.writeEnabled && controlToken.length >= 20 && state.connected;
  setText('controlLock', enabled ? 'CONTROL ENABLED' : state.writeEnabled ? 'SESSION LOCKED' : 'MONITOR ONLY');
  toggleClass($('controlLock'), 'enabled', enabled);
  document.querySelectorAll('[data-pulse],[data-hold],[data-toggle]').forEach(button => { button.disabled = !enabled; });
  if (!data) return;
  for (const [name, control] of Object.entries(data.controls)) {
    const toggle = document.querySelector(`[data-toggle="${name}"]`);
    if (toggle) toggleClass(toggle, 'active', control.value);
  }
}

async function refresh() {
  if (hostedDemo) {
    render(browserDemo.read());
    return;
  }
  try {
    const response = await fetch('/api/state', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    render(await response.json());
  } catch (error) {
    render({ connected: false, writeEnabled: false, mode: 'modbus', source: {}, latencyMs: null, timestamp: null, error: error.message, data: null });
  }
}

async function sendControl(name, value) {
  if (hostedDemo) {
    browserDemo.write(name, value);
    render(browserDemo.read(false));
    return;
  }
  try {
    const response = await fetch('/api/control', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Control-Token': controlToken },
      body: JSON.stringify({ name, value })
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`);
    await refresh();
  } catch (error) {
    toast(error.message, true);
  }
}

document.querySelectorAll('[data-pulse]').forEach(button => button.addEventListener('click', async () => {
  const name = button.dataset.pulse;
  await sendControl(name, true);
  setTimeout(() => sendControl(name, false), 250);
}));

document.querySelectorAll('[data-toggle]').forEach(button => button.addEventListener('click', () => {
  const name = button.dataset.toggle;
  sendControl(name, !Boolean(latest?.data?.controls?.[name]?.value));
}));

document.querySelectorAll('[data-hold]').forEach(button => {
  const start = event => { event.preventDefault(); toggleClass(button, 'pressed', true); sendControl(button.dataset.hold, true); };
  const stop = event => { event.preventDefault(); toggleClass(button, 'pressed', false); sendControl(button.dataset.hold, false); };
  button.addEventListener('pointerdown', start);
  button.addEventListener('pointerup', stop);
  button.addEventListener('pointercancel', stop);
  button.addEventListener('pointerleave', event => { if (button.classList.contains('pressed')) stop(event); });
});

$('sessionButton').addEventListener('click', () => {
  if (controlToken) {
    controlToken = '';
    toast('Control session closed');
    renderControls(latest, latest?.data);
  } else {
    $('authDialog').showModal();
  }
});

if (hostedDemo) $('sessionButton').hidden = true;

$('saveToken').addEventListener('click', event => {
  const value = $('tokenInput').value.trim();
  if (value.length < 20) {
    event.preventDefault();
    return toast('Token minimal 20 karakter', true);
  }
  controlToken = value;
  $('tokenInput').value = '';
  toast('Control session opened');
  if (latest) renderControls(latest, latest.data);
});

$('toggleTags').addEventListener('click', async () => {
  if (!tagsLoaded) {
    let tags;
    if (hostedDemo) {
      tags = STATIC_TAGS;
    } else {
      const response = await fetch('/api/tags');
      ({ tags } = await response.json());
    }
    $('tagTable').innerHTML = '<div class="tag-row tag-head"><span>TAG</span><span>PLC</span><span>MODBUS</span><span>ACCESS</span></div>' + tags.map(tag => `<div class="tag-row"><span>${escapeHtml(tag.name)}</span><span>${escapeHtml(tag.plc)}</span><span>${escapeHtml(String(tag.modbus))}</span><span>${escapeHtml(tag.access)}</span></div>`).join('');
    tagsLoaded = true;
  }
  $('tagTable').hidden = !$('tagTable').hidden;
  setText('toggleTags', $('tagTable').hidden ? 'SHOW TAGS' : 'HIDE TAGS');
});

function updateTrend(flow, pressure) {
  history.push({ flow: Number.isFinite(flow) ? flow : null, pressure: Number.isFinite(pressure) ? pressure : null });
  if (history.length > 120) history.shift();
  drawTrend();
}

function drawTrend() {
  const canvas = $('trend');
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth || 900;
  const height = canvas.clientHeight || 250;
  if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.strokeStyle = '#273237';
  ctx.lineWidth = 1;
  ctx.font = '10px Consolas, monospace';
  ctx.fillStyle = '#738085';
  for (let index = 0; index <= 4; index += 1) {
    const y = 18 + index * ((height - 36) / 4);
    ctx.beginPath(); ctx.moveTo(38, y); ctx.lineTo(width, y); ctx.stroke();
    ctx.fillText(String(150 - index * 37.5), 5, y + 3);
  }
  plot(ctx, width, height, history.map(point => point.flow), 150, '#efaa44');
  plot(ctx, width, height, history.map(point => point.pressure), 10, '#55b9d8');
}

function plot(ctx, width, height, values, max, color) {
  if (values.length < 2) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  let drawing = false;
  values.forEach((value, index) => {
    if (!Number.isFinite(value)) { drawing = false; return; }
    const x = 38 + (index / 119) * (width - 38);
    const y = height - 18 - Math.max(0, Math.min(1, value / max)) * (height - 36);
    if (!drawing) { ctx.moveTo(x, y); drawing = true; } else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

function format(value, decimals = 1) {
  return Number.isFinite(value) ? Number(value).toFixed(decimals) : '—';
}

function formatInteger(value) {
  return Number.isFinite(value) ? Math.trunc(value).toLocaleString('id-ID') : 'N/A';
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function createBrowserDemo() {
  const model = {
    tick: 0,
    running: true,
    autoMode: true,
    autoEnable: true,
    countedCycle: -1,
    counters: { sales: 1284, reprocess: 96, slop: 24 }
  };
  const routeOrder = ['SALES', 'SALES', 'REPROCESS', 'SALES', 'SLOP'];

  return {
    write(name, value) {
      if (name === 'start' && value) model.running = true;
      if (name === 'stop' && value) model.running = false;
      if (name === 'autoMode') model.autoMode = value;
      if (name === 'autoEnable') model.autoEnable = value;
      if (name === 'resetCounters' && value) model.counters = { sales: 0, reprocess: 0, slop: 0 };
    },
    read(advance = true) {
      if (advance) model.tick += 1;
      const cycle = Math.floor(model.tick / 36);
      const phase = model.tick % 36;
      const route = model.running ? routeOrder[cycle % routeOrder.length] : 'HOLD';
      const routeKey = route.toLowerCase();
      if (model.running && phase === 25 && model.countedCycle !== cycle) {
        model.counters[routeKey] += 1;
        model.countedCycle = cycle;
      }
      const busy = model.running && phase >= 7 && phase < 16;
      const divertActive = model.running && phase >= 16 && phase < 25;
      const wave = Math.sin(model.tick / 7);
      const pressureWave = Math.sin(model.tick / 11 + .8);
      const measurement = {
        flowRate: model.running ? 132 + wave * 5.8 : 0,
        suctionPressure: model.running ? 2.42 + pressureWave * .08 : 2.18,
        dischargePressure: model.running ? 8.34 + pressureWave * .24 : 2.2,
        bsw: route === 'SALES' ? .38 + wave * .05 : route === 'REPROCESS' ? 1.42 + wave * .16 : route === 'SLOP' ? 4.8 + wave * .4 : 0,
        salesLevel: Math.min(92, 63.2 + Math.max(0, model.counters.sales - 1284) * .03),
        reprocessLevel: Math.min(92, 37.6 + Math.max(0, model.counters.reprocess - 96) * .05),
        slopLevel: Math.min(92, 21.4 + Math.max(0, model.counters.slop - 24) * .08)
      };
      const equipment = [
        demoEquipment('sdv', 'SDV-101', 'Inlet Shutdown Valve', model.running, model.running),
        demoEquipment('pump', 'P-101', 'Crude Transfer Pump', model.running, model.running),
        demoEquipment('analyzer', 'AIT-101', 'Quality Analyser', busy, busy),
        demoEquipment('sales', 'XV-201A', 'Sales Route Valve', route === 'SALES', model.running && route === 'SALES'),
        demoEquipment('reprocess', 'XV-201B', 'Reprocess Route Valve', route === 'REPROCESS', model.running && route === 'REPROCESS'),
        demoEquipment('slop', 'XV-201C', 'Slop Route Valve', route === 'SLOP', model.running && route === 'SLOP')
      ];
      return {
        connected: true,
        mode: 'demo',
        writeEnabled: true,
        source: { driver: 'browser-demo', host: 'private-site', port: 443, unitId: 1 },
        timestamp: new Date().toISOString(),
        latencyMs: 0,
        error: null,
        data: {
          source: 'demo',
          system: { autoMode: model.autoMode, autoEnable: model.autoEnable, systemRun: model.running, processPermissive: true, manualDemand: model.running && !model.autoMode, autoDemand: model.running && model.autoMode && model.autoEnable, slopTankHH: false, esdTrip: false, commonAlarm: false, equipmentAlarm: false },
          sequence: { route, salesSelected: route === 'SALES', reprocessSelected: route === 'REPROCESS', slopSelected: route === 'SLOP', busy, divertActive, resetActive: model.running && phase === 25 },
          equipment,
          measurements: measurement,
          counters: { ...model.counters },
          diagnostics: { stopRequest: false, salesValveFail: false, reprocessValveFail: false, slopValveFail: false, pumpProofFail: false },
          controls: {
            autoMode: { value: model.autoMode }, start: { value: false }, stop: { value: false },
            autoEnable: { value: model.autoEnable }, resetCounters: { value: false }
          },
          alarms: []
        }
      };
    }
  };
}

function demoEquipment(id, tag, name, command, running) {
  return { id, tag, name, command, running, ready: true, healthy: true };
}

const STATIC_TAGS = [
  ['autoMode', '%M0', 0, 'R/W whitelist'], ['start', '%M1', 1, 'R/W whitelist'],
  ['stop', '%M2', 2, 'R/W whitelist'], ['autoEnable', '%M3', 3, 'R/W whitelist'],
  ['SYSTEM_RUN', '%M10', 10, 'Read only'], ['PROCESS_PERMISSIVE', '%M11', 11, 'Read only'],
  ['ESD_TRIP_LATCH', '%M15', 15, 'Read only'], ['SALES_ROUTE_LATCH', '%M20', 20, 'Read only'],
  ['REPROCESS_ROUTE_LATCH', '%M21', 21, 'Read only'], ['SLOP_ROUTE_LATCH', '%M22', 22, 'Read only'],
  ['ROUTE_SEQUENCE_BUSY', '%M23', 23, 'Read only'], ['DIVERT_ACTIVE', '%M24', 24, 'Read only'],
  ['COMMON_ALARM', '%M30', 30, 'Read only'], ['resetCounters', '%M40', 40, 'R/W whitelist']
].map(([name, plc, modbus, access]) => ({ name, plc, modbus, access }));

setInterval(() => setText('clock', new Date().toLocaleTimeString('id-ID')), 1000);
setInterval(refresh, 500);
window.addEventListener('resize', drawTrend);
refresh();
