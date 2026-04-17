# Quick Reference: Copilot Custom Agents

## 🚀 One-Liner Commands

### Complete Ticket Analysis
```python
task(agent_type="custom", name="ticket-agents-manager", 
     prompt="Analyze ticket 76783", mode="background")
```

### Log Analysis Only  
```python
task(agent_type="custom", name="couchbase-ticket-analyzer",
     prompt="Analyze ticket 76783 logs", mode="background")
```

### Documentation Lookup
```python
task(agent_type="custom", name="couchbase-docs-expert",
     prompt="What causes DCP BufferLogFull?", mode="background")
```

---

## 📋 Agent Quick Reference

| Agent | Purpose | Output | Duration |
|-------|---------|--------|----------|
| **ticket-agents-manager** | Full orchestration + QA | analysis_report.md + customer response | 10-20 min |
| **couchbase-ticket-analyzer** | Log analysis + root cause | analysis_metadata.json | 5-15 min |
| **couchbase-docs-expert** | Documentation research | Cited references | < 1 min |

---

## ✅ Prerequisites Checklist

```bash
# 1. AWS Authentication
aws sso login --profile supportal

# 2. Set environment (add to .env)
DIR_TICKETS=/path/to/tickets

# 3. Verify tools
rg --version    # ripgrep
jq --version    # JSON processor
aws --version   # AWS CLI
```

---

## 📁 Expected File Structure

```
$DIR_TICKETS/76783/
├── ticket_76783.raw              # Raw JSON from API
├── ticket_timeline.json          # Parsed ticket data
├── cbcollect_info_node1/         # Server logs (node 1)
├── cbcollect_info_node2/         # Server logs (node 2)  
├── ticket_files/                 # Customer uploads
├── analysis_metadata.json        # ← From ticket-analyzer
└── analysis_report.md            # ← From ticket-agents-manager
```

---

## 🔍 Monitor Agent Progress

```python
# List all agents
list_agents()

# Read agent output
read_agent(agent_id="couchbase-ticket-analyzer-xxxxx")

# Agents notify on completion automatically ✓
```

---

## 🎯 Common Use Cases

### New Ticket - Full Analysis
```python
task(agent_type="custom", name="ticket-agents-manager",
     prompt="Analyze ticket 76783. Generate complete report with customer response.",
     mode="background")
```

### Research Error Before Analyzing
```python
task(agent_type="custom", name="couchbase-docs-expert",
     prompt="What does 'OOM resident_ratio=0.95' mean? Known issues in 7.6.3?",
     mode="background")
```

### Focused Component Analysis
```python
task(agent_type="custom", name="couchbase-ticket-analyzer",
     prompt="Analyze ticket 80124. Focus on Query component. Timeout at 2026-03-15 10:30 UTC.",
     mode="background")
```

### Version Comparison
```python
task(agent_type="custom", name="couchbase-docs-expert",
     prompt="Index memory management differences between 7.2 and 7.6?",
     mode="background")
```

---

## 🛠️ Troubleshooting

| Error | Fix |
|-------|-----|
| "Custom agent not found" | Check `.github/copilot/agents/*.md` exist |
| "DIR_TICKETS not set" | Add `DIR_TICKETS=/path` to `.env` |
| "AWS access denied" | Run `aws sso login --profile supportal` |
| No cbcollect dirs | Check download completed: `ls $DIR_TICKETS/<ticket>/` |

---

## 📚 Documentation Links

- **Full Agent Docs**: `.github/copilot/agents/README.md`
- **Testing Guide**: `.github/copilot/agents/TESTING.md`
- **Legacy Agents**: `.factory/droids/` (Copilot Workspace)

---

## 💡 Tips

1. ⚡ Use `mode="background"` for all long-running tasks
2. 🎯 Start with **ticket-agents-manager** for complete workflow
3. 📖 Use **couchbase-docs-expert** to understand errors first
4. 🔍 Check **ticket_files/** for client-side logs
5. ✅ Verify AWS auth before starting

---

## 🏃 Quick Start

1. **Authenticate**: `aws sso login --profile supportal`
2. **Set path**: Add `DIR_TICKETS=/path/to/tickets` to `.env`
3. **Run manager**: `task(agent_type="custom", name="ticket-agents-manager", prompt="Analyze ticket XXXXX", mode="background")`
4. **Wait**: You'll be notified when complete (10-20 min)
5. **Review**: Check `$DIR_TICKETS/XXXXX/analysis_report.md`

---

**Ready to analyze tickets? Start with ticket-agents-manager! 🚀**
