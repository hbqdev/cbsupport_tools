# Couchbase Ticket Analyzer - Development & Finetuning Guide

This guide explains how to improve, customize, and finetune the ticket analyzer agent based on real-world usage and feedback.

---

## Architecture Overview

### Agent Components

```
couchbase-ticket-analyzer/
├── droid.yaml              # Agent configuration & system prompt
├── README.md               # User documentation
├── DEVELOPMENT.md          # This file
└── templates/
    ├── report_template.md      # Markdown report structure
    └── analysis_metadata.json  # JSON schema for structured output
```

### Key Configuration Files

**droid.yaml**:
- `model`: AI model to use (default: claude-sonnet-4)
- `tools`: Enabled tools (execute, read, web_search, etc.)
- `prompt`: System prompt with analysis methodology

---

## Finetuning Strategies

### 1. Improving Component Detection

**Problem**: Agent misclassifies issues (e.g., treats XDCR issue as KV issue)

**Solution**: Update the component mapping table in `droid.yaml` → `prompt` section:

```yaml
prompt: |
  ...
  ### Component → Log File Mapping
  
  | Issue Type | Component | Primary Logs |
  |------------|-----------|--------------|
  | YOUR_NEW_KEYWORDS | New Component | new_logfile.log |
```

**Example - Adding Backup component**:
```yaml
| backup, cbbackupmgr, restore | Backup | backup.log, cbbackupmgr.log |
```

**Testing**:
```bash
droid task couchbase-ticket-analyzer "Analyze ticket <ticket_with_backup_issue>"
```

Verify it searches `backup.log` instead of wrong log file.

---

### 2. Adjusting Search Window

**Problem**: Agent uses ±2 minutes but issues span longer (or shorter) periods

**Current default** (in `droid.yaml`):
```yaml
- Default search window: ±2 minutes around issue timestamp
- Extend window only if customer indicates prolonged issue
```

**Solution A - Change default globally**:

Edit `droid.yaml` → `prompt`:
```yaml
- Default search window: ±5 minutes around issue timestamp  # Changed from 2
```

**Solution B - Make it adaptive per issue type**:

```yaml
### Adaptive Search Windows

| Issue Type | Search Window |
|------------|---------------|
| Crash, OOM, panic | ±2 minutes (immediate) |
| Slow query, performance | ±15 minutes (gradual) |
| Rebalance, compaction | ±1 hour (long-running) |
| Network timeout | ±5 minutes (transient) |
```

**Testing**:
- Try tickets with different issue types
- Verify agent uses appropriate window
- Check if it captures all relevant log entries

---

### 3. Adding New Error Patterns

**Problem**: Agent doesn't recognize a common error you keep seeing

**Solution**: Create a pattern library file

Create `patterns/common_errors.json`:
```json
{
  "patterns": [
    {
      "error": "Connection reset by peer",
      "component": "Network",
      "search_terms": ["connection reset", "ECONNRESET", "peer closed"],
      "logs": ["ns_server.debug.log", "goxdcr.log"],
      "known_causes": [
        "Firewall dropping connections",
        "Network instability",
        "Client timeout"
      ],
      "mb_references": ["MB-12345", "MB-23456"]
    }
  ]
}
```

Update `droid.yaml` to reference this file:
```yaml
prompt: |
  ...
  ## Common Error Patterns
  
  Refer to patterns/common_errors.json for known error signatures and their typical causes.
```

---

### 4. Improving Documentation Search

**Problem**: Agent misses relevant docs or searches wrong terms

**Current search strategy**:
```yaml
1. Search docs.couchbase.com: "couchbase [error] [version]"
2. Search MBs: "site:issues.couchbase.com [error]"
3. Search KB: "site:support.couchbase.com [error]"
```

**Solution - Add search term variations**:

Edit `droid.yaml` → `prompt`:
```yaml
### Documentation Research Protocol

For every unfamiliar error or issue:

1. Primary searches:
   - docs.couchbase.com: "couchbase [error] [version]"
   - docs.couchbase.com: "couchbase [component] [symptom]"  # Added

2. Bug tracker searches:
   - "site:issues.couchbase.com [exact_error_message]"
   - "site:issues.couchbase.com [error_code]"  # Added
   - Focus on RESOLVED, CLOSED, FIXED status

3. KB searches:
   - "site:support.couchbase.com [error]"
   - "site:support.couchbase.com [symptom] [version]"  # Added

4. Community searches (if above fail):
   - "site:forums.couchbase.com [error]"  # Added
```

