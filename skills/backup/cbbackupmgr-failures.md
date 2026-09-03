# cbbackupmgr-failures

Diagnostic reference for `cbbackupmgr` (and Backup Service / CAO `CouchbaseBackup`) runs that fail
outright or complete but take absurdly long. Written for an agent working a live, undiagnosed case.

## When this applies

- "Full backup keeps failing since <date>", "backup fails at the data transfer stage".
- `database or disk is full` / `no space left on device` in the backup log, usually with a
  `failed to commit index transaction` wrapper.
- `stream closed with an unexpected error: DCP stream closed unexpectedly, check the logs for more information`.
- `Stream closed by backup client` (this is the *server* logging that the client closed it — read it as a
  client-side event, not a server fault).
- `memdClient read failure ... read: connection reset by peer` / `failed to dispatch DCP buffer ack` from
  the `(Gocbcore)` log tag inside a cbbackupmgr log.
- "Backup takes N hours, why is our smaller cluster slower than our bigger one?"
- "Support told us to raise `--threads` and it got *slower*."
- Staging PVC/volume filling up repeatedly, or "why does a 40 TB database need 12 TB of staging?"
- CAO-managed: `CouchbaseBackup` `status.failed: true`, backup pod
  `s3-couchbase-backup-<cluster>-full-<n>-<hash>` in `Error`/`CrashLoopBackOff`, or running for >24 h.

## Common root causes

### 1. Staging directory exhausted — `database or disk is full`

**What it is.** For a cloud archive (`s3://`, `az://`, `gs://`), cbbackupmgr does **not** buffer document
*values* locally — those are streamed straight to object store. What it *does* write locally, to
`--obj-staging-dir`, is archive metadata plus a per-bucket **storage index**: one entry per document key,
held in SQLite. So staging consumption scales with **key count × key size**, entirely independently of how
many bytes of value data the bucket holds. The documented sizing formula makes this explicit:

```
staging GB ≈ (num_items × (avg_key_bytes + 30)) / 1000^3   +   (num_backups / 60)
```

At 24.6 B items that first term alone is on the order of 1–2 TB *per backup* for modest keys, before
fragmentation and before the metadata term — which is why "40 TB of data needs 12 TB of staging" is not
anomalous and shouldn't be argued with. Do the arithmetic with the customer's actual item count and avg
key length instead of eyeballing it against bucket size.

**How to confirm.** In the client log (`logs/backup-N.log` inside the archive, or the pod's stdout):

```
failed to commit transaction: failed to commit index transaction: database or disk is full
ERRO: (Rift) failed to execute function | {"error":"... write /data/staging/.../temporary_upload_manifest_264.json.0_...: no space left on device"}
```

`database or disk is full` is SQLite's `SQLITE_FULL`. The `(Rift)` line — Rift is cbbackupmgr's own
storage/object layer — is the same condition surfacing on a plain file write, and is the more literal
proof of ENOSPC. Cross-check with the actual filesystem behind `--obj-staging-dir`.

**Distinguishing trap — two different filesystems can be full.** `SQLITE_FULL` is returned when *either*
the database file's own filesystem *or* SQLite's temp/spill directory hits ENOSPC. SQLite's temp dir is
`SQLITE_TMPDIR` / `TMPDIR` / `/tmp`, which on a container is usually the (tiny) ephemeral root filesystem,
**not** the staging PVC. If `df` on the staging mount shows plenty of headroom but you still get
`database or disk is full`, you are looking at the temp dir, not the staging volume; redirect it with
`SQLITE_TMPDIR` (Linux) / `TMP` (Windows). Prior-to-7.6 builds are documented as hitting this specific
tmpdir exhaustion much more readily; on 7.6+ prefer the plain-ENOSPC-on-staging explanation first.

**Distinguishing from #2/#3.** This one fails *hard and with a clear errno*, and it usually recurs at
roughly the same completion percentage each night. If the log has no space error at all, stop looking here.

**Fix.** Grow the staging volume (CAO: `CouchbaseBackup` `spec.size`, default 20Gi; `spec.storageClassName`;
there is also an `autoScaling` threshold option). Watch for CR drift: resizing the PVC directly with
`kubectl edit pvc` (visible as `manager: kubectl-edit` in `metadata.managedFields`) leaves
`spec.size` stale on the CouchbaseBackup CR, so the next PVC the operator provisions reverts to the old
size. Also sweep stale repos/lock files out of staging — the staging dir is disposable between runs.

### 2. Staging **disk throughput/IOPS** is the bottleneck — slow backup, DCP `BufferLogFull`

**What it is.** The same SQLite storage-index writes that consume staging *space* also consume staging
*I/O*, as many small, largely random writes plus transaction commits (fsync-heavy). When the volume can't
absorb them, cbbackupmgr stops draining its DCP buffers, stops sending `DCP_BUFFER_ACKNOWLEDGEMENT`, and
the server's per-connection `BufferLog` fills. In `kv_engine`, `DcpProducer::BufferLog` (see
`engines/ep/src/dcp/producer.{h,cc}`) tracks `bytesOutstanding` against `maxBytes` (set by the client via
the `connection_buffer_size` DCP control — cbbackupmgr uses 20 MiB, hence `maxBytes:20971520`), and returns
state `Full` once outstanding ≥ max. The producer then parks itself with
`PausedReason::BufferLogFull` (enum in `engines/ep/src/connhandler.h`, alongside `Initializing`,
`OutOfMemory`, `ReadyListEmpty`, `Unknown`) and cannot send another byte until an ACK arrives.

