# CAO Operator Internals — Reconciliation, Upgrades, Rebalance, and Certificates

How the operator thinks and acts: the reconciliation loop, pod lifecycle management, rolling upgrades, rebalance loops, and certificate rotation.

---

## Reconciliation Loop

The operator watches for changes to CouchbaseCluster (and related CRDs) and continuously reconciles actual cluster state toward the desired state in the spec.

**Every change to the CRD triggers a reconcile.** The operator computes a diff between desired and actual, then executes the minimum set of actions to converge. It requeues itself if the cluster is not yet stable.

```
CRD change detected
  → operator reads current cluster state (pod status, CBS REST API)
  → compute diff: what nodes to add/remove, what config to change
  → execute one action (e.g. add node, delete pod, rotate cert)
  → requeue after a delay
  → reconcile again until stable
```

**Why this matters for support:** If the operator log shows repeated `requeue after 30s` (or longer with exponential backoff), something is blocking convergence. Find the last error before the requeue — that is the blocker.

```bash
kubectl logs -n <namespace> -l app=couchbase-operator | grep -E "requeue|error|failed" | tail -50
```

---

## Pod Lifecycle and Identity

CBS pods are not plain Pods — they are managed by the operator directly (not a StatefulSet). The operator creates, deletes, and re-creates pods itself.

**Pod naming:** `<cluster-name>-<pool-name>-<index>`
```
my-cluster-data-0
my-cluster-data-1
my-cluster-index-0
```

The index is stable — `data-0` always refers to the same logical CBS node. The operator uses this to re-attach the correct PVC on restart.

**Pod labels used by operator:**
```bash
kubectl get pods -n <namespace> --show-labels
# couchbase_cluster=<name>, couchbase_service=data/index/query/..., couchbase_node=<name>
```

**What happens when a pod crashes:**
1. Kubernetes marks pod as `CrashLoopBackOff` or `OOMKilled`
2. Operator detects pod not Ready via watch event
3. Operator does NOT immediately delete/recreate — it checks CBS cluster health first
4. If cluster is healthy enough, operator deletes the pod → Kubernetes reschedules → operator re-attaches PVC
5. New pod runs CBS recovery from its own data (persistent storage intact)
6. Once pod joins cluster, operator may trigger a delta-recovery rebalance

---

## Rolling Upgrades

Triggered by changing `spec.image` in the CouchbaseCluster CRD.

**Upgrade sequence (per node):**
1. Operator gracefully fails over the node via CBS REST API (`/controller/startGracefulFailover`)
2. Waits until node is fully failed over (no active vBuckets)
3. Deletes the pod
4. New pod starts with new image
5. New pod joins cluster
6. Operator ejects the old node entry, adds new node, triggers delta recovery
7. Moves to next node

**What blocks an upgrade:**
- Cluster not healthy — operator will not proceed if any bucket has degraded replicas
- Rebalance already in progress — operator waits
- Pod fails to start with new image — operator stops and requeues
- CBS version compatibility check fails (operator knows which CBS versions it supports)

```bash
# Watch upgrade progress
kubectl get couchbasecluster -n <namespace> -w    # status.phase changes: Upgrading → Running
kubectl logs -n <namespace> -l app=couchbase-operator | grep -iE "upgrade|failover|rebalanc"
```

**InPlace vs RollingUpgrade:**
- `RollingUpgrade` (default): graceful failover before pod replacement — safe, slower
- `InPlace`: pod replaced without failover — faster, requires cluster to be healthy and have replicas

---

## Rebalance Loops

The operator triggers rebalances when topology changes (node added/removed, upgrade node rejoins). A "rebalance loop" is when rebalances keep failing and the operator keeps retrying.

**How to detect a rebalance loop:**
```bash
kubectl logs -n <namespace> -l app=couchbase-operator | grep -iE "rebalanc"
# Repeated "starting rebalance" with short intervals = loop
# Check CBS rebalance status:
kubectl exec -n <namespace> <pod> -- curl -s -u Administrator:password \
  http://localhost:8091/pools/default/rebalanceProgress | python3 -m json.tool
```

**Common causes of rebalance loops:**
- Node keeps crashing during rebalance (OOM mid-rebalance → node evicted → operator retries)
- Eventing service WaitUntilReady blocking node ready state (MB-71221 in 8.0.x — eventing-producer crashes, operator sees lost connection, retries rebalance)
- Insufficient memory — CBS OOMs on the destination node receiving data during rebalance
- Network timeout between nodes causing rebalance to fail mid-stream
- `inactivity_timeout` — ns_server kills rebalance worker after ~10 min of no progress (often caused by eventing/auth loop)

