---
name: couchbase-log-analysis
version: 1.0.0
description: Expert rg patterns and regex filters for analyzing Couchbase server logs. Use when searching logs for errors, performance issues, or debugging.
---

# Couchbase Log Analysis Skill

Expert patterns for searching Couchbase logs with ripgrep (rg).

## Timestamp Formats

**memcached.log**: `2026-03-11T14:23:42.123456`
**ns_server logs**: `[ns_server:info,2026-03-11T14:23:42.123Z]`
**ns_server.query.log**: `{"timestamp":"2026-03-11T14:23:42.123Z",...}`
**ns_server.indexer.log**: `2026-03-11T14:23:42.123456-05:00`

## Timestamp Filtering Pattern

```bash
# Filter by specific time window (example: 14:23:xx)
rg "2026-03-11T14:23:" memcached.log

# Filter by minute range (14:20 to 14:25)
rg "2026-03-11T14:2[0-5]:" memcached.log

# Filter by hour
rg "2026-03-11T14:" memcached.log
```

## Component-Specific Patterns

### KV Engine (memcached.log)

**Out of Memory (OOM)**:
```bash
rg -iN "out of memory|OOM|eviction|resident_ratio" memcached.log
rg -iN "memory.*exhausted|allocation.*failed" memcached.log
```

**DCP (Data Change Protocol)**:
```bash
rg -iN "DCP.*closed|DCP.*timeout|DCP.*failed" memcached.log
rg -iN "BufferLogFull|buffer.*full" memcached.log
rg -iN "stream.*closed|stream.*timeout" memcached.log
```

**Connection Issues**:
```bash
rg -iN "connection.*reset|connection.*closed|ECONNRESET" memcached.log
rg -iN "too many.*connection|connection.*limit" memcached.log
```

**Slow Operations**:
```bash
rg -iN "slow.*operation|operation.*exceeded|threshold.*exceeded" memcached.log
```

**Disk Issues**:
```bash
rg -iN "disk.*full|no space|write.*failed|I/O error" memcached.log
```

### Cluster Management (ns_server.*.log)

**Failover/Rebalance**:
```bash
rg -iN "failover|auto.*failover|node.*down" ns_server.debug.log
rg -iN "rebalance.*failed|rebalance.*error|rebalance.*stopped" ns_server.debug.log
rg -iN "vbucket.*move|vbucket.*transfer" ns_server.debug.log
```

**Node Health**:
```bash
rg -iN "node.*unhealthy|health.*check.*failed" ns_server.info.log
rg -iN "heartbeat.*failed|heartbeat.*timeout" ns_server.debug.log
```

**Network Issues**:
```bash
rg -iN "ETIMEDOUT|ECONNREFUSED|connection refused" ns_server.*.log
rg -iN "network.*error|network.*timeout" ns_server.*.log
```

**Cluster State**:
```bash
rg -iN "cluster.*membership|node.*joined|node.*left" ns_server.info.log
```

### Query (ns_server.query.log, completed_requests.json)

**Query Timeouts**:
```bash
rg -iN "timeout|exceeded.*second|query.*timeout" ns_server.query.log
rg -iN '"code":1080|"code":12009' completed_requests.json  # timeout error codes
```

**Slow Queries (>5 seconds)**:
```bash
# In JSON logs, find elapsedTime > 5000ms
rg '"elapsedTime":"?[5-9]\d{3}' completed_requests.json
rg '"elapsedTime":"?\d{5,}' completed_requests.json  # >10 seconds
```

**Primary Scans (inefficient queries)**:
```bash
rg -iN 'primaryScan|primary.*scan' completed_requests.json
rg '"phaseCounts".*"primaryScan":[1-9]' completed_requests.json
```

**Query Errors**:
```bash
rg -iN '"errors":\[' completed_requests.json  # queries with errors
rg '"code":[^0]' completed_requests.json  # non-zero error codes
```

**Index Selection**:
```bash
rg -iN '"index":"?[^"]*"' completed_requests.json  # which indexes were used
```

### Index (ns_server.indexer.log, ns_server.projector.log)

**Memory Warnings**:
```bash
rg -iN "resident.*percentage|resident.*ratio|memory.*threshold" ns_server.indexer.log
rg -iN "indexer.*RAM.*percentage|RAM.*below.*threshold" ns_server.info.log
```

**Index Build Issues**:
```bash
rg -iN "index.*build.*failed|build.*error|creation.*failed" ns_server.indexer.log
rg -iN "index.*dropped|index.*deleted" ns_server.indexer.log
```

**Performance**:
```bash
rg -iN "scan.*latency|avg.*latency|slow.*scan" ns_server.indexer.log
rg -iN "items.*remaining|backlog|mutations.*queue" ns_server.projector.log
```

### XDCR (ns_server.goxdcr.log)

