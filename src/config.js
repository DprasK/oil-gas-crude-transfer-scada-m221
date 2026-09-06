import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requested = process.env.SCADA_CONFIG || path.join(projectRoot, 'config', 'default.json');
const configPath = path.isAbsolute(requested) ? requested : path.resolve(projectRoot, requested);
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

config.runtime ||= { driver: 'modbus' };
if (!['modbus', 'demo'].includes(config.runtime.driver)) throw new Error('Driver SCADA harus modbus atau demo');
if (process.env.SCADA_PLC_HOST && config.runtime.driver === 'modbus') config.plc.host = process.env.SCADA_PLC_HOST.trim();
for (const [label, port] of [['PLC', config.plc.port], ['SCADA', config.listen.port]]) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Port ${label} tidak valid`);
}
if (config.listen.host !== '127.0.0.1' && config.listen.host !== '::1' && config.listen.host !== 'localhost') {
  throw new Error('SCADA lokal hanya boleh bind ke loopback. Gunakan reverse proxy TLS/VPN untuk akses jaringan.');
}
if (config.security.allowWrites) {
  const token = process.env.SCADA_WRITE_TOKEN || '';
  if (token.length < 20) throw new Error('SCADA_WRITE_TOKEN minimal 20 karakter saat kontrol diaktifkan');
}

config.projectRoot = projectRoot;
config.configPath = configPath;
config.security.auditFile = path.resolve(projectRoot, config.security.auditFile);

export default Object.freeze(config);