So: **`BufferLogFull` is by construction a statement about the client, not the server.** The server had
data ready and was blocked on the consumer.

**How to confirm.** On the data nodes, `memcached.log`:

```
DCP (Producer) eq_dcpq:cbbackupmgr:<ts>_<pid>_<n> - Unable to notify paused connection because
  DcpProducer::BufferLog is full; ackedBytes:312790235619, bytesSent:20971825, maxBytes:20971520
```

Note the middle field: despite the `bytesSent` label it is *outstanding* bytes, and `outstanding ≈ maxBytes`
is the tell. Then the authoritative one, emitted from `~DcpProducer` and aggregated by
`ConnHandler::getPausedDetailsDescription()`:

```
Destroying connection. Created 80810.651 s ago. Sent 169633099519 bytes. ... Paused 871606 times,
  for 21h:43m:59s total. Details: {"BufferLogFull": {"count":841202,"duration":"20h:37m:11s"},
  "Initializing": {...}, "ReadyListEmpty": {"count":32677,"duration":"41m:15s"}}
```

Read the `Details` histogram as a budget for the whole stream lifetime:

- **`BufferLogFull` dominant** → the *client* was the constraint (disk, CPU, or network on the backup host).
- **`ReadyListEmpty` dominant** → the *server* had nothing queued: backfill-bound (disk reads on the data
  nodes) or genuinely idle. Corroborate with `Scheduling backfill from ... to ...` and
  `ActiveStream::markDiskSnapshot` lines and with node read-I/O stats.
- A per-thread mix is normal and informative — one thread 11 h `BufferLogFull` / 10 h `ReadyListEmpty`
  next to three threads at 20–21 h `BufferLogFull` means the fleet was overwhelmingly client-limited with
  one stream also waiting on backfill.

**Then prove *which* client resource.** `BufferLogFull` alone does not name the culprit; you must pull
backup-**pod/host** stats (not just the cluster cbcollect) and compare each resource against its ceiling:

- disk write rate on the staging device vs. the volume's provisioned throughput,
- network RX vs. the instance's NIC ceiling,
- CPU% vs. allocated vCPU (high load average with low CPU% = blocked on I/O),
- RSS vs. limit.

In the reference case: staging `nvme1n1` averaged ~70 MB/s with bursts to ~97 MB/s against a gp3 volume
provisioned at the **baseline 125 MB/s / 3000 IOPS**; network RX averaged 188 MB/s against a ~50 Gbps NIC;
CPU averaged 365% of 1200%; RSS 15 GB of 330 GB. Only one number was near its ceiling.

**IOPS is often the binding constraint before MB/s — check both.** gp3's 3000 baseline IOPS at SQLite's
small page/journal writes is only single-digit-to-low-tens MB/s of *random* work; sustained 70 MB/s implies
significant merging, and raising throughput without raising IOPS may not move the needle. Recommend both.

**Distinguishing from #3.** Sustained, proportional pausing across the entire transfer, correlating with a
resource pinned at its provisioned cap ⇒ persistent client-side capacity limit (this cause). Abrupt
simultaneous failure ⇒ #3.

**Fix.** Raise the staging volume's provisioned throughput and IOPS (gp3: 125 MB/s → 500+ MB/s, 3000 →
5000–10000 IOPS), or move staging to a volume type that isn't baseline-capped. In the reference case this
took the same backup from 31 h to **10 h** with no other change.

