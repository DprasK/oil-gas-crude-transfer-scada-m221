import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const token = crypto.randomBytes(24).toString('base64url');
process.env.SCADA_CONFIG = path.join(root, 'config', 'demo.json');
process.env.SCADA_WRITE_TOKEN = token;

console.log('');
console.log('CRUDE TRANSFER SCADA — DEMONSTRATION ENGINE');
console.log('URL   : http://127.0.0.1:3210');
console.log(`TOKEN : ${token}`);
console.log('Data pada port 3210 berlabel DEMO dan tidak berasal dari PLC.');
console.log('');

await import('./server.js');
