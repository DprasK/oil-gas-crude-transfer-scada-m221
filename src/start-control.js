import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const token = crypto.randomBytes(24).toString('base64url');
process.env.SCADA_CONFIG = path.join(root, 'config', 'schneider-control.json');
process.env.SCADA_WRITE_TOKEN = token;

console.log('');
console.log('CRUDE TRANSFER SCADA — SCHNEIDER MODBUS CONTROL');
console.log('URL   : http://127.0.0.1:3200');
console.log(`TOKEN : ${token}`);
console.log('Token hanya berlaku sampai server dihentikan.');
console.log('');

await import('./server.js');
