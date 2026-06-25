import { requireAdmin, getSettings, saveSettings, readBody } from './_lib.js';

export default async function handler(req, res) {
  try {
    const admin = await requireAdmin(req);
    if (!admin) return res.status(403).json({ error: 'Только для администратора' });
    const s = await getSettings();

    if (req.method === 'GET') {
      return res.json({
        shiftStart: s.shiftStart, tz: s.tz,
        officeLat: s.officeLat ?? null, officeLng: s.officeLng ?? null, radius: s.radius || 200,
        clinics: s.clinics || [],
      });
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
      if (Array.isArray(b.clinics)) {
        s.clinics = b.clinics
          .filter((c) => c && c.name && !isNaN(+c.lat) && !isNaN(+c.lng))
          .slice(0, 200)
          .map((c, i) => ({
            id: c.id || ('c' + Date.now() + i),
            name: String(c.name).slice(0, 80),
            address: String(c.address || '').slice(0, 160),
            lat: +(+c.lat).toFixed(6), lng: +(+c.lng).toFixed(6),
            radius: Math.max(20, Math.min(20000, Math.round(+c.radius || 150))),
          }));
      }
      await saveSettings(s);
      return res.json({ ok: true });
    }
    return res.status(405).json({ error: 'method' });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
}
