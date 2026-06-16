import { currentUser, getEmployees, saveEmployees, hashPassword, readBody } from './_lib.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
  try {
    const user = await currentUser(req);
    if (!user) return res.status(401).json({ error: 'auth' });
    const { newPassword } = await readBody(req);
    if (!newPassword || String(newPassword).length < 6) {
      return res.status(400).json({ error: 'Пароль должен быть не короче 6 символов' });
    }
    const emps = (await getEmployees()) || [];
    const me = emps.find((e) => e.iin === user.iin);
    if (!me) return res.status(404).json({ error: 'not found' });
    me.pass = hashPassword(String(newPassword));
    me.mustChange = false;
    await saveEmployees(emps);
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
}
