# cbsupport_tools

Couchbase support ticket analysis tools with AI-powered agents.

## Quick Start

Four agents are available for ticket analysis:

| Agent | Role |
|-------|------|
| **ticket-agents-manager** | Orchestrator — full end-to-end analysis with QA and customer response |
| **couchbase-ticket-analyzer** | Log analyst — downloads logs, identifies root cause, outputs JSON |
| **couchbase-docs-expert** | Documentation researcher — docs.couchbase.com, MBs, KB articles |
| **couchbase-source-expert** | Source code researcher — searches github.com/couchbase for timers, defaults, error definitions |

### Factory Droids (`.factory/droids/`) — Primary

The Factory droids are the primary and most up-to-date agents. Invoke via the Droid task tool:

```
Analyze ticket 76783
```

The orchestrator (`ticket-agents-manager`) runs end-to-end analysis automatically.

### AI CLI Agents (`.claude/agents/`)

The same agents are available for the Claude AI CLI.

### GitHub Copilot CLI Agents (`.github/copilot/agents/`)

The same agents are available for GitHub Copilot CLI. See `.github/copilot/agents/README.md` for usage.

### Scripts

- `prep_ticket_aws.sh` - Download ticket data and logs from AWS S3
- `extract_ticket_timeline.sh` - Extract ticket timeline JSON
- `cb-source-tool/` - Couchbase source code analysis tool

## Agent Workflow

```
ticket-agents-manager
  ├── couchbase-ticket-analyzer   → analysis_metadata_vN.json
  ├── couchbase-docs-expert       → MB/doc research (mandatory)
  └── couchbase-source-expert     → source-level confirmation (when docs insufficient)
```

The analyzer produces a versioned JSON file. The manager runs QA checks (verbatim log enforcement, Jira MB verification, prior response review, tshark pcap enforcement) then generates a versioned `analysis_report_vN.md` containing the full analysis and customer response draft. Re-running analysis increments N without overwriting prior work.

## Log Analysis Skill

`.factory/skills/couchbase-log-analysis/SKILL.md` — read by the analyzer before every log search. Contains:

- Log file reference for all components (KV, Cluster, Query, Index, XDCR, FTS, Views, Eventing, Babysitter, couchbase.log, CAO/cbopinfo)
- Timestamp formats and filtering patterns
- Quick triage patterns for first-pass diagnosis
- Component-specific `rg` patterns
- StatsMgr mut/s rate calculation workflow
- tshark patterns for pcap analysis
- Multi-node correlation workflows

## Prerequisites

1. **AWS Credentials**: `aws sso login --profile supportal`
2. **Environment**: Create `.env` with `DIR_TICKETS=/path/to/tickets`
3. **Jira**: `~/.couchbase-support/jira.env` with `JIRA_INSTANCE_URL`, `JIRA_USER_EMAIL`, `JIRA_API_KEY` — see [`docs/jira-mcp-setup.md`](docs/jira-mcp-setup.md) for full setup instructions including optional MCP server config
4. **Tools**: `rg` (ripgrep), `jq`, `aws` CLI, `ditto` (macOS — for zip64 cbcollect archives), `tshark` (for pcap analysis)

## Output Files

```
$DIR_TICKETS/<ticket>/
├── ticket_<number>.raw              # Raw ticket JSON
├── ticket_timeline.json             # Parsed timeline + prior responses
├── snapshots/<uuid>/
│   └── cbcollect_info_*/            # Per-node server logs
│   └── cbopinfo*/                   # CAO operator logs (CAO-managed clusters)
├── ticket_files/                    # Customer-uploaded logs
├── analysis_metadata_vN.json        # Structured findings (from analyzer)
└── analysis_report_vN.md            # Complete report + customer response (from manager)
```