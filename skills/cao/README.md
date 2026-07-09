# CAO Skills Index

SME-level reference for Couchbase Autonomous Operator (CAO 2.x+) and Kubernetes. Read the relevant skill before analyzing any CAO ticket.

| Skill | When to read |
|-------|-------------|
| [diagnostics.md](diagnostics.md) | **Every CAO ticket** — first-response commands, cbopinfo structure, how to read describe/event output |
| [storage.md](storage.md) | PV/PVC issues, pod stuck at ContainerCreating, volume expansion, node recovery |
| [networking.md](networking.md) | External connectivity, LoadBalancer/NodePort, TLS port mapping, Network Policies |
| [public-dns.md](public-dns.md) | Public DNS / alternate addresses — the most common external connectivity issue; 4-layer architecture, troubleshooting failure points |
| [operator-internals.md](operator-internals.md) | Upgrade stuck, rebalance loops, cert rotation, admission webhook, reconciliation failures |
| [backups.md](backups.md) | Backup/restore issues — operator-backup workflow, cbbackupmgr version matrix, log locations, PVC access |
| [cng.md](cng.md) | Cloud Native Gateway (Protostellar) — CNG sidecar architecture, startup check, troubleshooting |
| [data-recovery.md](data-recovery.md) | Emergency recovery when cluster is unrecoverable but PVCs intact — cbdatarecovery procedure |
| [source-analysis.md](source-analysis.md) | Search `couchbase/couchbase-operator` source to confirm reconcile logic, defaults, error handling |
| [docs-reference.md](docs-reference.md) | Official docs distilled — defaults, cloud gotchas, upgrade strategies, known issues, best practices |
