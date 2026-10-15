# cbtriage

Local web UI for deterministic Couchbase log triage. No LLM, no network. Python 3 standard library plus `rg`.

    python3 cbtriage/server.py --root ~/Downloads/couchbaselogs/support
    # opens http://127.0.0.1:8765/  (binds to localhost only)

Tabs
- Overview: nodes, services (from each node's own couchbase.log line), versions, per-log first/last timestamps (UTC).
- Findings: runs `signatures.json` against every node. Counts exclude "suppressing duplicate log" lines.
- Timeline: merged, UTC-normalised lines across nodes and files around a time, with regex filter.
- Access log: per-node counts from ns_server.http_access.log, grouped by user, endpoint, client, status or status+size. Nodes with 0 matches are listed, which proves negatives across the cluster.
- Search: rg across chosen files and nodes.
- Report: "Pin to report" on any result, then save `triage_report_vN.md` into the ticket folder (new version every time). Each item carries its command and output.

Add knowledge by editing `signatures.json` (id, title, component, severity, files, regex, meaning, next; optional `flags`, e.g. `["-P"]` for lookahead).
Tickets whose nodes sit in different folders get a "(all nodes in ticket, merged)" collection.