**Replication Issues**:
```bash
rg -iN "replication.*failed|replication.*error|replication.*stopped" ns_server.goxdcr.log
rg -iN "connection.*timeout|connection.*failed" ns_server.goxdcr.log
```

**Lag/Backlog**:
```bash
rg -iN "replication.*lag|backlog|docs.*remaining" ns_server.goxdcr.log
rg -iN "changes.*left|changes.*pending" ns_server.goxdcr.log
```

**Conflict Resolution**:
```bash
rg -iN "conflict|merge.*failed|resolution.*error" ns_server.goxdcr.log
```

### Views (couchdb.log)

**View Build Issues**:
```bash
rg -iN "view.*build.*error|view.*indexing.*failed" couchdb.log
rg -iN "compaction.*failed|compaction.*error" couchdb.log
```

## Multi-Node Pattern Search

**Search pattern across all nodes**:
```bash
# Count occurrences per node
for log in cbcollect_info_*/memcached.log; do
  echo "=== $(basename $(dirname $log)) ==="
  rg -ic "OOM" "$log"
done

# Show first occurrence per node
for log in cbcollect_info_*/memcached.log; do
  echo "=== $(basename $(dirname $log)) ==="
  rg -iN "OOM" "$log" | head -5
done
```

## Extract Specific Data

**Extract Node IPs/Hostnames**:
```bash
rg -oN 'ns_1@[\w\.-]+' ns_server.debug.log | sort -u
```

**Extract Error Codes**:
```bash
rg -oN '"code":\d+' completed_requests.json | sort -u
```

**Extract Timestamps of Specific Event**:
```bash
rg -oN '\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}' memcached.log | head -1  # first
rg -oN '\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}' memcached.log | tail -1  # last
```

**Count Pattern Frequency**:
```bash
rg -ic "pattern" logfile.log  # total count
rg -i "pattern" logfile.log | wc -l  # line count
```

## Context Extraction

**Get context around matches**:
```bash
rg -iN -C 10 "error pattern" logfile.log  # ±10 lines
rg -iN -B 5 -A 15 "error pattern" logfile.log  # 5 before, 15 after
```

**Follow error chains**:
```bash
# Find error, extract timestamp, search around that time
ERROR_TIME=$(rg -oN '\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}' memcached.log | head -1)
rg "$ERROR_TIME" *.log  # find same timestamp in all logs
```

## Performance Analysis Patterns

**Identify Slow Operations**:
```bash
# Operations taking >100ms
rg -iN 'took.*[1-9]\d{2}.*ms' memcached.log

# Operations taking >1s
rg -iN 'took.*[1-9]\d*\.\d+.*s' memcached.log
```

**Find Resource Exhaustion**:
```bash
rg -iN "too many|limit.*reached|quota.*exceeded|throttled" *.log
```

**Identify Crash Patterns**:
```bash
rg -iN "panic|segfault|core.*dump|fatal.*error|SIGSEGV" *.log
rg -iN "crashed|terminated.*unexpectedly|abnormal.*termination" *.log
```

## Common Search Workflows

### Workflow 1: Find Error and Get Context
```bash
# 1. Find the error
rg -iN "specific error" memcached.log

# 2. Get line number (e.g., 4532)
# 3. Extract context around that line
sed -n '4522,4542p' memcached.log  # lines 4522-4542 (±10 from 4532)
```

### Workflow 2: Time-Based Analysis
```bash
# 1. Extract issue timestamp from ticket
ISSUE_TIME="2026-03-11T14:23"

# 2. Search ±2 minute window
rg "$ISSUE_TIME" *.log  # exact minute
rg "2026-03-11T14:2[1-5]:" *.log  # 14:21-14:25 range

# 3. Count errors in that window
rg -ic "error|failed|timeout" memcached.log | grep -A1 "$ISSUE_TIME"
```

### Workflow 3: Cross-Component Correlation
```bash
# 1. Find error in one component
rg -iN "DCP.*timeout" memcached.log

# 2. Extract timestamp
# 3. Check if other components had issues at same time
TIMESTAMP="2026-03-11T14:23:42"
rg "$TIMESTAMP" ns_server.debug.log
rg "$TIMESTAMP" ns_server.query.log
```

## Tips

1. **Always use -iN**: Case-insensitive (`-i`) with line numbers (`-N`)
2. **Use -c for counts**: Quick overview of pattern frequency
3. **Pipe to less**: `rg pattern file | less` for paginated output
4. **Save results**: `rg pattern file > results.txt` for later analysis
5. **Combine patterns**: `rg "pattern1|pattern2|pattern3"` for OR logic
6. **Exclude false positives**: `rg "error" | rg -v "ignore this"`

## Version-Specific Notes

- **7.6.x**: Index resident ratio warnings introduced
- **8.0.x**: New JSON log formats in some components
- **Capella**: Different log paths and formats
