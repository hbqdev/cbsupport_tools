# CAO Skills Index

SME-level reference for Couchbase Autonomous Operator (CAO 2.x+) and Kubernetes. Read the relevant skill before analyzing any CAO ticket.

| Skill | When to read |
|-------|-------------|
| [diagnostics.md](diagnostics.md) | **Every CAO ticket** — first-response commands, cbopinfo structure, how to read describe/event output |
| [storage.md](storage.md) | PV/PVC issues, pod stuck at ContainerCreating, volume expansion, node recovery |
| [networking.md](networking.md) | External connectivity, public DNS / alternate addresses, LoadBalancer/NodePort, TLS port mapping |
| [operator-internals.md](operator-internals.md) | Upgrade stuck, rebalance loops, cert rotation, admission webhook, reconciliation failures |
