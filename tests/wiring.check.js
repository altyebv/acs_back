/**
 * Wiring check - verification that needs no database.
 *
 * Exercises the parts of the foundation whose correctness does not depend on
 * MongoDB: token signing and verification, the authorization middleware, request
 * validation, error translation, and the HTTP surface of the assembled app.
 *
 * Run it anywhere, including CI without a database:
 *   npm run check
 *
 * The database-backed behaviour (sessions, rotation, reuse detection, account
 * disabling) is covered by `npm run smoke`, which needs a real MongoDB.
 */
process.env.NODE_ENV = 'test';
process.env.JWT_ACCESS_SECRET = 'wiring-check-secret-that-is-long-enough-here-32';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/acs_check';
process.env.LOG_LEVEL = 'error';
process.env.CORS_ORIGINS = 'http://localhost:5173';
process.env.BCRYPT_ROUNDS = '10';

import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const { createApp } = await import('../src/app.js');
const { User } = await import('../src/models/user.model.js');
const { ROLES } = await import('../src/constants/roles.js');
const { authorize, authorizeSelfOrAdmin } = await import('../src/middleware/authorize.js');
const { validate } = await import('../src/middleware/validate.js');
const { errorHandler } = await import('../src/middleware/errorHandler.js');
const { loginSchema } = await import('../src/modules/auth/auth.validation.js');
const { createUserSchema } = await import('../src/modules/users/user.validation.js');
const tokens = await import('../src/utils/tokens.js');
const { ApiError } = await import('../src/utils/ApiError.js');

