import { ensureSeed, getEmployees, saveEmployees, verifyPassword, signSession, setSessionCookie, readBody, clientIP, logEvent, getOrSetDeviceId } from './_lib.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
  try {
    const { iin, password, uid, deviceLabel, geo } = await readBody(req);
    const ip = clientIP(req);
    if (!/^\d{12}$/.test(String(iin || ''))) return res.status(400).json({ error: 'ИИН должен состоять из 12 цифр' });
    if (!password) return res.status(400).json({ error: 'Введите пароль' });

    await ensureSeed();
    const emps = (await getEmployees()) || [];
    const u = emps.find((e) => e.iin === iin);
    if (!u || !verifyPassword(password, u.pass)) {
      await logEvent({ type: 'login', ok: false, iin, reason: u ? 'неверный пароль' : 'ИИН не найден', ip, device: deviceLabel || '', uid: uid || '', geo: geo || null });
      return res.status(401).json({ error: 'Неверный ИИН или пароль' });
    }
    // запоминаем устройство/гео последнего входа
    u.lastUid = uid || ''; u.lastDevice = deviceLabel || ''; u.lastLoginAt = new Date().toISOString(); u.lastGeo = geo || null;
    try { await saveEmployees(emps); } catch (e) {}
    await logEvent({ type: 'login', ok: true, iin, reason: 'успешный вход', ip, device: deviceLabel || '', uid: uid || '', geo: geo || null });

    const token = signSession({ iin: u.iin, role: u.role, exp: Date.now() + 30 * 24 * 60 * 60 * 1000 });
    setSessionCookie(res, token);
    getOrSetDeviceId(req, res);
    return res.json({ ok: true, user: { iin: u.iin, fio: u.fio, role: u.role, company: u.company || '', mustChange: !!u.mustChange } });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
}
