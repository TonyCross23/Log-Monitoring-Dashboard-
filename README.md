# Log Monitoring Dashboard

A responsive React dashboard and a separate Node.js API, both written in strict TypeScript. Each folder is an independent npm package with its own manifest, lockfile, dependencies and commands.

## Project structure

```text
.
├── frontend/                  # React + Vite dashboard
│   ├── package.json            # Frontend dependencies and scripts
│   ├── package-lock.json       # Frontend dependency lockfile
│   ├── src/
│   │   ├── features/          # Auth, projects, logs and dashboard data
│   │   ├── components/        # Dashboard components and shadcn/ui primitives
│   │   ├── stores/            # Zustand UI preferences
│   │   ├── lib/               # API client, Zod models and sample data
│   │   ├── app.tsx
│   │   ├── index.css          # Tailwind and design tokens
│   │   └── main.tsx
│   └── README.md
├── backend/                   # Express + Prisma + PostgreSQL API
│   ├── package.json            # Backend dependencies and scripts
│   ├── package-lock.json       # Backend dependency lockfile
│   ├── src/
│   │   ├── features/
│   │   │   ├── auth/          # Controller, service, schemas and repositories
│   │   │   ├── projects/
│   │   │   └── logs/
│   │   ├── shared/            # Database, errors, middleware and logging
│   │   ├── app.ts
│   │   └── server.ts
│   ├── prisma/                # Database schema and migrations
│   ├── tests/
│   └── README.md
└── README.md
```

The backend preserves **Controller → Service → Repository → Database** within each feature. The frontend uses React for rendering, Zod for input and response validation, Zustand for interface preferences, TanStack Query for server data, and Tailwind CSS with shadcn/ui components for styling.

## Open the dashboard

Use Node.js 24. Open a terminal in the frontend folder:

```sh
cd frontend
npm ci
npm run dev
```

Open **http://localhost:3000**. The dashboard starts in a clearly labeled **demo mode** with sample projects and logs, so you can explore the responsive design without PostgreSQL. Sample data is held separately from authenticated API data.

The interface includes an overview, log explorer, project management and settings. Search and filter logs by level and time window, open a log for its metadata and stack trace, paginate results, and export the currently loaded logs as CSV. Project creation displays its ingestion API key once.

## Connect the real backend

Open a second terminal in the backend folder:

```sh
cd backend
npm ci
cp .env.example .env
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Put the two different generated values into `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` in this folder's `.env`. The example allows both `http://localhost:3000` and `http://127.0.0.1:3000` for local previews.

```sh
docker compose up -d --wait postgres
npm run db:generate
npm run db:deploy
npm run dev
```

The frontend listens on port **3000** and the backend on **3001**. Run each package in its own terminal. Vite forwards `/api` requests to the local backend. Use the dashboard's sign-in/register flow to connect your account; real projects and logs appear after authentication.

For a separate API origin, copy `frontend/.env.example` to `frontend/.env` and set `VITE_API_URL` to the API origin. Restart Vite after changing it. Configure the backend's exact CORS origin and cookie settings for that deployment. Access tokens stay in memory; refresh tokens stay in HTTP-only cookies. API keys are displayed for copying and are not persisted in browser storage.

## Check and build

Run these commands separately inside `frontend/` and inside `backend/`:

```sh
npm run typecheck
npm test
npm run build
```

Each package keeps its installed dependencies in its own `node_modules/` and writes build output to its own `dist/`. There is no root npm package or shared dependency installation.

PostgreSQL integration tests require an isolated test database; see [backend/README.md](backend/README.md). The frontend build is written to `frontend/dist`; deploy it as static assets alongside the API or configure an API origin. The Vite development proxy is only available during development.

See [frontend/README.md](frontend/README.md) for frontend organization and [backend/README.md](backend/README.md) for API contracts, security controls and deployment details.

