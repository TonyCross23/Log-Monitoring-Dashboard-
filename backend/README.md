# Log Monitoring Backend

This folder is an independent npm package with its own `package.json`, `package-lock.json` and dependencies. Run its installation, development, test and build commands from this folder.

A runnable Node.js 24 / TypeScript backend using Express 5, Zod 4, Prisma 7 and PostgreSQL. All authored TypeScript uses strict mode and avoids `any`. The Prisma-generated client and library declaration files are external code.

## Architecture and folder structure

Requests flow through **Controller → Service → Repository → PostgreSQL**. Each feature keeps its controller, service, validation schemas, domain types and repository contracts together under `src/features/`. Dependency direction still points inward: services use domain interfaces; Prisma, Express, Zod, JWT and bcrypt stay in the outer layers. `composition-root.ts` supplies concrete implementations. Services can be tested without HTTP or a database.

```text
.
├── prisma/
│   ├── schema.prisma
│   └── migrations/                 # Checked-in initial SQL migration
├── src/
│   ├── features/
│   │   ├── auth/
│   │   │   ├── auth.controller.ts  # HTTP requests and responses
│   │   │   ├── auth.service.ts     # Authentication business rules
│   │   │   ├── auth.schemas.ts     # Zod request validation
│   │   │   ├── auth.types.ts       # User/session domain types
│   │   │   ├── auth.ports.ts       # Repository and security interfaces
│   │   │   ├── repositories/
│   │   │   │   ├── prisma-user.repository.ts
│   │   │   │   └── prisma-refresh-session.repository.ts
│   │   │   ├── security/
│   │   │   │   ├── jwt-token-provider.ts
│   │   │   │   └── bcrypt-password-hasher.ts
│   │   │   └── middleware/auth.middleware.ts
│   │   ├── projects/
│   │   │   ├── project.controller.ts
│   │   │   ├── project.service.ts
│   │   │   ├── project.schemas.ts
│   │   │   ├── project.ts          # Project domain types
│   │   │   ├── project.repository.ts
│   │   │   ├── repositories/prisma-project.repository.ts
│   │   │   └── middleware/api-key.middleware.ts
│   │   └── logs/
│   │       ├── log.controller.ts
│   │       ├── log.service.ts
│   │       ├── log.schemas.ts
│   │       ├── log.ts              # Log/JSON domain types
│   │       ├── log.repository.ts
│   │       └── repositories/prisma-log.repository.ts
│   ├── shared/
│   │   ├── errors/app-error.ts
│   │   ├── database/prisma.ts      # PostgreSQL adapter and bounded connection pool
│   │   ├── middleware/
│   │   │   ├── cookie-origin.middleware.ts
│   │   │   ├── content-type.middleware.ts
│   │   │   ├── error-handler.middleware.ts
│   │   │   └── request-context.middleware.ts
│   │   ├── validation/postgres-string.ts
│   │   └── logger.ts               # Structured logging and credential redaction
│   ├── config/                     # Validated environment configuration
│   ├── types/express.d.ts           # Typed authenticated request context
│   ├── generated/prisma/            # Generated locally; ignored in source control
│   ├── composition-root.ts         # Dependency construction
│   ├── app.ts                      # Routes and HTTP middleware
│   └── server.ts                   # Startup checks and graceful shutdown
├── tests/                          # Unit, HTTP security and PostgreSQL integration tests
├── prisma.config.ts
├── compose.yaml                    # Development database
├── Dockerfile                      # Compiled, non-root application image
└── .env.example
```

Within each feature, controllers validate incoming body/query/params and serialize responses. Services own ownership checks, authentication rules, rotation and pagination. Repository interfaces define persistence contracts; the feature's `repositories/` directory contains Prisma implementations that own SQL queries and atomic persistence. Feature-specific guards live alongside their feature, while common HTTP middleware, database setup, errors and validation helpers live in `shared/`. Services never receive an Express request or Prisma client.

