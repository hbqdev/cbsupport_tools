---
name: couchbase-log-analysis
version: 2.0.0
description: Expert rg patterns and regex filters for analyzing Couchbase server logs. Use when searching logs for errors, performance issues, or debugging.
---

# Couchbase Log Analysis Skill

Expert `rg` patterns for searching Couchbase server logs. Read this file before starting any log search.

---

## Log File Reference

| Component | Log File(s) | Notes |
|-----------|------------|-------|
| KV Engine | `memcached.log` | Not ns_server prefixed |
| Cluster Manager | `ns_server.info.log`, `ns_server.debug.log`, `ns_server.error.log` | Always search both info + debug for cluster issues |
| Query | `ns_server.query.log`, `completed_requests.json` | JSON-structured |
| Index (GSI) | `ns_server.indexer.log`, `ns_server.projector.log` | |
| XDCR | `ns_server.goxdcr.log` | |
| FTS (Search) | `ns_server.fts.log` | |
| Views | `couchdb.log` | |
| Eventing | `ns_server.eventing.log` | |
| Babysitter | `ns_server.babysitter.log` | Process starts/stops/crashes |
| System Snapshot | `couchbase.log` | Static snapshot: config, cbstats, disk, services |
| CAO Operator | `cbopinfo*/` directory | Present on CAO-managed clusters only |

---

## Timestamp Formats

```
memcached.log:        2026-03-11T14:23:42.123456Z
ns_server.*.log:      [ns_server:info,2026-03-11T14:23:42.123Z,...]
ns_server.query.log:  {"timestamp":"2026-03-11T14:23:42.123Z",...}
ns_server.indexer.log: 2026-03-11T14:23:42.123456-05:00
couchdb.log:          [2026-03-11 14:23:42]
```

## Timestamp Filtering

```bash
# Exact minute
rg "2026-03-11T14:23:" memcached.log

# Minute range (14:20–14:25)
rg "2026-03-11T14:2[0-5]:" memcached.log

# Hour range (14:xx and 15:xx)
rg "2026-03-11T1[45]:" memcached.log

# ±2 minute window around 14:23
rg "2026-03-11T14:2[1-5]:" cbcollect_*/memcached.log
```

---

## Quick Triage (First Pass)

When you don't know where to look, run these first to identify which component has activity around the issue window.

```bash
# 1. Find crashes or panics across ALL logs
rg -iN "panic|segfault|core.*dump|SIGSEGV|fatal.*error|crashed|abnormal.*termination" \
  cbcollect_*/ns_server.*.log cbcollect_*/memcached.log 2>/dev/null \
  | rg "<TIMESTAMP_WINDOW>" | head -30

# 2. Find auto-failover events (cluster-level)
rg -iN "auto_failover|failover.*triggered|node.*failed over" \
  cbcollect_*/ns_server.info.log | head -20

# 3. Find OOM or memory pressure (KV)
rg -iN "OOM|out of memory|resident_ratio|high_wat" \
  cbcollect_*/memcached.log | rg "<TIMESTAMP_WINDOW>" | head -20

# 4. Find disk warnings (any component)
rg -iN "disk.*full|disk.*watermark|approaching.*full|no space left" \
  cbcollect_*/ns_server.info.log cbcollect_*/memcached.log 2>/dev/null | head -20

# 5. Find process restarts (babysitter)
rg -iN "started|restarting|exited|crash" \
  cbcollect_*/ns_server.babysitter.log | rg "<TIMESTAMP_WINDOW>" | head -20

# 6. Find query/index errors
rg -iN "Index not ready|timeout|error" \
  cbcollect_*/ns_server.query.log | rg "<TIMESTAMP_WINDOW>" | head -20

# 7. Identify which log files have the most activity around the window
for log in cbcollect_info_*/ns_server.debug.log; do
  count=$(rg -c "<TIMESTAMP_WINDOW>" "$log" 2>/dev/null || echo 0)
  echo "$count  $log"
done | sort -rn | head -10
```

---

## KV Engine (memcached.log)