### 3. Abrupt mid-transfer DCP disconnect — client/network, not capacity

**What it is.** All streams to several nodes die within the same second, and the run aborts with
`DCP stream closed unexpectedly`. Because DCP has no resumable cursor for an in-flight backup stream, one
reset connection kills the whole bucket transfer.

**How to confirm.** Client side, note that the three lines share a timestamp to the millisecond:

```
2026-06-02T21:31:39.368 (Gocbcore) memdclient failed to dispatch DCP buffer ack: write tcp
  100.80.235.42:41196->100.82.121.17:11207: write: connection reset by peer
2026-06-02T21:31:39.387 (Gocbcore) memdClient read failure on conn ... read: connection reset by peer
2026-06-02T21:31:39.405 (Cmd) Error backing up cluster: ... stream closed with an unexpected error
```

Server side, the matching socket teardown:

```
WARNING 223: [{"ip":"<pod>","port":41196} - {"ip":"<node>","port":11207} (<ud>Administrator</ud>)]
  Unrecoverable error encountered: ["writing","error"], socket_error: 110:Connection timed out,
  shutting down connection
```

**The ordering matters and is easy to misread.** In the reference case a `BufferLog is full` line preceded
the timeout by 45 seconds. That is *not* an independent network fault — the server had a full buffer, had
nothing it was allowed to write, and the socket write eventually timed out because the client never ACKed.
Sequence `BufferLogFull` → `socket_error: 110` on the *same* connection means cause #2 progressed to a
disconnect. Reserve "network/infrastructure disruption" for the case where the drop is simultaneous across
nodes **with no preceding BufferLogFull**, or where `errno` is a reset (`104`) arriving out of nowhere.

**Distinguishing.** Timing shape is the discriminator: same-second across all nodes with clean buffer state
= external network/firewall/pod eviction; slow bleed with hours of pause history = #2 reaching its timeout.

### 4. Item count, not data size, sets the duration

Two clusters on identical hardware diverge wildly because backup cost is dominated by *keys*, not *bytes*:
values bypass staging entirely and go straight to object store, while every key becomes a storage-index
row. A 23 TB / 24.6 B-item bucket took 31 h where a 140 TB cluster on the same instance type and the same
gp3 profile finished in 16 h.

Always get item counts before theorising: `cbbackupmgr info`, the archive's `info.json`, or the client log's
own completion record —

```
(Plan) (Data) Successfully transferred key value data for bucket 'oh_persist' |
  {"duration":"22h26m50s","stats":{"total_items":24593810217,"bytes_received":20915027063485, ...}}
```

Corollary: "the two environments are identical" from a customer usually means *identical instance type*.
It rarely covers storage class, provisioned IOPS/throughput, or data shape. Ask for
`aws ec2 describe-volumes --volume-ids <id> | egrep -i "iops|through"` (or the equivalent) on **both**
sides, plus item counts on both, before accepting the comparison.

### 5. Phase attribution — never treat "took 31 hours" as one block

Backups run in phases (bucket settings → view/GSI/FTS definitions → KV data transfer → multipart upload →
**storage index upload** → cleanup), and each phase logs its own `(Plan)` completion line with a duration.
In the reference case:

| Phase | Duration |
|---|---|
| small bucket, 1.47 M items | 4.5 s |
| `oh_persist` KV data transfer, 24.59 B items / ~20.9 TB | 22 h 26 m |
| multipart upload to S3 | 1 m 17 s |
| **`oh_persist` storage index upload** | **8 h 41 m** |

The index-upload phase was 28% of wall clock and involves *no DCP at all* — it is pure staging-disk read
plus object-store PUT. An analysis that only looks at DCP stats silently ignores it. Grep
`Successfully transferred key value data`, `Successfully uploaded storage indexes`, and neighbouring
`(Plan)` lines and build the phase table before choosing a theory.

### 6. Other confirmed cbbackupmgr failure modes worth ruling out early

These did not appear in the source ticket for this topic but are cheap to exclude and share the same
symptom surface (documented in the cbbackupmgr known-issues KB — treat as "per docs", mechanism not
re-derived here):

- **Rollback**: `client received rollback, either purge this backup or create a new backup repository`
  → bucket metadata purge interval is shorter than the backup interval (check
  `ep_persistent_metadata_purge_age` in `stats.log`). Every backup after the rollback becomes a full backup.
