import { requireAdmin, getJSON } from './_lib.js';

export default async function handler(req, res) {
  try {
    const admin = await requireAdmin(req);
    if (!admin) return res.status(403).json({ error: 'Только для администратора' });

    const { from, to, q } = req.query || {};
    let log = (await getJSON('attendance', [])) || [];
    const total = log.length;
    const query = (q || '').toString().toLowerCase().trim();
    log = log.filter((r) => {
      if (from && r.date < from) return false;
      if (to && r.date > to) return false;
      if (query && !((r.fio + ' ' + r.iin).toLowerCase().includes(query))) return false;
      return true;
    });
    log.sort((a, b) => b.ts - a.ts);
    return res.json({ total, count: log.length, records: log });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
}
