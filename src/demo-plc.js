import { CONTROLS, decodeSnapshot, MODBUS_READ_PLAN } from './tag-model.js';

export class DemoPlc {
  constructor() {
    this.coils = Array(MODBUS_READ_PLAN.coilQuantity).fill(false);
    this.coils[0] = true;
    this.coils[3] = true;
    this.coils[11] = true;
    this.tick = 0;
    this.countedCycle = -1;
    this.counters = { sales: 1284, reprocess: 96, slop: 24 };
  }

  async readStatus() {
    this.tick += 1;
    if (this.coils[1] && this.coils[11] && !this.coils[15]) this.coils[10] = true;
    if (this.coils[2] || this.coils[15]) this.coils[10] = false;

    const running = this.coils[10];
    const cycle = Math.floor(this.tick / 36);
    const phase = this.tick % 36;
    const routeOrder = ['sales', 'sales', 'reprocess', 'sales', 'slop'];
    const route = routeOrder[cycle % routeOrder.length];

    this.coils[12] = running && !this.coils[0];
    this.coils[13] = running && this.coils[0] && this.coils[3];
    this.coils[20] = running && route === 'sales';
    this.coils[21] = running && route === 'reprocess';
    this.coils[22] = running && route === 'slop';
    this.coils[23] = running && phase >= 7 && phase < 16;
    this.coils[24] = running && phase >= 16 && phase < 25;
    this.coils[25] = running && phase === 25;

    if (running && phase === 25 && this.countedCycle !== cycle) {
      this.counters[route] += 1;
      this.countedCycle = cycle;
    }

    const wave = Math.sin(this.tick / 7);
    const pressureWave = Math.sin(this.tick / 11 + 0.8);
    const measurements = {
      flowRate: running ? round(132 + wave * 5.8, 1) : 0,
      suctionPressure: running ? round(2.42 + pressureWave * 0.08, 2) : round(2.18 + pressureWave * 0.02, 2),
      dischargePressure: running ? round(8.34 + pressureWave * 0.24, 2) : round(2.2 + pressureWave * 0.03, 2),
      bsw: route === 'sales' ? round(0.38 + wave * 0.05, 2) : route === 'reprocess' ? round(1.42 + wave * 0.16, 2) : round(4.8 + wave * 0.4, 2),
      salesLevel: round(Math.min(92, 63.2 + (this.counters.sales - 1284) * 0.03), 1),
      reprocessLevel: round(Math.min(92, 37.6 + (this.counters.reprocess - 96) * 0.05), 1),
      slopLevel: round(Math.min(92, 21.4 + (this.counters.slop - 24) * 0.08), 1)
    };

    return decodeSnapshot(this.coils, { source: 'demo', measurements, counters: this.counters });
  }

  async setControl(name, value) {
    const control = CONTROLS[name];
    if (!control || typeof value !== 'boolean') throw new Error('Kontrol demo tidak diizinkan');
    this.coils[control.address] = value;
    if (name === 'resetCounters' && value) this.counters = { sales: 0, reprocess: 0, slop: 0 };
    return this.coils[control.address];
  }

  close() {}
}

function round(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
