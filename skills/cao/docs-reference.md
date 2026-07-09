# CAO Docs Reference

Key facts from the official Couchbase Autonomous Operator documentation that matter in support tickets. Focused on defaults, constraints, gotchas, and cloud-specific behavior.

Source: https://docs.couchbase.com/operator/current/

---

## Current Versions (as of CAO 2.9.2, May 2026)

| Component | Supported range |
|---|---|
| CAO | 2.9.2 current |
| Kubernetes | 1.31–1.35 |
| OpenShift | 4.18–4.20 |
| Couchbase Server | 7.2–8.0 (Enterprise) |
| EKS / GKE / AKS | Managed services supported |

---

## Components — Three Parts

1. **CRDs** — schema-validated custom resources (CouchbaseCluster, CouchbaseBucket, etc.)
2. **Dynamic Admission Controller (DAC)** — validates CRD changes synchronously before etcd write; stateless HTTPS webhook; can be cluster-wide or namespace-scoped; served by a separate `couchbase-operator-admission` deployment
3. **Operator** — per-namespace deployment; watches CouchbaseCluster; reconciles actual → desired state

**Installation:**
```bash
kubectl apply -f crd.yaml
bin/cao create admission   # DAC — cluster-wide recommended
bin/cao create operator    # per namespace
```

Verify: `kubectl get deployments` — both `couchbase-operator` and `couchbase-operator-admission` should be `1/1`.

**If DAC is down:** All `kubectl apply` to Couchbase CRDs fail immediately with webhook error (not just reconcile failure). This is a different symptom from the operator being down.

---

## Reconciliation Priority Order

When multiple things need reconciling simultaneously, the operator handles them in this order:

1. Hibernation / Pausing (highest)
2. Prerequisite resources (services, TLS, logging)
3. Cluster creation (pod provisioning)
4. Node reconciliation (topology changes, scaling, upgrades)
5. Post-topology operations (networking, buckets, RBAC, backups)

This explains why a networking fix won't apply until the cluster is healthy — the operator will not advance to step 5 if step 4 is blocked.

---

## CRD Key Fields and Defaults

### Memory quotas (per-service defaults — very low, almost always need overriding):
```
dataServiceMemoryQuota:      256Mi
indexServiceMemoryQuota:     256Mi
analyticsServiceMemoryQuota: 1Gi
eventingServiceMemoryQuota:  256Mi
searchServiceMemoryQuota:    256Mi
```

### Auto-failover:
```yaml
spec:
  cluster:
    autoFailoverTimeout: "120s"    # 5–3600s
    autoFailoverMaxCount: 1        # 1–3 (pre-7.1); wider range post-7.1
    autoFailoverOnDataDiskIssues: false
```

### Index:
```yaml
spec:
  cluster:
    indexer:
      storageMode: "plasma"        # plasma or memory_optimized
      numReplica: 0
```

### Query:
```yaml
spec:
  cluster:
    query:
      maxParallelism: 1
      temporarySpace: "5Gi"
      cboEnabled: true
```

### Auto-compaction:
```yaml
spec:
  cluster:
    autoCompaction:
      databaseFragmentationThreshold:
        percent: 30                # 2–100%
      tombstonePurgeInterval: "72h"
```

### Memory overhead requirement:
Auto-resource allocation adds 25% overhead above all service quotas combined. Always account for this when sizing pods. A pod with 16Gi data quota + 4Gi index quota needs at minimum a 25Gi pod (`(16+4) * 1.25`).

---

## Upgrade Strategies

### Rolling upgrade (SwapRebalance) — default:
```yaml
spec:
  upgrade:
    maxUpgradable: 1              # Fixed count per cycle
    maxUpgradablePercent: 25      # Or % per cycle
    stabilizationPeriod: "1m"    # Pause between cycles
    previousVersionPodCount: 1   # Keep N old-version pods during upgrade
```

### In-place upgrade:
```yaml
spec:
  upgrade:
    upgradeProcess: InPlaceUpgrade   # deprecated field — use upgradeOrderType in 2.9+
```