**Rebalance failure signals in CBS logs (look in cbopinfo pod logs or cbcollect):**
```
service_rebalance_failed,eventing,{agent_died,...}     → eventing crash during rebalance
inactivity_timeout                                     → rebalance worker killed by ns_server
SyncPhaseDone 401 ERR_UNAUTHENTICATED                  → eventing auth failure looping
```

---

## Certificate Rotation

CAO supports two TLS modes:

**1. Self-signed (operator-managed):**
The operator generates and rotates certificates automatically. Rotation is triggered when certs approach expiry or when forced via annotation.

**2. cert-manager integration:**
`Certificate` objects managed by cert-manager. The operator watches for cert renewal events and triggers a rolling restart of CBS pods to pick up new certs.

```yaml
# Check cert-manager certificate status
kubectl get certificate -n <namespace>
kubectl describe certificate <name> -n <namespace>
# Look for: Ready=True, Not After (expiry), Renewal Time
```

**Cert rotation sequence:**
1. cert-manager renews certificate → updates Secret
2. Operator detects Secret update
3. Operator triggers rolling restart of CBS pods (one at a time)
4. Each pod picks up new cert from mounted Secret on restart

**What breaks cert rotation:**
- cert-manager not installed or Certificate objects missing
- Secret not mounted correctly in pod spec
- Admission webhook cert expired — the webhook itself uses a cert; if expired, all CRD changes are rejected
  ```bash
  kubectl get validatingwebhookconfigurations | grep couchbase
  kubectl describe validatingwebhookconfiguration couchbase-operator-validating-webhook-configuration
  # Look at caBundle and clientConfig.caBundle — if expired, webhook calls fail with TLS error
  ```
- Clock skew between nodes — cert validity window missed
- NetworkPolicy blocking cert-manager ACME HTTP01/DNS01 challenges

**Force cert rotation (operator-managed):**
```bash
kubectl annotate couchbasecluster <name> -n <namespace> \
  couchbase.com/rotate-server-cert="$(date +%s)"
```

**Diagnosing cert issues from CBS side:**
```bash
# Check what cert CBS is currently using
kubectl exec -n <namespace> <pod> -- \
  openssl s_client -connect localhost:18091 -showcerts </dev/null 2>/dev/null \
  | openssl x509 -noout -dates -subject -issuer
```

---

## Admission Webhook

The operator installs a `ValidatingWebhookConfiguration` that validates CouchbaseCluster changes before they're applied. If the webhook is down, all `kubectl apply` to Couchbase CRDs will fail with:

```
Error from server (InternalError): ... failed calling webhook "couchbaseclusters.couchbase.com"
```

```bash
# Check webhook status
kubectl get validatingwebhookconfigurations | grep couchbase
kubectl describe validatingwebhookconfiguration <name>

# The webhook service must be reachable
kubectl get svc -n <namespace> | grep webhook
kubectl get pods -n <namespace> -l app=couchbase-operator    # operator serves the webhook
```

The webhook is served by the operator pod itself. If the operator is crashing, both reconciliation AND webhook validation are broken simultaneously.

---

## Hibernation

Setting `spec.hibernate: true` scales all CBS pods to zero while preserving PVCs. The operator stores last-known state and restores when `hibernate: false`.

Use for non-prod clusters to save compute cost. Data is preserved on PVs.

**Hibernation blockers:**
- Operator does not allow hibernation if cluster is unhealthy (degraded buckets, active rebalance)
- PVCs with `reclaimPolicy: Delete` will lose data if someone deletes pods manually during hibernation — always use `Retain`

```bash
kubectl patch couchbasecluster <name> -n <namespace> \
  --type=merge -p '{"spec":{"hibernate":true}}'
kubectl get pods -n <namespace>    # should scale to 0
```

---

## CouchbaseCluster Status Conditions — Quick Reference

```bash
kubectl get couchbasecluster -n <namespace> -o jsonpath='{.items[0].status.conditions}' | python3 -m json.tool
```

| Condition | Meaning |
|---|---|
| `Available: True` | Cluster is running and all nodes healthy |
| `Balanced: True` | No rebalance needed |
| `Scaling: True` | Scale operation in progress |
| `Upgrading: True` | Rolling upgrade in progress |
| `Hibernating: True` | Pods scaled to zero |
| `Degraded: True` | One or more nodes unhealthy — operator blocked from proceeding |

When `Degraded: True`, the operator will not upgrade, scale, or rotate certs. Resolve the degraded node first.
