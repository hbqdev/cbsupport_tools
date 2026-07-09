# CAO Emergency Data Recovery from PVC Files

Use this when a cluster is in an unrecoverable state (most pods deleted/failed), but the PVCs are still intact. Observed repeatedly with Amdocs: K8s worker node issues cause pods to be deleted but they remain in the cluster membership, and hard failover doesn't work.

Source: Confluence "Data Recovery from couch-store files" (Manoj Kumar Pamulapati, 2024-09)

---

## When to Use This

- Cluster is unrecoverable: multiple pods deleted/failed and can't rejoin
- Hard failover hasn't worked
- PVCs still exist and are in `Bound` or `Released` state
- **No usable backup** (if backup exists, always restore from backup first — simpler and more reliable)

This procedure reads raw data files from PVCs using `cbdatarecovery` — best-effort recovery, not a replacement for proper backup/restore.

---

## Prerequisites

1. **Pause the Operator** to prevent it from recreating pods and interfering:
   ```bash
   kubectl patch couchbasecluster <name> -n <namespace> \
     --type=merge -p '{"spec":{"paused":true}}'
   ```

2. **Verify PVCs still exist:**
   ```bash
   kubectl get pvc -n <namespace>
   # Look for the -data-00 PVCs (e.g. cb-cluster-0001-data-00)
   # Status should be Bound or Released — not Deleted
   ```

3. **Have a healthy target cluster** (new or partially recovered) where the data will be pushed.

---

## Recovery Procedure

### Step 1: Create a Recovery Pod Mounting the Data PVC

For each failed node's data PVC, attach a pod to access the raw data:

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: cb-recovery
  namespace: default
spec:
  restartPolicy: Never
  containers:
  - name: couchbase-server
    image: couchbase/server:7.1.3    # use same CBS version as the source cluster
    volumeMounts:
    - mountPath: /mnt/data
      name: data-pvc
  volumes:
  - name: data-pvc
    persistentVolumeClaim:
      claimName: cb-manoj-0001-data-00    # the data PVC from the failed node
```

```bash
kubectl apply -f recovery-pod.yaml
kubectl get pod cb-recovery    # wait for Running
```

**Note:** Use the `-data-00` PVC, not `-default-00`. The default PVC contains node config, not bucket data.

### Step 2: Shell into the Recovery Pod

```bash
kubectl exec -it cb-recovery -- bash
```

### Step 3: Run `cbdatarecovery`

```bash
cbdatarecovery \
  -c <target-cluster-node>:8091 \
  -u Administrator \
  -p password \
  -d /mnt/data \
  --auto-create-collections
```

- `-c` — any healthy node in the **target** cluster (the one you're recovering data *into*)
- `-d /mnt/data` — the mount path of the data PVC
- `--auto-create-collections` — automatically create collections if they don't exist on the target

**Example successful output:**
```
Recovering to 'cb-example-0000'
Copied all data in 3.13s (Avg. 6.90MiB/Sec)
31583 items / 20.69MiB
[============================] 100.00%

| Bucket        | Status    | Transferred | Duration |
| travel-sample | Succeeded | 20.69MiB    | 2.773s   |

| Mutations: Received=31582  Errored=0  Skipped=1 |
```

### Step 4: Repeat for Each Failed Node

Run the same process for each failed node's data PVC:
- `cb-cluster-0000-data-00` → attach recovery pod → run cbdatarecovery
- `cb-cluster-0001-data-00` → same
- `cb-cluster-0002-data-00` → same

Each recovery pod can only mount one PVC at a time (ReadWriteOnce).

---

## PVC Naming Convention

```
<cluster-name>-<pod-index>-data-00       ← bucket data (what you want)
<cluster-name>-<pod-index>-default-00    ← node config (not useful for data recovery)
```

For `storage.md`-named volumes the pattern changes based on `volumeClaimTemplates` names, but typically:
- data volumes end in `-data-00`
- config volumes end in `-default-00`

Confirm with:
```bash
kubectl get pvc -n <namespace>
kubectl describe pv <volume-name>    # look at VolumeHandle for EBS details
```

---

## After Recovery

1. Verify data in the target cluster via the UI or a query
2. Check for `Skipped` items in cbdatarecovery output — these may indicate corruption or version incompatibility
3. Un-pause the Operator if appropriate:
   ```bash
   kubectl patch couchbasecluster <name> -n <namespace> \
     --type=merge -p '{"spec":{"paused":false}}'
   ```
4. If PVCs from the failed nodes are no longer needed, coordinate with customer before deleting — PV reclaim policy may matter

---

## Caveats

- This is **best-effort**: cbdatarecovery reads raw couch-store files. It won't recover data that was only in memory (not yet flushed to disk) at the time of failure.
- Works for active data; may not recover all indexes or XDCR checkpoint state
- `--auto-create-collections` creates collections on the target — verify the target has the correct bucket structure first
- Works only if PVCs are accessible (not deleted). Check `PersistentVolume` reclaim policy — if `Delete`, PVs are gone when PVCs are deleted.