```bash
# OOM / eviction / memory pressure
rg -iN "out of memory|OOM|eviction|resident_ratio|high_wat|low_wat" \
  cbcollect_*/memcached.log | rg "<TIMESTAMP_WINDOW>"

# Hash table resize — signal of KV memory pressure
rg -iN "Adjusting hash table" cbcollect_*/memcached.log | wc -l

# DCP stream issues
rg -iN "DCP.*closed|DCP.*timeout|DCP.*failed|BufferLogFull|stream.*closed|stream.*failed" \
  cbcollect_*/memcached.log | rg "<TIMESTAMP_WINDOW>"

# Connection issues
rg -iN "Too many.*connection|connection.*limit|connection.*reset|ECONNRESET" \
  cbcollect_*/memcached.log | rg "<TIMESTAMP_WINDOW>"

# Slow operations
rg -iN "slow.*operation|operation.*exceeded|threshold.*exceeded" \
  cbcollect_*/memcached.log | rg "<TIMESTAMP_WINDOW>"

# Disk write failures
rg -iN "disk.*full|no space|write.*failed|I/O error|flusher.*stopped" \
  cbcollect_*/memcached.log | rg "<TIMESTAMP_WINDOW>"

# vBucket state changes
rg -iN "vbucket.*state.*changed|set.*vbucket.*state|vbucket.*active|vbucket.*replica" \
  cbcollect_*/memcached.log | rg "<TIMESTAMP_WINDOW>"

# Crashes / fatal errors
rg -iN "panic|segfault|SIGSEGV|fatal|crash" \
  cbcollect_*/memcached.log | rg "<TIMESTAMP_WINDOW>"
```

---

## Cluster Management (ns_server.info.log + ns_server.debug.log)

**Always search BOTH.** The debug log contains NACK messages, gen_server overload, supervisor restarts, and ns_config activity that do NOT appear in the info log.

```bash
# Failover / node down
rg -iN "failover|auto_failover|node.*down|rebalance.*fail" \
  cbcollect_*/ns_server.info.log cbcollect_*/ns_server.debug.log \
  | rg "<TIMESTAMP_WINDOW>"

# Process overload — debug only (critical for stall diagnosis)
rg -N "Received nack|register_with_async|message_queue_len|overloaded|noproc|noconnection" \
  cbcollect_*/ns_server.debug.log | rg "<TIMESTAMP_WINDOW>"

# Supervisor restarts — debug only
rg -N "SUPERVISOR REPORT|EXIT|process_died|child.*terminated|supervisor.*restarting" \
  cbcollect_*/ns_server.debug.log | rg "<TIMESTAMP_WINDOW>"

# gen_server call timeouts — debug only
rg -N "gen_server.*timeout|call.*timeout|handle_call.*timeout" \
  cbcollect_*/ns_server.debug.log | rg "<TIMESTAMP_WINDOW>"

# ns_config activity — debug only (config thrashing blocks the config server)
rg -N "ns_config|config_update|set_kvlist" \
  cbcollect_*/ns_server.debug.log | rg "<TIMESTAMP_WINDOW>"

# Erlang scheduler starvation — debug only
rg -iN "timer_lag|Skipped.*check_time" \
  cbcollect_*/ns_server.debug.log | rg "<TIMESTAMP_WINDOW>"

# Heartbeat failures
rg -iN "heartbeat.*timeout|heartbeat.*failed|send heartbeat timed out" \
  cbcollect_*/ns_server.debug.log | rg "<TIMESTAMP_WINDOW>"

# Disk / memory warnings
rg -iN "disk.*full|disk_usage|memory.*high|disk.*watermark|approaching.*full" \
  cbcollect_*/ns_server.info.log cbcollect_*/ns_server.debug.log \
  | rg "<TIMESTAMP_WINDOW>"

# Rebalance progress and errors
rg -iN "rebalance.*start|rebalance.*complete|rebalance.*fail|vbucket.*move" \
  cbcollect_*/ns_server.info.log | rg "<TIMESTAMP_WINDOW>"
```

