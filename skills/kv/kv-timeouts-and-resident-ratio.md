# KV Timeouts, Slow Operations and Resident Ratio

Diagnostic reference for Data Service (KV) latency: client/SDK timeouts, `Slow operation`
warnings in `memcached.log`, low resident ratio and memory-pressure eviction, and the way
all of these can escalate into an *auto-failover* of an apparently healthy node. Written for
an agent working a live, unsolved ticket.

The hardest version of this topic is the case where the customer says "the node was fine,
nothing was wrong with it, why did Couchbase fail it over?" — that is the shape of the
lead ticket (78045) and most of this file is about how to answer it without guessing.

## When this applies

- "Node was automatically failed over. Reason: **The cluster manager did not respond for the
  duration of the auto-failover threshold**" — one node, repeatedly, same day.
- "Node was automatically failed over. Reason: **The data service is online but the following
  buckets' data are not accessible: …**"
- "Node is accessible and healthy, we see no CPU spikes or storage latency — tell us why it
  failed over."
- SDK-side `UnambiguousTimeoutException` / `AmbiguousTimeoutException` / `ETIMEDOUT` on
  KV GETs or mutations, with or without matching server-side evidence.
- `WARNING … Slow operation: {…}` in `memcached.log` — commonly `GET`, `SET`, `GET_META`,
  `SET_WITH_META`, `DEL_WITH_META`.
- `Slow scheduling for NonIO task '…'. Schedule overhead: N ms` /
  `Slow runtime for '…' on thread …`.
- `Round trip time N is greater than threshold 500; ignoring time offset reply`.
- `Skipped N 'check_time' messages` (`timer_lag_recorder`).
- `ns_memcached:verify_report_long_call … call {get_vbucket_details_stats,…} took too long`,
  `call verify_warmup took too long`, `ensure_bucket took too long`.
- "Resident ratio dropped to X%", "bucket is over its memory quota", "we are seeing lots of
  disk fetches", high `ep_bg_fetched` / `cmd_get` disk-fetch ratio.
- Rebalance failing alongside the above:
  `Rebalance exited with reason {mover_crashed,{{badmatch,false},[{ns_vbucket_mover,…}]}}`.
- "Could not automatically fail over nodes ([…]). Rebalance is running."

## Common root causes

The four causes below produce *nearly identical* customer-visible symptoms (timeouts +
failover on one node). They are separated by **where the time went inside the request**, and
by **whether the anomaly survives removing the workload**. Work the list in that order.

### 1. Hypervisor / VM CPU-scheduling starvation (the lead ticket's final answer)

**What it is.** The guest VM is runnable but not being given a physical CPU promptly ("ready
time" / vCPU steal-adjacent, but *not* the same as `st` steal in `top` — it may not show up
in guest CPU metrics at all). Everything time-sensitive inside the node degrades at once:
the Linux high-resolution timer subsystem, the Erlang BEAM schedulers, and the KV engine's
executor threads.

**Why it causes a failover in 10 s.** `apps/ns_server/src/health_monitor.erl` sends a
heartbeat every `?DEFAULT_REFRESH_INTERVAL` = 1000 ms and marks a peer *inactive* after
`?INACTIVE_TICKS` (2) missed intervals; `ns_server_monitor:analyze_status/2` then reports
`unhealthy` when *all* peers agree the node is inactive, which
`auto_failover:fastfo_down_nodes/1` converts into a failover candidate once the configured
timeout (10 s here — the product minimum for auto-failover) has elapsed in tick periods
(`DownThreshold = (Timeout * 1000 + TickPeriod - 1) div TickPeriod`). **Consequence: a
single ~11-second freeze of the guest is sufficient.** There is no requirement for a crash,
an OOM kill, a `beam.smp` exit or a disk fault — and in 78045 none of those were present.
Do not treat their absence as evidence that nothing happened.

**How to confirm it — the decisive test.** Find an anomaly that *persists after the workload
is removed*:

- `timer_lag_recorder` (`apps/ns_server/src/timer_lag_recorder.erl`) sends itself a
  `check_time` message every 1000 ms and logs
  `Skipped N 'check_time' messages` when `trunc(Lag / 1000) > 0`. This is a pure
  "did the BEAM scheduler get CPU on time" probe — it does no KV work at all.
  In 78045 these continued **after a full VM reboot, with Couchbase freshly started and no
  KV load**. That single fact is what settled the case: scheduler lag with zero workload
  cannot be caused by the workload.
