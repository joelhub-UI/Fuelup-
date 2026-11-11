import test from 'node:test';
import assert from 'node:assert/strict';
import { Auth, Limiter, sameOrigin } from '../server/auth.js';

const req = (headers = {}) => ({ headers, socket: {} });

test('ohne Passwort ist kein Schutz aktiv', () => {
  assert.equal(new Auth('').isAuthenticated(req()), true);
});

test('Anmeldung, Cookie und Ablauf der Sitzung', () => {
  let now = 1_000_000;
  const auth = new Auth('ein-langes-passwort', { now: () => now });
  assert.equal(auth.isAuthenticated(req()), false);
  assert.equal(auth.login('falsch', '1.1.1.1'), 'wrong');
  assert.equal(auth.login('ein-langes-passwort', '1.1.1.1'), 'ok');
  const token = auth.createToken();
  const cookie = auth.cookie(token, true);
  assert.match(cookie, /HttpOnly; SameSite=Lax; Max-Age=2592000; Secure$/);
  assert.equal(auth.isAuthenticated(req({ cookie: `a=b; fuelup_session=${token}` })), true);
  // manipuliertes Ablaufdatum, fremdes Passwort, abgelaufene Sitzung
  const [expires, sig] = token.split('.');
  assert.equal(auth.verifyToken(`${Number(expires) + 1}.${sig}`), false);
  assert.equal(new Auth('anderes-passwort!', { now: () => now }).verifyToken(token), false);
  assert.equal(auth.verifyToken('unsinn'), false);
  now += 31 * 86400 * 1000;
  assert.equal(auth.verifyToken(token), false);
});

test('sperrt nach zu vielen Fehlversuchen und gibt nach 15 Minuten wieder frei', () => {
  let now = 0;
  const auth = new Auth('ein-langes-passwort', { now: () => now });
  for (let i = 0; i < 8; i++) assert.equal(auth.login('x', '2.2.2.2'), 'wrong');
  assert.equal(auth.login('ein-langes-passwort', '2.2.2.2'), 'locked');
  assert.equal(auth.login('ein-langes-passwort', '3.3.3.3'), 'ok'); // andere Adresse nicht betroffen
  now += 16 * 60 * 1000;
  assert.equal(auth.login('ein-langes-passwort', '2.2.2.2'), 'ok');
});

test('globale Sperre bei verteiltem Durchprobieren', () => {
  const auth = new Auth('ein-langes-passwort', { now: () => 0 });
  for (let i = 0; i < 60; i++) auth.login('x', `10.0.0.${i}`);
  assert.equal(auth.login('ein-langes-passwort', '9.9.9.9'), 'locked');
});

test('Limiter und Herkunftsprüfung', () => {
  let now = 0;
  const limiter = new Limiter(2, 1000, { now: () => now });
  assert.deepEqual([limiter.take(), limiter.take(), limiter.take()], [true, true, false]);
  now = 1000;
  assert.equal(limiter.take(), true);
  assert.equal(sameOrigin(req({ host: 'fuel.example', origin: 'https://fuel.example' })), true);
  assert.equal(sameOrigin(req({ host: 'fuel.example', origin: 'https://boese.example' })), false);
  assert.equal(sameOrigin(req({ host: 'fuel.example' })), true);
});
