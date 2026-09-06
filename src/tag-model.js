export const MODBUS_READ_PLAN = Object.freeze({ coilStart: 0, coilQuantity: 41 });

export const CONTROLS = Object.freeze({
  autoMode: { address: 0, label: 'AUTO MODE', kind: 'toggle' },
  start: { address: 1, label: 'START TRANSFER', kind: 'pulse' },
  stop: { address: 2, label: 'NORMAL STOP', kind: 'hold' },
  autoEnable: { address: 3, label: 'AUTO ENABLE', kind: 'toggle' },
  resetCounters: { address: 40, label: 'RESET BATCH COUNTERS', kind: 'pulse' }
});

const emptyMeasurements = Object.freeze({
  flowRate: null,
  suctionPressure: null,
  dischargePressure: null,
  bsw: null,
  salesLevel: null,
  reprocessLevel: null,
  slopLevel: null
});

const emptyCounters = Object.freeze({ sales: null, reprocess: null, slop: null });

export function decodeSnapshot(coils, telemetry = {}) {
  if (!Array.isArray(coils) || coils.length < MODBUS_READ_PLAN.coilQuantity) {
    throw new Error('Snapshot coil M221 tidak lengkap');
  }
  const coil = address => Boolean(coils[address - MODBUS_READ_PLAN.coilStart]);
  const systemRun = coil(10);
  const processPermissive = coil(11);
  const esdTrip = coil(15);
  const salesSelected = coil(20);
  const reprocessSelected = coil(21);
  const slopSelected = coil(22);
  const route = slopSelected ? 'SLOP' : reprocessSelected ? 'REPROCESS' : salesSelected ? 'SALES' : 'HOLD';

  const alarms = [];
  addAlarm(alarms, esdTrip, '%M15', 'ESD_TRIP', 'critical', 'Emergency shutdown latch active — reset locally after the field is safe');
  addAlarm(alarms, coil(26), '%M26', 'SALES_VALVE_FAIL', 'trip', 'Sales routing valve failed to prove position');
  addAlarm(alarms, coil(27), '%M27', 'REPROCESS_VALVE_FAIL', 'trip', 'Reprocess routing valve failed to prove position');
  addAlarm(alarms, coil(28), '%M28', 'SLOP_VALVE_FAIL', 'trip', 'Slop routing valve failed to prove position');
  addAlarm(alarms, coil(29), '%M29', 'PUMP_PROOF_FAIL', 'trip', 'Crude feed pump running feedback was not proven');
  addAlarm(alarms, coil(14), '%M14', 'SLOP_TANK_HH', 'warning', 'Slop tank high-high interlock is active');
  addAlarm(alarms, coil(33), '%M33', 'EQUIPMENT_ALARM', 'warning', 'Equipment alarm summary is active');
  if (coil(30) && alarms.length === 0) addAlarm(alarms, true, '%M30', 'COMMON_ALARM', 'trip', 'Common alarm summary is active');
  if (!processPermissive && !esdTrip) addAlarm(alarms, true, '%M11', 'PERMISSIVE_LOST', 'warning', 'One or more process permissives are not healthy');

  const equipment = [
    equipmentState('sdv', 'SDV-101', 'Inlet Shutdown Valve', systemRun, systemRun && processPermissive && !esdTrip, processPermissive && !esdTrip, !esdTrip),
    equipmentState('pump', 'P-101', 'Crude Transfer Pump', systemRun, systemRun && !coil(29), processPermissive && !esdTrip, !coil(29)),
    equipmentState('analyzer', 'AIT-101', 'Quality Analyser', coil(23), coil(23), processPermissive, true),
    equipmentState('sales', 'XV-201A', 'Sales Route Valve', salesSelected, salesSelected && !coil(26), processPermissive, !coil(26)),
    equipmentState('reprocess', 'XV-201B', 'Reprocess Route Valve', reprocessSelected, reprocessSelected && !coil(27), processPermissive, !coil(27)),
    equipmentState('slop', 'XV-201C', 'Slop Route Valve', slopSelected, slopSelected && !coil(28), processPermissive && !coil(14), !coil(28))
  ];

  return {
    source: telemetry.source || 'modbus',
    system: {
      autoMode: coil(0),
      autoEnable: coil(3),
      systemRun,
      processPermissive,
      manualDemand: coil(12),
      autoDemand: coil(13),
      slopTankHH: coil(14),
      esdTrip,
      commonAlarm: coil(30),
      equipmentAlarm: coil(33)
    },
    sequence: {
      route,
      salesSelected,
      reprocessSelected,
      slopSelected,
      busy: coil(23),
      divertActive: coil(24),
      resetActive: coil(25)
    },
    equipment,
    measurements: { ...emptyMeasurements, ...(telemetry.measurements || {}) },
    counters: { ...emptyCounters, ...(telemetry.counters || {}) },
    diagnostics: {
      stopRequest: coil(2),
      salesValveFail: coil(26),
      reprocessValveFail: coil(27),
      slopValveFail: coil(28),
      pumpProofFail: coil(29)
    },
    controls: Object.fromEntries(Object.entries(CONTROLS).map(([name, meta]) => [name, { ...meta, value: coil(meta.address) }])),
    alarms
  };
}

