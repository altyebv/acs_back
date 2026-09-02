# ACS API — integration guide

Base URL: `http://localhost:5000/api/v1` (configurable via `PORT` and `API_PREFIX`).

This document is the contract between the backend foundation and everything
that talks to it. If something here changes, it will be announced — do not read
implementation files to infer behaviour that is not written down here.

---

## 1. The response structure 

**Every** response, success or failure, has one of two shapes.

Success:

```json
{
  "success": true,
  "data": { "...": "endpoint-specific payload" },
  "meta":  { "page": 1, "limit": 20, "total": 42 }
}
```

`meta` appears only on list endpoints.

Failure:

```json
{
  "success": false,
  "error": {
    "code": "INSUFFICIENT_ROLE",
    "message": "Your role does not have access to this resource",
    "details": { "requiredRoles": ["admin"], "yourRole": "contestant" }
  },
  "requestId": "9f1c2c7e-..."
}
```

Three rules:

1. **Branch on `error.code`, never on `error.message`.** Messages are for humans
   and will be reworded and translated.
2. `details` is optional. On validation errors it is an array of
   `{ field, message }`, which maps directly onto form field errors.
3. `requestId` also comes back in the `X-Request-Id` header. Quote it when
   reporting a bug — it appears verbatim in the server logs.

---

## 2. Authentication model

Two tokens with different jobs:

- **Access token** — a JWT, 15 minutes, sent as `Authorization: Bearer <token>`.
  Keep it in memory (a React context / store variable). Do **not** put it in
  `localStorage`: anything that can read `localStorage` can steal the session.
- **Refresh token** — an `httpOnly` cookie the browser stores and sends
  automatically. Your JavaScript cannot read it, and should not try.

The flow:

```
login    → access token (body) + refresh cookie (automatic)
requests → Authorization: Bearer <access token>
401 TOKEN_EXPIRED → POST /auth/refresh → new access token, cookie rotated
refresh fails     → send the user to /login
logout   → POST /auth/logout, then clear client state
```

### Requests that must send the cookie

`/auth/login`, `/auth/refresh` and `/auth/logout` need
`credentials: 'include'` (fetch) or `withCredentials: true` (axios). Without
it the browser silently drops the refresh cookie and refresh will always fail
with `REFRESH_TOKEN_MISSING`.

Your dev origin must also be listed in `CORS_ORIGINS` in the backend `.env` —
`http://localhost:5173` and `http://localhost:3000` are there by default. A
wildcard origin is impossible here: cookies require an explicit allow-list.

### One refresh at a time

Every refresh rotates the token, and **replaying an already-rotated token
revokes the whole session** — the system treats it as a stolen token. So if
three requests 401 at once, do not fire three refreshes: queue them behind a
single in-flight refresh promise. There is an example in §6.

---

## 3. Roles

| Role | Value | Notes |
| --- | --- | --- |
| Admin | `admin` | Manages accounts. Created by the seed script |
| Contestant | `contestant` | Default role for new accounts |
| Judge | `judge` | |

There is no public sign-up. Admins create contestant and judge accounts through
`POST /users`.

Role checks run server-side on every request. Hiding a menu item is a courtesy
to the user; it is not what protects the endpoint.

---

## 4. Endpoints

Legend: **public** = no token · **auth** = any logged-in user · **admin** = admin only

### Auth

#### `POST /auth/login` — public

```json
{ "email": "admin@acs.local", "password": "ChangeMe!2026" }
```

`200`:

```json
{
  "success": true,
  "data": {
    "user": {
      "id": "66f0...",
      "name": "ACS Admin",
      "email": "admin@acs.local",
      "role": "admin",
      "isActive": true,
      "lastLoginAt": "2026-09-02T10:00:00.000Z",
      "createdAt": "2026-09-01T08:00:00.000Z",
      "updatedAt": "2026-09-02T10:00:00.000Z"
    },
    "accessToken": "eyJhbGciOi...",
    "tokenType": "Bearer",
    "expiresIn": "15m"
  }
}
```

The refresh token is **not** in the body — it is in the `Set-Cookie` header.

