import { clearSessionCookie } from './_lib.js';

export default async function handler(req, res) {
  clearSessionCookie(res);
  return res.json({ ok: true });
}
