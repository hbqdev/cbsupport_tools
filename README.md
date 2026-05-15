# cbsupport_tools

Couchbase support ticket analysis tools with AI-powered agents.

## Quick Start

### GitHub Copilot CLI Agents

Four custom agents are available for ticket analysis:

| Agent | Role |
|-------|------|
| **ticket-agents-manager** | Orchestrator — full end-to-end analysis with QA and customer response |
| **couchbase-ticket-analyzer** | Log analyst — downloads logs, identifies root cause, outputs JSON |
| **couchbase-docs-expert** | Documentation researcher — docs.couchbase.com, MBs, KB articles |
| **couchbase-source-expert** | Source code researcher — searches github.com/couchbase for timers, defaults, error definitions |

Always invoke via the main Copilot CLI context — never do manual log work in the main context.

**Usage**:
```bash
# In GitHub Copilot CLI, invoke with the task tool:
task(
  agent_type="general-purpose",
  name="ticket-agents-manager",
  prompt="Analyze ticket 76783",
  mode="background"
)
```

See `.github/copilot/agents/README.md` for detailed documentation.

### Scripts

- `prep_ticket_aws.sh` - Download ticket data and logs from AWS S3
- `extract_ticket_timeline.sh` - Extract ticket timeline JSON
- `cb-source-tool/` - Couchbase source code analysis tool

## Agent Workflow

```
ticket-agents-manager
  ├── couchbase-ticket-analyzer   → analysis_metadata.json
  ├── couchbase-docs-expert       → MB/doc research
  └── couchbase-source-expert     → source-level confirmation (when needed)
```

The manager runs QA checks on the analyzer output, then generates `analysis_report.md` with a customer response draft.

## Prerequisites

1. **AWS Credentials**: `aws sso login --profile supportal`
2. **Environment**: Create `.env` with `DIR_TICKETS=/path/to/tickets`
3. **Tools**: `rg` (ripgrep), `jq`, `aws` CLI, `ditto` (macOS — for zip64 cbcollect archives)

## Output Files

```
$DIR_TICKETS/<ticket>/
├── ticket_<number>.raw         # Raw ticket JSON
├── ticket_timeline.json        # Parsed timeline + prior responses
├── snapshots/<uuid>/
│   └── cbcollect_info_*/       # Per-node server logs
├── ticket_files/               # Customer-uploaded logs
├── analysis_metadata.json      # Structured findings (from analyzer)
└── analysis_report.md          # Complete report + customer response (from manager)
```

## Documentation

- **Agent docs**: `.github/copilot/agents/README.md`
- **Legacy agents** (Copilot Workspace): `.factory/droids/`