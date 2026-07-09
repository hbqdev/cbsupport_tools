# CAO Public DNS and Alternate Addresses

Public DNS is the most common CAO deployment for customers exposing a cluster externally. It is also the most common source of connectivity tickets. Understanding all four layers is essential.

Source: Tin Tran (internal runbook, 2026-07)

---

## Why Public DNS Is Hard for Couchbase

Couchbase requires direct per-node access — the SDK does client-side load balancing by mapping vBuckets to specific nodes. A single shared load balancer doesn't work for data traffic. Four things must work together:

1. **Per-pod LoadBalancer services** — each pod gets its own cloud LB with a public IP
2. **External DNS + DDNS** — DNS records updated dynamically as pods come/go
3. **TLS with wildcard SAN** — mandatory when cluster is publicly exposed
4. **`?network=external` in SDK connection string** — tells SDK to use alternate (external) addresses

---

## Layer 1 — Per-Pod LoadBalancer Services

For each CBS pod, the Operator creates a `Service` of type `LoadBalancer`:

```yaml
spec:
  networking:
    exposedFeatureServiceTemplate:
      spec:
        type: LoadBalancer
```

5 data nodes = 5 load balancers, each with its own public IP. The admin console gets a separate shared service (`adminConsoleServiceTemplate: type: LoadBalancer`).

**Why not NodePort?** NodePort exposes on the node IP — not publicly routable, not stable. **Why not ClusterIP?** Cluster-internal only. LoadBalancer is the only type that gets a stable public IP from the cloud provider.

---

## Layer 2 — External DNS and DDNS

External DNS (`kubernetes-sigs/external-dns`) watches Services for DNS annotations and syncs A records to a DNS provider (Cloudflare, Route53, Azure DNS, etc.).

The Operator annotates each per-pod service:
```
external-dns.alpha.kubernetes.io/hostname: cb-cluster-0000.your-domain.com
```

DNS records created:
- `console.<domain>` → admin console LB
- `sdk.<domain>` → SRV record for SDK bootstrap
- `*.〈domain〉` → per-pod A records (e.g. `001.gandalf.example.com`)

**Important:** External DNS does **not** support SRV records for public DNS. External clients must use HTTPS-based bootstrap via `console.<domain>`, not SRV-based bootstrap. This is fine but can have performance differences.

Key ExternalDNS args:
```yaml
args:
- --source=service
- --domain-filter=your-domain.com    # only manage this domain
- --provider=cloudflare              # or route53, azure, google
- --txt-owner-id=my-k8s-cluster      # unique ID to avoid conflicts with other ExternalDNS instances
```

---

## Layer 3 — TLS and Required SANs

When `exposedFeatures` is configured, the Operator **enforces TLS** — no plaintext connections to public endpoints.

Minimum TLS config:
```yaml
spec:
  networking:
    tls:
      rootCAs:
        - couchbase-server-ca
      secretSource:
        serverSecretName: couchbase-server-tls
```

**Required SANs for a cluster named `cb-example` in namespace `default`:**
```
DNS:*.cb-example
DNS:*.cb-example.default
DNS:*.cb-example.default.svc
DNS:*.cb-example.default.svc.cluster.local
DNS:cb-example-srv
DNS:cb-example-srv.default
DNS:cb-example-srv.default.svc
DNS:*.cb-example-srv.default.svc.cluster.local
DNS:localhost
```

**Plus — required for public DNS:**
```
DNS:*.gandalf.rockstar-wizard.com    ← wildcard covers all per-pod hostnames
```

Without the wildcard public DNS SAN, TLS verification fails on all external connections. The DAC validates this SAN is present when `spec.networking.dns.domain` is configured.

**PKCS12:** Supported from CAO 2.7.0 + CBS 7.6.0+.

**Multi-CA:** CAO 2.2+ with CBS 7.1+ supports multiple CAs in `rootCAs`. CBS 7.0 and earlier: one CA only.

---

## Layer 4 — SDK Connection String

```
couchbases://console.gandalf.rockstar-wizard.com?network=external
```

- `couchbases://` — TLS required (the trailing `s`)
- `console.<domain>` — shared bootstrap endpoint (load-balanced across all nodes)
- `?network=external` — SDK uses alternate (external) addresses from node map

**SDK versions that support `?network=external`:**

| SDK | Minimum Version |
|-----|-----------------|
| Go | 2.x+ |
| Java, .NET, C, Node.js, PHP, Python, Ruby | 3.x+ |
| XDCR (Couchbase Server) | 6.6.0+ |
| Sync Gateway | 2.8.2+ |

Older clients don't support explicit network selection — omit `?network=external` and rely on automatic selection.

---

## Alternate Address — The Core Mechanism

Even with LoadBalancer services + DNS working, the **cluster node map must advertise external addresses**, not internal `.svc` FQDNs. Without alternate addresses, external clients get:

```
cb-replica-0000.cb-replica.rcnltxekvzwcspc-y-hc-x-000.svc:18091
```

→ Not resolvable outside Kubernetes → connection fails with `no such host`.

### How the Operator Sets Alternate Addresses

1. Operator watches each per-pod LoadBalancer service's `.status.loadBalancer.ingress`
2. When `ingress` gets an `ip` or `hostname`, the Operator calls the CBS REST API:
   `POST /node/controller/setupAlternateAddresses/external`
3. Uses the `external-dns.alpha.kubernetes.io/hostname` annotation value as the alternate hostname

**Critical:** If `.status.loadBalancer.ingress` is empty or `pending`, the Operator **never sets alternate addresses**. This is the #1 failure point.

### The `pending` LoadBalancer Problem

