# Couchbase Ticket Analyzer Agent

Automated analysis agent for Couchbase support tickets. Systematically analyzes customer issues by correlating ticket details with log patterns and documentation to produce actionable diagnostic reports.

---

## Overview

This agent automates the tedious parts of ticket analysis:
- Downloads ticket data and logs automatically
- Identifies exact timestamps and affected components
- Searches relevant logs with precision
- Researches documentation and known issues
- Correlates patterns across nodes and components
- Generates detailed reports with evidence and recommendations

**Time saved**: 1-3 hours per ticket on manual log grepping and doc searching.

---

## Prerequisites

### 1. Environment Setup

Ensure `.env` file exists in project root with:
```bash
DIR_TICKETS="/path/to/your/couchbaselogs/support"
BASE_DIR="/path/to/your/couchbaselogs/support"
```

See `.env.example` for template.

### 2. Required Tools

- **prep_ticket_aws.sh**: Must be functional (requires AWS CLI and SSO authentication)
- **ripgrep (rg)**: For log searching (already installed)
- **curl/wget**: For API calls
- **jq**: For JSON parsing

### 3. Access Requirements

- Supportal VPN connection
- AWS credentials configured for s3dl
- GitHub credentials for MB access (if needed)

---

## Usage

### Basic Analysis

Invoke the agent with a ticket number:

```bash
# From project root
droid task couchbase-ticket-analyzer "Analyze ticket 75546"
```

The agent will:
1. Download ticket via `prep_ticket_aws.sh`
2. Parse ticket timeline
3. Identify issue and timestamps
4. Search relevant logs
5. Research documentation
6. Generate reports in `$DIR_TICKETS/75546/`

### Advanced Usage

**Custom output location:**
```bash
droid task couchbase-ticket-analyzer "Analyze ticket 75546 and save report to /custom/path/"
```

**With related tickets:**
```bash
droid task couchbase-ticket-analyzer "Analyze ticket 75546, then compare with related tickets 75547, 75550"
```

**Re-analyze existing download:**
```bash
droid task couchbase-ticket-analyzer "Re-analyze ticket 75546 (already downloaded, focus on memcached OOM errors)"
```

---

## Output

The agent generates two files in `$DIR_TICKETS/<ticket_number>/`:

### 1. `analysis_report.md` (Human-readable)

Markdown report with:
- **Executive Summary**: One-page overview with key findings
- **Ticket Overview**: Customer issue, timestamp, environment
- **Analysis Process**: Documentation consulted, reasoning steps
- **Log Analysis**: Exact log excerpts with line numbers and context
- **Root Cause**: Hypothesis with supporting evidence
- **Recommended Actions**: Immediate steps and investigation commands

### 2. `analysis_metadata.json` (Machine-readable)

Structured JSON with:
```json
{
  "ticket_number": "75546",
  "classification": {
    "component": "KV",
    "issue_type": "OOM",
    "confidence": "high"
  },
  "root_cause": {
    "summary": "...",
    "evidence": [...]
  },
  "recommended_actions": [...],
  "logs_analyzed": [...],
  "documentation_references": [...]
}
```

Use this for:
- Automated ticket routing
- Pattern recognition across tickets
- Feeding into other analysis agents
- Building knowledge bases

---

## How It Works

### Component Detection

The agent maps keywords to components and log files:

| Keywords | Component | Logs to Check |
|----------|-----------|---------------|
| OOM, eviction, vBucket | KV Engine | memcached.log |
| failover, rebalance, node down | Cluster | ns_server.debug.log, ns_server.error.log |
| N1QL, query timeout | Query | query.log |
| GSI, index, plasma | Indexing | indexer.log, projector.log |
| XDCR, replication | XDCR | goxdcr.log |
| view, mapreduce | Views | couchdb.log |
| FTS, full-text | FTS | fts.log |

### Timestamp Analysis

- Extracts exact timestamp from ticket (e.g., "2026-03-11 14:23:45")
- Searches logs in ±2 minute window by default
- Uses `rg -iN` for case-insensitive search with line numbers
- Counts pattern occurrences to identify frequency
- Compares across nodes to detect cluster-wide vs node-specific issues

### Documentation Research

Searches in parallel:
1. **docs.couchbase.com**: Official documentation
2. **issues.couchbase.com**: MB (bug tracker) for known issues
3. **support.couchbase.com**: KB articles and solutions