Errors: `400 VALIDATION_ERROR` · `401 INVALID_CREDENTIALS` ·
`403 ACCOUNT_DISABLED` · `429 RATE_LIMITED`

A wrong password and an unknown email return the **identical** 401, on purpose:
different messages would turn the login form into an account-enumeration tool.
Show one message for both: *"Email or password is incorrect."*

#### `POST /auth/refresh` — public (needs the cookie)

No body required. Returns the same payload as login, with a new access token,
and rotates the cookie.

Errors: `401 REFRESH_TOKEN_MISSING` · `401 REFRESH_TOKEN_INVALID` ·
`401 SESSION_REVOKED` · `401 ACCOUNT_DISABLED`

Any of these means the same thing to the client: **go to the login screen.**

#### `POST /auth/logout` — public, idempotent

Revokes the session and clears the cookie. Always `200`, even with no valid
token — the client's goal is "be logged out", and afterwards it is.

#### `POST /auth/logout-all` — auth

Ends every session for the caller, on all devices.
`200` → `{ "message": "...", "revokedSessions": 3 }`

#### `GET /auth/me` — auth

`200` → `{ "user": { ... } }`. Call this on app boot to rehydrate auth state.

#### `GET /auth/sessions` — auth

The caller's active sessions, for a "where am I logged in" screen.

```json
{ "success": true, "data": [
  { "id": "...", "current": true, "userAgent": "Mozilla/5.0 ...",
    "ip": "::1", "createdAt": "...", "expiresAt": "..." }
]}
```

#### `PATCH /auth/password` — auth

```json
{ "currentPassword": "OldPass!2026", "newPassword": "NewPass!2026" }
```

On success **every session is terminated, including the current one.** Send the
user to the login screen after this call — do not try to keep them signed in.

Errors: `400 VALIDATION_ERROR` · `401 INVALID_CREDENTIALS` (wrong current password)

### Users — admin surface

| Method | Path | Access | Purpose |
| --- | --- | --- | --- |
| `POST` | `/users` | admin | Create a contestant, judge or admin |
| `GET` | `/users` | admin | List, paginated and filterable |
| `GET` | `/users/:id` | admin **or self** | Read one account |
| `PATCH` | `/users/:id` | admin | Update name, email or role |
| `PATCH` | `/users/:id/status` | admin | Enable / disable |
| `PATCH` | `/users/:id/password` | admin | Reset someone's password |
| `DELETE` | `/users/:id` | admin | Delete an account |

`POST /users` body:

```json
{ "name": "Sara Ahmed", "email": "sara@acs.local",
  "password": "Passw0rd!2026", "role": "contestant" }
```

`201` → `{ "user": { ... } }`. Errors: `400 VALIDATION_ERROR` ·
`409 EMAIL_ALREADY_EXISTS` · `403 INSUFFICIENT_ROLE`

`GET /users` query parameters:

| Param | Default | Notes |
| --- | --- | --- |
| `page` | `1` | |
| `limit` | `20` | max 100 |
| `role` | — | `admin` · `contestant` · `judge` |
| `isActive` | — | `true` · `false` |
| `search` | — | case-insensitive match on name or email |
| `sort` | `-createdAt` | `createdAt` · `-createdAt` · `name` · `-name` |

Response: `data.users` plus a `meta` block with `page`, `limit`, `total`,
`totalPages`, `hasNextPage`, `hasPrevPage`.

Safety rails, so nobody locks everyone out: an admin cannot change their own
role, disable themselves, or delete themselves, and the **last active admin**
cannot be demoted, disabled or deleted (`409 LAST_ADMIN`).

Disabling an account or resetting its password revokes that user's sessions
immediately.

### Health

`GET /api/v1/health` — public. Returns uptime and database connection state.
`GET /health` — plain liveness probe for load balancers.

---

## 5. Error codes

Password policy for any **new** password: at least 8 characters, with a
lowercase letter, an uppercase letter and a digit. Login does not apply the
policy — an older account must still be able to sign in and change its password.

### 400 — the request itself is wrong

