import { currentUser } from './_lib.js';

export default async function handler(req, res) {
  try {
    const u = await currentUser(req);
    if (!u) return res.status(401).json({ error: 'auth' });
    return res.json({ user: { iin: u.iin, fio: u.fio, role: u.role, company: u.company || '', bio: !!(u.webauthn && u.webauthn.length) } });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
}