**Testing**:
- Pick a ticket with a known MB or KB article
- Verify agent finds the correct documentation
- Check if it includes relevant links in report

---

### 5. Customizing Report Format

**Problem**: Reports too verbose/concise, or missing key sections

**Solution**: Edit template files

**For markdown reports** - `templates/report_template.md`:
```markdown
# Add a new section
## Performance Metrics
- Average operation latency
- Request rate at time of issue
- Resource utilization (CPU, memory, disk)
```

**For JSON output** - `templates/analysis_metadata.json`:
```json
{
  "performance_metrics": {
    "avg_latency_ms": null,
    "request_rate": null,
    "cpu_percent": null
  }
}
```

**Then update `droid.yaml` prompt to instruct filling these sections**.

---

### 6. Adding Specialized Analysis Modes

**Use case**: Different ticket types need different analysis approaches

**Solution**: Create mode-specific instructions

Edit `droid.yaml`:
```yaml
prompt: |
  ...
  ## Analysis Modes
  
  Detect ticket type and apply specialized approach:
  
  ### Performance Degradation Mode
  Trigger: Keywords like "slow", "latency", "performance"
  - Focus on gradual patterns, not single events
  - Compare metrics before/during/after issue window
  - Check for resource exhaustion trends
  - Analyze query execution plans
  
  ### Crash Analysis Mode
  Trigger: Keywords like "crash", "panic", "core dump", "segfault"
  - Focus on exact crash moment
  - Look for preceding warnings/errors
  - Check for known crash bugs in version
  - Identify crash signature (stack trace patterns)
  
  ### Data Loss/Corruption Mode
  Trigger: Keywords like "missing data", "corruption", "inconsistent"
  - Check for unclean shutdowns
  - Verify replication status
  - Look for disk errors
  - Check persistence/durability settings
```

**Testing**: Try tickets of each type, verify agent follows correct mode.

---

### 7. Tuning Confidence Levels

**Problem**: Agent is too confident (or not confident enough)

**Current confidence logic** (implied in prompt):
- **High**: Clear error + known MB + log evidence aligns
- **Medium**: Pattern matches known issues but incomplete evidence
- **Low**: Symptoms unclear or insufficient logs

**Solution**: Make it explicit and tunable

Add to `droid.yaml` → `prompt`:
```yaml
### Confidence Assessment Criteria

Assign confidence based on evidence strength:

**High Confidence** (all must be true):
- Exact error message found in logs with line numbers
- Error documented in official docs or resolved MB
- Timeline matches customer report (±2 min)
- Root cause explanation is definitive
- Recommended fix is specific and actionable

**Medium Confidence** (2-3 criteria):
- Error pattern similar to known issues
- Timeline approximately matches
- Some log evidence but incomplete
- Root cause is plausible but not certain
- Recommended fix is exploratory

**Low Confidence** (0-1 criteria):
- No matching error patterns
- Timeline unclear or mismatched
- Minimal log evidence
- Multiple possible root causes
- Recommended fix is generic

Always state confidence level explicitly in reports.
```

---

### 8. Handling Multi-Component Issues

**Problem**: Issues span multiple components (e.g., query → index → KV)

**Solution**: Add cascade analysis instructions

Edit `droid.yaml` → `prompt`:
```yaml
### Cross-Component Cascade Analysis

When errors appear in multiple components:

1. **Establish Timeline**:
   - Order all errors chronologically across all components
   - Identify trigger event (earliest error)
   
2. **Map Dependencies**:
   - Query → Index → KV (data flow)
   - XDCR → KV → Cluster (replication flow)
   - Client → Network → Server (connection flow)

3. **Trace Cascade**:
   - Does error A in component X trigger error B in component Y?
   - Are timing intervals consistent with expected propagation?
   
4. **Report Structure**:
   - Primary component (root cause)
   - Secondary components (cascading effects)
   - Evidence of causal relationship

Example:
- 14:23:42 KV: OOM error
- 14:23:45 Index: "Connection lost to KV node"
- 14:23:50 Query: "Index not available"

Conclusion: KV OOM → node failure → index unavailable → query failure
```

