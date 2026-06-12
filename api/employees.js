import { requireAdmin, getEmployees, saveEmployees, hashPassword, readBody } from './_lib.js';

export default async function handler(req, res) {
  try {
    const admin = await requireAdmin(req);
    if (!admin) return res.status(403).json({ error: 'Только для администратора' });

    if (req.method === 'GET') {
      const emps = (await getEmployees()) || [];
      return res.json({ employees: emps.map((e) => ({ iin: e.iin, fio: e.fio, role: e.role, deviceLabel: e.deviceLabel || '', bound: !!e.deviceId })) });
    }

    if (req.method === 'POST') {
      const body = await readBody(req);
      const action = body.action || 'upsert';
      let emps = (await getEmployees()) || [];

      if (action === 'upsert') {
        const { iin, fio, role, password } = body;
        if (!/^\d{12}$/.test(String(iin || ''))) return res.status(400).json({ error: 'ИИН должен состоять из 12 цифр' });
        if (!fio || String(fio).trim().length < 3) return res.status(400).json({ error: 'Укажите ФИО' });
        const r = role === 'admin' ? 'admin' : 'employee';
        const ex = emps.find((e) => e.iin === iin);
        if (ex) {
          ex.fio = String(fio).trim(); ex.role = r;
          if (password) ex.pass = hashPassword(password);
        } else {
          if (!password) return res.status(400).json({ error: 'Для нового сотрудника задайте пароль' });
          emps.push({ iin, fio: String(fio).trim(), role: r, pass: hashPassword(password) });
        }
        await saveEmployees(emps);
        return res.json({ ok: true });
      }

      if (action === 'delete') {
        const { iin } = body;
        if (iin === admin.iin) return res.status(400).json({ error: 'Нельзя удалить свою учётную запись' });
        emps = emps.filter((e) => e.iin !== iin);
        await saveEmployees(emps);
        return res.json({ ok: true });
      }

      if (action === 'reset-device') {
        const { iin } = body;
        const e = emps.find((x) => x.iin === iin);
        if (e) { delete e.deviceId; delete e.deviceLabel; await saveEmployees(emps); }
        return res.json({ ok: true });
      }

      return res.status(400).json({ error: 'Неизвестное действие' });
    }

    return res.status(405).json({ error: 'method' });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
}
