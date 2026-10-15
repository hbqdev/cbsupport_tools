# cbsupport_tools

Couchbase support ticket analysis tools with AI-powered agents.

## Prerequisites

Install these before running `setup.sh` (it checks for them and tells you what is missing):

| Tool | Why | Install |
|------|-----|---------|
| `git`, `curl`, `python3`, `wget`, `unzip`, `tar` | ticket download scripts | `brew install git curl python wget unzip` (Linux: your package manager) |
| `rg` (ripgrep), `jq` | log search and JSON handling | `brew install ripgrep jq` |
| `aws` (AWS CLI v2) | SSO login and S3 downloads | `brew install awscli` |
| `s3dl` | downloads Supportal-hosted ticket files | `pip install git+https://github.com/couchbaselabs/s3dl.git` |
| `uv` (`uvx`) | runs the `couchbase-guru` docs MCP server in `.mcp.json` | `brew install uv` |
| `tshark` (optional) | pcap analysis | `brew install wireshark` |
| `node` / `npx` (optional) | only for the optional Jira MCP server | `brew install node` |
| Claude Code | runs the agents in `.claude/agents/` | https://docs.claude.com/en/docs/claude-code |

You also need:
- Couchbase VPN access (the scripts check that `supportal.couchbase.com` is reachable).
- An AWS SSO profile for the Supportal bucket (see below).
- A Jira API token that can read the CBSE project (`setup.sh` tests this).
- GitHub membership in the `couchbase`, `couchbaselabs`, `couchbasecloud` and `membase` orgs if you use `cb-source-tool/` (see its README).

---

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
| AWS SSO profile name (`AWS_PROFILE`) | `.env` |
| Jira credentials | `~/.couchbase-support/jira.env` |
| Git user name (ticket response signature) | `git config user.name` |
| Jira MCP server for Claude Code (optional) | `~/.claude.json` via `claude mcp add` |

**AWS SSO setup — two steps, in order:**

1. **Configure the profile in `~/.aws/config`** (one-time, per machine). `setup.sh` prompts for a profile name — it defaults to `supportal`, but this is just a name, not a fixed requirement; use whatever your `~/.aws/config` actually has, or create a new one:

   ```ini
   [profile supportal]
   sso_start_url  = <your SSO start URL>
   sso_region     = us-east-1
   sso_account_id = <your-account-id>
   sso_role_name  = <your-role-name>
   region         = us-east-1
   ```

   Use the start URL that your AWS SSO sign-in page shows (the `aws sso login` output prints it, for example `https://d-xxxxxxxxxx.awsapps.com/start`). `setup.sh` checks whether the profile you named already exists here and prints this block for you to fill in if it doesn't.

2. **Authenticate**, using whatever profile name you configured in step 1 and told `setup.sh` about:

   ```bash
   aws sso login --profile supportal   # replace 'supportal' with your actual profile name
   ```

See [`docs/jira-mcp-setup.md`](docs/jira-mcp-setup.md) for manual Jira MCP configuration.

---

## Using the tools

### 1. Start a Claude Code session in the repo

```bash
cd cbsupport_tools
claude
```

Start Claude Code from the repo folder so it loads the agents in `.claude/agents/`, the log analysis skill and `.mcp.json`. The first time, approve the `couchbase-guru` docs MCP server when it asks. Make sure you are on the Couchbase VPN and logged in to AWS SSO (`aws sso login --profile <your profile>`).

### 2. First prompt of a session: check the setup

The first time you use the repo in a session (or after pulling changes), have Claude check the setup before you jump into a ticket:

```
Before we start, review this repo: confirm the agents in .claude/agents are readable,
check that .env has DIR_TICKETS and BASE_DIR set to a real, existing directory, confirm
AWS SSO is authenticated (aws sts get-caller-identity --profile <the AWS_PROFILE value from .env>), and confirm
Jira credentials in ~/.couchbase-support/jira.env work. Also confirm the ticket-agents-manager
workflow is wired correctly end to end: it should call couchbase-ticket-analyzer first, then
couchbase-docs-expert (mandatory) and couchbase-source-expert (when docs aren't enough), then
run its own QA checks before producing analysis_report_vN.md. Tell me what's missing, if
anything, before we analyze a ticket.
```

### 3. Analyze a ticket

```
Analyze ticket 76783
```

The orchestrator (`ticket-agents-manager`) runs the whole pipeline: the analyzer downloads the logs itself (do not download them first), finds the root cause, the docs and source experts research it, the manager QA-checks the findings, and you get a report with a customer response draft. Wait for it to finish; it can take a while on large collections.

### 4. Work the ticket with follow-up prompts

Typical things to ask in the same session:

| You want | Example prompt |
|----------|----------------|
| Re-analyze after the customer replied or uploaded new logs | `Customer replied on 76783, re-analyze. Their new message is the latest one in the ticket.` |
| Check one claim against the raw logs | `Verify the claim about the failover time on node 0003 with the command and the raw output.` |
| Customer reply draft | `Draft the customer response for 76783 using the findings in analysis_report_v3.md.` |
| CBSE draft for engineering | `Draft a CBSE for 76783: questions first, then background, then analysis with the commands and outputs.` |
| Read what engineering answered | `Read CBSE-12345 and tell me what engineering said and what we can tell the customer.` |
| Test a command before sending it | `Test the commands in the draft against a local test setup before I send it.` |

Tell Claude your preferences once (greeting, sign-off, wording, what not to mention to the customer). Edit the drafts yourself; they are starting points.

### 5. What you get and where

Output goes to `$DIR_TICKETS/<ticket>/` (see "Output Files" below). Every run writes a new version (`analysis_report_v1.md`, `v2`, ...) and never overwrites an earlier one.

### Rules of thumb

- Customer responses and CBSE texts are drafts. Nothing is posted to Jira, Zendesk or Supportal by the agents; you send them.
- Ask for the command and verbatim output behind every claim, and spot-check them against the raw logs before sending.
- Say what you already know in the prompt (for example "the customer says X") so the analysis starts from it, and give the CBSE or MB number when engineering has already answered.
- If a run misses something, ask a targeted follow-up with the node, file and time window instead of starting over.

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

- `prep_ticket_aws.sh` — download ticket data and cbcollect logs from AWS S3 (`bash prep_ticket_aws.sh s3init` logs in to AWS SSO first)
- `extract_ticket_timeline.sh` — extract ticket timeline JSON (rewrites `ticket_<n>.raw` and `ticket_timeline.json` in the ticket folder)
- `cb-source-tool/` — Couchbase source code analysis tool

### Other folders

- `skills/` — SME reference notes (CAO, KV, backup) that the agents read.
- `agents/cao-sme.md` — standalone CAO and Kubernetes SME agent definition (not installed by default; copy it into `.claude/agents/` to use it).

### Check your setup

After `setup.sh`, these should all succeed:

```bash
aws sso login --profile "$AWS_PROFILE"          # source .env first, or type the profile name
aws sts get-caller-identity --profile <profile>
bash extract_ticket_timeline.sh <any ticket number>   # fetches the ticket text only, no downloads
```


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
