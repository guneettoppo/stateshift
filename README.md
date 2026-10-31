# StateShift

Move a running workload between machines at a step boundary — without restarting it and without repeating committed work.

StateShift is a live-migration control plane for **checkpointable workloads**. A job is a step-state machine; the worker commits each step's effects to an exactly-once op log, checkpoints its state into a content-addressed store, and can be handed to another machine mid-flight. An **epoch fence in the database** guarantees that exactly one node is authoritative at any moment.

> Scope, stated up front: StateShift migrates **explicit application state**, not kernel memory, sockets or file descriptors. Transparently migrating an arbitrary Linux process is CRIU's problem, with a different set of constraints (root, kernel support, matching environments). See [Limitations](#limitations).

---

## Why

Moving an application usually means deploying it again. That is fine for stateless services and expensive for anything with resident state: a long agent run, a simulation with hours of progress, a session with unpersisted state. Restarting loses work; replaying duplicates side effects (and, for an LLM agent, duplicates spend).

StateShift gives you: **pause a job, move it, resume it, and prove nothing was lost or repeated.**

---

## Architecture

```
                        ┌──────────────────────────────┐
   browser ────────────►│  coordinator (:9100)         │
                        │  /api/jobs /api/migrate      │
                        │  /api/events (SSE) + UI      │
                        └───────┬──────────┬───────────┘
                                │          │
                 ┌──────────────┘          └──────────────┐
                 ▼                                        ▼
        ┌─────────────────┐                      ┌─────────────────┐
        │  worker A       │                      │  worker B       │
        │  job loop       │ ◄──── migrate ────►  │  job loop       │
        │  checkpoint     │                      │  restore        │
        └───┬────────┬────┘                      └────┬───────┬────┘
            │        │                                │       │
   chunk PUT│        │epoch / oplog / lease  chunk GET │       │
            ▼        ▼                                ▼       │
     ┌────────────┐  ┌──────────────────┐        ┌─────────┐  │
     │ object     │  │ control-plane DB │◄───────┤ chunks  │◄─┘
     │ store      │  │ jobs, epochs,    │        └─────────┘
     │ (chunks +  │  │ oplog, ckpts,    │
     │ manifests) │  │ migrations       │
     └────────────┘  └──────────────────┘
```

Jobs are addressed **only** by logical ID through the coordinator. No client ever holds a node address, so a migration is invisible to consumers — that is the "network identity" answer: identities follow the job, not the machine.

### Components

| Package | Role |
|---|---|
| `internal/workload` | The migratable program: `Init`, `Step`, `Checksum`. Ships `compute` (deterministic, correctness proof) and `agent` (Gemini / mock) |
| `internal/node` | Worker agent: `POST /internal/{start,quiesce,restore}` |
| `internal/coordinator` | Control plane: creates jobs, drives the handover, serves the dashboard |
| `internal/store` | `mem` (zero-dependency) and `pg` (YugabyteDB YSQL / Postgres) implementations |
| `internal/chunk` | Content-defined chunking + manifests + delta upload |
| `internal/blob` | `fs` (local dir) and `spaces` (S3-compatible) |

---

## Migration protocol

```
coordinator          source (A)                    DB           target (B)
    │ POST /migrate     │                            │              │
    ├─ status=draining ─────────────────────────────►│              │
    ├──/internal/quiesce──►│                        │              │
    │                   │ finish current step        │              │
    │                   │ checkpoint @ seq S         │              │
    │                   │ PUT changed chunks ────────► blob          │
    │◄──{S, manifest}───┤                            │              │
    ├─ FENCE: epoch = epoch+1, owner = B ───────────►│  (1 row)     │
    ├──/internal/restore──────────────────────────────────────────►│
    │                   │                            │  GET chunks ◄┤
    │                   │                            │  verify hash │
    │◄────────────────────────────── claim ────────────────────────┤
    ├─ status=running (owner B) ────────────────────►│              │
    │                   │ sees epoch ≠ mine → exit   │              │
```

The fence is a single guarded statement. Exactly one caller can win it:

```sql
UPDATE jobs SET epoch = epoch + 1, owner = $target, status = 'restoring'
 WHERE id = $job AND epoch = $current;
```

Every committed step is guarded the same way, so a stale node's writes are rejected at the database, not trusted to a timeout:

```sql
UPDATE jobs SET seq = $4, state = $5 ...
 WHERE id = $1 AND epoch = $2 AND seq = $3 AND status IN ('running','draining');
-- 0 rows => ErrStaleEpoch => the worker stops
```

Exactly-once effects:

```sql
INSERT INTO oplog (job_id, seq, op_id, result) VALUES (...)
ON CONFLICT (job_id, seq, op_id) DO NOTHING;
```

### Failure handling

| Failure | Behaviour |
|---|---|
| Dies before the fence | Coordinator rolls the job back to `running` and restarts the source. Zero loss |
| Dies after the fence, before restore | Authority is handed back (`epoch+1`) to the source from the last committed checkpoint. Target never acted |
| Target restore fails | Same rollback; recorded as `failed-failover-back` in `migrations` |
| Both nodes alive, partitioned | Only the current-epoch holder can commit. The loser gets `ErrStaleEpoch` and exits |
| Source killed during transfer | Lease/epoch still points at the source; retry or rollback, never both authoritative |

