# StateShift on two droplets

Assumes Ubuntu 24.04, one coordinator and two workers, all on the same private
network (or with firewall rules allowing 9100-9102 between them).

## 0. From the laptop

```bash
make linux          # GOOS=linux GOARCH=amd64, no cgo
scp stateshift-linux root@DROPLET_1:/usr/local/bin/stateshift
scp stateshift-linux root@DROPLET_2:/usr/local/bin/stateshift
scp stateshift-linux root@DROPLET_0:/usr/local/bin/stateshift
```

## 1. Coordinator (DROPLET_0)

```bash
export STATESHIFT_DB_URL='postgres://user:pass@<yugabyte-host>:5433/stateshift?sslmode=require'
export SPACES_ENDPOINT='https://blr1.digitaloceanspaces.com'
export SPACES_REGION='blr1'
export SPACES_BUCKET='stateshift-ckpt'
export SPACES_KEY='...'
export SPACES_SECRET='...'

nohup stateshift --role=api --listen :9100 --db=yugabyte --blob=spaces \
  > /var/log/stateshift-api.log 2>&1 &
```

## 2. Workers (DROPLET_1, DROPLET_2)

```bash
nohup stateshift --role=node --listen :9101 --node-id droplet-1 \
  --coordinator http://<COORDINATOR_IP>:9100 \
  --db=yugabyte --blob=spaces --llm=gemini \
  > /var/log/stateshift-node.log 2>&1 &
```

Each worker registers itself every 3 seconds, so no config file has to list them.

## 3. Verify

```bash
curl -s http://<COORDINATOR_IP>:9100/api/state | jq '.nodes, .jobs'
curl -s -X POST http://<COORDINATOR_IP>:9100/api/jobs \
  -H 'Content-Type: application/json' -d '{"workload":"agent","steps":60}' | jq
```

Open `http://<COORDINATOR_IP>:9100` on the projector, press **Migrate**, then
`pkill -f stateshift` on the source droplet: the job must keep running on the
other node with the same sequence number and no repeated ops.

## Notes

- Keep the coordinator off the two worker droplets, or killing a worker kills
  your control plane mid-demo.
- The database must not live on either worker, for the same reason.
- If Spaces is unreachable, restart with `--blob=fs --blob-dir=/var/lib/stateshift`
  and the demo still works; that is what the fallback flags exist for.
