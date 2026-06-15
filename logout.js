import { ensureSeed, getEmployees, verifyPassword, signSession, setSessionCookie, readBody } from './_lib.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
  try {
    const { iin, password } = await readBody(req);
    if (!/^\d{12}$/.test(String(iin || ''))) return res.status(400).json({ error: 'ИИН должен состоять из 12 цифр' });
    if (!password) return res.status(400).json({ error: 'Введите пароль' });

    await ensureSeed();
    const emps = (await getEmployees()) || [];
    const u = emps.find((e) => e.iin === iin);
    if (!u || !verifyPassword(password, u.pass)) {
      return res.status(401).json({ error: 'Неверный ИИН или пароль' });
    }
    const token = signSession({ iin: u.iin, role: u.role, exp: Date.now() + 12 * 60 * 60 * 1000 });
    setSessionCookie(res, token);
    return res.json({ ok: true, user: { iin: u.iin, fio: u.fio, role: u.role } });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
}