---

## Quickstart (single machine, two real workers, no external services)

```bash
go run ./cmd/stateshift --role=all --db=mem --blob=fs --blob-dir=.run/blob --llm=mock
# dashboard: http://127.0.0.1:9100
```

`--role=all` starts the coordinator on `:9100` and two worker processes (A on `:9101`, B on `:9102`), so a migration exercises the real HTTP handover path.

Create a job and move it:

```bash
JOB=$(curl -s -X POST localhost:9100/api/jobs -H 'Content-Type: application/json' \
      -d '{"workload":"agent","steps":40}' | jq -r .id)

curl -s -X POST localhost:9100/api/migrate -H 'Content-Type: application/json' \
      -d "{\"job_id\":\"$JOB\",\"target\":\"B\"}" | jq
```

### Two droplets (the demo that matters)

```bash
# build once on the laptop, run the binary on Linux
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -o stateshift-linux ./cmd/stateshift

# coordinator on droplet 0, workers on droplet 1 and 2
./stateshift --role=api  --listen :9100 --db=yugabyte --db-url "$YSQL" --blob=spaces
./stateshift --role=node --listen :9101 --node-id droplet-1 --coordinator http://<coord-ip>:9100 ...
./stateshift --role=node --listen :9102 --node-id droplet-2 --coordinator http://<coord-ip>:9100 ...
```

Cross-compilation is one command because nothing here needs cgo.

---

## Configuration

Secrets come from the environment so they never land in a command history or a repo.

| Flag | Env | Meaning |
|---|---|---|
| `--role` | | `api`, `node`, `all` |
| `--db` | | `mem` (default), `pg`, `yugabyte` |
| `--db-url` | `STATESHIFT_DB_URL` | YSQL DSN, e.g. `postgres://user:pass@host:5433/db?sslmode=require` |
| `--blob` | | `fs` (default) or `spaces` |
| `--blob-dir` | | root for `fs` |
| `--spaces-endpoint` | `SPACES_ENDPOINT` | `https://blr1.digitaloceanspaces.com` |
| `--spaces-region` | `SPACES_REGION` | e.g. `blr1` |
| `--spaces-bucket` | `SPACES_BUCKET` | bucket name |
| `--spaces-key` / `--spaces-secret` | `SPACES_KEY` / `SPACES_SECRET` | credentials |
| `--llm` | | `mock` (default) or `gemini` |
| `--gemini-key` | `GEMINI_API_KEY` | Gemini key |
| `--step-delay` | | artificial pacing, so a demo job lasts minutes not milliseconds |
| `--checkpoint-each` | | periodic checkpoint interval, in steps |

**Every sponsor dependency has a fallback**, selected by flag, written the same day: `mem` ↔ `pg`, `fs` ↔ `spaces`, `mock` ↔ `gemini`. A bad demo network degrades the demo instead of killing it.

### YugabyteDB

`--db=yugabyte` applies `internal/store/schema.sql` on startup. Verified SQL subset: `BYTEA`, `TIMESTAMPTZ`, guarded `UPDATE ... RETURNING`, `ON CONFLICT DO NOTHING`, single-row transactions. Ops are inserted one per statement inside the step transaction rather than via `jsonb_to_recordset`, to stay inside the YSQL feature set.

---

## Tests

```bash
go test ./... -count=1
```

- `internal/chunk` — chunking round-trips, hash verification rejects a tampered chunk, and **repeated checkpoints skip unchanged chunks** (13.7 KiB state: 7 chunks, second checkpoint uploads 1 and skips 6).
- `internal/store` — the fence has exactly one winner; a fenced-out owner cannot commit; a *draining* owner still can (otherwise every migration would lose its in-flight step).
- `internal/e2e` — two real HTTP nodes: create a job, migrate mid-flight, let it finish, and assert the op log has exactly `N` rows for `N` steps and the checksum equals a control run that never migrated.

Measured on a laptop, loopback, `--step-delay 25ms`:

```
migrated job-... A -> B epoch 0->1 seq 146 pause 4ms bytes 13645 chunks_sent 8 deduped 6
```

---

## Dashboard

`internal/webui/index.html` is embedded in the binary: fleet view (which node is authoritative), per-job epoch and sequence, migration history with pause/bytes/chunks, and a one-click **Migrate** per job. No npm, no build step on the demo machine.

---

## Limitations

- Migrates **workload state**, not process state. No sockets, file descriptors, threads or kernel memory move.
- The workload must be expressible as `Init` / `Step` / `Checksum`. Arbitrary binaries are out of scope by design.
- Step effects must be idempotent under `op_id`, or the workload must be pure.
- The coordinator is a single process; it is not itself replicated (the DB is).
- Delta efficiency depends on state shape: an immutable head with a small mutable tail compresses best.
- Benchmarks here are loopback. WAN numbers will be dominated by chunk transfer, which is exactly what the dedupe metric measures.

---

## Roadmap

- [ ] Streaming chunk transfer (currently upload-then-download through the store)
- [ ] Migrate-on-failure automation (watchdog instead of a click)
- [ ] gRPC data plane behind the same interfaces
- [ ] Third-party workloads via a plugin interface (WASM or an out-of-process SDK)
- [ ] CRIU spike behind `--criu` for comparison only, never on the main path
