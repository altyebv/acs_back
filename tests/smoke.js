/**
 * End-to-end smoke test.
 *
 * Boots the real app against an in-memory MongoDB and exercises the paths that
 * matter: login, refresh rotation, stolen-token reuse detection, role guards,
 * account disabling and password change. No mocks - if this passes, the wiring
 * is genuinely correct.
 *
 *   npm run smoke
 */
process.env.NODE_ENV = 'test';
process.env.JWT_ACCESS_SECRET = 'smoke-test-secret-that-is-definitely-long-enough-32';
process.env.ACCESS_TOKEN_TTL = '15m';
process.env.BCRYPT_ROUNDS = '10';
process.env.LOG_LEVEL = 'error';
process.env.COOKIE_SECURE = 'false';
process.env.CORS_ORIGINS = 'http://localhost:5173';
process.env.LOGIN_RATE_LIMIT_MAX = '50';

// Prefer a real MongoDB when MONGODB_URI is exported; otherwise spin up an
// ephemeral one. mongodb-memory-server downloads a mongod binary on first run,
// so on a locked-down network export MONGODB_URI instead:
//   MONGODB_URI=mongodb://127.0.0.1:27017/acs_test npm run smoke
let mongo = null;
if (process.env.SMOKE_MONGODB_URI) {
  process.env.MONGODB_URI = process.env.SMOKE_MONGODB_URI;
} else {
  const { MongoMemoryServer } = await import('mongodb-memory-server');
  mongo = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongo.getUri('acs_test');
}

const { connectDatabase, disconnectDatabase } = await import('../src/config/database.js');
const { createApp } = await import('../src/app.js');
const { User } = await import('../src/models/user.model.js');
const { ROLES } = await import('../src/constants/roles.js');

await connectDatabase();
const server = createApp().listen(0);
const base = `http://127.0.0.1:${server.address().port}/api/v1`;

// --- tiny assertion harness -------------------------------------------------
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

/** Fetch wrapper that tracks the refresh cookie like a browser would. */
let cookieJar = '';
const api = async (path, { method = 'GET', body, token, cookie } = {}) => {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const jar = cookie === undefined ? cookieJar : cookie;
  if (jar) headers.Cookie = jar;

  const response = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const setCookie = response.headers.get('set-cookie');
  if (setCookie && cookie === undefined) {
    cookieJar = setCookie.split(';')[0];
  }

  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null, setCookie };
};

// --- fixtures ---------------------------------------------------------------
const { Session } = await import('../src/models/session.model.js');
await Promise.all([User.deleteMany({}), Session.deleteMany({})]);

const PASSWORD = 'Passw0rd!2026';
const admin = await User.create({ name: 'Admin', email: 'admin@acs.test', password: PASSWORD, role: ROLES.ADMIN });
await User.create({ name: 'Contestant', email: 'contestant@acs.test', password: PASSWORD, role: ROLES.CONTESTANT });
await User.create({ name: 'Judge', email: 'judge@acs.test', password: PASSWORD, role: ROLES.JUDGE });

console.log('\nACS backend smoke test\n');

// --- health -----------------------------------------------------------------
console.log('health');
{
  const res = await api('/health');
  check('health returns 200 and connected db', res.status === 200 && res.body.data.database === 'connected');
}

// --- login ------------------------------------------------------------------
console.log('\nlogin');
let adminToken;
{
  const res = await api('/auth/login', { method: 'POST', body: { email: 'admin@acs.test', password: PASSWORD } });
  adminToken = res.body?.data?.accessToken;
  check('valid credentials return 200 + access token', res.status === 200 && !!adminToken);
  check('response envelope has success:true and data', res.body.success === true && !!res.body.data.user);
  check('password hash is never in the response', !JSON.stringify(res.body).includes('$2'));
  check('refresh token is set as httpOnly cookie', /acs_refresh_token=/.test(res.setCookie ?? '') && /HttpOnly/i.test(res.setCookie ?? ''));
  check('refresh token is NOT in the response body', !JSON.stringify(res.body).includes('refreshToken'));

  const wrong = await api('/auth/login', { method: 'POST', body: { email: 'admin@acs.test', password: 'WrongPassword1' }, cookie: '' });
  check('wrong password returns 401 INVALID_CREDENTIALS', wrong.status === 401 && wrong.body.error.code === 'INVALID_CREDENTIALS');

  const unknown = await api('/auth/login', { method: 'POST', body: { email: 'nobody@acs.test', password: PASSWORD }, cookie: '' });
  check('unknown email returns the SAME error (no enumeration)', unknown.status === 401 && unknown.body.error.code === 'INVALID_CREDENTIALS' && unknown.body.error.message === wrong.body.error.message);

  const malformed = await api('/auth/login', { method: 'POST', body: { email: 'not-an-email' }, cookie: '' });
  check('malformed body returns 400 VALIDATION_ERROR with field details', malformed.status === 400 && malformed.body.error.code === 'VALIDATION_ERROR' && Array.isArray(malformed.body.error.details));
}

