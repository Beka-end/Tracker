import {
  generateRegistrationOptions, verifyRegistrationResponse,
  generateAuthenticationOptions, verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import {
  currentUser, getEmployees, saveEmployees, readBody,
  signSession, verifySession, getCookie, setExtraCookie, rpInfo,
} from './_lib.js';

const b64uToU8 = (s) => new Uint8Array(Buffer.from(s, 'base64url'));
const u8Tob64u = (u) => Buffer.from(u).toString('base64url');

export default async function handler(req, res) {
  try {
    const user = await currentUser(req);
    if (!user) return res.status(401).json({ error: 'auth' });
    const { rpID, origin } = rpInfo(req);
    const action = (req.query && req.query.action) || '';

    // ---- варианты опций (GET) ----
    if (req.method === 'GET' && action === 'register-options') {
      const emps = (await getEmployees()) || [];
      const me = emps.find((e) => e.iin === user.iin) || {};
      const existing = (me.webauthn || []).map((c) => ({ id: c.id, transports: c.transports || [] }));
      const options = await generateRegistrationOptions({
        rpName: 'Учёт прихода',
        rpID,
        userName: user.iin,
        userDisplayName: user.fio,
        userID: new TextEncoder().encode(user.iin),
        attestationType: 'none',
        excludeCredentials: existing,
        authenticatorSelection: { residentKey: 'discouraged', userVerification: 'required', authenticatorAttachment: 'platform' },
      });
      setExtraCookie(res, 'wachal', signSession({ wc: options.challenge, exp: Date.now() + 5 * 60 * 1000 }), 300);
      return res.json({ options });
    }

    if (req.method === 'GET' && action === 'auth-options') {
      const emps = (await getEmployees()) || [];
      const me = emps.find((e) => e.iin === user.iin) || {};
      const creds = me.webauthn || [];
      if (!creds.length) return res.json({ enabled: false });
      const options = await generateAuthenticationOptions({
        rpID,
        allowCredentials: creds.map((c) => ({ id: c.id, transports: c.transports || [] })),
        userVerification: 'required',
      });
      setExtraCookie(res, 'wachal', signSession({ wc: options.challenge, exp: Date.now() + 5 * 60 * 1000 }), 300);
      return res.json({ enabled: true, options });
    }

    // ---- проверки (POST) ----
    if (req.method === 'POST') {
      const body = await readBody(req);
      const act = body.action;
      const emps = (await getEmployees()) || [];
      const me = emps.find((e) => e.iin === user.iin);
      if (!me) return res.status(404).json({ error: 'not found' });

      if (act === 'disable') {
        delete me.webauthn; await saveEmployees(emps);
        return res.json({ ok: true, enabled: false });
      }

      const chalTok = verifySession(getCookie(req, 'wachal'));
      if (!chalTok || !chalTok.wc) return res.status(400).json({ error: 'Истёк запрос. Повторите.' });
      const expectedChallenge = chalTok.wc;

      if (act === 'register-verify') {
        const verification = await verifyRegistrationResponse({
          response: body.response, expectedChallenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true,
        });
        if (!verification.verified || !verification.registrationInfo) return res.status(400).json({ error: 'Не подтверждено' });
        const cred = verification.registrationInfo.credential;
        me.webauthn = me.webauthn || [];
        me.webauthn.push({ id: cred.id, publicKey: u8Tob64u(cred.publicKey), counter: cred.counter || 0, transports: cred.transports || [] });
        await saveEmployees(emps);
        return res.json({ ok: true, verified: true });
      }

      if (act === 'auth-verify') {
        const creds = me.webauthn || [];
        const resp = body.response || {};
        const cred = creds.find((c) => c.id === resp.id || c.id === resp.rawId);
        if (!cred) return res.status(400).json({ error: 'Ключ не найден' });
        const verification = await verifyAuthenticationResponse({
          response: resp, expectedChallenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true,
          credential: { id: cred.id, publicKey: b64uToU8(cred.publicKey), counter: cred.counter || 0, transports: cred.transports || [] },
        });
        if (!verification.verified) return res.status(400).json({ error: 'Не подтверждено' });
        cred.counter = verification.authenticationInfo.newCounter;
        await saveEmployees(emps);
        // выдаём короткоживущий «пропуск» для отметки (проверяется в /api/checkin)
        setExtraCookie(res, 'biopass', signSession({ iin: user.iin, t: Date.now(), exp: Date.now() + 2 * 60 * 1000 }), 120);
        return res.json({ ok: true, verified: true });
      }

      return res.status(400).json({ error: 'Неизвестное действие' });
    }

    return res.status(405).json({ error: 'method' });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
}
