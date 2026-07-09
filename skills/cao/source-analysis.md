# CAO Source Code Analysis

How to search and read `couchbase/couchbase-operator` source to confirm behavior, trace reconcile logic, find default values, or understand error handling.

---

## Repository

`couchbase/couchbase-operator` — Go

**Key packages:**

| Package | Contents |
|---|---|
| `pkg/controller/` | Main reconciliation logic — cluster, bucket, user, backup, replication controllers |
| `pkg/apis/couchbase/v2/` | CRD type definitions — all CouchbaseCluster spec fields and defaults |
| `pkg/util/` | Shared utilities, retry logic, error handling |
| `pkg/manager/` | Operator startup, leader election, admission webhook server |
| `cmd/operator/` | Entry point |

---

## Version → Tag

Always pin to the customer's exact CAO version before reading code.

```bash
gh api repos/couchbase/couchbase-operator/git/refs/tags \
  | python3 -c "
import sys, json
for t in json.load(sys.stdin):
    ref = t['ref'].replace('refs/tags/','')
    if '2.8' in ref: print(ref)
"
```

---

## Tier 1: GitHub Search (fast)

```bash
# Find a function, log message, or behavior
gh search code "gracefulFailover" --repo couchbase/couchbase-operator --limit 20

# Find a specific log message
gh search code "cluster not ready" --repo couchbase/couchbase-operator --limit 10

# Find where a CRD field is consumed
gh search code "WaitForFirstConsumer" --repo couchbase/couchbase-operator --limit 10

# Find error handling for a specific condition
gh search code "rebalanceProgress" --repo couchbase/couchbase-operator --limit 10
```

## Tier 2: Read File at Exact Tag

```bash
gh api "repos/couchbase/couchbase-operator/contents/pkg/controller/cluster.go?ref=v2.8.0" \
  | python3 -c "import sys,json,base64; d=json.load(sys.stdin); print(base64.b64decode(d['content']).decode())"
```

## Tier 3: Sparse Clone for Deep Reading

```bash
git clone --depth 1 --filter=blob:none --sparse \
  --branch v2.8.0 \
  git@github.com:couchbase/couchbase-operator.git \
  ~/couchbase-src/couchbase-operator-v2.8.0

cd ~/couchbase-src/couchbase-operator-v2.8.0
git sparse-checkout set pkg/controller pkg/apis
```

---

## Common Search Patterns

```bash
# Where does the operator check cluster health before upgrade?
gh search code "Ready\|Degraded\|upgrade" --repo couchbase/couchbase-operator --limit 20

# How does graceful failover work?
gh search code "startGracefulFailover\|graceful" --repo couchbase/couchbase-operator --limit 20

# What triggers a requeue and how long?
gh search code "requeueAfter\|RequeueAfter" --repo couchbase/couchbase-operator --limit 20

# Where is cert rotation triggered?
gh search code "rotateCert\|certificate.*renew\|secret.*tls" --repo couchbase/couchbase-operator --limit 20

# CRD field default values
gh search code "defaultVolumeClaimTemplate\|defaultStorage\|default.*quota" --repo couchbase/couchbase-operator --limit 20
```

---

## Rules

- Always read at the **exact customer CAO version tag** — never `main`
- Show the full `gh` command and its output
- Quote verbatim code — never paraphrase
- Note the file path and line number
- If SSH key lacks SSO access: `gh auth refresh -s read:org`