// --- authentication guard ---------------------------------------------------
console.log('\nauthentication');
{
  const noToken = await api('/auth/me');
  check('no token returns 401 AUTH_REQUIRED', noToken.status === 401 && noToken.body.error.code === 'AUTH_REQUIRED');

  const badToken = await api('/auth/me', { token: 'garbage.token.here' });
  check('invalid token returns 401 TOKEN_INVALID', badToken.status === 401 && badToken.body.error.code === 'TOKEN_INVALID');

  const ok = await api('/auth/me', { token: adminToken });
  check('valid token returns the current user', ok.status === 200 && ok.body.data.user.email === 'admin@acs.test');
  check('/auth/me never exposes the password field', ok.body.data.user.password === undefined);
}

// --- role-based authorization ----------------------------------------------
console.log('\nauthorization');
let contestantToken;
{
  const login = await api('/auth/login', { method: 'POST', body: { email: 'contestant@acs.test', password: PASSWORD }, cookie: '' });
  contestantToken = login.body.data.accessToken;

  const denied = await api('/users', { token: contestantToken });
  check('contestant hitting an admin route gets 403 INSUFFICIENT_ROLE', denied.status === 403 && denied.body.error.code === 'INSUFFICIENT_ROLE');
  check('403 details tell the client which roles are required', denied.body.error.details?.requiredRoles?.includes('admin'));

  const allowed = await api('/users', { token: adminToken });
  check('admin can list users, with pagination meta', allowed.status === 200 && Array.isArray(allowed.body.data.users) && allowed.body.meta.total === 3);

  const self = await api(`/users/${admin._id}`, { token: adminToken });
  check('admin can read a user by id', self.status === 200);

  const other = await api(`/users/${admin._id}`, { token: contestantToken });
  check('contestant cannot read another user (self-or-admin guard)', other.status === 403);
}

// --- admin user creation ----------------------------------------------------
console.log('\nuser management');
let createdId;
{
  const created = await api('/users', { token: adminToken, method: 'POST', body: { name: 'New Judge', email: 'judge2@acs.test', password: 'Judge!2026x', role: ROLES.JUDGE } });
  createdId = created.body?.data?.user?.id;
  check('admin can create a judge', created.status === 201 && created.body.data.user.role === 'judge');

  const duplicate = await api('/users', { token: adminToken, method: 'POST', body: { name: 'Dup', email: 'judge2@acs.test', password: 'Judge!2026x', role: ROLES.JUDGE } });
  check('duplicate email returns 409 EMAIL_ALREADY_EXISTS', duplicate.status === 409 && duplicate.body.error.code === 'EMAIL_ALREADY_EXISTS');

  const weak = await api('/users', { token: adminToken, method: 'POST', body: { name: 'Weak', email: 'weak@acs.test', password: 'short', role: ROLES.JUDGE } });
  check('weak password is rejected with 400', weak.status === 400 && weak.body.error.code === 'VALIDATION_ERROR');

  const injected = await api('/users', { token: adminToken, method: 'POST', body: { name: 'Sneaky', email: 'sneaky@acs.test', password: 'Sneaky!2026x', role: ROLES.CONTESTANT, isAdmin: true } });
  check('unknown fields are rejected, not silently accepted', injected.status === 400);

  const selfDelete = await api(`/users/${admin._id}`, { token: adminToken, method: 'DELETE' });
  check('admin cannot delete their own account', selfDelete.status === 400 && selfDelete.body.error.code === 'CANNOT_MODIFY_SELF');
}

// --- refresh rotation + reuse detection ------------------------------------
console.log('\nrefresh rotation');
{
  const first = await api('/auth/login', { method: 'POST', body: { email: 'judge@acs.test', password: PASSWORD }, cookie: '' });
  const originalCookie = first.setCookie.split(';')[0];

  const refreshed = await api('/auth/refresh', { method: 'POST', cookie: originalCookie });
  const rotatedCookie = refreshed.setCookie.split(';')[0];
  check('refresh returns a new access token', refreshed.status === 200 && !!refreshed.body.data.accessToken);
  check('refresh rotates the refresh token', rotatedCookie !== originalCookie);

  const replay = await api('/auth/refresh', { method: 'POST', cookie: originalCookie });
  check('replaying the OLD refresh token is rejected (reuse detected)', replay.status === 401 && replay.body.error.code === 'SESSION_REVOKED');

  const afterBreach = await api('/auth/refresh', { method: 'POST', cookie: rotatedCookie });
  check('reuse detection also kills the legitimate token (whole family revoked)', afterBreach.status === 401);

  const noCookie = await api('/auth/refresh', { method: 'POST', cookie: '' });
  check('refresh without a token returns 401 REFRESH_TOKEN_MISSING', noCookie.status === 401 && noCookie.body.error.code === 'REFRESH_TOKEN_MISSING');
}