- **Version skew**: `cannot unmarshal number -1 into Go struct field .scopes of type uint32` → cbbackupmgr
  older than 7.6 against a ≥7.6 cluster. Not a bug; the tool must be ≥ the cluster version.
- **Cloud backend semantics**: ADLS Gen2 can't support the directory semantics cleanup needs
  (`failed to create directory ...: not a directory`), so one failed backup makes *every* later backup fail.
- **Silent no-op deletes**: a `cbbackupmgr remove` / retention sweep reporting success is not evidence the
  objects were deleted (regression seen between operator-backup 1.4.1 and 1.5.1 on `az://`). If the
  presenting symptom is space exhaustion, verify against the storage backend itself.
- **Windows, cbbackupmgr 8.0.0**: operation succeeds but the process never exits.

## Common misdiagnoses

**"Raise `--threads` to speed it up."** This was recommended in the source ticket (1 → 4) and had to be
walked back in a later reply. It looks right: the docs literally say "more clients mean faster backups",
the pod had 12–16 vCPU and 330 GiB free, and the default of 1 looks obviously under-provisioned. It was
wrong because each additional thread is another concurrent DCP client *and another concurrent writer into
the same SQLite storage index on the same volume*. When the binding constraint is a shared, capacity-capped
resource, parallelism adds contention (and fsync serialisation), not throughput. Result: 25 h at threads=1
became 31 h at threads=4, with pod load average climbing from ~74 to ~142 while CPU utilisation stayed low
— the classic I/O-blocked signature. **Rule out before recommending threads:** confirm from backup-host
stats that no resource is already at its ceiling. If staging disk is capped, revert to `threads=1` and fix
the volume instead. `--threads` genuinely helps only when the client has spare disk *and* CPU headroom and
the streams are `ReadyListEmpty`-bound.

**"Network bandwidth is the bottleneck."** Carried in from an earlier ticket on the same customer/clusters,
where network had genuinely been the constraint. Plausible here too — long transfer, remote S3 target — and
it consumed several round trips. Ruled out by measuring instead of assuming: pod network RX averaged
~188 MB/s (~1.5 Gbps) against an r5n.12xlarge's 50 Gbps ceiling, i.e. ~3% utilised. **Do not inherit a root
cause from a prior ticket on the same cluster** — re-measure. Historical findings are hypotheses, not priors.

**"Same instance type ⇒ same performance profile."** Both backup pods ran r5n.12xlarge with identical CPU
and memory requests, which made the 31 h vs 16 h gap look inexplicable and pushed the investigation toward
exotic theories. The divergence lived in what "identical" didn't cover: item count (24.6 B vs. unknown but
far fewer keys per byte) and the fact that the *same* gp3 baseline (3000 IOPS / 125 MB/s) is adequate for
one workload and crippling for the other. Ask for storage provisioning and item counts explicitly.

**"Disk is full again" when the staging mount has free space.** Fixing ENOSPC once (2 TB → 7 TB → 12 TB)
does not mean the next `database or disk is full` has the same cause; and a `SQLITE_FULL` can come from the
SQLite temp dir on a completely different filesystem. Check `df` on the staging mount *and* on
`$SQLITE_TMPDIR`/`$TMPDIR` before growing the volume a third time.

**Reading `Stream closed by backup client` as a server-side stream failure.** It is the server reporting
that the *client* tore the stream down. It points the investigation at the backup host, not at KV.

## Where to look

**Client side (cbbackupmgr).**

- `<archive>/<repo>/logs/backup-N.log` — repo-level as of Totoro and later; older builds put them at
  `<archive>/logs/`. Absence at the old path is not "logs missing". Rotates at 200 MB, keeps 5.
- `cbbackupmgr collect-logs` output zip (`cbbackupmgr-collectinfo-archive-<ts>.zip`) — this is a **separate
  artifact from the server cbcollect** and is where the client-side truth lives. Always ask for both.
- If the archive is unreachable so `collect-logs` itself fails: rerun with
  `--log-level debug --obj-log-level debug`, plus `GODEBUG=netdns=2` and (S3) `CB_AWS_FORCE_ENABLE_LOGGING`.
- Profiles when the host looks saturated but you can't tell which way: `CB_GOLANG_PPROF` (CPU),
  `CB_GOLANG_MEM_PROF` (memory).