- Kernel evidence in `syslog` / `messages` / `systemd_journal.gz`:
  `kernel: hrtimer: interrupt took 923188 ns`. Linux emits this when servicing the timer
  interrupt itself took far longer than expected (~100 µs order is normal); it means the
  *kernel* was not scheduled promptly, which is below anything Couchbase controls.
- `ns_tick_agent:is_time_in_sync/…`
  (`Round trip time 1289 is greater than threshold 500; ignoring time offset reply`):
  the RTT is `ReceiveTimeMono - SendTimeMono` for a time-offset probe to the master. It is
  *discarded* above the 500 ms `rtt_threshold`, so this line is **not** a clock-skew alert —
  read it purely as "an RPC round trip on this node took >500 ms", i.e. another scheduling
  /latency indicator. Do not report it to the customer as an NTP problem.

**What distinguishes it.** Node-wide, service-agnostic degradation: ns_server *and*
memcached *and* the kernel all slow down in the same window, and the lag reproduces without
load. Contrast with #2, where the slowdown is confined to KV worker/executor threads and
tracks KV work volume.

**Expect the cloud provider to say "no platform events."** In 78045 Azure's first review
found nothing; only after being asked specifically about *vCPU ready time, noisy neighbours,
and host CPU oversubscription* (as opposed to VM migrations / host failures / maintenance —
what their standard check covers) did they confirm **elevated CPU utilisation on the
underlying host**, and note the VM had since been moved to a different host with no
recurrence. Ask the narrow question, naming `hrtimer: interrupt took` and the exact UTC
window; a generic "was there an infra issue?" gets a generic no.

### 2. Node-local KV overload starving the executor pools (the plausible rival)

**What it is.** Real KV work on that one node — disk fetches, hash-table resizes, checkpoint
memory recovery, paging — saturates the reader/writer/NonIO pools, so *everything* queued on
those pools is late, including the calls ns_server makes to decide whether the node is alive.

**How to confirm.**

- `Slow scheduling for NonIO task '<name>' on thread NonIoPool0. Schedule overhead: N ms`
  comes from `KVBucket::logQTime` in `engines/ep/src/kv_bucket.cc`; the queue-time thresholds
  are **>1 s for NonIO** and **>10 s for AuxIO**. Schedule overhead is the enqueue→start
  delay, *not* execution time — it is a direct measure of pool contention. In 78045 the
  overheads were ~1.07 s, i.e. only just over the threshold: real contention, but an order
  of magnitude short of explaining a 15-second stall on its own. Read the magnitude, not
  just the presence of the warning.
- `Slow runtime for '<task>' on thread …` comes from `logRunTime` in the same file and fires
  when a task exceeds its own `maxExpectedDuration()` — per-task, not per-pool. Example from
  78045: `Slow runtime for 'Adjusting hash table sizes.' on thread NonIoPool0: 359 ms`.
- Cross-node comparison is mandatory. Build a table of the same `rg` count across every node
  (`Slow operation`, `Slow scheduling`, `Skipped .* check_time`, hash-table resizes,
  `ep_bg_fetched`). A number is only meaningful relative to peers: in 78045 the elevated
  bg-fetch rate and the slow-scheduling warnings appeared on `.226` **and nowhere else**,
  across ~30 nodes.

**Mechanism worth knowing: hash-table resizing is a stop-the-world event per vBucket.**
Verified in `engines/ep/src/hash_table.cc`: `resizeInOneStep()` takes `MultiLockHolder
mlh(mutexes)` — *every* stripe lock at once — while rehashing. Newer builds also have an
incremental path (`continueIncrementalResize()`), which takes one lock per invocation and
only grabs all locks for the final table swap, plus a `visitorMutex` `try_to_lock` that
defers the resize (`NeedsRevisit::YesLater`) while a visitor is traversing. So on a bucket
with large item counts, a burst of resizes is a legitimate, easily-overlooked source of
latency blips that has nothing to do with disk or network. A node showing thousands of
resizes while peers show single digits is a genuine signal.