// --- logout -----------------------------------------------------------------
console.log('\nlogout');
{
  const login = await api('/auth/login', { method: 'POST', body: { email: 'judge@acs.test', password: PASSWORD }, cookie: '' });
  const cookie = login.setCookie.split(';')[0];

  const out = await api('/auth/logout', { method: 'POST', cookie });
  check('logout returns 200 and clears the cookie', out.status === 200 && /acs_refresh_token=;/.test(out.setCookie ?? ''));

  const reuse = await api('/auth/refresh', { method: 'POST', cookie });
  check('refresh token no longer works after logout', reuse.status === 401);

  const twice = await api('/auth/logout', { method: 'POST', cookie });
  check('logging out twice is not an error (idempotent)', twice.status === 200);
}

// --- disabling an account revokes access immediately ------------------------
console.log('\naccount disabling');
{
  const login = await api('/auth/login', { method: 'POST', body: { email: 'judge2@acs.test', password: 'Judge!2026x' }, cookie: '' });
  const token = login.body.data.accessToken;
  const cookie = login.setCookie.split(';')[0];

  const before = await api('/auth/me', { token });
  check('disabled-to-be user works before disabling', before.status === 200);

  const disabled = await api(`/users/${createdId}/status`, { token: adminToken, method: 'PATCH', body: { isActive: false } });
  check('admin can disable an account', disabled.status === 200 && disabled.body.data.user.isActive === false);

  const after = await api('/auth/me', { token });
  check('existing access token stops working immediately', after.status === 403 && after.body.error.code === 'ACCOUNT_DISABLED');

  const refresh = await api('/auth/refresh', { method: 'POST', cookie });
  check('refresh token was revoked too', refresh.status === 401);

  const relogin = await api('/auth/login', { method: 'POST', body: { email: 'judge2@acs.test', password: 'Judge!2026x' }, cookie: '' });
  check('disabled user cannot log in again', relogin.status === 403 && relogin.body.error.code === 'ACCOUNT_DISABLED');
}

// --- password change invalidates tokens -------------------------------------
console.log('\npassword change');
{
  const login = await api('/auth/login', { method: 'POST', body: { email: 'contestant@acs.test', password: PASSWORD }, cookie: '' });
  const token = login.body.data.accessToken;

  const wrongCurrent = await api('/auth/password', { token, method: 'PATCH', body: { currentPassword: 'NotIt123', newPassword: 'BrandNew!2026' } });
  check('wrong current password is rejected', wrongCurrent.status === 401);

  const changed = await api('/auth/password', { token, method: 'PATCH', body: { currentPassword: PASSWORD, newPassword: 'BrandNew!2026' } });
  check('password change succeeds', changed.status === 200);

  const stale = await api('/auth/me', { token });
  check('tokens issued before the change are rejected', stale.status === 401 && stale.body.error.code === 'PASSWORD_CHANGED');

  const oldPassword = await api('/auth/login', { method: 'POST', body: { email: 'contestant@acs.test', password: PASSWORD }, cookie: '' });
  check('old password no longer works', oldPassword.status === 401);

  const newPassword = await api('/auth/login', { method: 'POST', body: { email: 'contestant@acs.test', password: 'BrandNew!2026' }, cookie: '' });
  check('new password works', newPassword.status === 200);
}

// --- 404 shape --------------------------------------------------------------
console.log('\nerror envelope');
{
  const missing = await api('/does-not-exist');
  check('unknown route returns the standard error envelope', missing.status === 404 && missing.body.success === false && missing.body.error.code === 'NOT_FOUND');
  check('every error carries a requestId for log correlation', typeof missing.body.requestId === 'string');
}

// --- summary ----------------------------------------------------------------
console.log(`\n${passed} passed, ${failures.length} failed\n`);
if (failures.length) failures.forEach((f) => console.log(`  - ${f}`));

server.close();
await disconnectDatabase();
if (mongo) await mongo.stop();
process.exit(failures.length ? 1 : 0);
