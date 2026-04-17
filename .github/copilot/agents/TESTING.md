# Testing GitHub Copilot Custom Agents

This guide shows how to test and use the custom agents.

## Test 1: Documentation Expert (Quickest)

Test the docs expert first - it doesn't require tickets or downloads:

```bash
# In a Copilot CLI session, call:
task(
  agent_type="custom",
  name="couchbase-docs-expert",
  description="Test docs expert",
  prompt="What are the common causes of 'BufferLogFull' warnings in Couchbase DCP? Include any known issues.",
  mode="background"
)
```

**Expected output**:
- Documentation from docs.couchbase.com
- Known issues from issues.couchbase.com
- Solutions from support.couchbase.com
- All sources cited with URLs

---

## Test 2: Ticket Analyzer (Requires Ticket)

Before running, ensure:
1. AWS SSO authenticated: `aws sso login --profile supportal`
2. Environment variable set: `DIR_TICKETS=/path/to/tickets`
3. Ticket exists or will be downloaded

```bash
# Replace 76783 with actual ticket number
task(
  agent_type="custom",
  name="couchbase-ticket-analyzer",
  description="Analyze ticket 76783",
  prompt="Analyze Couchbase support ticket 76783. Download logs if needed, identify root cause, and generate structured findings.",
  mode="background"
)
```

**Expected output**:
- Downloads logs to `$DIR_TICKETS/76783/`
- Searches logs with timestamp precision
- Generates `analysis_metadata.json`

**Duration**: 5-15 minutes depending on cluster size

---

## Test 3: Full Orchestration (Complete Workflow)

This runs the entire workflow end-to-end:

```bash
task(
  agent_type="custom",
  name="ticket-agents-manager",
  description="Complete ticket 76783 analysis",
  prompt="Perform complete analysis of ticket 76783. Invoke the ticket analyzer, validate output, perform QA checks, and generate customer-ready report.",
  mode="background"
)
```

**Expected output**:
- Delegates to couchbase-ticket-analyzer
- Reads analysis_metadata.json
- Performs QA validation
- Generates `analysis_report.md` with customer response
- Returns summary with next steps

**Duration**: 10-20 minutes for full workflow

---

## Monitoring Agents

```bash
# List running agents
list_agents()

# Read output from specific agent
read_agent(agent_id="couchbase-ticket-analyzer-xxxxx")

# You'll receive automatic notification when agents complete
```

---

## Verifying Agent Registration

To check if agents are discovered by Copilot:

```bash
# Agents should be in this location
ls -la .github/copilot/agents/

# Expected files:
# - ticket-agents-manager.md
# - couchbase-ticket-analyzer.md
# - couchbase-docs-expert.md
# - README.md
```

Each agent file must have:
1. YAML frontmatter with `name`, `description`, `model`
2. Markdown body with instructions

---

## Example Invocations

### Research a specific error
```bash
task(
  agent_type="custom",
  name="couchbase-docs-expert",
  prompt="What does 'resident_ratio=0.95' mean in memcached.log? What are the thresholds and remediation steps?",
  mode="background"
)
```

### Analyze specific component
```bash
task(
  agent_type="custom",
  name="couchbase-ticket-analyzer",
  prompt="Analyze ticket 80124. Focus on Query service. Customer reports N1QL timeout at 2026-03-15 10:30:00 UTC.",
  mode="background"
)
```

### Version comparison
```bash
task(
  agent_type="custom",
  name="couchbase-docs-expert",
  prompt="How did index memory management change between Couchbase 7.2 and 7.6? What settings need adjustment when upgrading?",
  mode="background"
)
```

---

## Troubleshooting

### "Custom agent not found"
- **Cause**: Agent files not in correct location
- **Fix**: Ensure files are in `.github/copilot/agents/`
- **Verify**: `ls .github/copilot/agents/*.md`

### "DIR_TICKETS not set"
- **Cause**: Environment variable missing
- **Fix**: Create `.env` file: `DIR_TICKETS=/path/to/tickets`
- **Verify**: `echo $DIR_TICKETS`

### "AWS S3 access denied"
- **Cause**: AWS SSO expired
- **Fix**: `aws sso login --profile supportal`
- **Verify**: `aws s3 ls s3://bucket-name --profile supportal`

### Agent runs but produces no output
- **Cause**: Logs not downloaded or missing
- **Fix**: Check `$DIR_TICKETS/<ticket>/` for cbcollect directories
- **Retry**: Re-run agent, it will skip existing downloads

---

## Tips

1. **Always use background mode** for long-running tasks (downloads, analysis)
2. **Start with docs expert** to understand errors before analyzing logs
3. **Use manager for complete workflow** - it handles orchestration and QA
4. **Check ticket_files** - customer uploads often contain crucial client-side info
5. **Verify AWS auth** before starting analysis to avoid mid-run failures

---

## Agent Comparison

| Agent | Use Case | Duration | Output |
|-------|----------|----------|--------|
| docs-expert | Quick research | < 1 min | Cited documentation |
| ticket-analyzer | Log analysis | 5-15 min | JSON metadata |
| ticket-agents-manager | Full workflow | 10-20 min | Complete report + customer response |

---

## Next Steps

1. Test `couchbase-docs-expert` with a simple query
2. Verify AWS credentials: `aws sso login --profile supportal`
3. Set environment: `DIR_TICKETS=/path/to/tickets`
4. Run full analysis on a real ticket
5. Review outputs in `$DIR_TICKETS/<ticket>/`

See `.github/copilot/agents/README.md` for detailed agent documentation.
