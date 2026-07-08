# CAO Storage — PV, PVC, and Volume Lifecycle

How CAO manages persistent storage, what the operator does when pods restart or move, how to diagnose storage failures, and what goes wrong.

---

## How the Operator Manages PVCs

CAO creates one PVC per volume mount per CBS pod. The naming convention is:

```
<volumeClaimTemplate-name>-<cluster-name>-<node-pool>-<index>
e.g.  couchbase-default-0        (data volume for pool "default", pod 0)
      analytics-default-0        (analytics volume for same pod)
```

**The PVC is tied to the pod identity, not the pod instance.** When a pod is deleted and rescheduled, the operator re-attaches the same PVC. This is how data survives pod restarts. The operator uses label selectors on PVCs to find the right volume when re-creating a pod.

PVCs are **not deleted** when a pod is removed (by design — reclaim policy is `Retain` in production configs). They are only deleted if you explicitly delete the CouchbaseCluster or set `reclaimPolicy: Delete`.

---

## Storage Class Requirements

```yaml
allowVolumeExpansion: true      # Required for online PVC expansion
volumeBindingMode: WaitForFirstConsumer  # Critical for multi-AZ clusters
reclaimPolicy: Retain           # Protect data on pod deletion
```

**`WaitForFirstConsumer` is critical in multi-AZ clusters.** Without it, the PV is provisioned in a random AZ before the pod is scheduled. If the pod lands in a different AZ, the mount fails because `ReadWriteOnce` volumes are AZ-local (EBS, Azure Disk, GCP PD). The bind must happen *after* the scheduler picks a node.

**Check what's in use:**
```bash
kubectl get sc                          # list storage classes
kubectl describe sc <name>              # check volumeBindingMode and allowVolumeExpansion
kubectl get pvc -n <namespace> -o yaml | grep storageClassName
```

---

## PVC Lifecycle States

```
Pending → Bound → Released (if PV manually deleted) → Failed
```

**Pending** — PVC waiting for a PV to be provisioned or bound.

Causes:
- `WaitForFirstConsumer` + pod not yet scheduled → normal, resolves when pod lands
- No storage class found → check `storageClassName` typo in CRD
- No capacity in provisioner → check cloud quota / node capacity
- AZ mismatch — PV exists but in wrong AZ

```bash
kubectl describe pvc <name> -n <namespace>    # Events section shows reason
```

**Bound** — healthy, PV is attached.

**Released** — the PVC was deleted but PV still exists with old claim reference. PV cannot re-bind until you remove `claimRef` from the PV:
```bash
kubectl patch pv <pv-name> -p '{"spec":{"claimRef": null}}'
```

---

## Node Recovery and PVC Re-attachment

When an operator upgrades a node or a pod OOM-kills:

1. Operator deletes the pod
2. Kubernetes schedules a new pod with the same identity (`default-0`)
3. Operator ensures the new pod spec has the same PVC claim name
4. PVC re-attaches to the new pod — **data is preserved**

**What can break this:**
- Node pool `size` was changed and pod index shifts — operator may map wrong PVC
- PV was manually deleted while pod was down
- `reclaimPolicy: Delete` — PV was auto-deleted on pod termination
- PVC stuck on old node (ReadWriteOnce force-detach timeout — common on EKS with EBS)

**EBS force-detach timeout:** When an EC2 node goes NotReady ungracefully, EBS volumes stay attached for up to 6 minutes before AWS force-detaches. The new pod hangs at `ContainerCreating` with `FailedMount` events until the detach completes. This is AWS-side, not a CAO bug.

```bash
# Check if volume is stuck detaching
kubectl describe pvc <name> -n <namespace>
kubectl describe pv <name>       # look for: Message: Volume is already exclusively attached to one node
```

---

## Volume Expansion

To expand a PVC online:

1. Update `volumeClaimTemplates.resources.requests.storage` in the CouchbaseCluster CRD
2. Operator detects the diff and resizes each PVC sequentially
3. Cloud provisioner expands the underlying volume (EBS, etc.)
4. Filesystem resize happens inside the pod automatically (if CSI driver supports it)

**Expansion is one-directional — you cannot shrink a PVC.**

**What goes wrong:**
- Storage class does not have `allowVolumeExpansion: true` → operator cannot resize; error in operator logs
- CSI driver does not support online resize → pod must be restarted after PV expansion
- Expansion quota exceeded at cloud provider level

```bash
kubectl get pvc -n <namespace> -o custom-columns='NAME:.metadata.name,CAPACITY:.status.capacity.storage,REQUEST:.spec.resources.requests.storage'
# If status capacity < spec request, expansion is pending
```

---

## Common Storage Failure Patterns

### PVC stuck in Pending after upgrade or scale-up
```bash
kubectl describe pvc <name> -n <namespace>
# Look for: "no nodes are available that match all of the following predicates"
# or: "node(s) had no available volume zone"
```
Cause: `WaitForFirstConsumer` not set, PV provisioned in wrong AZ. 

Fix: Delete the PVC and PV, let the operator re-provision with the pod scheduled first. Or move the pod's AZ constraint to match the existing PV's AZ.

### Pod stuck at ContainerCreating — FailedMount
```
Warning  FailedMount  Unable to attach or mount volumes: ... already used by another node
```
Cause: Previous pod not fully terminated, or EC2 node ungracefully lost. The EBS volume is still "attached" at the cloud level.

Fix: Wait for AWS force-detach (up to 6 minutes). If urgent: `aws ec2 detach-volume --force --volume-id <vol-id>`. Get volume ID from `kubectl describe pv`.

### PV retained after PVC deletion, now unbound
PV shows `Released`, not `Available`. Kubernetes does not auto-rebind Released PVs.

Fix:
```bash
kubectl patch pv <pv-name> -p '{"spec":{"claimRef": null}}'
# PV transitions to Available and can be claimed again
```

### Data volume vs index volume on same StorageClass
Data service needs sequential I/O (large throughput). Index/GSI needs low-latency random I/O. Running both on `gp2` is a common performance issue. Recommend separate storage classes: `gp3` with provisioned IOPS for index nodes.

---

## CouchbaseCluster Spec — Storage Section Reference

```yaml
spec:
  servers:
  - name: data-nodes
    size: 3
    services: [data]
    volumeMounts:
      default: couchbase        # mounts the PVC named "couchbase-<pod>" at /opt/couchbase/var
    pod:
      resources:
        requests:
          memory: "16Gi"
          cpu: "4"
        limits:
          memory: "16Gi"        # Always equal to requests — Guaranteed QoS
          cpu: "4"
  volumeClaimTemplates:
  - metadata:
      name: couchbase
    spec:
      storageClassName: gp3
      resources:
        requests:
          storage: 500Gi
      accessModes:
      - ReadWriteOnce
```

**`accessModes: ReadWriteOnce`** — the only mode supported for data nodes. Means only one node can mount the volume at a time. This is correct and expected; it is NOT a limitation for Couchbase because each pod owns its own PVC.
