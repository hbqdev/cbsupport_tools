# Couchbase Log Analysis Skill

Expert `rg` patterns for searching Couchbase server logs.

## Log File Reference

| Component | Log File | Notes |
|-----------|----------|-------|
| KV Engine | `memcached.log` | Not ns_server prefixed |
| Cluster Manager | `ns_server.info.log`, `ns_server.debug.log`, `ns_server.error.log` | Always search both info + debug for cluster issues |
| Query | `ns_server.query.log`, `completed_requests.json` | |
| Index (GSI) | `ns_server.indexer.log`, `ns_server.projector.log` | |
| XDCR | `ns_server.goxdcr.log` | |
| FTS | `ns_server.fts.log` | |
| Analytics | `ns_server.analytics*.log` | |
| Views | `couchdb.log` | |
| Babysitter | `ns_server.babysitter.log` | Process starts/stops |

## Timestamp Formats

```
memcached.log:       2026-03-11T14:23:42.123456Z
ns_server.*.log:     [ns_server:info,2026-03-11T14:23:42.123Z,...]
ns_server.query.log: {"timestamp":"2026-03-11T14:23:42.123Z",...}
ns_server.indexer.log: 2026-03-11T14:23:42.123456-05:00
```

## Timestamp Filtering

```bash
# Exact minute
rg "2026-03-11T14:23:" memcached.log

# Minute range (14:20–14:25)
rg "2026-03-11T14:2[0-5]:" memcached.log

# Hour range (14:xx–15:xx)
rg "2026-03-11T1[45]:" memcached.log
```

---

## KV Engine (memcached.log)

```bash
# OOM / eviction
rg -iN "out of memory|OOM|eviction|resident_ratio|high_wat" memcached.log

# DCP
rg -iN "DCP.*closed|DCP.*timeout|DCP.*failed|BufferLogFull|stream.*closed" memcached.log

# Connections
rg -iN "Too many.*connection|connection.*limit|connection.*reset|ECONNRESET" memcached.log

# Slow operations
rg -iN "slow.*operation|operation.*exceeded|threshold.*exceeded" memcached.log

# Hash table resize (KV pressure signal)
rg -iN "Adjusting hash table" memcached.log | wc -l

# Disk
rg -iN "disk.*full|no space|write.*failed|I/O error" memcached.log
```

---

## Cluster Management (ns_server.info.log + ns_server.debug.log)

**Always search BOTH.** The debug log contains NACK messages, gen_server overload, supervisor restarts, and ns_config activity that do NOT appear in the info log.

```bash
# Failover / node down
rg -iN "failover|auto_failover|node.*down|rebalance.*fail" \
  cbcollect_*/ns_server.info.log cbcollect_*/ns_server.debug.log

# Process overload — debug only
rg -N "Received nack|register_with_async|message_queue_len|overloaded|noproc" \
  cbcollect_*/ns_server.debug.log | rg "<TIMESTAMP_WINDOW>"

# Supervisor restarts — debug only
rg -N "SUPERVISOR REPORT|EXIT|process_died|child.*terminated" \
  cbcollect_*/ns_server.debug.log | rg "<TIMESTAMP_WINDOW>"

# gen_server call timeouts — debug only
rg -N "gen_server.*timeout|call.*timeout|handle_call.*timeout" \
  cbcollect_*/ns_server.debug.log | rg "<TIMESTAMP_WINDOW>"

# ns_config activity — debug only
rg -N "ns_config|config_update|set_kvlist" \
  cbcollect_*/ns_server.debug.log | rg "<TIMESTAMP_WINDOW>"

# Heartbeat / health
rg -iN "heartbeat.*timeout|heartbeat.*failed|send heartbeat timed out" \
  cbcollect_*/ns_server.debug.log

# timer_lag (Erlang scheduler pressure)
rg -iN "timer_lag|Skipped.*check_time" cbcollect_*/ns_server.debug.log

# Disk / memory
rg -iN "disk.*full|disk_usage|memory.*high|disk.*watermark" \
  cbcollect_*/ns_server.info.log cbcollect_*/ns_server.debug.log
```

**Key debug-only signals:**
- `async:register_with_async: Received nack` — process mailbox full / not responding
- `message_queue_len` spike — process falling behind
- `SUPERVISOR REPORT … {id, menelaus_web_cache}` — web cache killed by supervisor
- `ns_config:get` timeout / CRASH REPORT — ns_config server blocked
- `timer_lag_recorder: Skipped N 'check_time' messages` — Erlang scheduler starvation

---

## Query (ns_server.query.log, completed_requests.json)

```bash
# Errors and timeouts in query log
rg -iN "timeout|error|Index not ready|GSI.*fail" \
  cbcollect_*/ns_server.query.log | rg "<TIMESTAMP_WINDOW>"

# Slow queries (elapsed > 5s) from completed_requests
jq -r 'select(.elapsedTime != null) |
  [.requestTime, .elapsedTime, .statement[0:100], .errors[0].msg] | @tsv' \
  cbcollect_*/completed_requests.json 2>/dev/null | sort -k2 -rn | head -20

# Queries with errors
jq -r 'select(.errors != null and (.errors | length) > 0) |
  [.requestTime, .errors[0].code, .errors[0].msg] | @tsv' \
  cbcollect_*/completed_requests.json 2>/dev/null | head -20

# Primary scans (no index)
rg -iN '"primaryScan":[1-9]' cbcollect_*/completed_requests.json

# GSI endpoint in "Index not ready" errors — identifies which node served the error
rg -oiN 'GsiScanClient:"[^"]*"' cbcollect_*/ns_server.query.log \
  | rg "<TIMESTAMP_WINDOW>" | sort | uniq -c | sort -rn | head -20
```

---

