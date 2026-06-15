import {
  currentUser, getSettings, getEmployees, saveEmployees, getJSON, setJSON,
  localNow, slotCode, clientIP, readBody,
} from './_lib.js';

function toMin(h) { if (!h) return 0; const p = h.split(':'); return (+p[0]) * 60 + (+p[1]); }
function workedMin(r) { if (!r.in || !r.out) return null; let d = toMin(r.out) - toMin(r.in); if (d < 0) d += 1440; return d; }

export default async function handler(req, res) {
  try {
    const user = await currentUser(req);
    if (!user) return res.status(401).json({ error: 'auth' });
    const s = await getSettings();
    const tz = s.tz;
    const now = localNow(tz);

    // ----- статус текущего дня -----
    if (req.method === 'GET') {
      const log = (await getJSON('attendance', [])) || [];
      const rec = log.find((r) => r.iin === user.iin && r.date === now.date);
      return res.json({ shiftStart: s.shiftStart, today: rec || null, worked: rec ? workedMin(rec) : null });
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'method' });

    const body = await readBody(req);
    const { code, deviceId, deviceLabel } = body;

    // ----- проверка QR-кода на сервере -----
    let data; try { data = JSON.parse(code); } catch { data = null; }
    if (!data || data.t !== 'attend' || !data.s || !data.c) {
      return res.json({ ok: false, kind: 'err', title: 'Неверный код', note: 'Отсканируйте код со станции.' });
    }
    const prev = localNow(tz, new Date(Date.now() - 60000));
    const valid =
      (data.s === now.slot && data.c === slotCode(now.slot, s.qrSalt)) ||
      (data.s === prev.slot && data.c === slotCode(prev.slot, s.qrSalt));
    if (!valid) {
      return res.json({ ok: false, kind: 'err', title: 'Код устарел', note: 'Код действует одну минуту — отсканируйте текущий.' });
    }

    // ----- привязка устройства -----
    const emps = (await getEmployees()) || [];
    const me = emps.find((e) => e.iin === user.iin);
    if (me) {
      if (!me.deviceId) {
        me.deviceId = deviceId || 'unknown';
        me.deviceLabel = deviceLabel || 'устройство';
        await saveEmployees(emps);
      } else if (deviceId && me.deviceId !== deviceId) {
        return res.json({
          ok: false, kind: 'err', title: 'Чужое устройство',
          note: 'Отметка возможна только с вашего устройства (' + (me.deviceLabel || 'закреплённого') + '). Для смены телефона обратитесь к администратору.',
        });
      }
    }

    const ip = clientIP(req);
    const log = (await getJSON('attendance', [])) || [];
    let rec = log.find((r) => r.iin === user.iin && r.date === now.date);

    if (!rec) {
      const lateMin = Math.max(0, toMin(now.time) - toMin(s.shiftStart));
      rec = {
        id: Date.now() + '-' + Math.random().toString(36).slice(2, 7),
        iin: user.iin, fio: user.fio, date: now.date,
        in: now.time, out: null, shiftStart: s.shiftStart,
        late: lateMin > 0, lateMin,
        device: deviceLabel || '', deviceId: deviceId || '', ip, ts: now.ts, outTs: null,
      };
      log.push(rec);
      await setJSON('attendance', log);
      return res.json({
        ok: true, kind: 'ok', title: 'Приход — ' + user.fio,
        meta: now.date + ' · ' + now.time,
        note: lateMin > 0 ? ('Опоздание ' + lateMin + ' мин (смена с ' + s.shiftStart + ').') : 'Вовремя. Хорошего дня!',
      });
    } else {
      rec.out = now.time; rec.outTs = now.ts; rec.outIp = ip;
      await setJSON('attendance', log);
      return res.json({
        ok: true, kind: 'ok', title: 'Уход — ' + user.fio,
        meta: 'приход ' + rec.in + ' → уход ' + now.time,
        note: 'Отработано ' + (() => { const m = workedMin(rec); const h = Math.floor(m / 60); return h + 'ч ' + (m % 60 < 10 ? '0' : '') + (m % 60) + 'м'; })() + '.',
      });
    }
  } catch (e) {
    return res.status(500).json({ ok: false, kind: 'err', title: 'Ошибка', note: String((e && e.message) || e) });
  }
}
