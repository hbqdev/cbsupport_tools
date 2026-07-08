# CAO Networking — Services, DNS, and Public Access

How CBS pods are exposed inside and outside Kubernetes, how DNS works, what public DNS means in the CAO context, and how to diagnose connectivity issues.

---

## Service Topology Overview

CAO creates multiple services per cluster. Understanding all of them is required to diagnose connectivity issues.

```
Per-pod services (headless):
  <cluster-name>-<pod-name>-svc          ← one per CBS pod, stable DNS for peer-to-peer

Cluster-wide services:
  <cluster-name>                          ← ClusterIP, round-robin to all pods (not used by CBS internally)
  <cluster-name>-ui                       ← port 8091/18091, for Couchbase Web Console access
  <cluster-name>-srv                      ← headless service, DNS SRV records for SDK auto-discovery

Exposed services (when spec.networking.exposeAdminConsole or exposedFeatures set):
  <cluster-name>-exposed-<feature>        ← LoadBalancer or NodePort per exposed service
```

```bash
kubectl get svc -n <namespace> -o wide    # see all services, their types, EXTERNAL-IP
kubectl get endpoints -n <namespace>      # which pod IPs are registered behind each service
```

---

## Per-Pod Services and Internal DNS

Each CBS pod gets its own headless service. This gives it a stable DNS name:

```
<cluster-name>-<pool>-<index>-svc.<namespace>.svc.cluster.local
e.g. my-cluster-default-0-svc.couchbase.svc.cluster.local
```

CBS nodes use these names to talk to each other — **not pod IPs**. Pod IPs change on restart; service DNS does not. This is how the cluster maintains node identity across pod restarts.

**When pod-to-pod DNS breaks:**
- CBS nodes show as failed/unreachable even though pods are Running
- Verify the headless services exist and have the correct endpoints:
  ```bash
  kubectl get svc -n <namespace> | grep <cluster-name>
  kubectl get endpoints <cluster-name>-default-0-svc -n <namespace>
  # Endpoints should list the pod IP — if blank, pod is not Ready
  ```

---

## Public DNS / External Exposure

`spec.networking.exposeAdminConsole` and `spec.networking.exposedFeatures` control external access.

```yaml
spec:
  networking:
    exposeAdminConsole: true           # creates LoadBalancer service for port 8091
    exposedFeatures:
    - xdcr
    - client
    - admin
    exposeFeatureServiceType: LoadBalancer   # or NodePort
    adminConsoleServiceType: LoadBalancer
```

When `exposeFeatureServiceType: LoadBalancer`, the operator creates one LoadBalancer service per feature per pod. Each pod gets its own external IP/hostname. **This is intentional** — CBS clients must be able to address each node directly (no NAT proxy), so each pod needs its own externally reachable address.

**The alternate address problem** — the most common public DNS issue:

CBS nodes advertise their address to clients during bootstrap. Without `dns.domain` set, they advertise their internal Kubernetes DNS names (e.g. `my-cluster-default-0-svc.couchbase.svc.cluster.local`). Clients outside the cluster cannot resolve these.

With `spec.networking.dns.domain` set, the operator configures CBS to advertise the external DNS names as "alternate addresses." Clients outside use alternate addresses; clients inside use internal names.

```yaml
spec:
  networking:
    dns:
      domain: my-cluster.example.com    # base domain for per-pod DNS records
```

The operator expects DNS records like:
```
my-cluster-default-0.my-cluster.example.com  →  <LoadBalancer IP for pod 0>
my-cluster-default-1.my-cluster.example.com  →  <LoadBalancer IP for pod 1>
```

**These DNS records must be created externally** (Route53, Cloud DNS, etc.) — CAO does not create them. If they don't exist or point to wrong IPs, external clients fail to connect.

```bash
# Check what alternate addresses CBS has registered
kubectl exec -n <namespace> <pod-name> -- \
  curl -s -u Administrator:password http://localhost:8091/pools/default/nodeServices \
  | python3 -m json.tool | grep -A5 "alternateAddresses"
```

---

## Diagnosing External Connectivity

### Client connects but gets redirected to internal DNS
Symptom: SDK connects to LoadBalancer IP, succeeds, but then fails on subsequent operations with "Unknown host: my-cluster-default-0-svc.couchbase.svc.cluster.local"

Cause: Client bootstrapped successfully but CBS sent back internal node addresses. No `dns.domain` set or alternate addresses not configured.

Fix: Set `spec.networking.dns.domain`, create matching DNS records for each pod's LoadBalancer IP, ensure ports 8091-8096, 11210, 18091-18096 are accessible.

### LoadBalancer service stuck in Pending (no EXTERNAL-IP)
```bash
kubectl describe svc <service-name> -n <namespace>
# Events: "Error syncing load balancer: ... no suitable external load balancer provider found"
# or: cloud provider quota exceeded
```
- On bare-metal / on-prem: need MetalLB or similar LoadBalancer provider
- On EKS/GKE/AKS: check cloud IAM permissions for the controller to create LBs
- NodePort is an alternative: set `exposeFeatureServiceType: NodePort`

### NodePort — port ranges
NodePort assigns a port in the 30000–32767 range per service port. Clients must use `<node-IP>:<nodePort>`. All cluster nodes must be reachable on those ports. Firewall rules are frequently the blocker.

```bash
kubectl get svc -n <namespace> -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.spec.type}{"\t"}{.spec.ports[*].nodePort}{"\n"}{end}'
```

---

## TLS and Port Mapping

| Port | Service | TLS | Notes |
|------|---------|-----|-------|
| 8091 | REST / UI | No | Plain HTTP |
| 18091 | REST / UI | Yes | HTTPS |
| 11210 | KV (data) | No | memcached binary protocol |
| 11207 | KV (data) | Yes | TLS KV |
| 8093 | Query (N1QL) | No | |
| 18093 | Query (N1QL) | Yes | |
| 8094 | Search (FTS) | No | |
| 18094 | Search (FTS) | Yes | |
| 8096 | Eventing | No | |
| 18096 | Eventing | Yes | |
| 21100–21299 | Indexer internal | — | Must be open for index service inter-node |
| 4369, 21100 | Erlang distribution | — | Internal cluster communication |

In CAO with TLS enabled, all external communication should use TLS ports. The operator enables/disables TLS in the CouchbaseCluster spec:

```yaml
spec:
  security:
    tls:
      static:
        serverSecret: <secret-name>    # server TLS cert
        operatorSecret: <secret-name>  # operator internal TLS cert
```

---

## Network Policies

If NetworkPolicy resources exist in the namespace, CBS pod-to-pod and pod-to-operator traffic may be blocked silently. Symptoms: cluster forms but nodes fail to join, or rebalance hangs.

```bash
kubectl get networkpolicy -n <namespace>
kubectl describe networkpolicy <name> -n <namespace>
```

Required ingress/egress for CBS pods:
- All pods in the namespace on all ports (CBS inter-node communication is broad)
- Operator pod to CBS pods on 8091/18091 (health checks, REST)
- Clients to CBS pods on relevant service ports

---

## Debugging Connectivity from Inside the Cluster

```bash
# Test DNS resolution from inside a CBS pod
kubectl exec -n <namespace> <pod> -- nslookup <cluster-name>-default-0-svc.<namespace>.svc.cluster.local

# Test port connectivity between pods
kubectl exec -n <namespace> <pod-A> -- curl -s http://<pod-B-svc-name>:8091/pools

# Check what address CBS is advertising
kubectl exec -n <namespace> <pod> -- curl -s http://localhost:8091/nodes/self | python3 -m json.tool | grep -E "hostname|alternateAddresses"
```
