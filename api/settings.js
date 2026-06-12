import { requireAdmin, getSettings, saveSettings, readBody } from './_lib.js';

export default async function handler(req, res) {
  try {
    const admin = await requireAdmin(req);
    if (!admin) return res.status(403).json({ error: 'Только для администратора' });
    const s = await getSettings();

    if (req.method === 'GET') {
      return res.json({ shiftStart: s.shiftStart, tz: s.tz });
    }
    if (req.method === 'POST') {
      const b = await readBody(req);
      if (b.shiftStart && /^\d{2}:\d{2}$/.test(b.shiftStart)) s.shiftStart = b.shiftStart;
      if (b.tz && typeof b.tz === 'string') s.tz = b.tz;
      await saveSettings(s);
      return res.json({ ok: true, shiftStart: s.shiftStart, tz: s.tz });
    }
    return res.status(405).json({ error: 'method' });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
}
