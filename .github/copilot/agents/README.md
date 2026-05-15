# GitHub Copilot Custom Agents

Custom agent definitions for Couchbase support ticket analysis. These agents are invoked by the Copilot CLI (main context) using the `task` tool — never do manual log work in the main context.

## Available Agents

### `ticket-agents-manager` — Orchestrator (use this by default)

Manages the full ticket analysis workflow end-to-end.

- Invokes `couchbase-ticket-analyzer` for log analysis
- Invokes `couchbase-docs-expert` for documentation/MB research
- Invokes `couchbase-source-expert` for code-level questions
- Performs QA checks on findings
- Generates `analysis_report.md` with customer response

**Output**: `$DIR_TICKETS/<ticket>/analysis_report.md`

---

### `couchbase-ticket-analyzer` — Log Analyst

Downloads and analyzes cbcollect/ticket_files from S3.

- Selects the latest snapshot automatically (when multiple exist)
- Anchors analysis to the customer's **primary complaint**, not secondary events
- Searches component logs with ±2 min timestamp precision:
  - KV: `memcached.log`
  - Query: `ns_server.query.log`, `completed_requests.json`
  - Index: `ns_server.indexer.log`, `ns_server.projector.log`
  - Cluster: `ns_server.info.log`, `ns_server.debug.log` (both — debug contains NACK/supervisor signals not in info)
  - XDCR: `ns_server.goxdcr.log`
  - FTS: `ns_server.fts.log`
- For query latency / "Index not ready" issues: mandatory 4-step index deep-dive (impacted queries → index state per node → replica availability → GSI retry path)
- All evidence must be verbatim log lines; all causal claims require evidence on both sides

**Output**: `$DIR_TICKETS/<ticket>/analysis_metadata.json`

---

### `couchbase-docs-expert` — Documentation Researcher

Searches official Couchbase sources for error definitions, known bugs, and behavioral documentation.

- docs.couchbase.com
- issues.couchbase.com (MBs)
- support.couchbase.com (KB articles)

---

### `couchbase-source-expert` — Source Code Researcher

Searches `github.com/couchbase` and `github.com/couchbaselabs` source code. Use when docs don't explain a behavior, or to find timer/default values, error definitions, version diffs. Always pass the exact CBS/SDK version — it reads code at that git tag.

---

## Agent Flow

```
ticket-agents-manager
  ├── couchbase-ticket-analyzer   (log analysis → JSON)
  ├── couchbase-docs-expert       (MB/docs research)
  └── couchbase-source-expert     (source code, when needed)
```

---

## Prerequisites

```bash
# AWS SSO (for S3 log downloads)
aws sso login --profile supportal

# .env in repo root
DIR_TICKETS=/path/to/tickets   # e.g. ~/Downloads/couchbaselogs/support
```

Required tools: `rg` (ripgrep), `jq`, `aws` CLI, `ditto` (macOS, for zip64 archives)

---

## File Outputs

```
<ticket>/
├── ticket_<number>.raw         # Raw ticket JSON
├── ticket_timeline.json        # Parsed timeline + prior responses
├── snapshots/<uuid>/
│   └── cbcollect_info_*/       # Per-node cbcollect logs
├── ticket_files/               # Customer-uploaded logs
├── analysis_metadata.json      # Structured findings (analyzer)
└── analysis_report.md          # Complete report + customer response (manager)
```

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| AWS SSO expired | `aws sso login --profile supportal` |
| `DIR_TICKETS` not set | Add to `.env` in repo root |
| zip64 extraction fails | Use `ditto -xk file.zip dest/` (not `unzip`) |
| Agent re-downloads existing logs | Delete partial dir or agents will skip existing cbcollect |

---

## Comparison with `.factory/droids`

| `.factory/droids` | `.github/copilot/agents` |
|-------------------|--------------------------|
| Copilot Workspace | Copilot CLI |
| `ticket-agents-manager.md` | `ticket-agents-manager.md` |
| `couchbase-ticket-analyzer.md` | `couchbase-ticket-analyzer.md` |
| `couchbase-docs-expert.md` | `couchbase-docs-expert.md` |
| `couchbase-source-expert.md` | `couchbase-source-expert.md` |

Both sets are kept in sync. See `MIGRATION.md` for differences in invocation syntax.