---

## Testing & Validation

### Manual Testing

After making changes, test with known tickets:

```bash
# Test basic analysis
droid task couchbase-ticket-analyzer "Analyze ticket 75546"

# Test edge cases
droid task couchbase-ticket-analyzer "Analyze ticket <crash_ticket>"
droid task couchbase-ticket-analyzer "Analyze ticket <multi_component_ticket>"
droid task couchbase-ticket-analyzer "Analyze ticket <no_logs_ticket>"
```

**Validation checklist**:
- [ ] Agent correctly identifies component
- [ ] Searches appropriate log files
- [ ] Finds relevant documentation
- [ ] Extracts correct timestamp
- [ ] Generates both MD and JSON outputs
- [ ] Provides actionable recommendations
- [ ] Confidence level makes sense

### Regression Testing

Keep a set of "golden" tickets with known root causes:

```bash
test_tickets/
├── 75546_known_oom.txt          # Expected: High confidence, KV OOM
├── 75550_query_timeout.txt      # Expected: Medium confidence, Query
├── 75555_xdcr_lag.txt           # Expected: High confidence, XDCR
```

After changes, re-run on golden set and compare results.

---

## Common Customization Scenarios

### Scenario 1: Company-Specific Log Locations

**Problem**: Your logs are in custom paths or have custom names

**Solution**: Update path patterns in `droid.yaml`:

```yaml
### Custom Log Locations

If logs are in non-standard locations, adjust search patterns:

Standard: $DIR_TICKETS/<ticket>/snapshot_<node>/logs/memcached.log
Custom: $DIR_TICKETS/<ticket>/custom_logs/<node>/memcached.log

Update search commands:
```bash
# Standard
rg -iN "error" "$TICKET_DIR/snapshot_*/logs/memcached.log"

# Custom
rg -iN "error" "$TICKET_DIR/custom_logs/*/memcached.log"
```

### Scenario 2: Version-Specific Behavior

**Problem**: Error meanings change between Couchbase versions

**Solution**: Add version-aware logic

```yaml
### Version-Specific Error Handling

When analyzing errors, consider version context:

| Error | v6.x Meaning | v7.x Meaning |
|-------|--------------|--------------|
| "eviction failed" | Memory exhaustion | Could be memory or disk |
| "index build failed" | Syntax error | Could be resource constraint |

Always check ticket version and adjust interpretation accordingly.
```

### Scenario 3: Integration with Other Tools

**Problem**: Want to feed analysis into Jira, Slack, or other systems

**Solution**: The JSON output is designed for this. Create wrapper scripts:

```bash
#!/bin/bash
# auto_triage.sh - Send analysis to Jira

TICKET=$1
droid task couchbase-ticket-analyzer "Analyze ticket $TICKET"

# Read JSON output
JSON_FILE="$DIR_TICKETS/$TICKET/analysis_metadata.json"
COMPONENT=$(jq -r '.classification.component' "$JSON_FILE")
PRIORITY=$(jq -r '.classification.severity' "$JSON_FILE")

# Create Jira ticket
jira create-issue \
  --project SUPPORT \
  --type "Technical Investigation" \
  --component "$COMPONENT" \
  --priority "$PRIORITY" \
  --description "$(cat $DIR_TICKETS/$TICKET/analysis_report.md)"