Builds context: What does this error mean? Known causes? Fixed in version X?

---

## Example Report

```markdown
# Ticket Analysis Report: 75546

## Executive Summary
- Issue: OOM causing node auto-failover
- Component: KV Engine
- Root Cause: Bucket memory quota undersized for workload
- Confidence: High
- Recommended Actions: Increase bucket quota to 8GB, review eviction policy

## Log Analysis

### memcached.log (Node: 10.0.1.5)
Time Window: 2026-03-11 14:21:00 to 14:25:00
Pattern: "out of memory"

**Finding**:
```
Line 4532 | 2026-03-11T14:23:42.123 [ERROR] Memory allocation failed: bucket=default
Line 4533 | 2026-03-11T14:23:42.125 [ERROR] OOM: resident_ratio=0.95, high_wat=0.85
```

Frequency: 15 occurrences in 2 minutes (every 8-10 seconds)

### ns_server.debug.log (Node: 10.0.1.5)
```
Line 8721 | 2026-03-11T14:23:45.456 [WARN] Node health check failed: memory
Line 8722 | 2026-03-11T14:23:50.123 [INFO] Auto-failover initiated for node
```

### Root Cause
Memory exhaustion triggered auto-failover. Timeline:
1. 14:23:42 - OOM errors begin
2. 14:23:45 - Node marked unhealthy (3 seconds later)
3. 14:23:50 - Auto-failover triggered (8 seconds total)

## Recommended Actions

### Immediate
1. Increase bucket memory quota:
   ```bash
   curl -X POST http://10.0.1.5:8091/pools/default/buckets/default \
     -u admin:password -d ramQuotaMB=8192
   ```

2. Monitor eviction rate:
   ```bash
   curl http://10.0.1.5:8091/pools/default/buckets/default/stats | jq '.op.samples.ep_num_value_ejects'
   ```

### Investigation
- Review application write patterns
- Check if workload increase correlates with timestamp
- Verify other nodes' memory usage
```

---

## Troubleshooting

### Agent fails to download ticket

**Error**: "Cannot reach supportal.couchbase.com"
- **Solution**: Connect to VPN first

**Error**: "AWS authentication failed"
- **Solution**: Run `aws sso login --profile supportal` to re-authenticate

### Agent can't find logs

**Issue**: Ticket downloaded but no logs found
- **Cause**: Customer may not have uploaded snapshots yet
- **Action**: Agent will analyze ticket metadata only and note missing logs

### Low confidence results

**Issue**: Agent reports "confidence: low"
- **Cause**: Insufficient evidence or unfamiliar error pattern
- **Action**: Review documentation references, may need manual investigation

### Agent asks for related tickets

**Prompt**: "Would you like me to analyze related tickets?"
- **Response**: Provide comma-separated ticket numbers: "75547, 75550, 75551"
- **Result**: Agent will compare patterns across tickets

---

## Tips for Best Results

1. **Provide context in your prompt**:
   - ❌ "Analyze ticket 75546"
   - ✅ "Analyze ticket 75546 - customer reports query timeouts starting 2PM UTC"

2. **Specify focus areas if known**:
   - "Analyze ticket 75546, focus on XDCR replication lag"
   - "Analyze ticket 75546, customer mentions Java SDK connection errors"

3. **Use for pattern recognition**:
   - "Analyze tickets 75546, 75550, 75555 - all from same customer, look for common patterns"

4. **Leverage existing downloads**:
   - If ticket was previously downloaded, mention it: "Re-analyze ticket 75546 (already downloaded)"

---

## Limitations

- **Requires downloaded snapshots**: Can't analyze logs if customer hasn't uploaded them
- **Timestamp-dependent**: If customer doesn't provide exact time, analysis is less precise
- **Known issues only**: Best at recognizing documented errors; novel issues may need human review
- **Single ticket focus**: Doesn't automatically detect related tickets (you must provide them)

---

## Next Steps

- **For finetuning**: See [DEVELOPMENT.md](DEVELOPMENT.md)
- **For output format**: See [templates/](templates/)
- **For questions**: Check project docs or ask the team

---

## Version History

- **v1.0** (2026-03-11): Initial release
  - Automated ticket download and parsing
  - Component detection and log analysis
  - Documentation research integration
  - Dual output format (markdown + JSON)