**What distinguishes it from #1.** The anomaly is proportional to KV work and disappears
when the work does. If you can find the equivalent of the 78045 post-reboot test — lag or
slowness *with no load* — this cause is ruled out as the primary one.

### 3. Low resident ratio → every metadata op becomes a disk fetch (the amplifier)

This is rarely the whole story but it is very often what turns cause #1 or #2 from "a blip"
into "a failover", and it is the part the customer can actually fix.

**Mechanism.** When estimated memory used crosses the high watermark (default 85 % of the
bucket quota) the ItemPager runs. In current `engines/ep/src/item_pager.cc` the pager
evicts **replicas first** when `kvBucket.canEvictFromReplicas()`, then actives/pendings, with
the per-category ratio computed dynamically as
`std::min(1.0, remainingBytesToEvict / evictableMemory)` and logged as
`Using N bytes of memory, paging out X% of active and pending items, Y% of replica items.`
(Older KB material quotes a fixed 40 % active / 60 % replica bias — treat that as a
version-specific historical detail, not as what current code does; grep the actual log line
instead of quoting percentages.) Eviction continues until the low watermark (default 75 %).

Once resident ratio is below 100 %, a *metadata* operation on a non-resident document must go
to disk. That matters enormously for an **XDCR target**, which is exactly what `.226` was:
the slow ops in 78045 were dominated by `GET_META` and `DEL_WITH_META` arriving from a
separate `10.115.219.x` subnet — i.e. `goxdcr` on the source cluster doing conflict
resolution and tombstone propagation. Every one of those on a non-resident key becomes a
reader-thread background fetch. So a bucket over quota on an XDCR target produces a
self-reinforcing loop: eviction → disk fetches on GET_META/DEL_WITH_META → reader queue
depth → EWOULDBLOCK re-scheduling → executor-pool contention → ns_server's own memcached
calls time out.

**How to read the slow-op trace (this is the highest-value skill in this section).** The
trace field is a set of spans; `Code` values are defined in
`include/memcached/tracecode.h` and include `Request` (whole request), `Execute` (front-end
thread execution), `BackgroundWait` (**waiting for a background fetch to be scheduled** —
i.e. reader-thread queueing/contention) and `BackgroundLoad` (**the actual disk read** — i.e.
the disk itself being slow). From 78045:

```
"duration":"1947 ms", "trace":"request=2169392363630953:1947029
                                execute=2169392363630953:1257
                                execute=2169394002691694:307968"
```

Read it as: total 1947 ms; first execute did 1.3 ms of work then the op yielded
(EWOULDBLOCK, awaiting a fetch); a second execute began ~1639 ms later and ran 308 ms.
**Almost none of the 1947 ms was engine execution.** When `request` ≫ Σ`execute`, the time
was spent queued/blocked, not computing — that points at reader-thread or executor-pool
saturation (and, if `bg.wait`/`bg.load` spans are present, tells you which). Conversely a
single fat `execute` span means real in-engine work.

**Also confirm from stats.** `vb_active_perc_mem_resident` /
`vb_replica_perc_mem_resident`, `mem_used` vs `ep_mem_high_wat` / `ep_mem_low_wat`,
`ep_bg_fetched`, `vb_eject`, `ep_num_value_ejects`, and `vb_checkpoint_memory_bytes`.
Bucket-over-quota is directly visible in Mortimer/Grafana; in 78045 two buckets
(`StoredValueCoupons`, `StoredValueCouponsWallet`) were over quota.

**Fix direction.** Raising bucket quota or adding Data nodes (raising RR so the GETs never
touch disk) is the root fix. Raising reader threads or disk IOPS only widens the pipe to a
disk you should not be hitting — call it mitigation, never resolution.

### 4. Latency outside KV entirely (rule in/out before blaming the server)

A KV timeout is latency anywhere in application → SDK → JVM/GC → app-host OS → network →
server-host OS → KV engine. Two traps specific to this topic:

- **`Slow operation` measures only `response_send - request_recv` inside KV-engine.** Time a
  request spends in the host's TCP receive queue before memcached accepts it, or in the send
  buffer after the response is written, is invisible. **A client-observed timeout with zero
  matching `Slow operation` entry is therefore entirely consistent with the fault being on
  the Couchbase host.** Check `netstat -s` in `couchbase.log` on *both* ends for pruning,
  collapsing, and `tcpzerowindow` before concluding "nothing slow on the server".
