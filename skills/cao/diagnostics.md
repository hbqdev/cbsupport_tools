# CAO Diagnostics — First Response

Read this before starting any CAO/Kubernetes ticket. It covers where to find everything, how to read it, and what commands to run first.

---

## Operator Log Location

The operator runs as a Deployment (typically named `couchbase-operator`) in the CAO namespace — usually `default`, `couchbase`, or a customer-named namespace.

```bash
# Find the operator pod
kubectl get pods -n <namespace> -l app=couchbase-operator

# Stream operator logs
kubectl logs -n <namespace> -l app=couchbase-operator --tail=200 -f

# If there are multiple replicas or restarts
kubectl logs -n <namespace> <operator-pod-name> --previous   # prior container
```

**What to look for in operator logs:**
- `Reconciling CouchbaseCluster` — every change triggers this; shows the operator saw the event
- `error` / `failed` — reconcile failures; always read the full line for context
- `requeue` — operator is retrying; how often tells you how stuck it is
- `upgrade` — upgrade state machine transitions
- `rebalance` — operator-initiated rebalances, failures show here
- `certificate` / `tls` — cert rotation events
- Admission webhook errors — show up as `admission webhook ... denied`

---

## cbopinfo Structure

`cbopinfo` is a zip archive collected by the operator or support. Inside:

```
<cbopinfo-root>/
└── deployment/
    └── <namespace>/           ← customer's namespace
        ├── operator/
        │   ├── deployment.yaml         ← operator Deployment spec
        │   ├── logs/                   ← operator pod logs (current + previous)
        │   └── events.yaml             ← namespace events
        ├── couchbaseclusters/
        │   └── <cluster-name>.yaml     ← the CouchbaseCluster CRD (source of truth)
        ├── pods/
        │   └── <pod-name>/
        │       ├── describe.txt        ← kubectl describe pod output
        │       ├── logs/               ← CBS pod logs per container
        │       └── previous-logs/      ← prior container logs (OOM, crash)
        ├── services/
        │   └── *.yaml
        ├── persistentvolumeclaims/
        │   └── *.yaml
        ├── persistentvolumes/
        │   └── *.yaml
        ├── configmaps/
        ├── secrets/                    ← names only, values redacted
        └── events.yaml
```

**Start here when reading cbopinfo:**
1. `couchbaseclusters/<name>.yaml` — understand the intended topology
2. `operator/logs/` — what the operator was doing/failing at
3. `operator/events.yaml` — timeline of warnings and errors
4. `pods/<node-name>/describe.txt` — for any pod that crashed or is stuck
5. `persistentvolumeclaims/*.yaml` — for storage issues

---

## First-Response kubectl Commands

Run these in order. Read output before moving on.

### Cluster overview
```bash
kubectl get couchbasecluster -n <namespace>                    # cluster status, upgrade state
kubectl describe couchbasecluster <name> -n <namespace>        # full status, conditions, events
kubectl get pods -n <namespace> -o wide                        # pod status, node placement, restarts
kubectl get events -n <namespace> --sort-by='.lastTimestamp'   # chronological event stream
```

### Pod health
```bash
# Any pod not Running/Completed:
kubectl describe pod <pod-name> -n <namespace>    # Events section at bottom is most important
kubectl logs <pod-name> -n <namespace> -c couchbase --tail=100
kubectl logs <pod-name> -n <namespace> -c couchbase --previous   # if crashed

# Resource usage
kubectl top pod -n <namespace>
kubectl top node
```

### Storage
```bash
kubectl get pvc -n <namespace> -o wide             # Bound/Pending status
kubectl get pv -o wide                             # PV → PVC binding, reclaim policy, AZ
kubectl describe pvc <name> -n <namespace>         # Events show why Pending
kubectl describe pv <name>                         # nodeAffinity shows AZ lock
```

### Networking / Services
```bash
kubectl get svc -n <namespace> -o wide             # ClusterIP / LoadBalancer / NodePort, EXTERNAL-IP
kubectl describe svc <name> -n <namespace>         # endpoints, port mappings
kubectl get endpoints -n <namespace>               # which pod IPs are behind each service
```

