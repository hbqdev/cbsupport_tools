# cbsupport_tools

Couchbase support ticket analysis tools with AI-powered agents.

## New Machine Setup

Clone the repo and run the setup script once:

```bash
git clone git@github.com:hbqdev/cbsupport_tools.git
cd cbsupport_tools
bash setup.sh
```

The script covers:

| What | Where |
|------|--------|
| Ticket download directory (`DIR_TICKETS`, `BASE_DIR`) | `.env` |
| AWS SSO profile name | `.env` |
| Jira credentials | `~/.couchbase-support/jira.env` |
| Git user name (ticket response signature) | `git config user.name` |
| Jira MCP server for Claude Code (optional) | `~/.claude.json` via `claude mcp add` |

After setup, authenticate AWS SSO before downloading tickets:

```bash
aws sso login --profile supportal
```

Install required CLI tools if missing:

```
brew install ripgrep jq awscli wireshark   # wireshark installs tshark
```

See [`docs/jira-mcp-setup.md`](docs/jira-mcp-setup.md) for manual Jira MCP configuration.

---

## Quick Start

The first time you use the repo in a session (or after pulling changes), it helps to have Claude sanity-check the setup before jumping into a ticket:

```
Before we start, review this repo: confirm the agents in .claude/agents are readable,
check that .env has DIR_TICKETS and BASE_DIR set to a real, existing directory, confirm
AWS SSO is authenticated (aws sts get-caller-identity --profile supportal), and confirm
Jira credentials in ~/.couchbase-support/jira.env work. Also confirm the ticket-agents-manager
workflow is wired correctly end to end: it should call couchbase-ticket-analyzer first, then
couchbase-docs-expert (mandatory) and couchbase-source-expert (when docs aren't enough), then
run its own QA checks before producing analysis_report_vN.md. Tell me what's missing, if
anything, before we analyze a ticket.
```

Once that comes back clean, analyze a ticket with:

```
Analyze ticket 76783
```

Run that prompt in Claude Code — the orchestrator (`ticket-agents-manager`) handles the full pipeline automatically: downloads logs, identifies root cause, researches docs/MBs, QA-checks the findings, and drafts a customer response.

---

## Agents

| Agent | Role |
|-------|------|
| **ticket-agents-manager** | Orchestrator — full end-to-end analysis with QA and customer response draft |
| **couchbase-ticket-analyzer** | Log analyst — downloads logs, identifies root cause, outputs structured JSON |
| **couchbase-docs-expert** | Documentation researcher — docs.couchbase.com, MBs, KB articles |
| **couchbase-source-expert** | Source code researcher — searches github.com/couchbase for timers, defaults, error definitions |

### Where the agents live

`.claude/agents/` — Claude Code is the only supported platform for these agents.

### Scripts

- `prep_ticket_aws.sh` — download ticket data and cbcollect logs from AWS S3
- `extract_ticket_timeline.sh` — extract ticket timeline JSON
- `cb-source-tool/` — Couchbase source code analysis tool

---

## Agent Workflow

```
ticket-agents-manager
  ├── couchbase-ticket-analyzer   → analysis_metadata_vN.json
  ├── couchbase-docs-expert       → MB/doc research (mandatory)
  └── couchbase-source-expert     → source-level confirmation (when docs insufficient)
```

The analyzer produces a versioned JSON file. The manager runs QA checks (verbatim log enforcement, Jira MB verification, prior response review, tshark pcap enforcement) then generates a versioned `analysis_report_vN.md` with the full analysis and customer response draft. Re-running increments N without overwriting prior work.

---

## Log Analysis Skill

`.claude/skills/couchbase-log-analysis/SKILL.md` — loaded by the analyzer before every log search. Contains:

- Log file reference for all components (KV, Cluster, Query, Index, XDCR, FTS, Views, Eventing, Babysitter, couchbase.log, CAO/cbopinfo)
- Timestamp formats and filtering patterns
- Quick triage patterns for first-pass diagnosis
- Component-specific `rg` patterns
- StatsMgr mut/s rate calculation workflow
- tshark patterns for pcap analysis
- Multi-node correlation workflows

---

## Output Files

```
$DIR_TICKETS/<ticket>/
├── ticket_<number>.raw              # Raw ticket JSON
├── ticket_timeline.json             # Parsed timeline + prior responses
├── snapshots/<uuid>/
│   ├── cbcollect_info_*/            # Per-node server logs
│   └── cbopinfo*/                   # CAO operator logs (CAO-managed clusters)
├── ticket_files/                    # Customer-uploaded logs
├── analysis_metadata_vN.json        # Structured findings (from analyzer)
└── analysis_report_vN.md            # Complete report + customer response (from manager)
```
