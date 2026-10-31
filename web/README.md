# StateShift · Web dashboard

A live control-plane dashboard for StateShift, built with **Next.js (App Router) + Tailwind CSS v4**. No `src/` directory. Apple-system typography, glass cards, a class-based light/dark theme, and a live SSE stream (with an automatic 2s polling fallback so it works even where `next dev` buffers the events).

## What it shows

- **Fleet** — every registered worker, who is the *authoritative* owner right now.
- **Jobs** — live step progress, epoch, owner, ops, pause time, and one-click **Migrate →** per running job.
- **Migrations** — audited handovers with pause / bytes / chunks and chunk-dedupe.
- **New job** — pick a workload (`compute` / `agent`), steps, optional prompt, and pin-to-node from a side sheet.
- **Job detail** — a live pane with the same job's own migration history.

## Run it

The UI proxies every `/api/*` call to the coordinator, so point the backend up first (from the repo root):

```bash
# backend — coordinator :9100 + two workers :9101/:9102
cd ../.. && go run ./cmd/stateshift --role=all --db=mem --blob=fs --blob-dir=.run/blob --llm=mock
```

Then, in this directory:

```bash
npm install
npm run dev          # → http://localhost:3000
```

Production:

```bash
npm run build && npm start
```

### Configuration

By default the proxy targets `http://127.0.0.1:9100`. Point it elsewhere with an env var:

```bash
STATESHIFT_API=http://coordinator:9100 npm run dev
```

> **Note on live updates:** the dashboard subscribes to `/api/events` (SSE) for push updates. Because `next dev` buffers SSE in some setups, `lib/useStateShift.ts` also runs an immediate `/api/state` fetch and a 2s poll until a frame actually arrives. So the UI stays live in both dev and prod.

## Layout

```
app/
  layout.tsx        # fonts, persisted theme boot (no FOUC)
  page.tsx          # dashboard screen
  globals.css       # Tailwind v4 theme, design tokens, animations
components/         # TopBar, Fleet, JobsTable, Migrations, NewJobSheet, JobDetail, status
lib/
  types.ts          # wire types mirroring internal/model
  api.ts            # createJob / migrateJob
  useStateShift.ts  # live snapshot hook (SSE + poll fallback)
  format.ts         # bytes, uptime, node hue, ids
  icons.tsx         # inline SVG icon set
```