Cloud providers (AWS, GCP, Azure) write the public IP back to the Kubernetes API. But some platforms (F5 SPK, MetalLB, custom CNI) route traffic externally **without writing back to the Kubernetes API**. Result:
- LoadBalancer service stays `pending` forever
- Operator never detects external address
- Alternate addresses never set
- External clients receive internal `.svc` hostnames → connection fails

**Real ticket example (CBSE-76671 — Verizon/HCL):** F5 SPK on OpenShift. Per-pod LoadBalancer services stayed `pending`. XDCR from OpenStack cluster failed because node map only had internal `.svc` addresses. The shared console VIP worked for bootstrapping, but per-node XDCR connections failed because alternate addresses were never set.

### Verify Alternate Addresses

```bash
curl -sk -u Administrator:<password> \
  https://localhost:18091/pools/default/nodeServices | \
  python3 -m json.tool | grep -A10 "alternateAddresses"
```

Expected output if correctly set:
```json
"alternateAddresses": {
  "external": {
    "hostname": "cb-replica-0000.5gc.example.com",
    "ports": {
      "mgmtSSL": 18091,
      "kvSSL": 11207,
      "capiSSL": 18092
    }
  }
}
```

If `alternateAddresses` block is absent → alternate addresses not set → check LoadBalancer service status.

### Manual Workaround (for testing only)

```bash
# Set manually — Operator WILL overwrite during any pod roll
curl -X PUT https://localhost:18091/node/controller/setupAlternateAddresses/external \
  -u Administrator:<password> \
  --cacert /var/run/secrets/couchbase.com/tls-mount/ca.crt \
  -d "hostname=cb-cluster-0000.your-domain.com" \
  -d "mgmtSSL=18091" \
  -d "kvSSL=11207" \
  -d "capiSSL=18092"

# To prevent Operator overwriting during testing:
kubectl patch couchbasecluster <name> -n <namespace> \
  --type=merge -p '{"spec":{"paused":true}}'
```

---

## Troubleshooting Common Failures

### 1. `no such host` — Internal `.svc` Addresses in Node Map

**Symptom:** `dial tcp: lookup cb-0000.cb.default.svc: no such host`

**Root cause:** Alternate addresses not set. Either:
- LoadBalancer services stuck in `pending` (`.status.loadBalancer.ingress` is empty)
- `dns.domain` not configured in CouchbaseCluster spec

**Check:**
```bash
kubectl get svc -n <namespace> -o wide    # look for EXTERNAL-IP = <pending>
kubectl describe svc <pod-service-name> -n <namespace>    # check .status.loadBalancer.ingress
```
Then run the alternate address check above on a CBS node.

**Fix:** Ensure LoadBalancer services have external IPs. If platform doesn't write back to K8s API → escalate to customer's platform team or use the manual workaround.

---

### 2. TLS Certificate SAN Mismatch

**Symptom:** `x509: certificate is valid for ... not for console.my-cluster.acme.com`

**Root cause:** Server certificate missing the public DNS wildcard SAN.

**Check:**
```bash
openssl s_client -connect console.gandalf.example.com:18091 -showcerts </dev/null 2>/dev/null | \
  openssl x509 -noout -ext subjectAltName
```

**Fix:** Re-issue server certificate with `DNS:*.gandalf.example.com` in the SAN list.

---

### 3. Client Uses Wrong Network Even with `?network=external`

**Symptom:** Bootstrap to `console.<domain>` succeeds. Data operations fail. Logs show internal `.svc` addresses.

**Root cause:** Client doesn't support explicit network selection — see version table in Layer 4.

**Fix:** Omit `?network=external` for older clients. Or upgrade SDK.

---

### 4. DNS Records Not Created

**Symptom:** LoadBalancer has external IP, but DNS queries return `NXDOMAIN`.

**Root cause:** External DNS controller not running or misconfigured.

**Check:**
```bash
kubectl get pods -l app=external-dns                          # is it running?
kubectl logs -l app=external-dns                              # any errors?
kubectl get svc <pod-svc> -o jsonpath='{.metadata.annotations}'   # has external-dns annotation?
```

**Fix:** Verify External DNS RBAC, domain filter matches, DNS provider credentials are valid.

---

### 5. Console Works, XDCR/SDK Data Operations Fail

**Symptom:** Admin UI at `console.<domain>:18091` is reachable. XDCR remote cluster reference can be created. But replication fails with `no such host` for individual nodes.

**Root cause:** The console service is shared across all nodes (works via shared VIP). XDCR needs per-node connections. If alternate addresses aren't set, the XDCR source receives internal `.svc` addresses for each target node.

**Fix:** Verify alternate addresses on target cluster nodes (not just the console endpoint).

---

## Key Configuration Fields

| Field | What It Does |
|---|---|
| `spec.networking.exposedFeatures` | Enables per-pod services and alternate address management |
| `exposedFeatureServiceTemplate.spec.type: LoadBalancer` | Creates cloud LBs with public IPs per pod |
| `adminConsoleServiceTemplate.spec.type: LoadBalancer` | Shared LB for admin UI |
| `spec.networking.dns.domain` | Public DNS domain; used for ExternalDNS annotations AND alternate address hostnames |
| `spec.networking.tls.secretSource.serverSecretName` | Server TLS secret (mandatory for public exposure) |
| `spec.networking.tls.rootCAs` | CA trust pool |
| SDK `?network=external` | Forces SDK to use external (alternate) addresses from node map |

---

## How `dns.domain` and Alternate Address Relate

`spec.networking.dns.domain` serves two purposes:
1. Annotates per-pod LoadBalancer services for External DNS to create DNS records
2. Provides the hostname value when Operator calls `setupAlternateAddresses/external` on CBS

Setting `dns.domain` alone is not enough. The LoadBalancer service must have `.status.loadBalancer.ingress` populated for the Operator to actually call the alternate address API.