- **Capella / no-cbcollect cases.** When the ticket is Capella + PrivateLink + "works from
  my laptop, times out from the pod", the fault is usually customer-side DNS or
  security-group/VPC-endpoint config, and confirmation requires diagnostics run from *inside
  the failing pod/container* — a bastion or sidecar proving TCP+DNS work is not equivalent
  evidence.

### Escalation path: how KV latency becomes an auto-failover

Worth stating explicitly to the customer, because it explains "the node looked fine":

1. KV executor pools / the whole VM get behind.
2. ns_server's calls into memcached go long — `ns_memcached:verify_report_long_call`
   (`call {get_vbucket_details_stats,all,["state"]} took too long: 1481759 us`,
   `call verify_warmup took too long`) and
   `perform_very_long_call_with_timing` (`ensure_bucket took too long: 4745677 us`).
3. `kv_monitor` polls `ns_memcached:bucket_statuses()` with a **500 ms** timeout; buckets
   that don't answer become `not_ready`, and `kv_monitor:get_reason/1` produces
   *"The data service is online but the following buckets' data are not accessible: …"* —
   which is precisely the second failover reason in 78045.
4. In parallel the local management plane itself times out:
   `ns_doctor:get_nodes … {exit,{timeout,{gen_server,call,[ns_doctor,get_nodes]}}}`,
   `Got timeout {timeout,{gen_server,call,[ns_config,get,15000]}}` (a 15 s `gen_server`
   call giving up ⇒ the stall exceeded 15 s ⇒ comfortably past a 10 s failover threshold),
   and `mb_master:send_heartbeat_with_peers … send heartbeat timed out`.
5. Peers stop hearing it: `stats_reader:log_bad_responses … Some nodes didn't respond:
   ['ns_1@…']` from *several* peers, then `auto_failover:log_down_nodes_reason`, then
   failover.

Note the interaction with rebalance: auto-failover is suppressed while a rebalance runs
(`Could not automatically fail over nodes ([…]). Rebalance is running.`), and if the
unresponsive node is a mover participant the rebalance itself dies —
`{mover_crashed,{{badmatch,false},[{ns_vbucket_mover,handle_info,2,…}]}}` — after which the
deferred failover proceeds. That crash is a *downstream consequence* of the node stall, not
an independent ns_server bug; do not open it as a separate rebalance defect.

## Common misdiagnoses

**"Nothing is wrong on the node, so this must be a Couchbase bug / a false-positive
failover."** This is the customer's framing in 78045 ("We have not observed any CPU spikes or
storage latency… no issues were observed on the node") and Azure's too. It is wrong because
the detection window is ~10 s and the guest-side metric resolution is usually 30–60 s
averages — an 11-second freeze is invisible in a 1-minute average and completely explains the
failover. Answer it with the arithmetic (heartbeat 1 s × 2 inactive ticks → 10 s threshold →
observed 15 s `ns_config` timeout), not with reassurance.

**"Absence of an OOM kill / `beam.smp` crash / disk fault means nothing happened."**
Explicitly checked and absent in 78045, and the node still stalled twice. These checks are
worth running (they cheaply rule out real, different root causes) but a clean result narrows
the diagnosis to a *transient stall*; it does not exonerate the node.

**"It's an infra problem" → "no, it's node-local KV overload" → back to infra.** This
reversal happened twice on 78045 and is the single most instructive thing in the ticket.
An intermediate analysis found a genuine KV smoking gun on the failing node only (elevated
bg fetches, hash-table-resize and slow-flusher counts orders of magnitude above all other
nodes, `Slow scheduling` NonIO warnings) and concluded the workload was starving the BEAM
scheduler. That evidence was real. It was still not *sufficient*, because the same
observable — scheduler lag — has two possible causes. The test that decided it:
`timer_lag` warnings continued after a full VM reboot with Couchbase freshly started and no
KV load, plus `hrtimer: interrupt took` in the kernel log. **Rule to carry forward: before
attributing scheduler lag to a workload, check whether the lag persists when the workload
does not.** If you cannot run that test, say the direction of causation is unresolved rather
than picking the side with the prettier grep output.