- Useful patterns:
  - `rg 'no space left|disk is full|SQLITE_FULL' logs/backup-*.log` — then bucket by date
    (`rg -o '^\d{4}-\d{2}-\d{2}' | sort | uniq -c`) to see when the failure regime started.
  - `rg '\(Plan\).*Successfully' logs/backup-*.log` — builds the phase/duration table.
  - `rg '\(Cmd\) (cbbackupmgr version|config|backup)'` — version, archive URI, staging dir, `--threads`.
  - `rg '\(Gocbcore\).*(read failure|connection reset|failed to dispatch DCP buffer ack)'` — disconnects;
    check whether their timestamps cluster in a single second.
  - `rg 'ERRO: \(Rift\)'` — object-store/staging write errors from cbbackupmgr's storage layer.

**Server side (KV).** `memcached.log` on each data node; every backup stream is named
`eq_dcpq:cbbackupmgr:<ISO-ts>_<pid>_<threadIdx>`, so the suffix tells you which client thread you're
looking at.

- `rg 'eq_dcpq:cbbackupmgr.*Destroying connection'` — the single most valuable line: lifetime, bytes sent,
  and the `Details` pause histogram. Do this on **every** data node, not one.
- `rg 'DcpProducer::BufferLog is full'` — compare the `outstanding` value against `maxBytes`.
- `rg 'Unrecoverable error encountered.*socket_error'` — socket teardown with errno.
- `rg 'Scheduling backfill|markDiskSnapshot'` — how much of the stream was served from disk.
- `stats.log`: `ep_persistent_metadata_purge_age` (rollback theory), item counts per bucket.

**Source pointers (mechanism).**

- `kv_engine` — `engines/ep/src/dcp/producer.h` / `producer.cc`: `DcpProducer::BufferLog`
  (`insert`/`acknowledge`/`release`/`setBufferSize`/`getState` → `Disabled|SpaceAvailable|Full`),
  the "Unable to notify paused connection…" log, `isStuck()` (disconnects a producer whose `ackedBytes`
  hasn't moved within the limit — a stalled backup client eventually gets hung up on), and the
  `~DcpProducer` "Destroying connection" emit.
- `kv_engine` — `engines/ep/src/connhandler.h`: `enum class PausedReason { BufferLogFull, Initializing,
  OutOfMemory, ReadyListEmpty, Unknown }`, the `PausedDetails` struct (`reasonCounts[]`,
  `reasonDurations[]`) and `getPausedDetailsDescription()` that renders the JSON histogram.
- `couchbase-operator` — `CouchbaseBackup` CRD: `spec.size` (staging PVC, default 20Gi),
  `spec.storageClassName`, `spec.threads` (default 1), `spec.objectStore.uri`, `spec.strategy`,
  `spec.autoScaling`; `status.lastSuccess` / `status.lastFailure` / `status.failed` are the fastest way to
  date the onset. The `s3-couchbase-backup-<cluster>-<full|incremental>-<n>-<hash>` pod's args echo the
  full cbbackupmgr command line.
- `couchbase/backup` (the cbbackupmgr Go source, incl. the Rift storage layer) is **not public** — the
  404 on `raw.githubusercontent.com/couchbase/backup` is expected. Claims about cbbackupmgr internals here
  are derived from docs plus observed log strings, not from reading that source.

**Ask the customer for, early:** item count per bucket and average key size; staging volume type and its
provisioned IOPS *and* throughput (both clusters if they're comparing); `--threads`; backup-pod CPU/disk/
network stats covering the run window; and whether the PVC was resized outside the CR.

---

- Source tickets: 78583
- Reference URLs used:
  - https://docs.couchbase.com/server/current/backup-restore/cbbackupmgr-cloud.html
  - https://docs.couchbase.com/server/current/backup-restore/cbbackupmgr-backup.html
  - https://docs.couchbase.com/operator/current/resource/couchbasebackup.html
  - https://raw.githubusercontent.com/couchbase/kv_engine/master/engines/ep/src/dcp/producer.cc
  - https://raw.githubusercontent.com/couchbase/kv_engine/master/engines/ep/src/dcp/producer.h
  - https://raw.githubusercontent.com/couchbase/kv_engine/master/engines/ep/src/connhandler.h
- Couchbase version(s) involved: cbbackupmgr 7.6.7-6712 (linux/amd64), CAO-managed cluster on AWS EKS
  (r5n.12xlarge backup node, gp3 staging PVC); server version not stated in-ticket beyond the 7.6 line
  implied by the backup client.
- Built: 2026-07-26
