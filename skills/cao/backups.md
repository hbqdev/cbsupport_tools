# CAO Operator-Managed Backups

Covers backup/restore architecture, configuration, log locations, troubleshooting, and the cbbackupmgr version compatibility matrix.

Sources: Confluence "Operator-Managed Backups", "The operator-backup image and cbbackupmgr", "Testing S3 Cloud Backups with CAO" (Jack Bakes)

---

## Enabling Operator-Managed Backups

Two steps required:

```yaml
# 1. In CouchbaseCluster:
spec:
  backups:
    managed: true

# 2. Create a CouchbaseBackup resource
apiVersion: couchbase.com/v2
kind: CouchbaseBackup
metadata:
  name: my-backup
spec:
  strategy: full_incremental   # full_only | full_incremental | immediate_full | immediate_incremental | periodic_merge (2.9+)
  full:
    schedule: "0 3 * * 0"     # weekly full
  incremental:
    schedule: "0 3 * * 1-6"   # daily incremental
  size: 20Gi
```

**Also run (one-time):**
```bash
bin/cao create backup    # creates the couchbase-backup RBAC Role and RoleBinding
```

If backup jobs fail with RBAC errors and `namespace/<ns>/role/couchbase-backup` is **absent** from cbopinfo → someone forgot this step.

---

## Backup PVC — Always Created

A PVC is always created, named exactly after the CouchbaseBackup resource:

```bash
kubectl get pvc
# NAME       STATUS   VOLUME     CAPACITY   ACCESS MODES   STORAGECLASS   AGE
# my-backup  Bound    pvc-...    20Gi       RWO            standard       5m
```

- **Local backup:** Actual backup data stored in the PVC at `/data/backups`
- **Cloud backup:** PVC is only a **staging directory** (`/data/staging`). No backup data lives in the PVC — it all goes to the object store.
- **Both cases:** operator-backup script logs always stored in PVC at `/data/scriptlogs`

**Important:** Changing the CouchbaseBackup resource name creates a brand-new PVC. A restore from local storage uses `spec.backup` in the `CouchbaseBackupRestore` resource — it must match the backup PVC name (= backup resource name). Getting this wrong means restoring from an empty PVC.

---

## Backup Archive Structure

### Local storage:
```
/data/backups/archive/
  ├── logs/
  │   ├── backup-0.log          ← cbbackupmgr's own logs (rotated)
  │   └── backup-1.log
  ├── cb-example-2025-02-05T12_10_53/    ← full backup repository
  └── cb-example-2025-02-06T03_00_00/    ← next full backup repository
```

### Cloud storage (S3/Azure/GCS):
```
s3://my-bucket/archive/          ← uri in spec = s3://my-bucket/, archive is appended
  ├── logs/
  │   └── backup-0.log
  └── cb-example-2025-02-05T12_10_53/
```

Repository names: `<cluster-name>-<ISO-timestamp>` (timestamp uses `_` instead of `:` to be filesystem-safe).

---

## How Jobs and CronJobs Are Created

| Strategy | What the Operator Creates |
|---|---|
| `immediate_full` | One Job (runs immediately) |
| `immediate_incremental` | One Job (runs immediately) |
| `full_only` | One CronJob named `<backup>-full` |
| `full_incremental` | Two CronJobs: `<backup>-full` and `<backup>-incremental` |
| `periodic_merge` (2.9+) | CronJobs for full + incremental + a merge job |

The Operator creates Jobs/CronJobs. Kubernetes creates the actual backup pod in response.

**Job timestamp in name:** Job names include a Unix timestamp **in minutes** (not seconds), e.g. `my-backup-full-29006773`. Divide by 60 to get Unix epoch seconds.

---

## operator-backup Workflow (Python Wrapper)

`operator-backup` is a Python script wrapping `cbbackupmgr`. It does extra K8s-specific work:

1. Parse CLI args (passed from Job spec written by Operator)
2. Create K8s client (needed to update CouchbaseBackup/CouchbaseBackupRestore status)
3. Create backup archive at `/data/backups` (local) or stage from cloud (if first run)
4. **Backup:** Create new repository (full) OR run `cbbackupmgr info` to find latest repo (incremental)
5. Run `cbbackupmgr backup` or `cbbackupmgr restore`
6. **Backup only:** Retention — delete repositories older than threshold (entire repos, not individual backups)
7. Update CouchbaseBackup/CouchbaseBackupRestore status in K8s with success/failure
8. Delete old scriptlogs

**Scriptlogs note:** cbbackupmgr output is captured to scriptlogs **after** cbbackupmgr exits. If a backup is still in progress or OOM-killed mid-run, scriptlogs will have nothing from that step.

---

## Log Locations — Know These Cold

### 1. `cbbackupmgr-full.log` (in backup pod)
Path in cbopinfo: `namespace/<ns>/pod/my-backup-full-<timestamp>-<id>/cbbackupmgr-full.log`

**Despite the name, this is the operator-backup (Python) output, not raw cbbackupmgr output.** In recent versions, it *contains* the cbbackupmgr output. This is what customers share when they give you "backup logs."

### 2. Scriptlogs (on PVC)
Path: `/data/scriptlogs/` on the backup PVC. Shows the operator-backup script steps. Access by attaching a pod to the PVC.

