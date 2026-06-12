import { requireAdmin, getSettings, localNow, payloadFor, slotCode } from './_lib.js';

export default async function handler(req, res) {
  try {
    const admin = await requireAdmin(req);
    if (!admin) return res.status(403).json({ error: 'Только для администратора' });
    const s = await getSettings();
    const now = localNow(s.tz);
    return res.json({
      payload: payloadFor(now.slot, s.qrSalt),
      code: slotCode(now.slot, s.qrSalt),
      date: now.date,
      time: now.time,
      tz: s.tz,
    });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
}
