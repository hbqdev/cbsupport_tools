# CNG — Cloud Native Gateway (Protostellar)

CNG offers a simpler alternative to public DNS for exposing Couchbase externally. Instead of per-node LoadBalancer services, CNG exposes a **single endpoint** and proxies connections to the correct node/port internally.

Source: Confluence CNG runbook (Brian Powers, 2025-05)

---

## Architecture

CNG runs as a **sidecar container inside each CBS pod** (not as a separate deployment):

```
kubectl get pods
NAME                                                     READY  STATUS
default-0000                                             2/2    Running    ← 2 containers: CBS + CNG
default-0001                                             2/2    Running
default-0002                                             2/2    Running
default-couchbase-admission-controller-...               1/1    Running
default-couchbase-operator-...                           1/1    Running
```

Each CBS pod shows `2/2 Ready` — one CBS container + one CNG container.

**How it differs from public DNS:**
- Public DNS: client connects directly to per-pod LoadBalancer IPs
- CNG: client connects to a single CNG endpoint; CNG tracks cluster topology and proxies to the right node/port
- CNG eliminates the need for per-pod LoadBalancer services and External DNS
- CNG is always deployed via CAO (not standalone)

CNG protocol is called **Protostellar**.

---

## Log Location in cbopinfo

CNG logs are alongside the CBS logs in each pod's directory:
```
namespace/<ns>/pod/<cluster-name>-0000/cloud-native-gateway.log
namespace/<ns>/pod/<cluster-name>-0001/cloud-native-gateway.log
```

If using `cao collect-logs`, look in the pod subdirectory for `cloud-native-gateway.log`.

---

## Checking if CNG Started Successfully

A successful CNG startup produces this log message:
```
{"level":"info","ts":"...","logger":"gateway","caller":"gateway/gateway.go:428",
 "msg":"starting to run protostellar system",
 "advertisedPortPS":18098,"advertisedPortSD":18099}
```

If this message is **absent** → CNG never started. This indicates an Operator-side configuration issue, not a CNG code bug.

**CNG ports:**
- `18098` — Protostellar data port
- `18099` — Protostellar service discovery port

---

## Troubleshooting CNG Issues

### CNG Failing to Start

If `cloud-native-gateway.log` doesn't contain the startup message → the container either crashed before that point or was never started.

Check container status in the pod YAML:
```
# In cbopinfo:
namespace/<ns>/pod/<name>/<name>.yaml
```

Look for the `cloud-native-gateway` container in `status.containerStatuses`. A terminated CNG container:
```yaml
name: cloud-native-gateway
ready: false
restartCount: 0
state:
  terminated:
    exitCode: 137    # 137 = OOMKill; 1 = crash
    reason: Error
    finishedAt: "2024-02-05T11:32:21Z"
```

Check `events.yaml` in the same directory for the termination reason.

**Root cause:** If CNG container is terminated, the issue is almost always Operator configuration (how Operator launched CNG), not CNG itself.

---

### CNG Unreachable After Successful Start

If CNG starts but the exposed endpoint can't be reached from outside → configuration of the containerization platform (OpenShift Routes, TLS config, ingress rules).

Check the certificate being presented:
```bash
openssl s_client -showcerts \
  -servername <cng-fqdn> \
  -connect <cng-endpoint>:18098 </dev/null
```

Common issues:
- Wrong certificate (SAN mismatch)
- Route not configured to pass through to the CNG port
- Firewall rule blocking 18098/18099

---

### Internal Communication Problems

If there are problems between CBS and CNG (or between the k8s control plane and CNG) → Operator is responsible for configuring internal services. Escalate to Operator team rather than CNG team.

---

## Known Issues

### Dynamic Log Level Change Causes Rebalance (pre-CAO 2.7.0)

Changing the CNG log level at runtime triggers a rebalance in Operator versions before 2.7.0.

```yaml
# CouchbaseCluster spec field:
spec:
  networking:
    cloudNativeGateway:
      cloudNativeGatewayLogLevel: "debug"
```

**Workaround:** Upgrade to CAO 2.7.0+ before changing log levels dynamically.

---

## Log Collection Including CBS Logs

Standard `cao collect-logs` collects CNG logs. If CBS server logs are also needed:
```bash
cao collect-logs --collectinfo --collectinfo-collect=all
```

This runs `cbcollect_info` against each CBS container in addition to the normal collection.

---

## Slack Channels for Escalation

- `#protostellar` — CNG-specific questions and issues
- `#kubernetes` — Operator + general Kubernetes questions
