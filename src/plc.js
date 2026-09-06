import { ModbusTcpClient } from './modbus-client.js';
import { CONTROLS, decodeSnapshot, MODBUS_READ_PLAN } from './tag-model.js';

export class M221Plc {
  constructor(config) {
    this.client = new ModbusTcpClient(config);
  }

  async readStatus() {
    const plan = MODBUS_READ_PLAN;
    const coils = await this.client.readCoils(plan.coilStart, plan.coilQuantity);
    return decodeSnapshot(coils, { source: 'modbus' });
  }

  async setControl(name, value) {
    const control = CONTROLS[name];
    if (!control || typeof value !== 'boolean') throw new Error('Kontrol tidak diizinkan');
    await this.client.writeCoil(control.address, value);
    const [readback] = await this.client.readCoils(control.address, 1);
    if (readback !== value) throw new Error(`Readback %M${control.address} tidak cocok`);
    return readback;
  }

  close() { this.client.close(); }
}
