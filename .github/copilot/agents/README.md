# GitHub Copilot Custom Agents

This directory contains custom agent definitions for Couchbase support ticket analysis.

## ⚠️ Important: Quality & Citations

**Version 2 (2026-03-19)**: Agents now enforce strict documentation citation requirements. All claims about "expected behavior" must be backed by official documentation or marked as "Unknown".

See `CHANGELOG.md` for recent improvements based on testing.

## Available Agents

### 1. ticket-agents-manager
**Orchestrator agent** that manages the entire ticket analysis workflow.

**Use this agent when**: You want a complete end-to-end ticket analysis with quality checks and customer-ready response.

**Invocation**:
```bash
# In Copilot CLI session, use the task tool
task(
  agent_type="custom",
  name="ticket-agents-manager",
  prompt="Analyze ticket 76783 and generate complete report",
  mode="background"
)
```

**What it does**:
1. Delegates to couchbase-ticket-analyzer for log analysis
2. Validates output and performs QA checks
3. Drafts customer response
4. Generates comprehensive analysis_report.md

**Output**:
- `$DIR_TICKETS/<ticket_number>/analysis_report.md` - Human-readable report with customer response
- Brief summary in chat

---

### 2. couchbase-ticket-analyzer
**Technical analyst agent** that downloads and analyzes logs.

**Use this agent when**: You want detailed log analysis without the full orchestration overhead.

**Invocation**:
```bash
task(
  agent_type="custom",
  name="couchbase-ticket-analyzer",
  prompt="Analyze ticket 76783 logs. Focus on KV component issues between 14:20-14:25 on 2024-03-19.",
  mode="background"
)
```

**What it does**:
1. Downloads logs from AWS S3 (cbcollect + ticket_files)
2. Searches logs with timestamp precision using ripgrep
3. Identifies root cause based on evidence
4. Consults couchbase-docs-expert for documentation
5. Generates structured JSON metadata

**Output**:
- `$DIR_TICKETS/<ticket_number>/analysis_metadata.json` - Structured findings

---

### 3. couchbase-docs-expert
**Documentation research agent** that searches official sources.

**Use this agent when**: You need to verify Couchbase behavior, look up errors, or find known issues.

**Invocation**:
```bash
task(
  agent_type="custom",
  name="couchbase-docs-expert",
  prompt="What does 'OOM resident_ratio=0.95' mean in Couchbase 7.6.3? Are there known issues?",
  mode="background"
)
```

**What it does**:
1. Searches docs.couchbase.com for official documentation
2. Checks issues.couchbase.com for known bugs (MBs)
3. Looks up support.couchbase.com for KB articles
4. Synthesizes findings with version-specific notes
5. Cites all sources with URLs

**Output**:
- Structured response with documentation references and confidence level

---

## Usage Examples

### Example 1: Complete Ticket Analysis (Recommended)

```bash
# Use the manager for full analysis
task(
  agent_type="custom",
  name="ticket-agents-manager",
  description="Analyze ticket 76783",
  prompt="Analyze Couchbase support ticket 76783 completely. Generate analysis report and customer response.",
  mode="background"
)
```

This will:
- Download logs automatically
- Analyze all components
- Research documentation
- Perform QA checks
- Create analysis_report.md with customer response

### Example 2: Quick Log Analysis

```bash
# Use analyzer directly for faster turnaround
task(
  agent_type="custom",
  name="couchbase-ticket-analyzer",
  description="Analyze ticket 76783 logs",
  prompt="Analyze ticket 76783. Customer reports query timeouts at 2024-03-19 14:23:00. Focus on query and index components.",
  mode="background"
)
```

### Example 3: Documentation Lookup

```bash
# Research specific error or feature
task(
  agent_type="custom",
  name="couchbase-docs-expert",
  description="Research DCP BufferLogFull",
  prompt="What causes 'DCP BufferLogFull' warnings in memcached.log? Are there known issues in version 7.6.3?",
  mode="background"
)
```

