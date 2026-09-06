import net from 'node:net';

export class ModbusTcpClient {
  constructor({ host, port = 502, unitId = 1, timeoutMs = 1500 }) {
    this.host = host;
    this.port = port;
    this.unitId = unitId;
    this.timeoutMs = timeoutMs;
    this.socket = null;
    this.buffer = Buffer.alloc(0);
    this.pending = new Map();
    this.transaction = 0;
    this.connectPromise = null;
  }

  async connect() {
    if (!this.host || this.host === '0.0.0.0') throw new Error('IP PLC belum diatur');
    if (this.socket && !this.socket.destroyed) return;
    if (this.connectPromise) return this.connectPromise;
    this.connectPromise = new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: this.host, port: this.port });
      const timer = setTimeout(() => socket.destroy(new Error('Timeout koneksi PLC')), this.timeoutMs);
      socket.setNoDelay(true);
      socket.once('connect', () => {
        clearTimeout(timer);
        this.socket = socket;
        resolve();
      });
      socket.once('error', reject);
      socket.on('data', chunk => this.onData(chunk));
      socket.on('close', () => this.onClose(new Error('Koneksi Modbus TCP ditutup')));
    }).finally(() => { this.connectPromise = null; });
    return this.connectPromise;
  }

  onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 7) {
      const protocolId = this.buffer.readUInt16BE(2);
      const length = this.buffer.readUInt16BE(4);
      if (protocolId !== 0 || length < 2 || length > 254) {
        this.destroy(new Error('Frame MBAP tidak valid'));
        return;
      }
      const frameLength = 6 + length;
      if (this.buffer.length < frameLength) return;
      const frame = this.buffer.subarray(0, frameLength);
      this.buffer = this.buffer.subarray(frameLength);
      const transaction = frame.readUInt16BE(0);
      const pending = this.pending.get(transaction);
      if (!pending) continue;
      this.pending.delete(transaction);
      clearTimeout(pending.timer);
      if (frame[6] !== this.unitId) {
        pending.reject(new Error('Unit ID respons tidak cocok'));
        continue;
      }
      const pdu = frame.subarray(7);
      if (pdu[0] & 0x80) pending.reject(new Error(`Modbus exception ${pdu[1]}`));
      else if (pdu[0] !== pending.functionCode) pending.reject(new Error('Function code respons tidak cocok'));
      else pending.resolve(pdu);
    }
  }

  onClose(error) {
    this.socket = null;
    this.buffer = Buffer.alloc(0);
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  destroy(error = new Error('Koneksi ditutup')) {
    if (this.socket) this.socket.destroy(error);
    this.onClose(error);
  }

  async request(functionCode, payload) {
    await this.connect();
    const transaction = this.transaction = (this.transaction + 1) & 0xffff;
    const pdu = Buffer.concat([Buffer.from([functionCode]), payload]);
    const frame = Buffer.allocUnsafe(7 + pdu.length);
    frame.writeUInt16BE(transaction, 0);
    frame.writeUInt16BE(0, 2);
    frame.writeUInt16BE(pdu.length + 1, 4);
    frame[6] = this.unitId;
    pdu.copy(frame, 7);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(transaction);
        this.destroy(new Error(`Timeout Modbus FC${functionCode}`));
        reject(new Error(`Timeout Modbus FC${functionCode}`));
      }, this.timeoutMs);
      this.pending.set(transaction, { functionCode, resolve, reject, timer });
      this.socket.write(frame, error => {
        if (!error) return;
        clearTimeout(timer);
        this.pending.delete(transaction);
        reject(error);
      });
    });
  }

  async readHoldingRegisters(start, quantity) {
    validateRange(start, quantity, 125);
    const payload = Buffer.allocUnsafe(4);
    payload.writeUInt16BE(start, 0);
    payload.writeUInt16BE(quantity, 2);
    const pdu = await this.request(3, payload);
    if (pdu[1] !== quantity * 2 || pdu.length !== 2 + quantity * 2) throw new Error('Panjang respons FC03 tidak valid');
    return Array.from({ length: quantity }, (_, index) => pdu.readUInt16BE(2 + index * 2));
  }

  async readCoils(start, quantity) {
    validateRange(start, quantity, 2000);
    const payload = Buffer.allocUnsafe(4);
    payload.writeUInt16BE(start, 0);
    payload.writeUInt16BE(quantity, 2);
    const pdu = await this.request(1, payload);
    const byteCount = Math.ceil(quantity / 8);
    if (pdu[1] !== byteCount || pdu.length !== 2 + byteCount) throw new Error('Panjang respons FC01 tidak valid');
    return Array.from({ length: quantity }, (_, index) => Boolean(pdu[2 + Math.floor(index / 8)] & (1 << (index % 8))));
  }

  async writeCoil(address, value) {
    validateRange(address, 1, 1);
    if (typeof value !== 'boolean') throw new Error('Nilai coil harus BOOL');
    const payload = Buffer.alloc(4);
    payload.writeUInt16BE(address, 0);
    payload.writeUInt16BE(value ? 0xff00 : 0, 2);
    const pdu = await this.request(5, payload);
    if (pdu.length !== 5 || !pdu.subarray(1).equals(payload)) throw new Error('Echo FC05 tidak valid');
  }

  close() { this.destroy(new Error('Client ditutup')); }
}

function validateRange(start, quantity, maxQuantity) {
  if (!Number.isInteger(start) || start < 0 || start > 65535) throw new RangeError('Alamat awal tidak valid');
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > maxQuantity || start + quantity > 65536) throw new RangeError('Quantity tidak valid');
}
