import { requireAdmin, getJSON, getSettings, localNow } from './_lib.js';

export default async function handler(req, res) {
  try {
    const admin = await requireAdmin(req);
    if (!admin) return res.status(403).json({ error: 'Только для администратора' });

    const { from, to, q } = req.query || {};
    const s = await getSettings();
    const tz = s.tz;
    const query = (q || '').toString().toLowerCase().trim();

    let log = (await getJSON('attendance', [])) || [];
    const total = log.length;
    log = log.filter((r) => {
      if (from && r.date < from) return false;
      if (to && r.date > to) return false;
      if (query && !((r.fio + ' ' + r.iin + ' ' + (r.company || '')).toLowerCase().includes(query))) return false;
      return true;
    });
    log.sort((a, b) => b.ts - a.ts);

    // события (вкл. неуспешные попытки)
    let events = (await getJSON('events', [])) || [];
    events = events.map((e) => Object.assign({}, e, { date: localNow(tz, new Date(e.ts)).date, time: localNow(tz, new Date(e.ts)).time }))
      .filter((e) => {
        if (from && e.date < from) return false;
        if (to && e.date > to) return false;
        if (query && !(((e.iin || '') + ' ' + (e.fio || '') + ' ' + (e.reason || '')).toLowerCase().includes(query))) return false;
        return true;
      })
      .sort((a, b) => b.ts - a.ts);
    const fails = events.filter((e) => e.ok === false);

    return res.json({ total, count: log.length, records: log, events, fails });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
}
