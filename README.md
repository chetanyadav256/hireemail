# HireReach AI

A job outreach platform being built around resume-grounded emails and explicit user approval. This repository implements the MERN foundation, session authentication, and Phase 2 HR contact import/management.

## Implemented now

- React/Vite dashboard, Tailwind CSS, responsive sidebar/top navigation and React Router.
- Dashboard connection status with retry; a working Contacts dashboard; Resume, Campaigns and Settings placeholders.
- Reusable Axios client, shared health-response schema and a local Vite API proxy.
- Express, Mongoose, dotenv validation, exact-origin CORS, Helmet, bounded JSON parsing and centralized JSON errors.
- Health endpoints, database-before-listen startup, replica-set validation and graceful shutdown.
- npm workspaces, ESLint, Vitest/Supertest, Playwright, an OpenAPI contract and CI.
- User registration/login/logout and current-user endpoints with Argon2id password hashes, MongoDB-backed opaque sessions, HttpOnly cookies, CSRF/origin checks, durable authentication rate limits, and protected frontend routes.

CSV/XLSX/XLS import, automatic/manual column mapping, cleaned previews, explicit save, owner-scoped contacts, search/filter/pagination, editing, soft deletion/restoration, temporary selection, statistics and import history are implemented.

Email verification, password reset, account settings, PDF uploads, AI, OAuth, campaign persistence and email sending are **not implemented**. Dashboard activity totals are placeholders; only connection status comes from the API.

## Requirements and setup

Use Node.js **22.23.3+ in the 22.x line** (or Node 24 LTS) and npm 11+. `.nvmrc` pins the tested Node 22.23.3 runtime. The original local Node 20.15 installation is too old for the selected tools; upgrade/select a supported runtime before installing. Check with `node --version` and `npm --version`. Engine requirements are enforced to avoid partially installing unsupported tooling.

After selecting the supported Node runtime, install npm 11 if needed with `npm install --global npm@11.21.1`. Phase 2 verification used Node 24.22.0 and npm 11.21.1.

Run from the repository root:

```sh
npm ci
```

Copy environment templates in PowerShell:

```powershell
Copy-Item server/.env.example server/.env
Copy-Item client/.env.example client/.env
```

On macOS/Linux, use `cp` instead of `Copy-Item`. Edit `server/.env` with your own MongoDB connection string. There are no real credentials in the templates. Environment files are ignored by Git; never place secrets in `VITE_` variables. Server dotenv loading resolves `server/.env` relative to the module, independent of the working directory. `NODE_ENV=test` skips local dotenv loading so tests cannot pick up application credentials.

The default connection is `mongodb://127.0.0.1:27017/hirereach_ai?replicaSet=rs0`. Use an existing replica set/Atlas cluster, or initialize a local replica set with installed MongoDB tools. For a fresh local database on Windows:

```powershell
New-Item -ItemType Directory -Force .local/mongodb-dev
mongod --dbpath .local/mongodb-dev --replSet rs0 --bind_ip 127.0.0.1 --port 27017
```

Leave that terminal running. In a second terminal, initialize **only that fresh local instance** once:

```powershell
mongosh 'mongodb://127.0.0.1:27017/admin?directConnection=true' --eval "rs.initiate({_id:'rs0',members:[{_id:0,host:'127.0.0.1:27017'}]})"
```

If port 27017 is already occupied, choose another unused port and update both the replica-set member address and `MONGODB_URI`. Do not reinitialize an existing database. Production deployment and secrets are outside this milestone.

Start client and server together:

```sh
npm run dev
```

Open **http://localhost:5173**. The API listens on port **5000**. Alternatively run `npm run dev:client` and `npm run dev:server` in separate terminals. Nodemon restarts server source changes; restart manually after changing `.env`. The backend exits unsuccessfully if configuration, database connectivity/topology, or HTTP listening fails. Combined development stops both processes if either command exits. The client alone still renders the dashboard with an unavailable-connection message.

The API binds to `127.0.0.1` by default. `HOST=0.0.0.0` is an explicit deployment setting for a future container/reverse proxy; it is not needed for local development. Runtime configuration currently includes only `NODE_ENV`, `HOST`, `PORT`, `APP_ORIGIN`, `MONGODB_URI` and `MONGODB_TIMEOUT_MS`; future integration credentials are deliberately absent.