### 3. cbbackupmgr logs (in archive)
Path: `/data/backups/archive/logs/backup-0.log` (local) or `<s3-uri>/archive/logs/backup-0.log` (cloud). These are cbbackupmgr's own structured logs.

### 4. CouchbaseBackup status
```bash
kubectl describe couchbasebackup <name> -n <namespace>
# In cbopinfo: namespace/<ns>/couchbasebackup/<name>/<name>.yaml
# Look at status.lastRun, status.failed, status.succeeded, and the capacity field
```

---

## cbbackupmgr Version Matrix

| operator-backup version | cbbackupmgr version |
|---|---|
| 1.3.0 | 7.0.2-6703 |
| 1.3.1 | 7.1.1-3175 |
| 1.3.2 | 7.1.3-3479 |
| 1.3.4 | 7.1.3-3479 |
| 1.3.5 | 7.1.3-3479 |
| 1.3.6 | 7.2.3-6705 |
| 1.3.7 | 7.2.4-7070 |
| 1.3.8 | 7.6.0-2176 |
| 1.4.0 | 7.6.0-2176 |

**Breaking:** cbbackupmgr < 7.6 against CBS 7.6 fails with:
```
failed to unmarshal response: json: cannot unmarshal number -1 into Go struct field .scopes of type uint32
```
Any CBS 7.6+ customer must use operator-backup 1.3.8+. See CBSE-17048.

To check the cbbackupmgr version for any operator-backup image:
```bash
docker run --entrypoint /usr/local/bin/cbbackupmgr couchbase/operator-backup:1.3.8 --version
```

---

## Accessing the Backup PVC

Attach a temporary pod to read logs or run manual cbbackupmgr commands:

```yaml
# Use this Job spec (from CAO docs):
apiVersion: batch/v1
kind: Job
metadata:
  name: backup-troubleshoot
spec:
  template:
    spec:
      restartPolicy: Never
      containers:
      - name: backup-troubleshoot
        image: couchbase/operator-backup:1.3.8   # operator-backup includes cbbackupmgr
        command: ["sleep", "3600"]
        volumeMounts:
        - mountPath: /data
          name: backup-pvc
      volumes:
      - name: backup-pvc
        persistentVolumeClaim:
          claimName: my-backup    # ← must match CouchbaseBackup name
```

```bash
kubectl exec -it job/backup-troubleshoot -- bash
ls /data           # staging/, scriptlogs/, backups/
ls /data/scriptlogs/
cbbackupmgr info --archive /data/backups/archive    # for local backup
```

---

## S3 Cloud Backups — Object Store Setup

```yaml
spec:
  objectStore:
    uri: s3://my-bucket/
    secret: s3-credentials    # K8s Secret with: region, access-key-id, secret-access-key
    endpoint:                 # optional — for non-AWS S3 (MinIO, etc.)
      url: http://minio-svc:9000
      useVirtualPath: false
```

For MinIO/local S3 testing, cbbackupmgr commands from inside the attached pod:
```bash
CB_AWS_FORCE_ENABLE_LOGGING=true cbbackupmgr info \
  --archive s3://backups/archive \
  --obj-staging-dir /data/staging \
  --obj-endpoint http://minio-svc.minio-dev:9000 \
  --obj-region us-east-1 \
  --obj-access-key-id minioadmin \
  --obj-secret-access-key minioadmin \
  --s3-force-path-style \
  --obj-log-level debug-with-body \
  --log-level debug
```

---

## Troubleshooting Checklist

| Symptom | Where to Look | Common Cause |
|---|---|---|
| Backup job never starts | CouchbaseBackup events, CronJob spec | `cao create backup` not run (missing RBAC); wrong schedule format |
| `cannot unmarshal number -1` | cbbackupmgr-full.log | CBS 7.6+ with operator-backup < 1.3.8 |
| Backup pod OOM | pod events, cbbackupmgr-full.log | PVC too small; `cbbackupmgr backup` holding all data in memory during cloud upload |
| Restore fails: no backup found | CouchbaseBackupRestore spec | `spec.backup` doesn't match CouchbaseBackup name (= PVC name) |
| PVC capacity issue | CouchbaseBackup status | Enable `autoscaling` in CouchbaseBackup spec; or manually resize PVC |
| scriptlogs empty / truncated | PVC access | Script was OOM-killed mid-run; check pod exit code (137 = OOMKill) |
| Incremental choosing wrong repo | cbbackupmgr info output | operator-backup picks latest repo alphabetically; if repo names are unexpected, check timestamps |
| Cloud backup fails auth | operator-backup logs | Wrong or expired cloud credentials in the K8s secret; CSP-specific env vars must be set in CronJob |

---

## cbopinfo Paths for Backup Issues

```
namespace/<ns>/couchbasebackup/<name>/<name>.yaml    ← spec/status, last success/failure
namespace/<ns>/cronjob/<backup>-full/                ← CronJob spec for full backups
namespace/<ns>/cronjob/<backup>-incremental/         ← CronJob spec for incrementals
namespace/<ns>/job/<backup>-full-<timestamp>/        ← individual job run
namespace/<ns>/pod/<backup>-full-<ts>-<id>/
    cbbackupmgr-full.log                             ← operator-backup output (what customers share)
    events.yaml
    <pod>.yaml
```