### 2.9+ upgrade config:
```yaml
spec:
  upgrade:
    upgradeOrderType: ""            # Node, ServerGroup, ServerClass, Service
    upgradeOrder: []
    stabilizationPeriod: "1m"
    previousVersionPodCount: 1
```

**Mixed Mode:** When upgrade is in progress and multiple CBS versions are running, the operator marks the cluster as Mixed Mode. In this state: sidecar pod modifications are disabled and bucket storage backend migrations are disabled. This is expected and temporary.

**Rollback:** Supported while upgrade is in progress (old-version pods still exist).

**WARNING — changing `serverName`:** Changing the `name` field of a server class removes existing pods and deploys new ones, even if services are unchanged. Only change names when intentionally changing topology. Always change `serverName` and `services` simultaneously.

---

## Online Volume Expansion

```yaml
spec:
  enableOnlineVolumeExpansion: true
  onlineVolumeExpansionTimeoutInMins: 10   # 0–30
  volumeClaimTemplates:
  - spec:
      resources:
        requests:
          storage: 2Gi    # Increase value to trigger expansion
```

- Volume can only increase — shrinking requires full pod replacement
- Storage class must have `allowVolumeExpansion: true`
- Block storage (EBS, Azure Disk, GCP PD) typically needs full filesystem expansion
- Network filesystems (Glusterfs, Azure File) support true online expansion
- Falls back to rolling upgrade if online expansion fails

---

## Networking Models

| Model | TLS | Recommended | Notes |
|---|---|---|---|
| Intra-Kubernetes | Optional | Yes | Simplest; uses endpoint DNS + SRV |
| Inter-Kubernetes with forwarded DNS | Optional | Yes | GKE multi-cluster, AWS VPC peering |
| Public with external DNS | Required | Yes | LoadBalancer IPs + `dns.domain` |
| Generic NodePort | None | **NO** | No TLS, breaks if NodePort changes, incompatible with mTLS |

**NodePort is explicitly not recommended for production.** Direct customers away from it.

**SDK minimum versions for exposed features:**
- Java SDK: 2.7.7+
- Go SDK: 1.6.1+
- Node.js SDK: 2.5.0+
- C SDK: 2.9.2+

---

## UI / Admin Console Access

| Method | How | Notes |
|---|---|---|
| Port-forward | `kubectl port-forward <pod> 8091` | Simplest, no TLS required |
| Port-forward TLS | `kubectl port-forward <pod> 18091` | Requires CA cert in browser trust store + localhost SAN |
| DNS-based | `https://console.<dns.domain>:18091` | Requires public networking configured |
| Ingress | Via nginx/Istio | **Requires session affinity** — CBS admin cookies are pod-specific |

**Ingress session affinity is mandatory:**
```
nginx.ingress.kubernetes.io/affinity: cookie
nginx.ingress.kubernetes.io/affinity-mode: persistent
```
Without this, UI requests load-balance across pods and the session is lost.

---

## TLS Configuration

```yaml
spec:
  networking:
    tls:
      rootCAs:
        - couchbase-server-ca
      secretSource:
        serverSecretName: couchbase-server-tls
      tlsMinimumVersion: "TLS1.2"
      nodeToNodeEncryption: ""   # off, control, or all
```

**Important:** CBS 7.0 and earlier support only one CA. Multiple CAs with 7.0 or earlier = undefined behavior.

**PKCS12 support:** CAO 2.7.0+ with CBS 7.6.0+. Key and cert must be PKCS#8 format, unencrypted.

---

## Multi-Cluster / Label Selection

When running multiple CouchbaseCluster resources in the same namespace, use label selectors to prevent one cluster from managing another's buckets/users/backups:

```yaml
spec:
  buckets:
    managed: true
    selector:
      matchLabels:
        cluster: cluster-1     # Only manage CouchbaseBuckets with this label
```

Without selectors, the operator manages ALL unlabeled resources of that type in the namespace.