## Commands and health checks

| Command | Purpose |
| --- | --- |
| `npm run dev` | Client and nodemon API together |
| `npm run lint` | JavaScript/JSX checks |
| `npm test` | Auth/contact API, parser/cleaning, environment and startup tests; real database integration tests skip without `TEST_MONGODB_URI` |
| `npm run build` | Production frontend build in `client/dist/` |
| `npm run check` | Lint, tests and frontend build |
| `npm start` | API without nodemon; configure MongoDB first |
| `npm run preview` | Local frontend build preview at port 4173; not a production web server |
| `npx playwright install chromium` | Install the browser used by UI checks |
| `npm run test:e2e` | Desktop/mobile auth, navigation, import, search, selection and edit/delete/restore checks using mocked HTTP responses; the live-API test is gated separately |
| `npm run migrate:contacts --workspace server` | Apply reviewed contact/import unique and TTL indexes |

```powershell
Invoke-RestMethod http://localhost:5000/api/health
Invoke-RestMethod http://localhost:5000/api/v1/health/ready
```

`GET /api/health`, `/api/v1/health` and `/api/v1/health/live` return `{"data":{"status":"ok","service":"hirereach-api"}}`. `/api/v1/health/ready` also pings MongoDB and returns 503 if unavailable. Liveness stays available during a later database outage. Authentication endpoints are `/api/v1/auth/csrf`, `/register`, `/login`, `/logout` and `/me`; mutation requests require the CSRF token from `/csrf` in `X-CSRF-Token` and the configured `Origin`. See [OpenAPI](docs/openapi.yaml).

### Authentication

Authentication requires the configured MongoDB replica set/Atlas database; the API does not substitute process memory or browser storage when MongoDB is unavailable. Set `MONGODB_URI` as described above, then run `npm run dev`. Production cookie mode requires HTTPS and uses a `__Host-` prefix, `Secure`, `HttpOnly`, `SameSite=Lax` and `Path=/`. Opaque sessions and hashed rate-limit buckets live in MongoDB; sessions have a 24-hour idle expiry and a 7-day absolute expiry. Session expiry is checked in application code, not only by the asynchronous TTL index. CSRF tokens are returned only by the CSRF endpoint and held in browser memory.

For a production database, apply the reviewed authentication indexes before deploying the API:

```sh
npm run migrate:auth --workspace server
```

The migration uses the configured `MONGODB_URI`, creates the unique normalized-email/session/rate-limit indexes and session/rate-limit TTL indexes, and does not modify user data.

Register at **http://localhost:5173/register** with a name, email, and password of at least 12 characters; then sign in at **http://localhost:5173/login**. A successful sign-in opens the protected dashboard. Use **Log out** to revoke the session. Registration deliberately returns the same response for new and duplicate accounts; sign-in errors do not distinguish an unknown email from an incorrect password.

Service-independent authorization tests inject synthetic repositories; the runtime uses Mongoose only. Optional real-database tests cover persisted auth sessions, transactions and the full contact API when `TEST_MONGODB_URI` points to a dedicated replica-set test database. Never point this variable at application data: integration tests create indexes and synthetic records and clean test rate-limit buckets.

To run the optional real-database transaction check against a dedicated **test** database:

```powershell
$env:TEST_MONGODB_URI = 'mongodb://127.0.0.1:27017/hirereach_setup_test?replicaSet=rs0'
npm test
Remove-Item Env:TEST_MONGODB_URI
```

Database tests verify transaction rollback, real authentication, tenant isolation, concurrent imports, commit replay, editing, soft deletion, pagination and expiry. They clean their synthetic records. CI runs service-independent API/build/browser checks; database integration requires a provisioned isolated test replica set.

To verify the browser against a live local API, use a separate replica-set database ending in `_test`; never point either process at application or Atlas data. Start the API in one terminal with the same isolated URI:

