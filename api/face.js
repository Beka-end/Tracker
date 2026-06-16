import { currentUser, getEmployees, getSettings, readBody, signSession, setExtraCookie } from './_lib.js';

function distance(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; s += d * d; }
  return Math.sqrt(s);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
  try {
    const user = await currentUser(req);
    if (!user) return res.status(401).json({ error: 'auth' });
    const { descriptor, liveness } = await readBody(req);
    const emps = (await getEmployees()) || [];
    const me = emps.find((e) => e.iin === user.iin);
    if (!me || !me.face || !me.face.length) return res.status(400).json({ ok: false, error: 'Эталон лица не загружен. Обратитесь к администратору.' });
    if (!Array.isArray(descriptor) || descriptor.length !== 128) return res.status(400).json({ ok: false, error: 'Лицо не распознано' });
    if (!liveness) return res.json({ ok: false, error: 'Проверка «живого» лица не пройдена' });

    const s = await getSettings();
    const threshold = s.faceThreshold || 0.5;
    const d = distance(me.face, descriptor);
    if (d <= threshold) {
      setExtraCookie(res, 'facepass', signSession({ iin: user.iin, t: Date.now(), exp: Date.now() + 2 * 60 * 1000 }), 120);
      return res.json({ ok: true, distance: +d.toFixed(3) });
    }
    return res.json({ ok: false, distance: +d.toFixed(3), error: 'Лицо не совпало с эталоном' });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String((e && e.message) || e) });
  }
}
