import test from 'node:test';
import assert from 'node:assert/strict';
import { DemoPlc } from '../src/demo-plc.js';
import { decodeSnapshot, MODBUS_READ_PLAN } from '../src/tag-model.js';

test('decodeSnapshot maps the crude-transfer M221 memory image', () => {
  const coils = Array(MODBUS_READ_PLAN.coilQuantity).fill(false);
  coils[0] = true;
  coils[3] = true;
  coils[10] = true;
  coils[11] = true;
  coils[13] = true;
  coils[20] = true;
  const data = decodeSnapshot(coils);
  assert.equal(data.system.autoMode, true);
  assert.equal(data.system.systemRun, true);
  assert.equal(data.sequence.route, 'SALES');
  assert.equal(data.equipment.find(item => item.id === 'sales').running, true);
});

test('decodeSnapshot exposes specific fail and ESD alarms', () => {
  const coils = Array(MODBUS_READ_PLAN.coilQuantity).fill(false);
  coils[11] = true;
  coils[15] = true;
  coils[27] = true;
  coils[29] = true;
  coils[30] = true;
  const data = decodeSnapshot(coils);
  assert.deepEqual(data.alarms.map(item => item.code), ['ESD_TRIP', 'REPROCESS_VALVE_FAIL', 'PUMP_PROOF_FAIL']);
  assert.equal(data.system.esdTrip, true);
});

test('decodeSnapshot fails closed on an incomplete Modbus image', () => {
  assert.throws(() => decodeSnapshot([true, false]), /tidak lengkap/);
});

test('demo engine starts, routes and resets counters through the same whitelist', async () => {
  const plc = new DemoPlc();
  await plc.setControl('start', true);
  let data = await plc.readStatus();
  assert.equal(data.system.systemRun, true);
  assert.equal(data.source, 'demo');
  assert.equal(data.measurements.flowRate > 0, true);
  await plc.setControl('resetCounters', true);
  data = await plc.readStatus();
  assert.deepEqual(data.counters, { sales: 0, reprocess: 0, slop: 0 });
});