```powershell
$env:NODE_ENV = 'test'
$env:HOST = '127.0.0.1'
$env:PORT = '5000'
$env:APP_ORIGIN = 'http://localhost:5173'
$env:MONGODB_URI = 'mongodb://127.0.0.1:27017/hirereach_live_api_test?replicaSet=rs0'
npm run dev:server
```

Then run the opt-in browser test in a second terminal:

```powershell
$env:TEST_MONGODB_URI = 'mongodb://127.0.0.1:27017/hirereach_live_api_test?replicaSet=rs0'
$env:RUN_LIVE_API_E2E = 'true'
npm run test:e2e -- tests/e2e/live-api.spec.js --project=desktop --workers=1
```

This guarded test rejects non-local, non-replica-set, or non-`_test` databases. It uses synthetic identities and `example.test` addresses, and cleans its records. It exercises live registration/login, CSV preview/commit and replay, stale-preview rejection, persisted contacts, pagination/search/filter/edit, cross-user denial, delete/restore, logout and protected-route redirection. The database-backed backend integration test also covers XLSX worksheet selection, preview and persistence. Do not use real contact data.

## Contact workflow and deployment

1. Sign in and open **Contacts → Import contacts**. Choose a UTF-8 comma-delimited CSV, XLSX or BIFF8 XLS. The first nonempty row is the header.
2. Review the suggested columns and worksheet. Email/HR Email/Recruiter Email, Company/Company Name, HR Name and Designation aliases are recognized. Unknown or ambiguous headers require manual mapping. Only email is required.
3. Select **Preview cleaned contacts**. Review valid, invalid, duplicate and skipped rows and reasons. Missing optional values are preserved. Syntax validation does not prove mailbox deliverability.
4. Select **Confirm and save** to persist valid contacts. Duplicate checks run again atomically; concurrent imports can reduce the saved count. Remapping invalidates the previous preview. Repeating the same completed commit returns its original result.
5. Search by name/email/company, filter by status/company, page through results, edit, delete or restore contacts. Deletion archives a contact and retains its duplicate identity. Checkbox selection stays only while the page is open and does not authorize email sending.
6. Reopen staged/completed imports from **Import history**. Previews expire 24 hours after upload; history remains for 90 days. Raw binaries are never persisted or downloaded.

Limits: 5 MiB per file; 5,000 data rows across at most 10 worksheets; 50 columns; 10,000 characters per cell; 25 MiB XLSX expansion; 8 MiB parsed staging. Parsing has a 10-second deadline and 128 MiB V8 heap. Each user has 10 upload attempts/hour, 120 contact requests/minute, five pending imports and 50,000 contacts including deleted entries. Company choices show up to 200 active companies; use text search for others. Tables paginate at 25 records (API maximum 100).

Apply both reviewed migrations against the configured database before production deployment:

```sh
npm run migrate:auth --workspace server
npm run migrate:contacts --workspace server
```

Contact migrations add unique owner/email and owner-state indexes, row uniqueness, query indexes and TTL indexes. Existing duplicate records make migration fail rather than silently delete data. Back up and review migrations before application rollout; production disables automatic index creation. A replica set is mandatory for atomic contact operations.

Uploads are authenticated and CSRF-protected before buffering, with bounded multipart parsing, signature checks, formula rejection and macro/encryption checks. A child parser receives no application secrets and has restricted filesystem access. Node permissions are not an OS sandbox: deployment still needs an unprivileged runtime, memory/CPU limits, controlled egress, proxy request limits/timeouts and a reviewed legacy-XLS risk policy. Antivirus scanning and retained-file quarantine are not implemented. Retained PDF/resume uploads must add that infrastructure in their own milestone.

## Current files

```text
client/src/
  app/ components/ lib/ styles/
  features/auth/ dashboard/ contacts/ resumes/ campaigns/ settings/
  features/contacts/{ContactsPage,ImportPanel,ContactComponents}.jsx
  features/contacts/contact-api.js
server/src/
  app.js server.js config/ middleware/
  modules/auth/ health/
  modules/contacts/{contact.model,contact.repository,contact.service,contact.routes}.js
  modules/imports/{import.model,clean,parse,parser,parser.child}.js
  infrastructure/migrations/{auth-indexes,contact-indexes}.js
  scripts/migrate-auth-indexes.js scripts/migrate-contact-indexes.js
server/tests/
  {app,auth,auth.integration,env,startup,database.integration}.test.js
  {contacts.parse,contacts.authorization,contacts.integration}.test.js
packages/contracts/src/{index,contacts}.js
tests/e2e/{workspace,contacts}.spec.js
docs/openapi.yaml docs/contacts.openapi.json
```