**Treating `Round trip time … greater than threshold 500` as a clock-sync problem.**
`ns_tick_agent:is_time_in_sync/…` *discards* the sample above the 500 ms `rtt_threshold` and
returns "in sync" — it never concludes the clock is bad. Reporting NTP drift from this line
sends the customer down a dead end. It is a latency indicator only.

**Reporting the `mover_crashed` rebalance failure as a separate issue.** It is caused by the
same unresponsive node (auto-failover was blocked by the rebalance; the mover then hit an
unreachable peer). Filing it separately splits one incident into two and loses the ordering
evidence.

**Re-analysing a previous report's quoted log lines as if it were fresh log analysis.**
Happened on 78045 after the cbcollect had been deleted from local disk: a "new" analysis pass
was produced entirely from excerpts embedded in an older report. Nobody noticed until the
snapshot directory was found to be empty. Re-downloading and re-grepping the raw logs then
surfaced numbers (e.g. thousands of hash-table resizes vs. one on a peer) that had never
existed in the summarised version. **Before treating any directory as analysed, verify the
raw logs are actually present.**

**Asserting a plausible engineering mechanism that the timeline doesn't support.** Recurring
failure mode across this category (seen sharply in the sibling ticket 78212, where a
DCP-reader-holds-the-old-file mechanism supplied by engineering turned out to be 8 hours
away from the compaction window). When engineering hands you a general mechanism, check its
timestamps against *this* incident before adopting it; if it doesn't line up, present it as
background/contributing context, not as the confirmed cause.

### Unresolved disagreement to carry into new tickets

78045 never produced a single agreed root cause, and an agent hitting the same symptom should
know that rather than inherit a false certainty:

- Couchbase Support's final position: environmental — hypervisor-level vCPU scheduling
  (`hrtimer` warnings + post-reboot `timer_lag` with no load).
- Azure's position: no platform events, host failures, maintenance or guest-OS indicators;
  VM stayed on the same host during the incident — *but*, on later review, elevated CPU
  utilisation on the underlying host "which may align with Couchbase findings", and no
  recurrence after the VM moved to a different host on 2026-05-25.
- The intermediate KV-overload analysis was never disproved as a *contributing* factor —
  buckets over quota, low RR, and XDCR metadata traffic on that node were all real.

The honest synthesis is layered, not either/or: a marginal node (over-quota buckets, low RR,
XDCR metadata load hitting disk) had no headroom to absorb a host-level scheduling hiccup, so
a sub-15-second stall crossed a 10-second failover threshold. Present it that way rather than
forcing a single culprit, and flag the residual ambiguity for human judgement.

## Where to look

**Anchor everything to the incident timestamp first**, taken from the customer's own event
list, then search ±2 minutes for log detail and several *hours* back for topology events
(rebalance, failover, quota change, XDCR setup). Note the log timezone — 78045's logs are
`+01:00` while the customer described times in IST; a wrong offset makes every correlation
meaningless.

Pull the **latest** cbcollect from *every* node (cross-node comparison is not optional here),
plus any customer `ticket_files`.

Per-file starting points:

| File | What to grep for |
|---|---|
| `memcached.log` | `Slow operation` (parse `duration` + `trace`), `Slow scheduling for`, `Slow runtime for`, `Adjusting hash table sizes`, `Slow flusher loop`, memory-recovery / `paging out` lines, `Checkpoint` |
| `ns_server.error.log` | `Some nodes didn't respond`, `ns_doctor:get_nodes`, `timeout_diag_logger` |
| `ns_server.debug.log` | `verify_report_long_call`, `perform_very_long_call_with_timing`, `Skipped .*check_time`, `Round trip time`, `send heartbeat timed out`, `log_down_nodes_reason` |
| `ns_server.info.log` / `diag.log` | `auto_failover`, `ns_orchestrator`, `Rebalance exited with reason`, babysitter/`ns_ports_manager` restarts (a fresh boot timestamp here = VM restart) |
| `babysitter.log` | process restarts; a fresh start after a total log gap ⇒ node/VM reboot |
| `stats.log` | `grep mem_usage`, `ep_bg_fetched`, `vb_*_perc_mem_resident`, `ep_mem_high_wat`/`low_wat`, `vb_checkpoint_memory_bytes`, `mctimings` histograms, `mcstat connections` |
| `couchbase.log` | `netstat -s` (pruning / collapsing / `tcpzerowindow`), per-connection `rb`/`tb`, `busy`, `rwnd_limited` |
| `syslog` / `systemd_journal.gz` | `hrtimer: interrupt took`, OOM killer, `blocked for more than`, boot markers |

