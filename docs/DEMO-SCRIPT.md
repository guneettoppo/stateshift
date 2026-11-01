# StateShift — live demo script

**Screen:** the stage console (`web/`, served from the coordinator box).
**Length:** 4:30 default, 1:00 cut at the end.
**Rule:** read every number off the screen. Never pre-announce a number you haven't seen.

---

## 0. Before you say a word (T-3 min)

- [ ] Coordinator + two workers up: `curl :9100/api/health` → `{"ok":true}`
- [ ] `curl :9100/api/state` → two nodes, neither `127.0.0.1`
- [ ] One job already running, somewhere around **60–120 of 400** — long enough to migrate, short enough to finish on stage
- [ ] Console open at **100 % zoom**, dark theme, browser at full screen, no other tabs
- [ ] DevTools closed. Notifications off. `do not disturb` on
- [ ] Terminal tab with the migration log visible behind the browser, in case you need to prove a line
- [ ] One spare job pre-created, in case the first one finishes before you click

**Do not** create the demo job live. It wastes 15 seconds of attention and looks like you're not sure it works.

---

## 1. The claim — 30 s

> "Every deploy people ship today is restart-from-zero. Kill the process, start it again, hope the work in flight was idempotent."

> "StateShift moves the job instead. This is one job, running on worker A. In a minute it will be running on worker B, and it will never have restarted."

*Point at the left panel: `A · AUTHORITATIVE · seq 87 of 400`.*

> "That counter is committed steps. Each one has a side effect already written to the database."

---

## 2. What you're looking at — 45 s

*Point at the left panel's `epoch 0`.*

> "One epoch, one owner. The epoch is the only thing that decides who may write."

*Point at the wire.*

> "Between them, the object store. A checkpoint is the job's state at a step boundary — serialized, chunked by content, uploaded. Not a memory dump: a state blob of about **13 KB**."

*Point at the store card's chunk cells.*

> "These cells are the chunks. Filled ones were uploaded. Dashed ones were already in the bucket from a previous checkpoint, so this handover doesn't pay for them again."

---

## 3. The handover — 40 s

> "I'll move it without stopping the job."

*Click `Migrate → B`.*

*Watch three things, in this order:*

1. The phase strip fills: `quiesce · checkpoint · upload · fence · restore · resume`.
2. The packet crosses the wire.
3. `pause` climbs, in red.

> "A drains at a step boundary — it stops accepting commits. The state uploads. The fence flips the epoch to 1 — from that instant A cannot write, and B is the only owner. Then B restores and resumes."

*Say nothing while `restore` runs.* Let the number climb. Silence sells it better than narration.

---

## 4. The result — 30 s

*After the phase strip goes all-done:*

> "Same job. Nothing restarted. Nothing replayed."

*Point at A: `FENCED · 87`.*
*Point at B: `AUTHORITATIVE · 91` — and the red tick at 87.*

> "A stopped at 87 and stays there. B picked up at 87 — that red mark — and is past it. Epoch is 1."

*Point at the metrics row.*

> "Pause: **[read it]**. Bytes moved: **13,645**. Chunks: **8 sent, 6 reused** out of 14. Ops committed: **[read it]**, zero repeated."

> "That's the number that matters — the job paused for that long and lost nothing."

---

## 5. The failure beat — 45 s

*This is the part that wins the room. Do it on the second job if the first has finished.*

> "Now the question every judge asks: what if the target dies halfway through?"

*Stop worker B in the terminal, in front of them.*

*Click `Migrate → B`.*

*The toast appears: `restore failed, authority returned to A`.*

> "409. The restore failed — B isn't answering. Authority went back to A, epoch never advanced, and the job is still running on A. Look at the counter: it's still climbing."

*Point at A's seq ticking up.*

> "A half-done handover is a no-op, not a split brain. That's the whole point of the fence — the move either completes, or it didn't happen."

---

## 6. Why it's correct — 40 s

> "Two invariants, both checked against the database, not against my screen."

> "One: every step wrote its operations exactly once — no step number appears twice in the op log. Checked on every job we ran: 200 ops, 160 ops four times, 136 ops. Zero duplicates."

> "Two: the work is right. The job's final checksum after a handover is **8c46b7c3…**, byte-identical to a control run that was never migrated."

> "Correctness isn't a vibe here. It's a checksum match and a row count."

---

## 7. Close — 30 s

> "What we're not claiming: this isn't CRIU. We don't migrate a process's memory and sockets — we migrate state a program can describe, which is why it works without root and without a matching kernel."

> "What's next: a watchdog so a dead owner is reaped automatically instead of stalling the job — we can show that gap if you want to see it."

> "Restart-from-zero is a choice. We made the other one."

---

## 1:00 version (if you're cut short)

1. "One job, two workers, one authority." (5 s)
2. "13 KB of state, chunked by content — 6 of 14 chunks are reused, so we don't re-upload what didn't change." (15 s)
3. *Click Migrate.* "Quiesce, upload, fence the epoch, restore, resume." (15 s)
4. "A is fenced at 87, B is the only writer, pause **[read it]**, zero repeated ops." (15 s)
5. "Kill the target and the fence refuses the move — the job never stops." (10 s)

---

## If it breaks on stage

| Symptom | Say | Do |
|---|---|---|
| Toast: `restore failed` | "Good — that's the failure path working." | Point at the still-running counter, move on |
| `Migrate` button disabled | "The job already finished; here's the audit row from the last one." | Select the previous job in the top bar |
| Console shows "coordinator offline" | "The coordinator dropped; the job is still running — that's the interesting part." | Reload once; if it fails, switch to `docs/dashboard.png` |
| Number looks bad (e.g. 9 s) | "That's a cross-region restore — 7.1 of those 9 seconds are chunk GETs from `sfo3`." | Show the waterfall in the audit row |

Never apologise for a number. Explain what it's made of.

---

## Questions you will get

**"Is this two separate machines?"**
"Two workers, separate processes, separate addresses. Today they're on one host; the same binary runs on two droplets — the deploy is a flag and a firewall rule, not a redesign." *(If deployed: "Two droplets in `sfo3`, separate kernels.")*

**"Why not CRIU?"**
"Root, matching kernels, and it fails on demo day. We migrate state a program can describe — narrower, and it actually finishes."

**"What if both nodes think they own it?"**
"One `UPDATE … WHERE epoch = $1`. One winner. The loser's next commit matches zero rows and returns `ErrStaleEpoch`."

**"How do you know nothing was executed twice?"**
"Op-log primary key `(job_id, seq, op_id)` with `ON CONFLICT DO NOTHING`, in the same transaction as the state advance. Plus the row-count invariant."

**"How fast is it really?"**
"Read the number on screen. Locally it's milliseconds; the 8.9 s run in our report was a cross-region restore, and 7.1 s of it was chunk downloads."

**"Can it migrate any app?"**
"No. Workloads have to be written as step machines. That's the honest boundary and it's why the thing works."

---

## Don't

- Don't say "zero downtime". Say "paused for [number]".
- Don't say "3 ms" unless you're on loopback and you say so.
- Don't say "consistent hashing" — it's content-defined chunking.
- Don't claim autonomous recovery. It doesn't exist yet; say so first.
