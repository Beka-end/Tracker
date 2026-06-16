import { requireAdmin, getSettings, saveSettings, readBody } from './_lib.js';

export default async function handler(req, res) {
  try {
    const admin = await requireAdmin(req);
    if (!admin) return res.status(403).json({ error: 'Только для администратора' });
    const s = await getSettings();

    if (req.method === 'GET') {
      return res.json({ shiftStart: s.shiftStart, tz: s.tz, officeLat: s.officeLat ?? null, officeLng: s.officeLng ?? null, radius: s.radius || 200 });
    }
    if (req.method === 'POST') {
      const b = await readBody(req);
      if (b.shiftStart && /^\d{2}:\d{2}$/.test(b.shiftStart)) s.shiftStart = b.shiftStart;
      if (b.tz && typeof b.tz === 'string') s.tz = b.tz;
      if (b.officeLat === null || b.officeLat === '') { s.officeLat = null; s.officeLng = null; }
      else if (b.officeLat != null && b.officeLng != null && !isNaN(+b.officeLat) && !isNaN(+b.officeLng)) {
        s.officeLat = +(+b.officeLat).toFixed(6); s.officeLng = +(+b.officeLng).toFixed(6);
      }
      if (b.radius != null && !isNaN(+b.radius)) s.radius = Math.max(20, Math.min(20000, Math.round(+b.radius)));
      await saveSettings(s);
      return res.json({ ok: true, shiftStart: s.shiftStart, tz: s.tz, officeLat: s.officeLat ?? null, officeLng: s.officeLng ?? null, radius: s.radius || 200 });
    }
    return res.status(405).json({ error: 'method' });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
}
