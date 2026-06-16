import {
  currentUser, getSettings, getEmployees, saveEmployees, getJSON, setJSON,
  localNow, slotCode, clientIP, readBody, logEvent, getOrSetDeviceId, verifySession, getCookie,
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
    const ip = clientIP(req);

    // ----- статус текущего дня -----
    if (req.method === 'GET') {
      const log = (await getJSON('attendance', [])) || [];
      const rec = log.find((r) => r.iin === user.iin && r.date === now.date);
      const emps0 = (await getEmployees()) || [];
      const me0 = emps0.find((e) => e.iin === user.iin);
      return res.json({
        shiftStart: s.shiftStart, today: rec || null, worked: rec ? workedMin(rec) : null,
        faceRequired: !!s.faceRequired, hasFace: !!(me0 && me0.face && me0.face.length),
      });
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'method' });

    const body = await readBody(req);
    const { code, deviceLabel, geo } = body;
    const deviceId = getOrSetDeviceId(req, res); // стабильный идентификатор устройства из cookie

    const fail = async (title, note, reason) => {
      await logEvent({ type: 'checkin', ok: false, iin: user.iin, fio: user.fio, reason: reason || title, ip, device: deviceLabel || '', uid: deviceId || '', geo: geo || null });
      return res.json({ ok: false, kind: 'err', title, note });
    };

    // ----- проверка QR-кода на сервере -----
    let data; try { data = JSON.parse(code); } catch { data = null; }
    if (!data || data.t !== 'attend' || !data.s || !data.c) {
      return fail('Неверный код', 'Отсканируйте код со станции.', 'неверный код');
    }
    const prev = localNow(tz, new Date(Date.now() - 60000));
    const valid =
      (data.s === now.slot && data.c === slotCode(now.slot, s.qrSalt)) ||
      (data.s === prev.slot && data.c === slotCode(prev.slot, s.qrSalt));
    if (!valid) {
      return fail('Код устарел', 'Код действует одну минуту — отсканируйте текущий.', 'просроченный код');
    }

    // ----- устройство: только фиксируем, без блокировки -----
    const emps = (await getEmployees()) || [];
    const me = emps.find((e) => e.iin === user.iin);

    // ----- проверка лица (если включена и есть эталон) -----
    if (s.faceRequired && me && me.face && me.face.length) {
      const fp = verifySession(getCookie(req, 'facepass'));
      if (!fp || fp.iin !== user.iin || (Date.now() - (fp.t || 0)) > 2 * 60 * 1000) {
        return fail('Нужна проверка лица', 'Подтвердите лицо и повторите.', 'нет проверки лица');
      }
    }

    if (me && (me.deviceId !== deviceId || me.deviceLabel !== (deviceLabel || me.deviceLabel))) {
      me.deviceId = deviceId; me.deviceLabel = deviceLabel || me.deviceLabel || '';
      try { await saveEmployees(emps); } catch (e) {}
    }

    const log = (await getJSON('attendance', [])) || [];
    let rec = log.find((r) => r.iin === user.iin && r.date === now.date);

    if (!rec) {
      const lateMin = Math.max(0, toMin(now.time) - toMin(s.shiftStart));
      rec = {
        id: Date.now() + '-' + Math.random().toString(36).slice(2, 7),
        iin: user.iin, fio: user.fio, company: (me && me.company) || user.company || '', date: now.date,
        in: now.time, out: null, shiftStart: s.shiftStart,
        late: lateMin > 0, lateMin,
        device: deviceLabel || '', deviceId: deviceId || '', ip, geo: geo || null, ts: now.ts, outTs: null,
      };
      log.push(rec);
      await setJSON('attendance', log);
      await logEvent({ type: 'checkin', ok: true, iin: user.iin, fio: user.fio, reason: 'приход', ip, device: deviceLabel || '', uid: deviceId || '', geo: geo || null });
      return res.json({
        ok: true, kind: 'ok', title: 'Приход — ' + user.fio,
        meta: now.date + ' · ' + now.time,
        note: lateMin > 0 ? ('Опоздание ' + lateMin + ' мин (смена с ' + s.shiftStart + ').') : 'Вовремя. Хорошего дня!',
      });
    } else {
      rec.out = now.time; rec.outTs = now.ts; rec.outIp = ip; rec.outGeo = geo || null; rec.outDevice = deviceLabel || ''; rec.outDeviceId = deviceId || '';
      await setJSON('attendance', log);
      await logEvent({ type: 'checkin', ok: true, iin: user.iin, fio: user.fio, reason: 'уход', ip, device: deviceLabel || '', uid: deviceId || '', geo: geo || null });
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
