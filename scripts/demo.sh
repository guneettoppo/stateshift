#!/usr/bin/env bash
# End-to-end smoke test of a running control plane: create a job, migrate it
# mid-flight, and verify the numbers the dashboard shows.
#
#   ./scripts/demo.sh [coordinator-url]
set -euo pipefail

API="${1:-http://127.0.0.1:9100}"
WORKLOAD="${WORKLOAD:-compute}"
STEPS="${STEPS:-800}"
mkdir -p .run

echo "-> health"
curl -sf "$API/api/health" || { echo "control plane not reachable at $API"; exit 1; }
echo

echo "-> fleet"
curl -sf "$API/api/state" | python -c '
import json, sys
d = json.load(sys.stdin)
for n in d["nodes"]:
    print("   %-12s %-28s jobs=%d" % (n["id"], n["addr"], n["jobs"]))
if len(d["nodes"]) < 2:
    print("   need at least two workers for a migration")
    sys.exit(1)
'

JOB=$(curl -sf -X POST "$API/api/jobs" -H 'Content-Type: application/json' \
      -d "{\"workload\":\"$WORKLOAD\",\"steps\":$STEPS}" \
      | python -c 'import json,sys; print(json.load(sys.stdin)["id"])')
echo "-> job $JOB started"

sleep 2
OWNER=$(curl -sf "$API/api/state" | JOB="$JOB" python -c '
import json, os, sys
d = json.load(sys.stdin); job = os.environ["JOB"]
print([j["owner"] for j in d["jobs"] if j["id"] == job][0])')
TARGET=$([ "$OWNER" = "A" ] && echo B || echo A)
echo "-> migrating $JOB from $OWNER to $TARGET"

curl -sf -X POST "$API/api/migrate" -H 'Content-Type: application/json' \
     -d "{\"job_id\":\"$JOB\",\"target\":\"$TARGET\"}" > .run/last-migration.json
python -c '
import json
m = json.load(open(".run/last-migration.json"))
print("   outcome=%s epoch=%d->%d pause=%dms bytes=%d chunks_sent=%d deduped=%d" % (
    m["outcome"], m["epoch_from"], m["epoch_to"], m["pause_ms"],
    m["bytes_transferred"], m["chunks_sent"], m["chunks_skipped"]))
'

echo "-> waiting for completion"
STATUS=""
for _ in $(seq 1 240); do
  STATUS=$(curl -sf "$API/api/state" | JOB="$JOB" python -c '
import json, os, sys
d = json.load(sys.stdin); job = os.environ["JOB"]
print([j["status"] for j in d["jobs"] if j["id"] == job][0])')
  [ "$STATUS" = "done" ] && break
  sleep 0.5
done

curl -sf "$API/api/state" | JOB="$JOB" python -c '
import json, os, sys
d = json.load(sys.stdin); job = os.environ["JOB"]
j = [x for x in d["jobs"] if x["id"] == job][0]
print("-> %s seq=%d/%d epoch=%d ops=%d checksum=%s" % (
    j["status"], j["seq"], j["total_steps"], j["epoch"], j["ops"], j["checksum"]))
assert j["status"] == "done", "job did not finish"
assert j["ops"] == j["total_steps"], "op count mismatch: work was repeated or lost"
print("   exactly-once: one committed op per step")
'