## Index (ns_server.indexer.log, ns_server.projector.log)

```bash
# Index state transitions (ready / warmup / building / recovering)
rg -iN "Index.*state.*change|indexState|index.*warming|index.*ready|index.*building" \
  cbcollect_*/ns_server.indexer.log | rg "<TIMESTAMP_WINDOW>"

# Index not ready / scan errors
rg -iN "not ready|ErrIndexNotReady|ErrScanTimedOut|scan.*fail" \
  cbcollect_*/ns_server.indexer.log | rg "<TIMESTAMP_WINDOW>"

# Index load / recovery after rejoin
rg -iN "loading index|recovery|bootstrap|recoveringIndex|indexer.*start" \
  cbcollect_*/ns_server.indexer.log | rg "<±10 min window>"

# Replica availability
rg -iN "replica|numReplica|replicaId" \
  cbcollect_*/ns_server.indexer.log | rg "<TIMESTAMP_WINDOW>"

# Memory warnings
rg -iN "resident.*percentage|resident.*ratio|memory.*threshold|indexer.*RAM" \
  cbcollect_*/ns_server.indexer.log

# Projector lag / backlog
rg -iN "items.*remaining|backlog|mutations.*queue" \
  cbcollect_*/ns_server.projector.log

# Build failures / crashes
rg -iN "build.*fail|build.*error|panic|fatal" \
  cbcollect_*/ns_server.indexer.log
```

---

## XDCR (ns_server.goxdcr.log)

```bash
# Replication failures
rg -iN "replication.*failed|replication.*error|replication.*stopped" \
  cbcollect_*/ns_server.goxdcr.log

# Lag / backlog
rg -iN "replication.*lag|backlog|docs.*remaining|changes.*left" \
  cbcollect_*/ns_server.goxdcr.log

# Connection issues
rg -iN "connection.*timeout|connection.*failed|ETIMEDOUT" \
  cbcollect_*/ns_server.goxdcr.log
```

---

## FTS (ns_server.fts.log)

```bash
rg -iN "error|timeout|panic|fatal|slow" cbcollect_*/ns_server.fts.log \
  | rg "<TIMESTAMP_WINDOW>"
```

---

## Views (couchdb.log)

```bash
rg -iN "view.*build.*error|compaction.*failed|compaction.*error" \
  cbcollect_*/couchdb.log
```

---

## Multi-Node Patterns

```bash
# Count pattern per node
for log in cbcollect_info_*/memcached.log; do
  count=$(rg -ic "OOM" "$log" 2>/dev/null || echo 0)
  echo "$(basename $(dirname $log)): $count"
done

# Search across all nodes, show node name
rg -iN "pattern" cbcollect_info_*/ns_server.debug.log \
  | rg "<TIMESTAMP_WINDOW>"

# Identify node-specific vs cluster-wide events
# (if only one node shows the pattern → node-local issue)
rg -l "pattern" cbcollect_info_*/ns_server.debug.log
```

---

## Useful Extractions

```bash
# All unique node names in cluster
rg -oN 'ns_1@[\w\.\-]+' cbcollect_*/ns_server.debug.log | sort -u

# Error codes from query completed_requests
jq -r '.errors[]?.code' cbcollect_*/completed_requests.json 2>/dev/null \
  | sort | uniq -c | sort -rn

# First and last timestamp in a log
rg -oN '\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}' memcached.log | head -1  # first
rg -oN '\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}' memcached.log | tail -1  # last
```

---

## Common Workflows

### Workflow 1: Anchor to issue timestamp, expand if needed
```bash
ISSUE="2026-03-11T14:23"
rg "$ISSUE" cbcollect_*/memcached.log
# If sparse, expand to ±5 min: rg "2026-03-11T14:2[0-8]:"
```

### Workflow 2: Cross-component correlation
```bash
# Find error in one component, check same timestamp across others
TIMESTAMP="2026-03-11T14:23:42"
rg "$TIMESTAMP" cbcollect_*/ns_server.debug.log
rg "$TIMESTAMP" cbcollect_*/ns_server.query.log
rg "$TIMESTAMP" cbcollect_*/memcached.log
```

### Workflow 3: Confirm node-local vs cluster-wide
```bash
# Count timer_lag events per node — if only one node has them, it's node-local
for log in cbcollect_info_*/ns_server.debug.log; do
  count=$(rg -ic "timer_lag|Skipped.*check_time" "$log" 2>/dev/null || echo 0)
  echo "$(basename $(dirname $log)): $count"
done
```

### Workflow 4: Index deep-dive for latency complaints
```bash
# Step 1 — which GSI endpoint served the errors
rg -oiN 'GsiScanClient:"[^"]*"' cbcollect_*/ns_server.query.log \
  | rg "$ISSUE" | sort | uniq -c | sort -rn

# Step 2 — index state on that node during the window
rg -iN "not ready|ErrIndexNotReady|index.*warming" \
  cbcollect_info_<FAILING_NODE>/ns_server.indexer.log | rg "$ISSUE"

# Step 3 — were replicas on other nodes ready?
rg -iN "replica.*ready|numReplica" \
  cbcollect_info_<SURVIVING_NODE>/ns_server.indexer.log | rg "$ISSUE"

# Step 4 — did GSI client try replica?
rg -iN "Trying scan again with replica|retry.*replica" \
  cbcollect_*/ns_server.query.log | rg "$ISSUE"
```

---

## Tips

- Always use `-N` (no filename in output) when searching a single file; omit when searching multiple to keep node context
- Use `-l` to quickly see which nodes have a pattern before reading lines
- For large logs, add `| head -50` to avoid flooding output
- Combine patterns with `|`: `rg "error|timeout|failed"`
- Exclude noise: `rg "error" file | rg -v "expected error"`