---

## Backup

```yaml
apiVersion: couchbase.com/v2
kind: CouchbaseBackup
spec:
  strategy: full_incremental   # or full_only, immediate_full, periodic_merge (2.9+)
  full:
    schedule: "0 3 * * 0"
  incremental:
    schedule: "0 3 * * 1-6"
  size: 20Gi
  autoscaling:
    thresholdPercent: 20
    incrementPercent: 20
    limit: 100Gi
```

Cloud storage (S3):
```yaml
spec:
  objectStore:
    secret: s3-secret          # region, access-key-id, secret-access-key
    uri: s3://my-bucket
```

---

## Cloud-Specific Gotchas

### AWS EKS
- Use `io2` EBS (or `gp3` for cost); not `gp2` for production — `gp2` has burst IOPS limits that crush CBS under load
- XDCR across clusters: requires VPC peering, non-overlapping CIDRs, security groups open on TCP 30000–32767 between clusters

### Google GKE
- XDCR: firewall rule "all ingress from 10.0.0.0/8" required
- Control plane firewall must allow port 8443 to DAC pod (required for admission webhook)
- Must create ClusterRoleBinding granting cluster-admin for operator service account

### Microsoft Azure AKS
- **AKS nodes have a maximum disk limit** — restricts how many PVs can attach per node. Limit pods to one PVC (excluding default) when near the limit.
- **Availability Zones are unsupported** — use numeric server group naming instead of AZ names
- Node failure disk recovery requires **manual intervention** — Azure Disk does not auto-detach on ungraceful node failure (similar to EBS but without the force-detach API)

---

## Breaking Changes in CBS 8.0 (via CAO upgrade)

| Change | Impact |
|---|---|
| Default bucket storage engine changed to `magma` | Existing `couchstore` buckets migrated during upgrade |
| Default vBucketCount changed to 128 (was 1024) | New buckets get 128 vBuckets; existing buckets unchanged |
| Memcached buckets removed | Must migrate before upgrading to 8.0 |
| AVX2 CPU required for optimal performance | Check node CPU capabilities before 8.0 upgrade |

---

## Known Issues (CAO 2.9.x)

| Issue | Workaround |
|---|---|
| CouchbaseCluster CRD too large for client-side `kubectl apply` | Use `kubectl apply --server-side` |
| Memcached bucket creation can fail in mixed mode during 8.0 upgrade | Avoid memcached buckets during upgrade |
| Operator may prematurely complete upgrade if operator itself is upgraded mid-process | Upgrade operator and CBS separately |
| IPv6 configuration creates IPv4-only Services | Manual patch required |

---

## MIR — Manual Intervention Required (CAO 2.9+)

Circuit breaker that stops the reconciliation loop when external factors cause repeated failures (TLS expiration, auth errors). Configured via `mirWatchdog` field. When triggered, the operator stops retrying and alerts — prevents runaway requeue loops from masking the root cause.

---

## Best Practices (from official docs)

- **Dedicated nodes:** Use `spec.servers.pod.spec.nodeSelector` + `spec.antiAffinity: true` — prevents "noisy neighbor" CPU/memory/disk/network starvation from other workloads
- **Namespace isolation:** Run operator and clusters in their own namespace — limits RBAC blast radius and simplifies compliance
- **Storage locality:** In cloud, storage must be in the same AZ as the pod (critical for `ReadWriteOnce` block storage)
- **`buckets.synchronize: false`** in production — sync mode is development-only and can cause bucket data loss if CRs are accidentally deleted
- **Guaranteed QoS:** Always set pod `requests == limits` — CBS is OOM-sensitive; Burstable QoS means the pod can be evicted under node pressure before hitting its own limit

**Kernel parameters (apply via DaemonSet):**
```
vm.transparent_hugepage.enabled = never    # THP causes latency spikes
vm.transparent_hugepage.defrag = never
```

**Ulimits:**
```
LimitNOFILE = 40960
LimitMEMLOCK = infinity
```