```

---

## Performance Optimization

### Speed Up Analysis

**If agent is slow**:

1. **Parallel searches**: Agent already does this for documentation, but you can emphasize:
   ```yaml
   Search docs, MBs, and KB **in parallel** using multiple web_search tool calls.
   ```

2. **Skip unnecessary logs**: If component is clearly identified, skip irrelevant logs:
   ```yaml
   If issue is definitively KV-related, skip Query, Index, XDCR logs unless cascade is suspected.
   ```

3. **Limit log search scope**: For huge logs, sample strategically:
   ```yaml
   For logs >100MB, use targeted sampling:
   - First 1000 lines around timestamp
   - Last 1000 lines of log
   - Any lines matching critical patterns
   ```

### Reduce Token Usage

**If agent uses too many tokens**:

1. **Concise documentation summaries**: Instead of quoting entire doc pages
2. **Limit context lines**: Use `-C 5` instead of `-C 10` for log context
3. **Selective log excerpts**: Include only most relevant lines, not all matches

---

## Advanced: Custom Analysis Plugins

For highly specialized analysis, create plugin scripts:

```bash
plugins/
├── xdcr_lag_analyzer.sh       # Deep XDCR analysis
├── query_plan_explainer.sh    # Query execution plan analysis
└── memory_profiler.sh         # Memory usage profiling
```

Reference in `droid.yaml`:
```yaml
prompt: |
  ...
  ## Specialized Plugins
  
  For deep analysis of specific components, use plugin scripts:
  
  - XDCR lag: `./plugins/xdcr_lag_analyzer.sh <ticket>`
  - Query performance: `./plugins/query_plan_explainer.sh <ticket>`
```

---

## Feedback Loop

### Collecting Improvement Data

After each analysis, ask yourself:
1. Did agent find the root cause?
2. Were recommendations actionable?
3. Did it miss any important logs or docs?
4. Was confidence level appropriate?
5. What would I have done differently?

Document gaps in `improvement_log.md`:
```markdown
## 2026-03-11 - Ticket 75546
- **Issue**: Agent missed MB-12345 which was highly relevant
- **Cause**: MB was marked as OPEN, agent only searches CLOSED
- **Fix**: Update search to include OPEN status MBs
```

### Iterative Improvement Process

1. **Week 1-2**: Use agent, collect feedback
2. **Week 3**: Review feedback, identify top 3 improvements
3. **Week 4**: Implement improvements, test on old tickets
4. **Repeat**: Continuous refinement

---

## Troubleshooting Agent Issues

### Agent produces hallucinated log lines

**Symptom**: Report includes log lines that don't exist

**Cause**: Model hallucination under uncertainty

**Fix**: Update prompt to be more explicit:
```yaml
CRITICAL: Only include log lines that you have **actually read** using the Read or Grep tools.
Never invent or paraphrase log content. If unsure, state "Log excerpt not available."
```

### Agent ignores timestamp precision

**Symptom**: Searches entire log instead of time window

**Fix**: Emphasize timestamp filtering:
```yaml
### MANDATORY: Timestamp Filtering

ALWAYS filter logs by timestamp. Never search entire log files.

Example workflow:
1. Extract timestamp: "2026-03-11 14:23:45"
2. Define window: 14:21:45 to 14:25:45
3. Search with filter:
   rg -iN "error" memcached.log | grep "2026-03-11T14:2[1-5]:"
```

### Agent gives generic recommendations

**Symptom**: Actions like "Check the logs" or "Contact support"

**Fix**: Require specificity:
```yaml
### Recommendation Quality Standards

NEVER provide generic advice. ALL recommendations must be:
- Specific (exact commands, settings, version numbers)
- Testable (can be verified)
- Prioritized (immediate vs long-term)

❌ Bad: "Check memory usage"
✅ Good: "Run: curl http://node:8091/pools/default | jq '.nodes[].systemStats.mem_used_percent'"
```

---

## Version Control for Agent Changes

Track agent improvements in git:

```bash
# After making changes
git add .factory/droids/couchbase-ticket-analyzer/
git commit -m "Agent: Improve XDCR component detection

- Added new keywords: replication lag, dcp stream
- Updated log search patterns
- Tested on tickets 75546, 75550"

# Tag stable versions
git tag agent-v1.1
```

---

## Questions & Support

For questions about finetuning:
1. Check this doc first
2. Review recent git commits for examples
3. Test changes on known tickets before deploying
4. Ask team for feedback on major changes

---

## Roadmap Ideas

Future enhancements to consider:

- [ ] **Pattern learning**: Agent learns from past analyses
- [ ] **Automatic related ticket detection**: Find similar tickets without manual input
- [ ] **Trend analysis**: Detect patterns across multiple tickets over time
- [ ] **Integration tests**: Automated testing framework
- [ ] **Multi-language logs**: Support for non-English log entries
- [ ] **Real-time analysis**: Analyze live systems, not just snapshots
- [ ] **Customer report generation**: Sanitized version for customer-facing reports
