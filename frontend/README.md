# Log Monitoring Frontend

A responsive React dashboard built with TypeScript, Vite, Zod, Zustand, TanStack Query, Tailwind CSS and shadcn/ui primitives. This folder is an independent npm package with its own `package.json`, `package-lock.json` and dependencies. Desktop and mobile layouts share the same project selection, log filters and account state.

## Run locally

From this directory:

```sh
npm ci
npm run dev
```

Open **http://localhost:3000**. The initial demo workspace uses sample logs and projects and requires no backend. Sign in or register to use the real API. Demo and account data use separate query caches.

The backend runs on port 3001; Vite proxies same-origin `/api` requests to it. Leave `VITE_API_URL` blank for this setup. Set it to an API origin such as `https://api.example.com` when deploying the frontend and backend separately. See the [repository setup](../README.md) to start PostgreSQL, apply migrations and run both applications.

## Feature organization

```text
src/
├── features/
│   ├── auth/                  # Login and registration
│   ├── projects/              # Project creation and one-time API-key display
│   ├── logs/                  # Log detail inspection
│   └── data/                  # Queries and dashboard mutations
├── components/
│   ├── dashboard/             # Navigation, charts, statistics and log views
│   └── ui/                    # Shared shadcn/ui primitives
├── stores/                    # Interface state and in-memory auth state
├── lib/
│   ├── api.ts                 # Validated API requests and auth session handling
│   ├── models.ts              # Zod input/response schemas and inferred types
│   ├── demo-data.ts           # Sample projects and logs
│   └── utils.ts
├── app.tsx                    # Page composition
├── index.css                  # Tailwind imports, theme tokens and layout styles
└── main.tsx                   # React bootstrap and QueryClient provider
```

TanStack Query owns fetched projects and logs, loading/error states and cache invalidation. Zustand owns interface state such as the selected page, project and filters, alongside an in-memory authentication store. Zod validates form inputs and API responses before typed data reaches components.

The overview derives statistics and charts from the logs loaded in the current view. These represent the displayed result set; the backend does not currently expose complete aggregate metrics, service uptime or an alerting API. The log explorer supports search, level and time-window filters, cursor pagination, a detail dialog and CSV export of loaded rows.

## Authentication and ingestion keys

The API client sends credentials for HTTP-only refresh cookies and the required `X-CSRF-Protection: 1` header for auth POST requests. Access JWTs are held in memory, and expired access tokens are renewed through the refresh endpoint. Account transitions clear account query data. Credentials are not persisted in browser storage; reloading starts a new demo session.

Creating a project returns an ingestion API key once. Copy it into your server-side log producer; the frontend does not retain it in browser storage. Sending production logs is a server-to-server operation using `X-API-Key` on `POST /api/v1/logs`.

## Styling and components

Tailwind uses the Vite plugin and CSS theme tokens. shadcn/ui components live in the repository so you can edit their appearance and behavior. `components.json` configures the New York style and `@/` aliases. Radix provides the dialog and select behavior; Lucide provides icons.

Reference documentation: [Tailwind with Vite](https://tailwindcss.com/docs/installation/using-vite), [shadcn/ui manual setup](https://ui.shadcn.com/docs/installation/manual), [TanStack Query for React](https://tanstack.com/query/latest/docs/framework/react/overview).

## Verify and build

```sh
npm run typecheck
npm test
npm run build
npm run preview
```

`npm run build` writes static assets to `dist/`. Preview serves them on port 4173; a real backend connection then requires an API reverse proxy or a configured `VITE_API_URL`, because the development `/api` proxy is not part of the production build.
