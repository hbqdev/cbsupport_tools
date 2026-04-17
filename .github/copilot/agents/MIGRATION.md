# Migration Guide: .factory/droids → GitHub Copilot CLI

This document explains the differences between `.factory/droids` agents (for Copilot Workspace) and `.github/copilot/agents` (for GitHub Copilot CLI).

## Overview

Both agent systems use the same underlying agent definitions (markdown files with YAML frontmatter), but they're invoked differently:

| Feature | .factory/droids | .github/copilot/agents |
|---------|-----------------|------------------------|
| **Platform** | Copilot Workspace | GitHub Copilot CLI |
| **Location** | `.factory/droids/` | `.github/copilot/agents/` |
| **Invocation** | `droid task <name> "<prompt>"` | `task(agent_type="custom", name="<name>", ...)` |
| **Skills** | `.factory/skills/` | Use built-in agents (explore, task) |
| **Format** | Markdown + YAML frontmatter | Markdown + YAML frontmatter (same) |

## Agent Equivalency

All three agents have been ported with **full compatibility**:

### 1. ticket-agents-manager
- ✅ Same instructions
- ✅ Same workflow (orchestrate → validate → QA → report)
- ✅ Same outputs (analysis_report.md)
- 🔄 Changed: Invokes sub-agents via `task()` instead of `droid task`

### 2. couchbase-ticket-analyzer  
- ✅ Same log analysis patterns
- ✅ Same download logic
- ✅ Same output format (analysis_metadata.json)
- 🔄 Changed: Uses `explore` agent for searches instead of `couchbase-log-analysis` skill
- 🔄 Changed: Calls `couchbase-docs-expert` via `task()` instead of `droid task`

### 3. couchbase-docs-expert
- ✅ Same documentation sources
- ✅ Same search strategy  
- ✅ Same citation format
- ✅ No changes needed

## Key Differences

### Invocation Syntax

**.factory/droids** (Copilot Workspace):
```bash
# Manager
droid task ticket-agents-manager "Analyze ticket 76783"

# Analyzer
droid task couchbase-ticket-analyzer "Analyze ticket 76783 logs"

# Docs expert  
droid task couchbase-docs-expert "What causes DCP BufferLogFull?"
```

**.github/copilot/agents** (Copilot CLI):
```python
# Manager
task(agent_type="custom", name="ticket-agents-manager",
     prompt="Analyze ticket 76783", mode="background")

# Analyzer
task(agent_type="custom", name="couchbase-ticket-analyzer",
     prompt="Analyze ticket 76783 logs", mode="background")

# Docs expert
task(agent_type="custom", name="couchbase-docs-expert",
     prompt="What causes DCP BufferLogFull?", mode="background")
```

### Skills Replacement

**.factory/droids** uses `.factory/skills/couchbase-log-analysis/`:
```bash
# Old: Use couchbase-log-analysis skill
droid task couchbase-ticket-analyzer "Use the couchbase-log-analysis skill for log searches"
```

**.github/copilot/agents** uses built-in `explore` agent:
```python
# New: Use explore agent for log searches
task(agent_type="explore", 
     prompt="Search memcached.log for OOM errors with timestamp 14:23:00")
```

The agent definitions include ripgrep patterns directly, so no separate skill file is needed.

### Sub-Agent Calls

**.factory/droids**:
```markdown
droid task couchbase-docs-expert "What does error XYZ mean?"
```

**.github/copilot/agents**:
```markdown
task(agent_type="custom", name="couchbase-docs-expert",
     prompt="What does error XYZ mean?")
```

## File Structure Comparison

```
.factory/                          .github/copilot/
├── droids/                        └── agents/
│   ├── ticket-agents-manager.md       ├── ticket-agents-manager.md
│   ├── couchbase-ticket-analyzer.md   ├── couchbase-ticket-analyzer.md
│   ├── couchbase-docs-expert.md       ├── couchbase-docs-expert.md
│   └── couchbase-ticket-analyzer/     ├── README.md
│       └── templates/                 ├── TESTING.md
├── skills/                            └── QUICKREF.md
│   └── couchbase-log-analysis/
│       └── SKILL.md
└── settings.json
```

## Migration Checklist

If you're switching from `.factory/droids` to Copilot CLI:

- [x] ✅ Create `.github/copilot/agents/` directory
- [x] ✅ Copy agent definitions (ticket-agents-manager, couchbase-ticket-analyzer, couchbase-docs-expert)
- [x] ✅ Update sub-agent invocations from `droid task` to `task(agent_type="custom", ...)`
- [x] ✅ Replace skill references with direct ripgrep patterns or `explore` agent
- [x] ✅ Test agents with sample ticket
- [ ] ⚠️ Update any scripts or workflows that reference `.factory/droids`

## Backward Compatibility

**Both systems can coexist!**

- Keep `.factory/droids/` for Copilot Workspace users
- Keep `.github/copilot/agents/` for Copilot CLI users
- Both use the same underlying logic
- Outputs are identical (analysis_metadata.json, analysis_report.md)

No need to delete `.factory/droids` - they serve different platforms.

## Testing Both Systems

### Test .factory/droids (Copilot Workspace)
```bash
droid task ticket-agents-manager "Analyze ticket 76783"
```

### Test .github/copilot/agents (Copilot CLI)
```python
task(agent_type="custom", name="ticket-agents-manager",
     prompt="Analyze ticket 76783", mode="background")
```

Both should produce the same results in `$DIR_TICKETS/76783/`.

## Recommendations

1. **For Copilot CLI users**: Use `.github/copilot/agents/`
2. **For Copilot Workspace users**: Use `.factory/droids/`  
3. **For teams**: Keep both and document which platform each user should use
4. **For CI/CD**: Copilot CLI agents can be invoked programmatically

## Future Enhancements

Both systems can be extended with:
- Additional specialist agents (memory-expert, query-expert, etc.)
- Enhanced QA checks
- Integration with ticket systems
- Automated response posting
- Multi-ticket batch analysis

Updates should be made to both systems to maintain compatibility.

## Support

- **Copilot CLI docs**: `.github/copilot/agents/README.md`
- **Copilot Workspace docs**: `.factory/droids/ticket-agents-manager.md`
- **Testing**: `.github/copilot/agents/TESTING.md`
- **Quick ref**: `.github/copilot/agents/QUICKREF.md`

---

**Both systems are production-ready and fully functional.** Choose based on your platform (Copilot CLI vs Copilot Workspace).