### TLS / Certs
```bash
kubectl get secret -n <namespace>                              # list secrets
kubectl get certificate -n <namespace>                         # cert-manager Certificate objects
kubectl describe certificate <name> -n <namespace>             # Ready/NotReady, expiry, conditions
kubectl get certificaterequest -n <namespace>                  # pending signing requests
```

### Operator config
```bash
kubectl get deployment couchbase-operator -n <namespace> -o yaml    # operator version, watchNamespace
kubectl get crd | grep couchbase                                     # installed CRD versions
kubectl get validatingwebhookconfigurations | grep couchbase         # admission webhook
```

---

## Reading `kubectl describe pod` Output

Key sections in order of usefulness for triage:

**Status / Conditions:**
```
Status: Running | Pending | CrashLoopBackOff | OOMKilled | Evicted
Conditions:
  PodScheduled      True/False   ← False = no node has capacity or selector match
  Initialized       True/False
  ContainersReady   True/False   ← False = liveness/readiness probe failing
  Ready             True/False
```

**Containers → State:**
```
State: Waiting
  Reason: CrashLoopBackOff       ← check previous logs
  Reason: ContainerCreating      ← check Events for image pull / volume mount errors
Last State: Terminated
  Reason: OOMKilled              ← pod exceeded memory limit; check resource limits vs quota
  Exit Code: 137                 ← OOMKill; Exit Code 1 = application crash
```

**Events section (bottom of describe output) — most important:**
```
Warning  FailedScheduling    0/3 nodes are available: 3 Insufficient memory
Warning  FailedMount         Unable to attach or mount volumes: ... already used by another pod on a different node
Warning  BackOff             Back-off restarting failed container
```
- `FailedScheduling` → resource pressure or node selector mismatch
- `FailedMount` → PVC stuck (ReadWriteOnce in wrong AZ or already attached)
- `Insufficient memory/cpu` → requests exceed available node capacity

---

## Reading `kubectl describe pvc` Output

```
Status: Pending        ← not bound; check Events
       Bound           ← healthy
Access Modes: RWO      ← ReadWriteOnce — can only attach to ONE node at a time
Volume:                ← blank if Pending
StorageClass: gp2      ← check if it supports WaitForFirstConsumer + allowVolumeExpansion
Events:
  Warning  ProvisioningFailed   storageclass.storage.k8s.io "gp2" not found
  Normal   WaitForFirstConsumer Delayed binding until pod is scheduled   ← expected with WaitForFirstConsumer
  Warning  FailedBinding        node(s) had no available volume zone
```

**RWO + multi-AZ = common trap:** A PVC bound in `us-east-1a` cannot be used by a pod scheduled in `us-east-1b`. The operator will keep retrying. Fix: ensure pod and PV are in the same AZ, or use `volumeBindingMode: WaitForFirstConsumer` so the PV binds after the pod is scheduled.

---

## Reading Operator Logs — Patterns

```bash
# Reconcile errors
kubectl logs ... | grep -iE "error|failed|reconcil"

# Upgrade state transitions
kubectl logs ... | grep -iE "upgrade|rollingUpgrade|inplace"

# Rebalance
kubectl logs ... | grep -iE "rebalanc|topology"

# Certificate events
kubectl logs ... | grep -iE "cert|tls|rotat"

# Admission webhook
kubectl logs ... | grep -iE "webhook|admit|deny"
```

**Common operator log patterns and what they mean:**

| Log pattern | Meaning |
|---|---|
| `requeue after` | Operator waiting before retrying — note the duration; long intervals = exponential backoff after repeated failure |
| `cluster not ready` | Operator is blocking an action (upgrade, rebalance) waiting for cluster health |
| `adding node ... to cluster` | Scale-up in progress |
| `removing node ... from cluster` | Scale-down — graceful failover should precede this |
| `failed to reconcile` + stack trace | Operator bug or unexpected cluster state — get full stack |
| `certificate ... not ready` | Cert rotation blocked — CBS pods cannot rotate without valid certs |
| `admission webhook ... connection refused` | Webhook pod is down — CRD changes will be rejected |