## Start locally

Install Node.js 24 and Docker, then:

```sh
npm ci
cp .env.example .env
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Put the two different outputs into `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` in `.env`. Set `CORS_ORIGINS` to your dashboard's exact origin. The example targets `http://localhost:3000`. Each secret must contain at least 64 characters; the generation command produces 96 random hexadecimal characters. Empty secrets deliberately prevent startup.

```sh
docker compose up -d --wait postgres
npm run db:generate
npm run db:deploy
npm run dev
```

The API listens on port 3001. `db:deploy` applies the checked-in migration. Use `npm run db:migrate -- --name descriptive_change` when changing the Prisma schema in development. Prisma 7 keeps the connection URL in `prisma.config.ts` and uses `@prisma/adapter-pg` at runtime. [Prisma 7 configuration](https://www.prisma.io/docs/guides/upgrade-prisma-orm/v7).

For compiled execution:

```sh
npm run build
npm start
```

## HTTP API

| Method | Path | Security | Purpose |
| --- | --- | --- | --- |
| POST | `/api/v1/auth/register` | CSRF header | Register email, name and password |
| POST | `/api/v1/auth/login` | CSRF header | Return access JWT and set refresh cookie |
| POST | `/api/v1/auth/refresh` | Refresh cookie + CSRF header | Rotate refresh JWT and issue access JWT |
| POST | `/api/v1/auth/logout` | Refresh cookie + CSRF header | Revoke login family and expire cookie |
| GET | `/api/v1/auth/me` | Bearer access JWT | Read current user |
| POST | `/api/v1/projects` | Bearer access JWT | Create project and return API key once |
| GET | `/api/v1/projects` | Bearer access JWT | List owned projects, `limit=1..100` |
| POST | `/api/v1/logs` | `X-API-Key` | Persist one validated log |
| GET | `/api/v1/projects/:projectId/logs` | Bearer access JWT + ownership | Filter and paginate logs |
| GET | `/health/live` | Public | Process liveness |
| GET | `/health/ready` | Public | Database readiness; returns 503 when unavailable |

JSON body routes require `Content-Type: application/json`. Unknown fields are rejected. Auth POST requests also require `X-CSRF-Protection: 1`. Browser origins must match the configured allowlist exactly. Refresh/logout accept an empty body or `{}`. Authentication responses and API responses use `Cache-Control: no-store`.

Example registration and login; `cookies.txt` is a local secret and should never be committed:

```sh
curl -X POST http://localhost:3001/api/v1/auth/register \
  -H 'Content-Type: application/json' -H 'X-CSRF-Protection: 1' \
  -d '{"email":"engineer@example.com","name":"Engineer","password":"use a unique long password"}'

curl -X POST http://localhost:3001/api/v1/auth/login \
  -H 'Content-Type: application/json' -H 'X-CSRF-Protection: 1' \
  -c cookies.txt \
  -d '{"email":"engineer@example.com","password":"use a unique long password"}'
```

Login/refresh returns `{ "data": { "user": { ... }, "accessToken": "...", "tokenType": "Bearer", "expiresIn": 900 } }`. The refresh JWT appears only in the HTTP-only cookie. Password hashes never appear in responses. Registration returns the public user; login is a separate request.

```sh
curl -X POST http://localhost:3001/api/v1/auth/refresh \
  -H 'X-CSRF-Protection: 1' -b cookies.txt -c cookies.txt

curl -X POST http://localhost:3001/api/v1/projects \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"Payments API"}'

curl -X POST http://localhost:3001/api/v1/logs \
  -H "X-API-Key: $PROJECT_API_KEY" -H 'Content-Type: application/json' \
  -d '{"level":"ERROR","message":"Payment request failed","stackTrace":"Error: upstream timeout","metadata":{"requestId":"req-123","retry":false}}'

curl --get "http://localhost:3001/api/v1/projects/$PROJECT_ID/logs" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  --data-urlencode 'level=ERROR' --data-urlencode 'limit=50' \
  --data-urlencode 'search=Payment request' \
  --data-urlencode 'from=2026-10-14T00:00:00Z' \
  --data-urlencode 'to=2026-10-14T23:59:59Z'

curl -X POST http://localhost:3001/api/v1/auth/logout \
  -H 'X-CSRF-Protection: 1' -b cookies.txt -c cookies.txt
```

Set `ACCESS_TOKEN`, `PROJECT_API_KEY` and `PROJECT_ID` from the login/project responses. Project creation returns `{ "data": { "project": { ... }, "apiKey": "lmd_..." } }`; copy the key immediately. Listing projects exposes its display prefix only. The key grants ingestion into its project and is intended for trusted server-side producers.

In a browser, keep the access token in memory and set `credentials: 'include'` on auth requests. Send `X-CSRF-Protection: '1'` for auth POST requests. Refresh requests must be serialized across tabs, for example using the Web Locks API or coordinated client state: replaying a consumed refresh token deliberately revokes the entire login family. A same-site frontend works with the default `SameSite=Strict`; a genuinely cross-site frontend requires `COOKIE_SAME_SITE=none` and `COOKIE_SECURE=true`, plus an exact HTTPS origin allowlist.

## Log validation and pagination

Levels are `TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR`, `FATAL`. Messages are nonblank and limited to 16 KiB UTF-8. Stack traces are optional and limited to 64 KiB. Metadata is an optional JSON object, limited to 64 KiB serialized, depth 20 and 10,000 nodes. Strings and metadata keys reject NUL and malformed Unicode to avoid PostgreSQL text/JSONB failures. Total uncompressed request bodies are limited to 256 KiB; compressed bodies are rejected.

Log filters are `level`, `search`, `from`, `to`, `limit`, `cursor`. Timestamps must be ISO 8601 with a timezone; the time interval is inclusive and `from <= to`. Search is a case-insensitive literal substring of `message`, at most 200 characters. Limits default to 50 and cap at 100. Logs order by `createdAt DESC, id DESC`, with both fields in the keyset boundary; identical timestamps do not lose records.

```json
{
  "data": {
    "items": [
      {"id":"...","projectId":"...","level":"ERROR","message":"...","stackTrace":null,"metadata":null,"createdAt":"..."}
    ],
    "pagination": {"limit":50,"hasMore":true,"nextCursor":"..."}
  }
}
```

Pass `nextCursor` with the same filters to get the next page; `null` means the final page. Cursors are opaque, size-bounded, validated and scoped to one project. They are pagination boundaries, not authorization credentials. Another owner's project returns 404 before querying logs. Keyset pagination is stable for ingestion with database-assigned timestamps, but is not a snapshot across requests.

Errors consistently return a safe code, message and request ID:

```json
{"success":false,"error":{"code":"VALIDATION_ERROR","message":"Request validation failed","details":[{"path":"level","code":"invalid_value","message":"..."}]},"requestId":"..."}
```

Responses use 400 for invalid input, 401 for invalid credentials, 403 for origin/CSRF rejection, 404 for missing/unowned projects, 409 for duplicate email, 413 for oversized bodies, 415 for unsupported content and 429 for rate limiting. Unexpected errors return a generic 500; details remain in server logs.

## Authentication and persistence

Access JWTs default to 15 minutes and cannot be configured above 15 minutes. Refresh JWTs default to 30 days with an absolute lifetime that rotation cannot extend. Token verification pins HS256, issuer, distinct audiences and signing keys, token purpose, UUID identity/session claims and expiration. Passwords require at least 12 characters when registering and at most 72 UTF-8 bytes to prevent bcrypt truncation; bcrypt defaults to cost 12. Login runs a bcrypt comparison even when the email is unknown.

The schema includes `User`, `Project`, `Log`, `RefreshTokenFamily` and `RefreshSession`. Extra session models provide persistent revocation and replay detection. A login creates a family and hashed session. Rotation locks that family's row, checks revocation/expiry, consumes the previous session and creates its successor in one transaction. Reuse commits family revocation before the service returns 401. Logout obtains the same lock, preventing a concurrent rotation from restoring a revoked family. Each lock wait is bounded by database/transaction timeouts.

Refresh JWTs and cryptographically random 256-bit API keys are stored only as SHA-256 hashes. Production refresh cookies are named `__Secure-refresh_token` and are secure, HTTP-only, host-only and scoped to `/api/v1/auth`. Logout and replay revoke refresh sessions; already-issued stateless access JWTs remain valid until their short expiry. [OAuth security guidance on rotation/replay](https://www.rfc-editor.org/rfc/rfc9700.html#section-4.14), [JWT verification options](https://github.com/auth0/node-jsonwebtoken#jwtverifytoken-secretorpublickey-options-callback), [OWASP CSRF guidance](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html).

## Verification

```sh
npm run typecheck
npm test
npm run build
npm audit --omit=dev
```

Unit and HTTP security tests run without a database. PostgreSQL tests skip unless `TEST_DATABASE_URL` is set. They refuse databases whose names do not end in `_test`. They clean up only user IDs created by their own test run, cascading those users' projects/logs/sessions.

Create an isolated PostgreSQL database, then:

```sh
DATABASE_URL="$TEST_DATABASE_URL" npm run db:deploy
TEST_DATABASE_URL="$TEST_DATABASE_URL" npm run test:integration
```

The database suite exercises duplicate-registration races, simultaneous refreshes and committed replay revocation, refresh/logout races, expiry during lock waits, real cookie rotation, hashed credentials, log ingestion, owner isolation and pagination with identical timestamps. HTTP tests cover origins/CSRF, malformed/oversized JSON, token confusion, schema bounds, cookies, readiness and spoof-resistant rate limiting.

## Deployment

Set `NODE_ENV=production`, unique secret-manager-provided JWT secrets, `COOKIE_SECURE=true`, exact HTTPS `CORS_ORIGINS` and a PostgreSQL URL with TLS verification appropriate to your provider. Terminate HTTPS at a trusted ingress; set `TRUST_PROXY` to only that proxy's IP/CIDR. Apply `npm run db:deploy` in a separate deployment migration job before starting replicas. The server checks the database before listening, exposes readiness, and handles SIGTERM/SIGINT with a 10-second shutdown deadline. The supplied Docker image runs compiled JavaScript as a non-root user.

```sh
docker build -t log-monitoring-backend .
# Supply environment variables via your deployment platform or a protected env file.
docker run --env-file .env.production -p 3001:3001 log-monitoring-backend
```

The local Compose database credentials are for development. Runtime logging records method/path/status/request IDs and redacts sensitive values; request bodies, query values and authentication headers are omitted. Request limits are currently per process: 1,200/minute globally per client IP, 20/15 minutes shared by registration/login, 120/15 minutes shared by refresh/logout, and 1,000/minute per authenticated project for ingestion. For multiple replicas, enforce aggregate limits at your ingress or supply a shared rate-limit store.

Before operating at sustained high log volumes, configure a retention job/partition strategy, quotas, backups and alerts appropriate to your deployment. Expired refresh families can be deleted after their absolute expiry (sessions cascade); retain consumed sessions until then to preserve replay detection. Indexed project/time/level queries support the current API. Literal substring search may scan many rows; provision a PostgreSQL `pg_trgm` index or dedicated search service when measured traffic requires it. API-key rotation/revocation, email verification, password reset and billing/quotas are extensions beyond the requested endpoints.

Dependency overrides pin patched `deepmerge-ts` and `mysql2` versions pulled in by the Prisma toolchain. Keep the lockfile, rerun the audit and the full suite when upgrading dependencies.
