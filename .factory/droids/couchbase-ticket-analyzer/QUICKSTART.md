# Quick Start Guide - Couchbase Ticket Analyzer

## What Was Created

A specialized AI agent for analyzing Couchbase support tickets automatically.

### File Structure

```
.factory/droids/couchbase-ticket-analyzer/
├── droid.yaml                      # Agent configuration & system prompt
├── README.md                       # Full usage documentation
├── DEVELOPMENT.md                  # Finetuning & customization guide
├── QUICKSTART.md                   # This file
└── templates/
    ├── report_template.md          # Human-readable report template
    └── analysis_metadata.json      # Machine-readable output schema
```

Also created in project root:
- `.env` - Environment configuration (ticket location)
- `.env.example` - Template for other machines

## How to Use

### 1. First Time Setup

Ensure prep_ticket_aws.sh is working:
```bash
# Authenticate AWS SSO (one time)
aws sso login --profile supportal

# Test with a ticket
./prep_ticket_aws.sh 75546
```

### 2. Run the Agent

```bash
# Basic usage
droid task couchbase-ticket-analyzer "Analyze ticket 75546"

# With context
droid task couchbase-ticket-analyzer "Analyze ticket 75546 - customer reports OOM at 2PM UTC"

# Compare related tickets
droid task couchbase-ticket-analyzer "Analyze ticket 75546, then compare with 75547, 75550"
```

### 3. Find the Results

The agent saves outputs to:
```
$DIR_TICKETS/<ticket_number>/
├── analysis_report.md         # Detailed human-readable report
└── analysis_metadata.json     # Structured data for automation
```

## What the Agent Does

1. **Downloads ticket** via prep_ticket_aws.sh
2. **Reads ticket timeline** to understand customer issue
3. **Identifies component** (KV, Query, Index, etc.)
4. **Searches logs** with timestamp precision using ripgrep
5. **Researches docs** (docs.couchbase.com, MBs, KB articles)
6. **Correlates patterns** across nodes and components
7. **Generates reports** with evidence and recommendations

## Example Output

**analysis_report.md** contains:
- Executive summary with root cause
- Documentation researched
- Log excerpts with line numbers
- Timeline of events
- Recommended immediate actions
- Investigation steps
- Long-term preventive measures

**analysis_metadata.json** contains:
- Structured classification data
- Array of evidence with timestamps
- Action items with commands
- Documentation references
- Statistics

## Next Steps

- **To use the agent**: See [README.md](README.md)
- **To customize**: See [DEVELOPMENT.md](DEVELOPMENT.md)
- **To modify output format**: Edit files in [templates/](templates/)

## Tips

1. **Provide timestamp context**: "customer reports issue at 14:23 UTC"
2. **Specify component if known**: "focus on XDCR replication lag"
3. **Use for pattern recognition**: Compare multiple related tickets
4. **Leverage existing downloads**: Mention if ticket already downloaded

## Troubleshooting

**Agent can't download ticket**:
- Check VPN connection
- Run `aws sso login --profile supportal` to re-authenticate

**Agent produces generic recommendations**:
- Provide more context in your prompt
- Check if snapshots were actually uploaded by customer

**Need to customize agent behavior**:
- Edit `droid.yaml` → `prompt` section
- See DEVELOPMENT.md for guidance

---

**Questions?** Check README.md or DEVELOPMENT.md for detailed information.