The root npm workspaces, lockfile, ESLint/Vitest/Playwright configuration, CI, environment examples and gitignore remain in place. Feature modules preserve route/service/repository boundaries. The server runs JavaScript directly; a production host serves `client/dist`, proxies `/api` to Express and falls back to `index.html` for SPA routes.

## Verification and remaining release gates

Latest local verification against a separate MongoDB replica set and synthetic data:

- `npm run check` passed: ESLint, **60 backend tests across 9 files**, and the production frontend build.
- `npm run test:e2e` passed: **14 desktop/mobile tests**; the two live-test project entries were skipped as intended because the opt-in flag was unset.
- The opt-in live browser/API test passed separately: registration/login, CSV preview/commit/replay, persisted contacts, pagination/search/filter/edit, cross-user denial, delete/restore, logout and protected-route redirection.
- Both auth and contact migrations succeeded; inspected unique and TTL indexes were present, and the isolated test database had no remaining user/contact/import/session/rate-limit records.
- `npm audit --omit=dev` reported **zero production dependency vulnerabilities**.
- `npx --yes @redocly/cli@1.34.5 lint docs/openapi.yaml --extends minimal` validated the OpenAPI contract, including its split contact-operation references.

XLSX worksheet selection, preview and commit persistence were verified in the database-backed backend suite. The normal application database and local secret files were not used.

Production Atlas connectivity, production migration rollout, physical TTL deletion timing, large-load/failover behavior, antivirus/OS containment and backup/deletion drills remain unverified. The live smoke test verifies local MongoDB persistence, not Atlas or production deployment. The production release gates in PLAN.md are still required; this milestone is not a public-production certification.

`npm audit --omit=dev` reports zero production dependency vulnerabilities. The existing full audit has 17 development-tree findings (10 moderate, 7 high), including the legacy nodemon watcher chain; no unrelated dependency downgrade was applied. Do not deploy development dependencies. Test database files and browser artifacts are retained only under ignored `.local/` and `test-results/`.

The spreadsheet dependency is SheetJS CE 0.20.3 from its [official distribution](https://docs.sheetjs.com/docs/getting-started/installation/nodejs/), pinned by the lockfile, rather than the older npm-registry release. Tailwind follows the [Vite plugin setup](https://tailwindcss.com/docs/installation/using-vite).

## Planned workflow

1. Register and log in. Email verification is not implemented yet.
2. Import CSV/XLSX/XLS contacts; map columns and preview accepted/rejected rows with reasons.
3. Upload a PDF resume, review extracted facts, and choose a desired role.
4. Create a campaign and generate resume-grounded email drafts.
5. Connect Gmail, review and edit drafts, select recipients, and approve exact versions.
6. Explicitly request sending; track individual submissions, failures, and uncertain outcomes.

## Stack and boundaries

- React, Vite, Tailwind CSS; JavaScript/JSX throughout.
- Node.js, Express, Mongoose, MongoDB replica set.
- Future private object storage for retained resume uploads; Google OAuth 2.0 and Gmail API for sending.
- Provider-neutral LLM integration; provider/model selection is deferred to implementation.
- Durable MongoDB operations initially; Redis/BullMQ scheduling in a later phase.

Each email has one recipient and the approved resume attachment. Approval is invalidated by relevant edits. Duplicate protection, conservative outreach limits, and tenant isolation are backend requirements. Gmail submission status does not establish delivery, opens, or replies.

## Planning documents

| Document | Purpose |
| --- | --- |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Components, folders, schemas, API contract, security, deployment |
| [PLAN.md](PLAN.md) | Ordered milestones with concrete acceptance checks |
| [AGENTS.md](AGENTS.md) | Repository rules for future implementation work |

Stop after Phase 2 contact management. Resume uploads, AI generation, OAuth, campaigns and sending require a separate implementation request.