**Key debug-only signals to always check for cluster/stall issues:**
- `async:register_with_async: Received nack` — process mailbox full or not responding
- `message_queue_len` spikes — process falling behind on message processing
- `SUPERVISOR REPORT … {id, menelaus_web_cache}` — web cache killed by supervisor
- `timer_lag_recorder: Skipped N 'check_time' messages` — Erlang scheduler starvation
- `ns_config:get` timeout or CRASH REPORT — ns_config server blocked

### Babysitter (ns_server.babysitter.log)

```bash
# Service starts and stops
rg -iN "started|stopped|restarting|exited|crash" \
  cbcollect_*/ns_server.babysitter.log | rg "<TIMESTAMP_WINDOW>"

# Unexpected exits
rg -iN "exit.*abnormal|exit.*killed|exit.*shutdown" \
  cbcollect_*/ns_server.babysitter.log | rg "<TIMESTAMP_WINDOW>"
```

---

## Query (ns_server.query.log + completed_requests.json)

```bash
# Errors and timeouts in query log
rg -iN "timeout|error|Index not ready|GSI.*fail|panic" \
  cbcollect_*/ns_server.query.log | rg "<TIMESTAMP_WINDOW>"

# Slow queries (elapsed > 5s) — structured jq extraction
jq -r 'select(.elapsedTime != null) |
  [.requestTime, .elapsedTime, .statement[0:120], (.errors[0].msg // "")] | @tsv' \
  cbcollect_*/completed_requests.json 2>/dev/null | sort -k2 -rn | head -30

# All queries with errors in the window
jq -r 'select(.errors != null and (.errors | length) > 0) |
  [.requestTime, .errors[0].code, .errors[0].msg[0:100]] | @tsv' \
  cbcollect_*/completed_requests.json 2>/dev/null \
  | rg "<TIMESTAMP_WINDOW>" | head -30

# Primary scans (missing or unused index — performance red flag)
jq -r 'select(.phaseCounts.primaryScan? > 0) |
  [.requestTime, .elapsedTime, .statement[0:120]] | @tsv' \
  cbcollect_*/completed_requests.json 2>/dev/null | head -20

# GSI endpoint that served "Index not ready" errors — identifies which node
rg -oiN 'GsiScanClient:"[^"]*"' cbcollect_*/ns_server.query.log \
  | rg "<TIMESTAMP_WINDOW>" | sort | uniq -c | sort -rn | head -20

# Error code frequency
jq -r '.errors[]?.code' cbcollect_*/completed_requests.json 2>/dev/null \
  | sort | uniq -c | sort -rn | head -20
```

---

## Index (ns_server.indexer.log + ns_server.projector.log)

**For any query latency complaint or "Index not ready" error, perform all four steps.**

### Step 1 — Find impacted queries and GSI endpoint
```bash
rg -iN "Index not ready|GSI.*error|index.*not found|timeout" \
  cbcollect_*/ns_server.query.log | rg "<TIMESTAMP_WINDOW>"

rg -oiN 'GsiScanClient:"[^"]*"' cbcollect_*/ns_server.query.log \
  | rg "<TIMESTAMP_WINDOW>" | sort | uniq -c | sort -rn
```

### Step 2 — Index state transitions on each node
```bash
rg -iN "Index.*state.*change|indexState|index.*warming|index.*ready|index.*building" \
  cbcollect_*/ns_server.indexer.log | rg "<TIMESTAMP_WINDOW>"

rg -iN "not ready|ErrIndexNotReady|ErrScanTimedOut|scan.*fail" \
  cbcollect_*/ns_server.indexer.log | rg "<TIMESTAMP_WINDOW>"

# Recovery after node rejoin (use wider window)
rg -iN "loading index|recovery|bootstrap|recoveringIndex|indexer.*start" \
  cbcollect_*/ns_server.indexer.log | rg "<±10 min window>"
```

### Step 3 — Replica availability on surviving nodes
```bash
rg -iN "replica|numReplica|replicaId" \
  cbcollect_*/ns_server.indexer.log | rg "<TIMESTAMP_WINDOW>"

rg -iN "Trying scan again with replica|retry.*replica|replica.*retry" \
  cbcollect_*/ns_server.query.log | rg "<TIMESTAMP_WINDOW>"
```

