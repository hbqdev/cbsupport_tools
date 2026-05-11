# cbsupport_tools

Couchbase support ticket analysis tools with AI-powered agents.

## Quick Start

### GitHub Copilot CLI Agents

Three custom agents are available for ticket analysis:

1. **ticket-agents-manager** - Full orchestration with QA and customer response
2. **couchbase-ticket-analyzer** - Log analysis and root cause identification  
3. **couchbase-docs-expert** - Documentation and known issues research

**Usage**:
```bash
# In GitHub Copilot CLI, invoke custom agents with the task tool:
task(
  agent_type="custom",
  name="ticket-agents-manager",
  prompt="Analyze ticket 76783",
  mode="background"
)
```

See `.github/copilot/agents/README.md` for detailed documentation.

### Scripts

- `prep_ticket_aws.sh` - Download ticket data and logs from AWS
- `extract_ticket_timeline.sh` - Extract ticket timeline JSON
- `cb-source-tool/` - Couchbase source code analysis tool

## Agent Workflows

### Complete Analysis (Recommended)
```
ticket-agents-manager
  ├─ Downloads logs
  ├─ Analyzes components  
  ├─ Researches docs
  ├─ QA validation
  └─ Generates report + customer response
```

### Quick Log Analysis
```
couchbase-ticket-analyzer
  ├─ Downloads logs
  ├─ Searches with ripgrep
  ├─ Identifies root cause
  └─ Outputs JSON metadata
```

### Documentation Lookup
```
couchbase-docs-expert
  ├─ Searches docs.couchbase.com
  ├─ Checks issues.couchbase.com (MBs)
  ├─ Looks up support.couchbase.com (KB)
  └─ Returns cited references
```

## Prerequisites

1. **AWS Credentials**: `aws sso login --profile supportal`
2. **Environment**: Create `.env` with `DIR_TICKETS=/path/to/tickets`
3. **Tools**: ripgrep, jq, aws cli

## Output Files

After analysis, tickets have:
```
$DIR_TICKETS/76783/
├── analysis_metadata.json    # Structured findings
├── analysis_report.md         # Complete report with customer response
├── cbcollect_info_*/          # Server logs
└── ticket_files/              # Customer uploads
```

## Documentation

- **Agent Documentation**: `.github/copilot/agents/README.md`
- **Legacy Agents**: `.factory/droids/` (for Copilot Workspace)