function addAlarm(target, condition, address, code, severity, message) {
  if (condition) target.push({ address, code, severity, message });
}

function equipmentState(id, tag, name, command, running, ready, healthy) {
  return { id, tag, name, command: Boolean(command), running: Boolean(running), ready: Boolean(ready), healthy: Boolean(healthy) };
}

export const TAGS = Object.freeze([
  ...Object.entries(CONTROLS).map(([name, item]) => ({ name, plc: `%M${item.address}`, modbus: item.address, type: 'BOOL', access: 'R/W whitelist' })),
  { name: 'SYSTEM_RUN', plc: '%M10', modbus: 10, type: 'BOOL', access: 'Read only' },
  { name: 'PROCESS_PERMISSIVE', plc: '%M11', modbus: 11, type: 'BOOL', access: 'Read only' },
  { name: 'MANUAL_DEMAND', plc: '%M12', modbus: 12, type: 'BOOL', access: 'Read only' },
  { name: 'AUTO_DEMAND', plc: '%M13', modbus: 13, type: 'BOOL', access: 'Read only' },
  { name: 'SLOP_TANK_HH', plc: '%M14', modbus: 14, type: 'BOOL', access: 'Read only' },
  { name: 'ESD_TRIP_LATCH', plc: '%M15', modbus: 15, type: 'BOOL', access: 'Read only' },
  { name: 'SALES_ROUTE_LATCH', plc: '%M20', modbus: 20, type: 'BOOL', access: 'Read only' },
  { name: 'REPROCESS_ROUTE_LATCH', plc: '%M21', modbus: 21, type: 'BOOL', access: 'Read only' },
  { name: 'SLOP_ROUTE_LATCH', plc: '%M22', modbus: 22, type: 'BOOL', access: 'Read only' },
  { name: 'ROUTE_SEQUENCE_BUSY', plc: '%M23', modbus: 23, type: 'BOOL', access: 'Read only' },
  { name: 'DIVERT_ACTIVE', plc: '%M24', modbus: 24, type: 'BOOL', access: 'Read only' },
  { name: 'SEQUENCE_RESET', plc: '%M25', modbus: 25, type: 'BOOL', access: 'Read only' },
  { name: 'SALES_VALVE_FAIL', plc: '%M26', modbus: 26, type: 'BOOL', access: 'Read only' },
  { name: 'REPROCESS_VALVE_FAIL', plc: '%M27', modbus: 27, type: 'BOOL', access: 'Read only' },
  { name: 'SLOP_VALVE_FAIL', plc: '%M28', modbus: 28, type: 'BOOL', access: 'Read only' },
  { name: 'PUMP_PROOF_FAIL', plc: '%M29', modbus: 29, type: 'BOOL', access: 'Read only' },
  { name: 'COMMON_ALARM', plc: '%M30', modbus: 30, type: 'BOOL', access: 'Read only' },
  { name: 'EQUIPMENT_ALARM', plc: '%M33', modbus: 33, type: 'BOOL', access: 'Read only' }
]);