### Example 4: Version-Specific Behavior

```bash
task(
  agent_type="custom",
  name="couchbase-docs-expert",
  description="Query memory quota behavior",
  prompt="How did query service memory management change between 7.2 and 7.6? What's the recommended sizing for production?",
  mode="background"
)
```

---

## Agent Communication

Agents can call each other:

```
ticket-agents-manager
  └─ calls ──> couchbase-ticket-analyzer
                 └─ calls ──> couchbase-docs-expert
```

**Manager** orchestrates the workflow  
**Analyzer** does the technical work  
**Docs Expert** provides authoritative information  

---

## Prerequisites

1. **Environment Variables**:
   ```bash
   # Set in .env file
   DIR_TICKETS=/path/to/tickets
   ```

2. **AWS Credentials**:
   ```bash
   # Must be authenticated to download logs
   aws sso login --profile supportal
   ```

3. **Required Tools**:
   - ripgrep (rg)
   - jq
   - aws cli

4. **Working Directory**:
   - All agents expect to run from: `/Users/tin.tran/dev/couchbase/cbsupport_tools`

---

## File Outputs

After analysis, expect these files in `$DIR_TICKETS/<ticket_number>/`:

```
76783/
├── ticket_76783.raw              # Raw JSON from API
├── ticket_timeline.json          # Parsed ticket data
├── cbcollect_info_node1/         # Server logs (node 1)
├── cbcollect_info_node2/         # Server logs (node 2)
├── ticket_files/                 # Customer uploads (SDK/app logs)
├── analysis_metadata.json        # Structured findings (from analyzer)
└── analysis_report.md            # Complete report (from manager)
```

---

## Monitoring Agent Progress

```bash
# Check if agent is still running
list_agents()

# Read intermediate output
read_agent(agent_id="couchbase-ticket-analyzer-abc123")

# You'll be notified when agents complete
```

---

## Tips

1. **Start with manager**: For complete analysis, always use `ticket-agents-manager`
2. **Use analyzer directly**: When you just need log analysis without full report
3. **Consult docs expert**: For any Couchbase-specific questions during manual analysis
4. **Run in background**: Use `mode="background"` for long-running tasks (downloads can take 10+ minutes)
5. **Check logs first**: Agents check for existing downloads before fetching new ones

---

## Troubleshooting

### Agent not found
```
Error: Custom agent 'couchbase-ticket-analyzer' not found
```
**Solution**: Ensure you're in the correct directory with `.github/copilot/agents/` present

### AWS SSO expired
```
Error: Unable to download from S3
```
**Solution**: Run `aws sso login --profile supportal` and retry

### Missing environment variable
```
Error: DIR_TICKETS not set
```
**Solution**: Create `.env` file with `DIR_TICKETS=/path/to/tickets`

### Download timeout
If download takes longer than expected, check partial completion:
```bash
ls $DIR_TICKETS/<ticket_number>/cbcollect*
```
Re-run the agent - it will skip existing downloads.

---

## Model Configuration

All agents use **Claude Sonnet 4.6** by default. You can override:

```bash
task(
  agent_type="custom",
  name="couchbase-ticket-analyzer",
  model="claude-opus-4.6",  # Use more powerful model
  prompt="...",
  mode="background"
)
```

---

## Comparison with .factory/droids

These GitHub Copilot agents are equivalent to the `.factory/droids` agents but work with GitHub Copilot CLI:

| .factory/droids | GitHub Copilot | Notes |
|----------------|----------------|-------|
| ticket-agents-manager.md | ticket-agents-manager.md | ✅ Full compatibility |
| couchbase-ticket-analyzer.md | couchbase-ticket-analyzer.md | ✅ Full compatibility |
| couchbase-docs-expert.md | couchbase-docs-expert.md | ✅ Full compatibility |

Both sets can coexist. Use `.factory/droids` for Copilot Workspace, `.github/copilot/agents/` for Copilot CLI.