| Code | Meaning |
| --- | --- |
| `VALIDATION_ERROR` | Failed schema validation. `details` is `[{ field, message }]` |
| `BAD_REQUEST` | Valid shape, invalid operation |
| `CANNOT_MODIFY_SELF` | An admin tried to change their own role/status, or delete themselves |

Unknown fields are **rejected**, not ignored: posting an extra key returns a
`VALIDATION_ERROR`. This is what stops a client from smuggling `role: "admin"`
into an endpoint that never meant to accept it.

### 401 — we do not know who you are → refresh, or log in

| Code | What the client should do |
| --- | --- |
| `AUTH_REQUIRED` | No token sent → log in |
| `INVALID_CREDENTIALS` | Wrong email/password → show the form error |
| `TOKEN_EXPIRED` | **Refresh, then retry the original request** |
| `TOKEN_INVALID` | Token is malformed or forged → log in |
| `REFRESH_TOKEN_MISSING` | No cookie (often a missing `credentials: 'include'`) → log in |
| `REFRESH_TOKEN_INVALID` | Unknown refresh token → log in |
| `SESSION_REVOKED` | Logged out elsewhere, or token reuse detected → log in |
| `PASSWORD_CHANGED` | Password changed after this token was issued → log in |

### 403 — we know who you are, and the answer is no

