# Jira MCP Setup for Claude Code

Instructions for an agent (or human) to configure the Jira MCP server for Claude Code on a new machine. Mirrors the configuration in `~/.factory/mcp.json` used by the Factory droids.

## What this does

Adds the `jira-mcp` npm package as an MCP server so Claude Code agents can query Jira (issues.couchbase.com) natively via MCP tools instead of using `curl` shell calls. The agents already fall back to `curl` + `~/.couchbase-support/jira.env`; this is additive and cleaner.

## Current state (as of 2026-06-26)

| Platform | Jira MCP | Method |
|---|---|---|
| Factory droids | configured | `~/.factory/mcp.json` → `npx jira-mcp` |
| GitHub Copilot | none | `curl` + `~/.couchbase-support/jira.env` |
| Claude Code | **none** | `curl` + `~/.couchbase-support/jira.env` |

## Prerequisites

- Node.js ≥ 18 and npm installed (`node --version`, `npm --version`)
- A Jira API token for `issues.couchbase.com` (via Atlassian account settings)
- `~/.couchbase-support/` directory for credentials

## Step 1 — Create the credentials file

```bash
mkdir -p ~/.couchbase-support
cat > ~/.couchbase-support/jira.env << 'EOF'
JIRA_INSTANCE_URL=https://api.atlassian.com/ex/jira/7fa05bac-b453-4b39-9ec3-830a6365e08a
JIRA_USER_EMAIL=<your-email@couchbase.com>
JIRA_API_KEY=<your-atlassian-api-token>
EOF
chmod 600 ~/.couchbase-support/jira.env
```

To generate a Jira API token:
1. Go to https://id.atlassian.com/manage-profile/security/api-tokens
2. Click **Create API token**
3. Label it `claude-mcp` and copy the token

## Step 2 — Verify the credentials work (optional smoke test)

```bash
source ~/.couchbase-support/jira.env
curl -s -u "$JIRA_USER_EMAIL:$JIRA_API_KEY" \
  -H "Accept: application/json" \
  "$JIRA_INSTANCE_URL/rest/api/2/issue/MB-65738" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['fields']['summary'])"
```

Expected: prints the MB-65738 summary without error.

## Step 3 — Add the Jira MCP server to Claude Code

### Option A: via `claude mcp add` (recommended — user scope, applies to all projects)

```bash
source ~/.couchbase-support/jira.env
claude mcp add jira \
  -e JIRA_INSTANCE_URL="$JIRA_INSTANCE_URL" \
  -e JIRA_USER_EMAIL="$JIRA_USER_EMAIL" \
  -e JIRA_API_KEY="$JIRA_API_KEY" \
  -- npx jira-mcp
```

This writes to `~/.claude.json` under `mcpServers` and is available in all Claude Code sessions.

### Option B: via project `.mcp.json` (project scope only)

Create `/path/to/cbsupport_tools/.mcp.json`:

```json
{
  "mcpServers": {
    "jira": {
      "type": "stdio",
      "command": "npx",
      "args": ["jira-mcp"],
      "env": {
        "JIRA_INSTANCE_URL": "https://api.atlassian.com/ex/jira/7fa05bac-b453-4b39-9ec3-830a6365e08a",
        "JIRA_USER_EMAIL": "<your-email@couchbase.com>",
        "JIRA_API_KEY": "<your-atlassian-api-token>"
      },
      "disabled": false
    }
  }
}
```

**Note:** Do not commit `.mcp.json` with real credentials — add it to `.gitignore`.

### Option C: match the Factory config exactly

The factory uses `~/.factory/mcp.json`. The identical structure works for Claude Code if placed at `~/.mcp.json` (user-level global):

```bash
source ~/.couchbase-support/jira.env
cat > ~/.mcp.json << EOF
{
  "mcpServers": {
    "jira": {
      "type": "stdio",
      "command": "npx",
      "args": ["jira-mcp"],
      "env": {
        "JIRA_INSTANCE_URL": "$JIRA_INSTANCE_URL",
        "JIRA_USER_EMAIL": "$JIRA_USER_EMAIL",
        "JIRA_API_KEY": "$JIRA_API_KEY"
      },
      "disabled": false
    }
  }
}
EOF
chmod 600 ~/.mcp.json
```

## Step 4 — Verify Claude Code sees the server

```bash
claude mcp list
```

Expected output includes:
```
jira: npx jira-mcp - connected
```

If it shows `needs authentication` or is missing, restart Claude Code and run again.

## Step 5 — Test from within Claude Code

In a Claude Code session:
```
Search Jira for MB tickets related to "plasma memory" affecting version 7.6.5
```

Claude should use the `jira` MCP tool instead of falling back to `curl`.

## Notes

- `npx jira-mcp` downloads the package on first use (~2 seconds). To pre-cache: `npx jira-mcp --version`
- The Atlassian instance UUID (`7fa05bac-b453-4b39-9ec3-830a6365e08a`) is Couchbase's Jira cloud instance — same across all team members.
- `JIRA_INSTANCE_URL` must use the Atlassian cloud REST URL, not `issues.couchbase.com` directly.
- API keys are per-user — each team member needs their own token from id.atlassian.com.
- The `~/.couchbase-support/jira.env` file is also read directly by the agent `curl` fallback path, so keeping it populated means both MCP and curl work.

## Reference: Factory config location

The Factory droids read from `~/.factory/mcp.json`:
```json
{
  "mcpServers": {
    "jira": {
      "type": "stdio",
      "command": "npx",
      "args": ["jira-mcp"],
      "env": {
        "JIRA_INSTANCE_URL": "https://api.atlassian.com/ex/jira/7fa05bac-b453-4b39-9ec3-830a6365e08a",
        "JIRA_USER_EMAIL": "<user>@couchbase.com",
        "JIRA_API_KEY": "<token>"
      },
      "disabled": false
    }
  }
}
```

Claude Code uses the same `mcpServers` schema but reads from `~/.mcp.json`, `<project>/.mcp.json`, or `~/.claude.json` (written by `claude mcp add`).