let passed = 0;
const failures = [];
const check = (label, condition, extra = '') => {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${label}`);
  } else {
    failures.push(label);
    console.log(`  FAIL  ${label} ${extra}`);
  }
};
const section = (name) => console.log(`\n${name}`);

/** Runs a middleware against fake req/res and reports what it did. */
const runMiddleware = (middleware, req) =>
  new Promise((resolve) => {
    const res = {
      statusCode: null,
      body: null,
      status(code) { this.statusCode = code; return this; },
      json(payload) { this.body = payload; resolve({ res: this, error: null, called: 'json' }); return this; },
    };
    middleware(req, res, (error) => resolve({ res, error: error ?? null, called: 'next' }));
  });

console.log('\nACS backend wiring check (no database required)\n');

// --- access tokens ----------------------------------------------------------
section('access tokens');
{
  const token = tokens.signAccessToken({ userId: 'abc123', role: ROLES.JUDGE, sessionFamily: 'fam-1' });
  const payload = tokens.verifyAccessToken(token);
  check('sign/verify round-trips the claims', payload.sub === 'abc123' && payload.role === 'judge' && payload.fam === 'fam-1');
  check('payload is marked as an access token', payload.type === 'access');
  check('token carries iat and exp', typeof payload.iat === 'number' && payload.exp > payload.iat);
  check('access token lifetime is short (<= 1 hour)', payload.exp - payload.iat <= 3600);

  let rejectedWrongSecret = false;
  try { jwt.verify(token, 'a-different-secret-entirely-long-enough'); } catch { rejectedWrongSecret = true; }
  check('a token signed with another secret is rejected', rejectedWrongSecret);

  const forged = jwt.sign({ sub: 'x', role: 'admin', type: 'access' }, process.env.JWT_ACCESS_SECRET, { issuer: 'evil', audience: 'acs-client' });
  let rejectedIssuer = false;
  try { tokens.verifyAccessToken(forged); } catch { rejectedIssuer = true; }
  check('a token with the wrong issuer is rejected', rejectedIssuer);

  const expired = jwt.sign({ sub: 'x', type: 'access' }, process.env.JWT_ACCESS_SECRET, { issuer: 'acs-api', audience: 'acs-client', expiresIn: '-10s' });
  let rejectedExpired = false;
  try { tokens.verifyAccessToken(expired); } catch (error) { rejectedExpired = error instanceof jwt.TokenExpiredError; }
  check('an expired token raises TokenExpiredError', rejectedExpired);
}

// --- refresh tokens ---------------------------------------------------------
section('refresh tokens');
{
  const a = tokens.generateRefreshToken();
  const b = tokens.generateRefreshToken();
  check('refresh tokens are long random strings', a.token.length === 128 && /^[0-9a-f]+$/.test(a.token));
  check('two refresh tokens never collide', a.token !== b.token);
  check('only the hash would be stored, and it differs from the token', a.tokenHash !== a.token && a.tokenHash.length === 64);
  check('hashing is deterministic (lookup works)', tokens.hashRefreshToken(a.token) === a.tokenHash);
  check('the raw token cannot be derived from the hash', !a.tokenHash.includes(a.token.slice(0, 16)));

  const options = tokens.refreshCookieOptions();
  check('refresh cookie is httpOnly (unreadable by page JS)', options.httpOnly === true);
  check('refresh cookie is scoped to the auth routes', options.path === '/api/v1/auth');
  check('refresh cookie sets sameSite', ['lax', 'strict', 'none'].includes(options.sameSite));
}

// --- password handling ------------------------------------------------------
section('password handling');
{
  const hash = await bcrypt.hash('Passw0rd!2026', 10);
  check('bcrypt hash does not contain the plaintext', !hash.includes('Passw0rd'));
  check('correct password verifies', await bcrypt.compare('Passw0rd!2026', hash));
  check('wrong password does not verify', !(await bcrypt.compare('Passw0rd!2027', hash)));

  const user = new User({ name: 'X', email: 'x@acs.test', password: hash, role: ROLES.ADMIN });
  user.passwordChangedAt = new Date('2026-01-02T00:00:00Z');
  const before = Math.floor(new Date('2026-01-01T00:00:00Z').getTime() / 1000);
  const after = Math.floor(new Date('2026-01-03T00:00:00Z').getTime() / 1000);
  check('tokens issued BEFORE a password change are invalidated', user.passwordChangedAfter(before) === true);
  check('tokens issued AFTER a password change stay valid', user.passwordChangedAfter(after) === false);
  check('a user who never changed their password keeps their tokens', new User({ name: 'Y', email: 'y@acs.test', password: hash }).passwordChangedAfter(before) === false);
}

// --- user schema ------------------------------------------------------------
section('user schema');
{
  const invalid = new User({ name: 'A', email: 'not-an-email', password: 'short', role: 'superuser' });
  const errors = invalid.validateSync()?.errors ?? {};
  check('name shorter than 2 chars is rejected', !!errors.name);
  check('malformed email is rejected', !!errors.email);
  check('password shorter than 8 chars is rejected', !!errors.password);
  check('an unknown role is rejected', !!errors.role);

  const valid = new User({ name: 'Valid User', email: '  MiXeD@ACS.Test ', password: 'Passw0rd!2026' });
  check('a valid user passes validation', valid.validateSync() === undefined);
  check('email is normalised to lowercase and trimmed', valid.email === 'mixed@acs.test');
  check('role defaults to contestant', valid.role === ROLES.CONTESTANT);
  check('accounts are active by default', valid.isActive === true);

  valid.password = 'Passw0rd!2026';
  const serialised = JSON.parse(JSON.stringify(valid));
  check('serialising a user never leaks the password', serialised.password === undefined);
  check('serialising a user exposes id, not _id', typeof serialised.id === 'string' && serialised._id === undefined);
}

// --- authorization middleware ----------------------------------------------
section('role-based authorization');
{
  const guard = authorize(ROLES.ADMIN);

  const noUser = await runMiddleware(guard, {});
  check('a route reached without authentication yields 401', noUser.error?.statusCode === 401 && noUser.error.code === 'AUTH_REQUIRED');

  const wrongRole = await runMiddleware(guard, { user: { role: ROLES.CONTESTANT, id: '1' } });
  check('the wrong role yields 403 INSUFFICIENT_ROLE', wrongRole.error?.statusCode === 403 && wrongRole.error.code === 'INSUFFICIENT_ROLE');
  check('the 403 tells the client which roles are required', wrongRole.error.details.requiredRoles.includes('admin'));

  const rightRole = await runMiddleware(guard, { user: { role: ROLES.ADMIN, id: '1' } });
  check('the right role passes through', rightRole.error === null);

  const multi = authorize(ROLES.ADMIN, ROLES.JUDGE);
  check('multi-role guards accept any listed role', (await runMiddleware(multi, { user: { role: ROLES.JUDGE, id: '1' } })).error === null);
  check('multi-role guards still reject unlisted roles', (await runMiddleware(multi, { user: { role: ROLES.CONTESTANT, id: '1' } })).error?.statusCode === 403);

  let rejectedEmpty = false;
  try { authorize(); } catch { rejectedEmpty = true; }
  check('authorize() with no roles fails loudly at boot, not silently at runtime', rejectedEmpty);

  const selfGuard = authorizeSelfOrAdmin('id');
  check('a user may read their own record', (await runMiddleware(selfGuard, { user: { role: ROLES.CONTESTANT, id: 'u1' }, params: { id: 'u1' } })).error === null);
  check("a user may not read someone else's record", (await runMiddleware(selfGuard, { user: { role: ROLES.CONTESTANT, id: 'u1' }, params: { id: 'u2' } })).error?.statusCode === 403);
  check('an admin may read anyone', (await runMiddleware(selfGuard, { user: { role: ROLES.ADMIN, id: 'a1' }, params: { id: 'u2' } })).error === null);
}

// --- request validation -----------------------------------------------------
section('request validation');
{
  const loginGuard = validate({ body: loginSchema });

  const bad = await runMiddleware(loginGuard, { body: { email: 'nope' } });
  check('a malformed login body is rejected with field-level details', bad.error?.code === 'VALIDATION_ERROR' && bad.error.details.some((d) => d.field === 'email'));

  const req = { body: { email: '  ADMIN@ACS.Test ', password: 'anything' } };
  const good = await runMiddleware(loginGuard, req);
  check('a valid login body passes', good.error === null);
  check('email is normalised before it reaches the controller', req.body.email === 'admin@acs.test');

  const createGuard = validate({ body: createUserSchema });
  const smuggled = await runMiddleware(createGuard, { body: { name: 'Mallory', email: 'm@acs.test', password: 'Passw0rd!2026', role: 'contestant', isActive: true, createdBy: 'anything' } });
  check('unknown fields are rejected rather than silently stripped', smuggled.error?.code === 'VALIDATION_ERROR');

  const badRole = await runMiddleware(createGuard, { body: { name: 'Mallory', email: 'm@acs.test', password: 'Passw0rd!2026', role: 'superadmin' } });
  check('an invented role cannot be assigned', badRole.error?.code === 'VALIDATION_ERROR');

  const weak = await runMiddleware(createGuard, { body: { name: 'Mallory', email: 'm@acs.test', password: 'alllowercase', role: 'judge' } });
  check('the password policy is enforced on creation', weak.error?.code === 'VALIDATION_ERROR');
}

// --- error translation ------------------------------------------------------
section('error translation');
{
  const fakeReq = { id: 'req-1', method: 'GET', originalUrl: '/api/v1/x' };
  const send = (error) =>
    new Promise((resolve) => {
      const res = {
        statusCode: null,
        status(code) { this.statusCode = code; return this; },
        json(body) { resolve({ status: this.statusCode, body }); return this; },
      };
      errorHandler(error, fakeReq, res, () => {});
    });

  const apiErr = await send(ApiError.notFound('Nope'));
  check('an ApiError keeps its status and code', apiErr.status === 404 && apiErr.body.error.code === 'NOT_FOUND');
  check('every error body has success:false and a requestId', apiErr.body.success === false && apiErr.body.requestId === 'req-1');

  const dup = await send(Object.assign(new Error('E11000'), { code: 11000, keyPattern: { email: 1 } }));
  check('a duplicate-key error becomes 409 EMAIL_ALREADY_EXISTS', dup.status === 409 && dup.body.error.code === 'EMAIL_ALREADY_EXISTS');

  const cast = await send(new mongoose.Error.CastError('ObjectId', 'oops', 'id'));
  check('a malformed id becomes 400, not 500', cast.status === 400);

  const expired = await send(new jwt.TokenExpiredError('jwt expired', new Date()));
  check('an expired JWT becomes 401 TOKEN_EXPIRED', expired.status === 401 && expired.body.error.code === 'TOKEN_EXPIRED');

  const badJwt = await send(new jwt.JsonWebTokenError('invalid signature'));
  check('an invalid JWT becomes 401 TOKEN_INVALID', badJwt.status === 401 && badJwt.body.error.code === 'TOKEN_INVALID');

  const boom = await send(new Error('connection string mongodb://user:hunter2@host/db failed'));
  check('an unexpected error becomes a generic 500', boom.status === 500 && boom.body.error.code === 'INTERNAL_ERROR');
  check('the generic 500 message reveals nothing internal', !boom.body.error.message.includes('hunter2'));
}

// --- assembled HTTP surface -------------------------------------------------
section('http surface');
{
  const server = createApp().listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (path, init = {}) => {
    const response = await fetch(base + path, init);
    const text = await response.text();
    return { status: response.status, headers: response.headers, body: text ? JSON.parse(text) : null };
  };

  const health = await call('/health');
  check('/health responds without authentication', health.status === 200 && health.body.success === true);

  const missing = await call('/api/v1/does-not-exist');
  check('an unknown route returns the standard error envelope', missing.status === 404 && missing.body.error.code === 'NOT_FOUND');
  check('every response carries an X-Request-Id header', !!missing.headers.get('x-request-id'));

  const noAuth = await call('/api/v1/auth/me');
  check('a protected route without a token returns 401 AUTH_REQUIRED', noAuth.status === 401 && noAuth.body.error.code === 'AUTH_REQUIRED');

  const garbage = await call('/api/v1/auth/me', { headers: { Authorization: 'Bearer not.a.jwt' } });
  check('a garbage bearer token returns 401 TOKEN_INVALID', garbage.status === 401 && garbage.body.error.code === 'TOKEN_INVALID');

  const noScheme = await call('/api/v1/auth/me', { headers: { Authorization: 'some-token' } });
  check('an Authorization header without the Bearer scheme is refused', noScheme.status === 401);

  const forged = jwt.sign({ sub: '507f1f77bcf86cd799439011', role: 'admin', type: 'access' }, 'attacker-secret-long-enough-to-sign-x', { issuer: 'acs-api', audience: 'acs-client', expiresIn: '1h' });
  const forgedCall = await call('/api/v1/auth/me', { headers: { Authorization: `Bearer ${forged}` } });
  check('a self-signed admin token is rejected (signature checked)', forgedCall.status === 401 && forgedCall.body.error.code === 'TOKEN_INVALID');

  const badLogin = await call('/api/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'nope' }) });
  check('login validates the body before touching the database', badLogin.status === 400 && badLogin.body.error.code === 'VALIDATION_ERROR');

  const badJson = await call('/api/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{oops' });
  check('malformed JSON returns 400, not a crash', badJson.status === 400);

  const usersNoAuth = await call('/api/v1/users');
  check('admin routes are unreachable without authentication', usersNoAuth.status === 401);

  const cors = await call('/health', { headers: { Origin: 'http://evil.example.com' } });
  check('a disallowed CORS origin is refused with 403', cors.status === 403);

  const allowedCors = await fetch(`${base}/health`, { headers: { Origin: 'http://localhost:5173' } });
  check('the configured frontend origin is allowed', allowedCors.headers.get('access-control-allow-origin') === 'http://localhost:5173');
  check('credentials are allowed, so the refresh cookie can travel', allowedCors.headers.get('access-control-allow-credentials') === 'true');

  check('security headers are applied (helmet)', !!missing.headers.get('x-content-type-options'));
  check('the Express fingerprint is hidden', !missing.headers.get('x-powered-by'));
  check('rate limiting is active', !!missing.headers.get('ratelimit-limit') || !!missing.headers.get('ratelimit'));

  server.close();
}

console.log(`\n${passed} passed, ${failures.length} failed\n`);
if (failures.length) {
  failures.forEach((f) => console.log(`  - ${f}`));
  process.exit(1);
}
process.exit(0);