### Step 4 — Memory and build health (secondary checks)
```bash
# Memory pressure
rg -iN "resident.*percentage|resident.*ratio|memory.*threshold|plasma.*memory|indexer.*RAM" \
  cbcollect_*/ns_server.indexer.log

# Build failures
rg -iN "build.*fail|build.*error|panic|fatal" \
  cbcollect_*/ns_server.indexer.log | rg "<TIMESTAMP_WINDOW>"

# Projector lag
rg -iN "items.*remaining|backlog|mutations.*queue" \
  cbcollect_*/ns_server.projector.log | rg "<TIMESTAMP_WINDOW>"
```

---

## XDCR (ns_server.goxdcr.log)

```bash
# Replication pipeline failures
rg -iN "replication.*failed|replication.*error|replication.*stopped|pipeline.*broken" \
  cbcollect_*/ns_server.goxdcr.log | rg "<TIMESTAMP_WINDOW>"

# Lag and backlog
rg -iN "replication.*lag|backlog|docs.*remaining|changes.*left|changes.*pending" \
  cbcollect_*/ns_server.goxdcr.log | rg "<TIMESTAMP_WINDOW>"

# Connection / network issues
rg -iN "connection.*timeout|connection.*failed|ETIMEDOUT|ECONNREFUSED" \
  cbcollect_*/ns_server.goxdcr.log | rg "<TIMESTAMP_WINDOW>"

# Bandwidth throttling
rg -iN "throttl|bandwidth.*limit|throughput.*cap" \
  cbcollect_*/ns_server.goxdcr.log | rg "<TIMESTAMP_WINDOW>"

# Checkpoint activity
rg -iN "checkpoint.*saved|checkpoint.*failed|checkpoint_interval" \
  cbcollect_*/ns_server.goxdcr.log | rg "<TIMESTAMP_WINDOW>"

# Conflict resolution
rg -iN "conflict|merge.*failed|resolution.*error|LWW|seqno.*conflict" \
  cbcollect_*/ns_server.goxdcr.log | rg "<TIMESTAMP_WINDOW>"

# Pipeline restarts
rg -iN "pipeline.*restart|pipeline.*start|pipeline.*stop" \
  cbcollect_*/ns_server.goxdcr.log | rg "<TIMESTAMP_WINDOW>"
```

---

## FTS (ns_server.fts.log)

```bash
# Errors and timeouts
rg -iN "error|timeout|panic|fatal|slow" \
  cbcollect_*/ns_server.fts.log | rg "<TIMESTAMP_WINDOW>"

# Index build and ingestion
rg -iN "index.*build|index.*error|bleve|ingestion.*paused|ingestion.*error" \
  cbcollect_*/ns_server.fts.log | rg "<TIMESTAMP_WINDOW>"

# Memory and quota issues
rg -iN "memory.*quota|OOM|memory.*exceeded|resident" \
  cbcollect_*/ns_server.fts.log | rg "<TIMESTAMP_WINDOW>"

# Partition / DCP issues
rg -iN "partition.*error|DCP.*error|feed.*error|rollback" \
  cbcollect_*/ns_server.fts.log | rg "<TIMESTAMP_WINDOW>"

# Search request failures
rg -iN "search.*failed|query.*error|request.*timeout" \
  cbcollect_*/ns_server.fts.log | rg "<TIMESTAMP_WINDOW>"
```

---

## Views (couchdb.log)

```bash
# View build and indexing errors
rg -iN "view.*build.*error|view.*indexing.*failed|view.*error" \
  cbcollect_*/couchdb.log | rg "<TIMESTAMP_WINDOW>"

# Compaction issues
rg -iN "compaction.*failed|compaction.*error|compaction.*abort" \
  cbcollect_*/couchdb.log | rg "<TIMESTAMP_WINDOW>"

# Design document changes
rg -iN "design.*doc|ddoc.*updated|ddoc.*deleted" \
  cbcollect_*/couchdb.log | rg "<TIMESTAMP_WINDOW>"

# Disk / storage issues
rg -iN "disk.*full|write.*error|open.*failed|no space" \
  cbcollect_*/couchdb.log | rg "<TIMESTAMP_WINDOW>"
```