A total-silence gap across *all* log files for a node at the same instant is VM-level
evidence (freeze/reboot); a gap or error burst in a *single* file is service-level evidence.
Confirm the former with a fresh babysitter/ns_server boot timestamp after the gap.

Source-code anchors verified while writing this file:

- `ns_server`: `apps/ns_server/src/health_monitor.erl` (1 s heartbeat,
  `?INACTIVE_TICKS` = 2, `time_diff_to_status`), `apps/ns_server/src/auto_failover.erl`
  (`fastfo_down_nodes/1`, `DownThreshold` computation), `apps/ns_server/src/kv_monitor.erl`
  (`analyze_status/2`, `get_reason/1`, 500 ms `ns_memcached:bucket_statuses()` timeout,
  `dcp_traffic_monitor` interaction), `apps/ns_server/src/ns_server_monitor.erl`
  (`analyze_status/2`, healthy / unhealthy / potential-network-partition),
  `apps/ns_server/src/timer_lag_recorder.erl` (1000 ms `?TIMER_INTERVAL`,
  `Skipped = trunc(Lag / ?TIMER_INTERVAL)`), `apps/ns_server/src/ns_tick_agent.erl`
  (`is_time_in_sync`, 500 ms `rtt_threshold`).
  Note the path layout: modern branches use `apps/ns_server/src/…`, older ones plain `src/…`.
- `kv_engine`: `engines/ep/src/kv_bucket.cc` (`logQTime` → "Slow scheduling", NonIO >1 s /
  AuxIO >10 s; `logRunTime` → "Slow runtime", per-task `maxExpectedDuration()`),
  `engines/ep/src/hash_table.cc` (`resizeInOneStep()` taking all stripe mutexes;
  `continueIncrementalResize()`; `visitorMutex` `try_to_lock`),
  `engines/ep/src/item_pager.cc` (high-watermark trigger, replica-first eviction, dynamic
  ratios, `paging out …%` log line), `include/memcached/tracecode.h` (`Request`, `Execute`,
  `BackgroundWait`, `BackgroundLoad`, `SetWithMeta`, `Store`, `Get` span codes).
- `goxdcr` is the source of `GET_META` / `SET_WITH_META` / `DEL_WITH_META` traffic on a
  target cluster — if the slow ops are these opcodes from a foreign subnet, you are looking
  at an XDCR *target* and should ask about source-side throughput before treating the load
  as organic application traffic.

Unverified / stated only from the ticket and KB: the exact file defining the
`Adjusting hash table sizes.` task description and its default run interval (the message and
the all-locks resize behaviour are confirmed, the task's own source file was not located);
and the specific `Slow flusher loop` message text.

---

- **Source tickets:** 78045 (lead; also draws on cross-ticket kv themes from 76783, 76849,
  78212 for the misdiagnosis patterns)
- **Reference URLs used:** no reference URLs were supplied with this task. Mechanisms were
  verified against `raw.githubusercontent.com/couchbase/ns_server`
  (`apps/ns_server/src/{auto_failover,health_monitor,kv_monitor,ns_server_monitor,timer_lag_recorder,ns_tick_agent}.erl`)
  and `raw.githubusercontent.com/couchbase/kv_engine`
  (`engines/ep/src/{kv_bucket.cc,hash_table.cc,item_pager.cc}`,
  `include/memcached/tracecode.h`), plus `issues.couchbase.com/browse/MB-45211` for the
  FollyExecutorPool slow-scheduling logging history.
- **Couchbase version(s) involved:** not recorded in ticket 78045's text. Log signatures
  (`CheckpointMemRecoveryTask`, `timer_lag_recorder`, `perform_very_long_call_with_timing`,
  Folly-pool `Slow scheduling` warnings) place it in the 7.2–7.6 range on Linux/Azure VMs;
  confirm from `couchbase.log` / `version.txt` in the cbcollect before quoting version-gated
  behaviour.
- **Built:** 2026-07-26
