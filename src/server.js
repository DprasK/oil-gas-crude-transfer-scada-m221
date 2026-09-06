import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import config from './config.js';
import { DemoPlc } from './demo-plc.js';
import { M221Plc } from './plc.js';
import { CONTROLS, TAGS } from './tag-model.js';

const plc = config.runtime.driver === 'demo' ? new DemoPlc() : new M221Plc(config.plc);
const publicRoot = path.join(config.projectRoot, 'public');
const writeToken = process.env.SCADA_WRITE_TOKEN || '';
const writeBuckets = new Map();

let state = {
  connected: false,
  mode: config.runtime.driver,
  writeEnabled: Boolean(config.security.allowWrites),
  source: { driver: config.runtime.driver, host: config.plc.host, port: config.plc.port, unitId: config.plc.unitId },
  timestamp: null,
  latencyMs: null,
  error: null,
  data: null
};
let polling = false;

await fsp.mkdir(path.dirname(config.security.auditFile), { recursive: true });

async function poll() {
  if (polling) return;
  polling = true;
  const started = performance.now();
  try {
    const data = await plc.readStatus();
    state = { ...state, connected: true, timestamp: new Date().toISOString(), latencyMs: Math.round(performance.now() - started), error: null, data };
  } catch (error) {
    state = { ...state, connected: false, timestamp: new Date().toISOString(), latencyMs: Math.round(performance.now() - started), error: safeError(error), data: null };
  } finally {
    polling = false;
  }
}

function securityHeaders(res) {
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), usb=()');
  res.setHeader('Cache-Control', 'no-store');
}

function json(res, status, body) {
  const payload = JSON.stringify(body);
  securityHeaders(res);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(payload) });
  res.end(payload);
}

function safeError(error) {
  return String(error?.message || error).replace(/[\r\n]/g, ' ').slice(0, 240);
}

function safeEqual(candidate, expected) {
  const a = Buffer.from(candidate || '');
  const b = Buffer.from(expected || '');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  return origin === `http://${config.listen.host}:${config.listen.port}` || origin === `http://localhost:${config.listen.port}`;
}

function rateAllowed(ip) {
  const now = Date.now();
  const bucket = writeBuckets.get(ip) || { since: now, count: 0 };
  if (now - bucket.since > 60_000) { bucket.since = now; bucket.count = 0; }
  bucket.count += 1;
  writeBuckets.set(ip, bucket);
  return bucket.count <= config.security.writeRatePerMinute;
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 2048) throw new Error('Payload terlalu besar');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

async function audit(req, body, outcome, detail = '') {
  const entry = {
    at: new Date().toISOString(), remote: req.socket.remoteAddress || 'unknown',
    action: body?.name || null, value: body?.value, outcome, detail: String(detail).slice(0, 180)
  };
  await fsp.appendFile(config.security.auditFile, `${JSON.stringify(entry)}\n`, 'utf8');
}

async function handleControl(req, res) {
  let body;
  try {
    body = await readJson(req);
    if (!config.security.allowWrites) throw new Error('Server berjalan dalam mode monitor-only');
    if (!state.connected) throw new Error('Sumber data sedang offline');
    if (!sameOrigin(req)) throw new Error('Origin ditolak');
    if (!rateAllowed(req.socket.remoteAddress || 'unknown')) throw new Error('Batas kontrol per menit terlampaui');
    if (!safeEqual(req.headers['x-control-token'], writeToken)) throw new Error('Token kontrol salah');
    if (!Object.hasOwn(CONTROLS, body.name) || typeof body.value !== 'boolean') throw new Error('Kontrol atau nilai tidak valid');
    const readback = await plc.setControl(body.name, body.value);
    await audit(req, body, 'accepted');
    json(res, 200, { ok: true, readback });
  } catch (error) {
    await audit(req, body, 'rejected', safeError(error)).catch(() => {});
    json(res, 400, { ok: false, error: safeError(error) });
  }
}

const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8' };

async function serveStatic(req, res) {
  const rawPath = new URL(req.url, 'http://localhost').pathname;
  const relative = rawPath === '/' ? 'index.html' : decodeURIComponent(rawPath.slice(1));
  const resolved = path.resolve(publicRoot, relative);
  if (!resolved.startsWith(`${publicRoot}${path.sep}`) && resolved !== path.join(publicRoot, 'index.html')) return json(res, 404, { error: 'Not found' });
  try {
    const content = await fsp.readFile(resolved);
    securityHeaders(res);
    res.writeHead(200, { 'Content-Type': types[path.extname(resolved)] || 'application/octet-stream' });
    res.end(req.method === 'HEAD' ? undefined : content);
  } catch {
    json(res, 404, { error: 'Not found' });
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/api/state') return json(res, 200, state);
    if (req.method === 'GET' && url.pathname === '/api/health') return json(res, state.connected ? 200 : 503, { ok: state.connected, driver: state.mode, timestamp: state.timestamp });
    if (req.method === 'GET' && url.pathname === '/api/tags') return json(res, 200, { tags: TAGS });
    if (req.method === 'POST' && url.pathname === '/api/control') return handleControl(req, res);
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'Method not allowed' });
    return serveStatic(req, res);
  } catch (error) {
    return json(res, 500, { error: safeError(error) });
  }
});

server.requestTimeout = 10_000;
server.headersTimeout = 12_000;
server.keepAliveTimeout = 5_000;

await poll();
const pollTimer = setInterval(poll, config.plc.pollIntervalMs);
server.listen(config.listen.port, config.listen.host, () => {
  console.log(`${config.appName}`);
  console.log(`SCADA : http://${config.listen.host}:${config.listen.port}`);
  console.log(`SOURCE: ${config.runtime.driver === 'demo' ? 'DEMO ENGINE' : `${config.plc.host}:${config.plc.port} unit ${config.plc.unitId}`}`);
  console.log(`WRITE : ${config.security.allowWrites ? 'enabled' : 'monitor-only'}`);
});

function shutdown() {
  clearInterval(pollTimer);
  plc.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 2000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