---

## Eventing (ns_server.eventing.log)

```bash
# Function lifecycle (deploy, undeploy, pause, resume)
rg -iN "deploy|undeploy|pause|resume|lifecycle" \
  cbcollect_*/ns_server.eventing.log | rg "<TIMESTAMP_WINDOW>"

# Execution errors and script failures
rg -iN "error|exception|script.*fail|execution.*fail|timeout" \
  cbcollect_*/ns_server.eventing.log | rg "<TIMESTAMP_WINDOW>"

# DCP stream issues (Eventing uses DCP internally)
rg -iN "DCP.*error|DCP.*fail|feed.*error|rollback|vbucket" \
  cbcollect_*/ns_server.eventing.log | rg "<TIMESTAMP_WINDOW>"

# Timer failures
rg -iN "timer.*fail|timer.*error|timer.*timeout|missed.*timer" \
  cbcollect_*/ns_server.eventing.log | rg "<TIMESTAMP_WINDOW>"

# Worker crashes and restarts
rg -iN "worker.*crash|worker.*restart|worker.*exit|panic" \
  cbcollect_*/ns_server.eventing.log | rg "<TIMESTAMP_WINDOW>"

# Backlog / lag
rg -iN "backlog|lag|pending.*mutations|dcp.*seq" \
  cbcollect_*/ns_server.eventing.log | rg "<TIMESTAMP_WINDOW>"
```

---

## couchbase.log (System Snapshot)

This is a **static snapshot** collected at cbcollect time — not a streaming log. It contains `cbstats` output, cluster config, disk info, and service settings. Useful for configuration and capacity questions.

```bash
# Memory quota settings
rg -iN "memory_quota|memoryQuota|quota" couchbase.log | head -20

# Disk usage at collection time
rg -iN "disk_used|disk_free|couch_docs_actual_disk_size|ep_db_file_size" \
  couchbase.log | head -20

# Active services on each node
rg -iN "services|kv|index|query|fts|eventing|cbas" couchbase.log | head -20

# Cluster version
rg -iN "version|build" couchbase.log | head -10

# ep-engine settings (KV config at collection time)
rg -iN "ep_max_size|ep_item_eviction_policy|ep_failpartialwarmup" \
  couchbase.log | head -20

# Connection counts at collection time
rg -iN "curr_connections|max_connections" couchbase.log | head -10
```

---

## Couchbase Autonomous Operator (cbopinfo/)

Present on CAO-managed clusters. Always check `cbopinfo` first for Kubernetes-managed clusters.

```bash
# Find all log files inside cbopinfo
find cbopinfo*/ -name "*.log" -o -name "*.txt" | sort

# Reconciliation errors and operator decisions
rg -iN "error|failed|unrecoverable|manual.*action" cbopinfo*/ \
  | rg "<TIMESTAMP_WINDOW>"

# Auto-failover and recovery policy decisions
rg -iN "autoFailover|failover|recovery|PrioritizeUptime|PrioritizeDataIntegrity|CountdownExpired" \
  cbopinfo*/ | rg "<TIMESTAMP_WINDOW>"

# Pod eviction and scheduling issues
rg -iN "evicted|OOMKilled|node.*down|pod.*deleted|unschedulable|Pending" \
  cbopinfo*/ | rg "<TIMESTAMP_WINDOW>"

# CouchbaseCluster status changes
rg -iN "Degraded|Balanced|Scaling|Upgrading|Running" \
  cbopinfo*/ | rg "<TIMESTAMP_WINDOW>"

# Operator version
rg -iN "operator.*version|image.*couchbase-operator" cbopinfo*/ | head -5
```

---

## StatsMgr Rate Calculations