| Code | Meaning |
| --- | --- |
| `FORBIDDEN` | Not allowed (e.g. reading another user's record) |
| `INSUFFICIENT_ROLE` | Wrong role. `details.requiredRoles` lists what is needed |
| `ACCOUNT_DISABLED` | The account was disabled by an admin |

**Never refresh on a 403.** The token is fine; the permission is not. Retrying
just loops.

### 404 / 409 / 413 / 429 / 500

| Code | Status | Meaning |
| --- | --- | --- |
| `NOT_FOUND` | 404 | Unknown route |
| `USER_NOT_FOUND` | 404 | No such user |
| `CONFLICT` | 409 | Generic conflict |
| `EMAIL_ALREADY_EXISTS` | 409 | Email is taken |
| `LAST_ADMIN` | 409 | Would leave the platform with no active admin |
| `PAYLOAD_TOO_LARGE` | 413 | Body over the limit |
| `RATE_LIMITED` | 429 | Too many requests. Login: 10 failures / 15 min per IP+email |
| `INTERNAL_ERROR` | 500 | Server-side bug. Report the `requestId` |

### Reserved for the file-storage module

These are defined in `src/constants/errorCodes.js` and thrown by the storage
module, so upload failures arrive in the same envelope as everything else:

| Code | Suggested status |
| --- | --- |
| `FILE_REQUIRED` | 400 |
| `FILE_TOO_LARGE` | 413 |
| `UNSUPPORTED_FILE_TYPE` | 415 |
| `CORRUPT_ARCHIVE` | 400 |
| `UPLOAD_FAILED` | 500 |
| `STORAGE_UNAVAILABLE` | 503 |

---

## 6. Frontend integration

### An API client with a single-flight refresh

```js
const API = 'http://localhost:5000/api/v1';

let accessToken = null;            // in memory only — never localStorage
let refreshPromise = null;         // ensures ONE refresh at a time

export const setAccessToken = (token) => { accessToken = token; };

async function refreshTokens() {
  // Concurrent 401s share one refresh. Firing several would replay a rotated
  // token, which the backend treats as theft and kills the whole session.
  refreshPromise ??= fetch(`${API}/auth/refresh`, {
    method: 'POST',
    credentials: 'include',
  })
    .then(async (response) => {
      const body = await response.json();
      if (!response.ok) throw body.error;
      accessToken = body.data.accessToken;
      return body.data;
    })
    .finally(() => { refreshPromise = null; });

  return refreshPromise;
}

export async function api(path, options = {}) {
  const send = () =>
    fetch(API + path, {
      ...options,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...options.headers,
      },
    });

  let response = await send();
  let body = response.status === 204 ? null : await response.json();

  // Retry once, and only for an expired access token.
  if (response.status === 401 && body?.error?.code === 'TOKEN_EXPIRED') {
    try {
      await refreshTokens();
      response = await send();
      body = response.status === 204 ? null : await response.json();
    } catch {
      accessToken = null;
      window.location.assign('/login');
      throw new Error('Session expired');
    }
  }

  if (!response.ok) throw Object.assign(new Error(body.error.message), body.error);
  return body.data;
}
```

### Login

```js
const { user, accessToken } = await api('/auth/login', {
  method: 'POST',
  body: JSON.stringify({ email, password }),
});
setAccessToken(accessToken);
```

### Restoring the session on page load

The access token lives in memory, so a refresh of the page loses it — but the
refresh cookie survives. On boot:

```js
try {
  const { user } = await refreshTokens();   // cookie does the work
  setUser(user);
} catch {
  setUser(null);                            // not logged in
}
```

### Protecting a route by role

Use the role from `/auth/me` or the login response for **rendering** decisions.
The backend independently enforces the same rule, so a user who edits their
client state gets a `403` rather than access.

```jsx
function RequireRole({ role, children }) {
  const { user, loading } = useAuth();
  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace />;
  if (role && user.role !== role) return <Navigate to="/forbidden" replace />;
  return children;
}
```

### Mapping errors to the UI

```js
const MESSAGES = {
  INVALID_CREDENTIALS: 'Email or password is incorrect.',
  ACCOUNT_DISABLED:    'This account has been disabled. Contact an administrator.',
  RATE_LIMITED:        'Too many attempts. Please wait a few minutes.',
  INSUFFICIENT_ROLE:   'You do not have access to this page.',
};

// Field-level errors from a 400 map straight onto form inputs:
// error.details === [{ field: 'email', message: 'Email format is invalid' }]
```

---

## 7. Adding a module

For the submissions, files, judging and scoring modules. The foundation does not
change; you add one folder and one line.

```
src/modules/submissions/
├── submission.routes.js
├── submission.controller.js
├── submission.service.js
└── submission.validation.js
```

```js
// submission.routes.js
import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize, adminOnly } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ROLES } from '../../constants/roles.js';
import * as controller from './submission.controller.js';
import { createSubmissionSchema } from './submission.validation.js';

const router = Router();
router.use(authenticate);                       // everything below needs a login

router.post(
  '/',
  authorize(ROLES.CONTESTANT),                  // role check, server-side
  validate({ body: createSubmissionSchema }),   // input check
  asyncHandler(controller.create),              // async errors reach the handler
);

router.get('/', authorize(ROLES.ADMIN, ROLES.JUDGE), asyncHandler(controller.list));

export default router;
```

Then one line in `src/routes/index.js`:

```js
router.use('/submissions', submissionRoutes);
```

Six things to keep to, so the API stays coherent:

1. **Wrap every async handler in `asyncHandler`.** Express 4 does not await
   handlers; an unwrapped rejection hangs the request.
2. **Throw `ApiError`, never `res.status(400).json(...)`.**
   `throw ApiError.notFound('Submission not found')` — the error handler builds
   the envelope. Anything that is not an `ApiError` is treated as a bug and
   returned as a bare 500.
3. **Add new codes to `src/constants/errorCodes.js`** and to §5 above, so the
   frontend can branch on them.
4. **Reply with `sendSuccess` / `sendCreated` / `sendNoContent`** from
   `utils/apiResponse.js`, not raw `res.json`.
5. **Never trust `req.body` for identity or ownership.** The authenticated user
   is `req.user`; a contestant creating a submission owns it because
   `req.user.id` says so, not because the body claims it.
6. **Check ownership in the service, not the route.** `authorize()` handles
   roles. "Is this contestant's submission theirs?" needs the loaded document,
   so it belongs where the document is loaded.

### For the file-storage module specifically

- `Submission` (`src/models/submission.model.js`) is a **placeholder**, added
  only so file records have something to reference. Extend or replace it freely.
- The upload error codes in §5 are already defined — throw them via `ApiError`
  and uploads will fail in the same envelope as everything else.
- `req.user` is available in any route mounted after `authenticate`, so file
  ownership can be derived from `req.user.id` without trusting the request body.
- Do not return absolute filesystem paths in responses. Return an opaque file id
  and serve downloads through a route that re-checks authorization.
