# ACS Backend

Backend foundation for the ACS competition platform: Express + MongoDB, with
authentication and role-based authorization that the remaining modules build on.

**Phase 1 scope** — project structure, database connection, environment
configuration, User model, authentication, login API, token/session management,
auth middleware, role-based authorization (Admin / Contestant / Judge), route
protection, and a unified error-handling contract.

---

## Quick start

```bash
# 1. install
npm install

# 2. configure
cp .env.example .env          # PowerShell: Copy-Item .env.example .env

# 3. generate a real JWT secret and paste it into .env
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

# 4. create the first admin (and demo accounts, if SEED_DEMO_USERS=true)
npm run seed

# 5. run
npm run dev
```

The API is then at `http://localhost:5000/api/v1`. Check it with:

```bash
curl http://localhost:5000/api/v1/health
```

MongoDB must be reachable at `MONGODB_URI` — either a local `mongod` or a free
MongoDB Atlas cluster.

### Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Start with nodemon (auto-restart on change) |
| `npm start` | Start once, for production |
| `npm run seed` | Create the first admin; skips accounts that already exist |
| `npm run seed:reset` | **Wipes** users and sessions, then seeds. Blocked in production |
| `npm run check` | Verification suite that needs no database |
| `npm run smoke` | Full end-to-end suite against a real database |

Run the full suite against a local MongoDB:

```bash
SMOKE_MONGODB_URI=mongodb://127.0.0.1:27017/acs_test npm run smoke
```

Without `SMOKE_MONGODB_URI` it spins up an ephemeral MongoDB via
`mongodb-memory-server`, which downloads a `mongod` binary on first run.

---

## Project structure

```
src/
├── config/            environment loading + validation, database connection
│   ├── env.js         THE only place process.env is read
│   └── database.js
├── constants/
│   ├── roles.js       admin | contestant | judge
│   └── errorCodes.js  every machine-readable error code in the system
├── models/
│   ├── user.model.js
│   ├── session.model.js     one row per refresh token
│   └── submission.model.js  PLACEHOLDER for the submissions/storage modules
├── middleware/
│   ├── authenticate.js  who are you           (401)
│   ├── authorize.js     what may you do       (403)
│   ├── validate.js      is the input valid    (400)
│   ├── rateLimiters.js
│   ├── requestId.js
│   ├── notFound.js
│   └── errorHandler.js  the single place an error becomes a response
├── modules/           one folder per feature
│   ├── auth/          routes · controller · service · validation
│   └── users/         routes · controller · service · validation
├── routes/index.js    where modules are mounted
├── scripts/seed.js
├── utils/             ApiError · apiResponse · asyncHandler · tokens · logger
├── app.js             Express assembly (no listening, no DB — importable in tests)
└── server.js          process entry point
```

**The layering rule:** a route wires middleware and points at a controller; a
controller translates HTTP to arguments and back; a service holds the business
rules and is the only layer that touches models. Services never see `req` or
`res` — that is what makes them testable and reusable.

---

## Architecture decisions

### Two token types

| | Access token | Refresh token |
| --- | --- | --- |
| Format | Signed JWT | 64 random bytes (no claims) |
| Lifetime | 15 minutes | 7 days |
| Sent as | `Authorization: Bearer …` | `httpOnly` cookie |
| Stored where | Frontend memory | `sessions` collection (SHA-256 hash only) |
| Revocable | No — it just expires | Yes, immediately |

A stateless refresh token cannot be revoked, so logout would be a lie. Backing
refresh tokens with a database row makes logout, "log out everywhere", account
disabling and theft detection into real operations.

The refresh token is `httpOnly`, so page JavaScript — and therefore any XSS
payload — cannot read it. Only its SHA-256 hash is stored, so a dump of the
sessions collection cannot be replayed against the API.

### Rotation and reuse detection

Every refresh **rotates**: the old token is revoked the moment a new one is
issued, and all tokens descending from one login share a `family` id.

If a token that has already been rotated is presented again, it was replayed —
either the token was stolen, or a client kept a copy. The system cannot tell
which, so it assumes theft and revokes the entire family. Both the attacker and
the legitimate user are forced back to the login screen. That is the intended
outcome: a stolen refresh token buys at most one rotation window.

### Authorization is enforced server-side

`authorize(...)` re-checks the caller's role on **every** request. The frontend
hiding a button is a convenience for the user, never a security control. There
is no route in this codebase whose protection depends on the UI.

Disabling an account takes effect immediately rather than whenever the access
token happens to expire: `authenticate` reloads the user on each request and
rejects disabled accounts, and disabling also revokes every session.

### No secrets in code

Every configurable value is read once, in `src/config/env.js`, validated with a
schema, and exported as a frozen object. Nothing else in `src/` reads
`process.env`. A missing or malformed variable stops the process at boot with a
readable message instead of failing mysteriously under load. `.env` is
git-ignored; `.env.example` documents every key with no real values.

---

## For the rest of the team

`docs/API.md` is the integration contract: every endpoint, the response
envelope, the full error-code table, and worked examples for the frontend.

Short version:

- Every response has the same shape — `{ success, data, meta? }` or
  `{ success: false, error: { code, message, details? }, requestId }`.
- Switch on `error.code`, never on `error.message`.
- `401` means "log in / refresh". `403` means "you are logged in but not
  allowed" — never retry it with a refresh.
- Send `credentials: 'include'` on `/auth/login`, `/auth/refresh` and
  `/auth/logout` so the refresh cookie travels, and add your dev origin to
  `CORS_ORIGINS`.

To add a module, see the comment block at the top of `src/routes/index.js`.

---

## Deployment notes

- Set `NODE_ENV=production`. The process refuses to start with
  `COOKIE_SECURE=false` in production — refresh cookies must not cross plain HTTP.
- A cross-site frontend needs `COOKIE_SAMESITE=none` **and** `COOKIE_SECURE=true`.
- Set `CORS_ORIGINS` to the deployed frontend origin(s).
- Rate limits are stored in process memory; behind more than one instance,
  switch `express-rate-limit` to a Redis store.