When the customer reports ops/s or mutation rates, find consecutive StatsMgr log lines and compute the delta. **Always show both lines and the arithmetic** (required by RULE #2).

```bash
# Find StatsMgr lines in the incident window (memcached.log)
rg -N "total_docs|ep_total_enqueued|ep_commit_num|bytes_written" \
  cbcollect_*/memcached.log | rg "<TIMESTAMP_WINDOW>" | head -20

# Find consecutive lines for a specific stat
rg -N "total_docs=" cbcollect_*/memcached.log | rg "<TIMESTAMP_WINDOW>" | head -10
```

**Rate arithmetic template:**
```
# Line A (from log):
2026-04-23T03:40:11.616Z ... total_docs=2668921153 ...
# Line B (from log, 1 second later):
2026-04-23T03:40:12.616Z ... total_docs=2668928095 ...
# Calculation: (2668928095 - 2668921153) ÷ 1.000s = 6,942 mut/s
```

**For ops/s from ns_server stats:**
```bash
# Find cmd_get / cmd_set stats in ns_server
rg -N "cmd_get|cmd_set|ops" cbcollect_*/ns_server.debug.log \
  | rg "<TIMESTAMP_WINDOW>" | head -20
```

---

## tshark Patterns (pcap / tcpdump Analysis)

If a ticket includes `.pcap` or `.pcap.gz` files, **always analyze with tshark**. Available at `/opt/homebrew/bin/tshark`.

```bash
# Decompress if needed
gunzip -k file.pcap.gz   # produces file.pcap

# Time range and total packet count
tshark -r file.pcap -q -z io,stat,0 2>/dev/null | head -20

# All unique source IPs connecting to port 11210 (KV)
tshark -r file.pcap -Y "tcp.dstport == 11210" -T fields -e ip.src \
  2>/dev/null | sort | uniq -c | sort -rn | head -30

# Source IP distribution via conversation table
tshark -r file.pcap -q -z conv,tcp 2>/dev/null \
  | grep ":11210" | awk '{print $1}' | grep -oE '^[0-9.]+' \
  | sort | uniq -c | sort -rn | head -30

# Sample packet details for a specific source IP
tshark -r file.pcap -Y "ip.src == 192.168.8.49 and tcp.dstport == 11210" \
  -T fields -e frame.time -e ip.src -e ip.dst -e tcp.srcport -e tcp.flags.str -e tcp.len \
  2>/dev/null | head -20

# HTTP traffic on port 11210 (health probe anti-pattern)
tshark -r file.pcap -Y "tcp.dstport == 11210 and http" 2>/dev/null | head -20

# TCP SYN rate per source (connection storm detection)
tshark -r file.pcap \
  -Y "tcp.dstport == 11210 and tcp.flags.syn == 1 and tcp.flags.ack == 0" \
  -T fields -e ip.src 2>/dev/null | sort | uniq -c | sort -rn | head -20

# Payload first bytes (detect non-Couchbase traffic on KV port)
tshark -r file.pcap -Y "tcp.dstport == 11210" \
  -T fields -e ip.src -e data 2>/dev/null | grep -v "^$" | head -20

# Protocol distribution
tshark -r file.pcap -q -z io,phs 2>/dev/null | head -40
```

**For large pcap files**, add `-c 100000` to limit packets analyzed:
```bash
tshark -r file.pcap -c 100000 -Y "tcp.dstport == 11210" -T fields -e ip.src \
  2>/dev/null | sort | uniq -c | sort -rn | head -30
```

---

## Multi-Node Patterns

```bash
# Count pattern occurrences per node
for log in cbcollect_info_*/memcached.log; do
  count=$(rg -ic "OOM" "$log" 2>/dev/null || echo 0)
  echo "$(basename $(dirname $log)): $count"
done

# Show which nodes have a pattern at all (fast filter)
rg -l "pattern" cbcollect_info_*/ns_server.debug.log

# Search across all nodes, preserving node context in output
rg -iN "pattern" cbcollect_info_*/ns_server.debug.log \
  | rg "<TIMESTAMP_WINDOW>"

# Confirm node-local vs cluster-wide (count per node)
for log in cbcollect_info_*/ns_server.debug.log; do
  count=$(rg -ic "timer_lag|Skipped.*check_time" "$log" 2>/dev/null || echo 0)
  echo "$count  $(basename $(dirname $log))"
done | sort -rn
```

---

## Common Workflows

### Workflow 1: Anchor to issue timestamp, expand if sparse
```bash
ISSUE="2026-03-11T14:23"
rg "$ISSUE" cbcollect_*/memcached.log
# If no results, expand to ±5 min:
rg "2026-03-11T14:2[0-8]:" cbcollect_*/memcached.log
```

### Workflow 2: Cross-component correlation at the same timestamp
```bash
TIMESTAMP="2026-03-11T14:23:42"
rg "$TIMESTAMP" cbcollect_*/ns_server.debug.log
rg "$TIMESTAMP" cbcollect_*/ns_server.query.log
rg "$TIMESTAMP" cbcollect_*/ns_server.indexer.log
rg "$TIMESTAMP" cbcollect_*/memcached.log
rg "$TIMESTAMP" cbcollect_*/ns_server.goxdcr.log
```

### Workflow 3: Confirm node-local vs cluster-wide
```bash
# If only one node shows the pattern → node-local issue
rg -l "pattern" cbcollect_info_*/ns_server.debug.log

# Quantify: count per node
for log in cbcollect_info_*/ns_server.debug.log; do
  count=$(rg -ic "pattern" "$log" 2>/dev/null || echo 0)
  echo "$count  $(basename $(dirname $log))"
done | sort -rn
```

### Workflow 4: Index deep-dive for "Index not ready" / query latency
```bash
ISSUE="2026-03-11T14:23"

# Step 1 — which GSI endpoint (host:port) served the errors?
rg -oiN 'GsiScanClient:"[^"]*"' cbcollect_*/ns_server.query.log \
  | rg "$ISSUE" | sort | uniq -c | sort -rn
# → map the winning host:port to the failed/recovering node

# Step 2 — was that index in warmup/building on that node?
rg -iN "not ready|ErrIndexNotReady|index.*warming|index.*building" \
  cbcollect_info_<FAILING_NODE>/ns_server.indexer.log | rg "$ISSUE"

# Step 3 — were replica indexes on surviving nodes in ready state?
rg -iN "replica.*ready|numReplica|replicaId" \
  cbcollect_info_<SURVIVING_NODE>/ns_server.indexer.log | rg "$ISSUE"

# Step 4 — did GSI client attempt retry against replica?
rg -iN "Trying scan again with replica|retry.*replica" \
  cbcollect_*/ns_server.query.log | rg "$ISSUE"
```

### Workflow 5: StatsMgr mut/s rate from consecutive log lines
```bash
# Find consecutive StatsMgr lines around the incident
rg -N "total_docs=" cbcollect_info_<NODE>/memcached.log \
  | rg "2026-03-11T14:2[1-5]:" | head -10
# Pick two consecutive lines 1 second apart, compute delta:
# rate = (value_B - value_A) / (time_B - time_A in seconds)
```

---

## Useful Extractions

```bash
# All unique node names in the cluster
rg -oN 'ns_1@[\w\.\-]+' cbcollect_*/ns_server.debug.log | sort -u

# First and last timestamp in a log (log time range)
rg -oN '\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}' memcached.log | head -1  # first
rg -oN '\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}' memcached.log | tail -1  # last

# Error code frequency from completed_requests
jq -r '.errors[]?.code' cbcollect_*/completed_requests.json 2>/dev/null \
  | sort | uniq -c | sort -rn

# Count pattern frequency per hour (trend analysis)
rg -oN '\d{4}-\d{2}-\d{2}T\d{2}' memcached.log | sort | uniq -c

# Get context around a match (±10 lines)
rg -iN -C 10 "error pattern" logfile.log

# Save results for later reference
rg -iN "pattern" cbcollect_*/memcached.log > /tmp/results.txt
```

---

## Tips

- Always use `-N` to suppress filename prefix when searching a single file; omit `-N` when searching multiple to preserve node context
- Use `-l` to quickly identify which nodes have a pattern before reading lines
- Use `-c` for a fast count before pulling full lines
- For large logs, add `| head -50` to avoid flooding output
- Combine patterns with `|`: `rg "error|timeout|failed"`
- Exclude noise: `rg "error" file | rg -v "expected_error_string"`
- Always show the exact `rg` command before its output (required by RULE #2)
