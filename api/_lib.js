import crypto from 'crypto';

/* ===== Хранилище: Vercel KV / Upstash Redis (REST API) ===== */
const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const SESSION_SECRET = process.env.SESSION_SECRET || 'CHANGE_ME_SESSION_SECRET';

async function kvCmd(cmd) {
  if (!KV_URL || !KV_TOKEN) throw new Error('KV не настроен (нет KV_REST_API_URL / KV_REST_API_TOKEN)');
  const res = await fetch(KV_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
  });
  if (!res.ok) throw new Error('Ошибка хранилища: ' + res.status);
  const j = await res.json();
  return j.result;
}
export async function getJSON(key, def) {
  const r = await kvCmd(['GET', key]);
  if (r == null) return def;
  try { return JSON.parse(r); } catch { return def; }
}
export async function setJSON(key, val) { return kvCmd(['SET', key, JSON.stringify(val)]); }

/* ===== Пароли (scrypt) ===== */
export function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const h = crypto.scryptSync(String(pw), salt, 32).toString('hex');
  return salt + ':' + h;
}
export function verifyPassword(pw, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, h] = stored.split(':');
  const hh = crypto.scryptSync(String(pw), salt, 32).toString('hex');
  const a = Buffer.from(h, 'hex'), b = Buffer.from(hh, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* ===== Сессия (подписанная cookie) ===== */
export function signSession(obj) {
  const data = Buffer.from(JSON.stringify(obj)).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(data).digest('base64url');
  return data + '.' + sig;
}
export function verifySession(token) {
  if (!token || !token.includes('.')) return null;
  const [data, sig] = token.split('.');
  const exp = crypto.createHmac('sha256', SESSION_SECRET).update(data).digest('base64url');
  const a = Buffer.from(sig), b = Buffer.from(exp);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try { const o = JSON.parse(Buffer.from(data, 'base64url').toString()); if (o.exp && Date.now() > o.exp) return null; return o; }
  catch { return null; }
}
export function getCookie(req, name) {
  const c = req.headers.cookie || '';
  const m = c.match(new RegExp('(?:^|; )' + name + '=([^;]+)'));
  return m ? decodeURIComponent(m[1]) : null;
}
export function setSessionCookie(res, token) {
  res.setHeader('Set-Cookie', `sess=${token}; HttpOnly; Path=/; SameSite=Lax; Secure; Max-Age=${60 * 60 * 12}`);
}
export function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `sess=; HttpOnly; Path=/; SameSite=Lax; Secure; Max-Age=0`);
}

/* ===== Сотрудники / настройки / сидирование ===== */
export async function getEmployees() { return getJSON('employees', null); }
export async function saveEmployees(arr) { return setJSON('employees', arr); }

export async function getSettings() {
  let s = await getJSON('settings', null);
  if (s == null) {
    s = { shiftStart: '09:00', tz: process.env.OFFICE_TZ || 'Asia/Almaty', qrSalt: crypto.randomBytes(12).toString('hex') };
    await setJSON('settings', s);
  }
  if (!s.qrSalt) { s.qrSalt = crypto.randomBytes(12).toString('hex'); await setJSON('settings', s); }
  if (!s.tz) s.tz = process.env.OFFICE_TZ || 'Asia/Almaty';
  return s;
}
export async function saveSettings(s) { return setJSON('settings', s); }

export async function ensureSeed() {
  let emps = await getEmployees();
  if (emps == null) {
    const iin = process.env.ADMIN_IIN || '111111111111';
    const pw = process.env.ADMIN_PASSWORD || 'admin';
    emps = [{ iin, fio: process.env.ADMIN_FIO || 'Администратор', role: 'admin', pass: hashPassword(pw) }];
    await saveEmployees(emps);
    await getSettings(); // создаст настройки и секрет QR
  }
  return emps;
}

export async function currentUser(req) {
  const sess = verifySession(getCookie(req, 'sess'));
  if (!sess) return null;
  const emps = (await getEmployees()) || [];
  return emps.find((e) => e.iin === sess.iin) || null;
}
export async function requireAdmin(req) {
  const u = await currentUser(req);
  return u && u.role === 'admin' ? u : null;
}

/* ===== IP / тело запроса ===== */
export function clientIP(req) {
  const xf = req.headers['x-forwarded-for'];
  if (xf) return String(xf).split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || '';
}
export async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body || '{}'); } catch { return {}; } }
  return new Promise((resolve) => {
    let d = '';
    req.on('data', (c) => (d += c));
    req.on('end', () => { try { resolve(JSON.parse(d || '{}')); } catch { resolve({}); } });
  });
}

/* ===== Время в часовом поясе офиса ===== */
export function localNow(tz, dateObj) {
  const d = dateObj || new Date();
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const p = fmt.formatToParts(d).reduce((a, x) => { a[x.type] = x.value; return a; }, {});
  let hh = p.hour === '24' ? '00' : p.hour;
  const date = `${p.year}-${p.month}-${p.day}`;
  const time = `${hh}:${p.minute}`;
  return { date, time, slot: date + ' ' + time, ts: d.getTime() };
}

/* ===== Минутный QR-код (секрет qrSalt только на сервере) ===== */
export function slotCode(slot, salt) {
  return crypto.createHmac('sha256', salt).update(slot).digest('hex').slice(0, 8).toUpperCase();
}
export function payloadFor(slot, salt) {
  return JSON.stringify({ t: 'attend', s: slot, c: slotCode(slot, salt) });
}
