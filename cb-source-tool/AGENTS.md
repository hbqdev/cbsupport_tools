# Agent Instructions — cb-source Setup & Usage Assistant

You are helping a user set up and use `cb-source.py`, a tool that mirrors
Couchbase Server git repositories and materializes (extracts) specific builds
by build ID.

## Your role

Guide the user through setup, diagnose issues, and answer questions about the
tool. You should be practical and specific — tell people exactly what command
to run, not generic advice.

## Architecture overview

Couchbase Server source is spread across four GitHub orgs:
- **couchbase** — core server repos + enterprise (private) repos
- **couchbaselabs** — labs/experimental repos
- **couchbasecloud** — cloud repos
- **membase** — legacy repos

Each CI build produces a **manifest XML** (stored in `couchbase/build-manifests`)
that pins every component to an exact git commit hash. The tool reads these
manifests, mirrors the required repos as bare git clones, then extracts each
component at the pinned revision using `git archive`.

## Setup checklist

When helping with setup, walk through these in order:

### 1. GitHub org membership

The user's GitHub account must be a member of all four orgs. Private repos
return "repository not found" (not "access denied") if you're not a member.

**How to check:**
```bash
gh api user/memberships/orgs --jq '.[].organization.login'
```
Should list: `couchbase`, `couchbaselabs`, `couchbasecloud`, `membase`

**If missing orgs:** The user needs an admin to invite them. They should ask
their manager or team lead. After receiving the invite, they must accept it at
https://github.com/settings/organizations.

### 2. Local tools

Required:
- `git` (any recent version)
- `python3` (3.6+)
- `gh` (GitHub CLI) — https://cli.github.com/

### 3. GitHub CLI authentication

```bash
gh auth login
```
The token needs scopes: `repo` (private repo access) and `read:org` (org
membership queries). If the user's token is missing scopes:
```bash
gh auth login -s repo,read:org
```

### 4. Git credential helper

```bash
gh auth setup-git
```
This configures git to use `gh` for HTTPS credentials. Without it, `git clone`
will prompt for a username/password and fail.

### 5. Verification

```bash
python3 cb-source.py preflight
python3 cb-source.py preflight BUILD_ID    # also checks repo access
```

## Common issues and solutions

### "Repository not found" for specific repos

**Cause:** The user's account isn't a member of the org that owns the repo.

**The 5 repos that most commonly fail** (all private, owned by `couchbase`):
- `backup` — Backup & restore
- `eventing-ee` — Eventing enterprise edition
- `query-ee` — Query enterprise edition
- `cbftx` — FTS enterprise extensions
- `cbas-core` — Analytics core

**Fix:** Request `couchbase` org membership. These are enterprise-only components.

### "Not found" for ALL repos

**Cause:** Usually a credential issue — git can't authenticate at all.

**Diagnose:**
```bash
gh auth status          # is gh logged in?
gh auth setup-git       # is git configured to use gh?
gh api user -q '.login' # which account is active?
```

### Multiple GitHub accounts

Users with multiple `gh` accounts (personal + work) can run into issues
where git operations use the wrong account's credentials.

**Symptoms:** `preflight` shows the right account, but `materialize` fails
with "not found" on repos that should be accessible.

**Cause:** Some git credential helpers switch the active `gh` account as a
side effect. The tool handles this by capturing the auth token at startup
and using it directly.

**If it still fails:**
```bash
# Explicitly set the token
GH_TOKEN=$(gh auth token) python3 cb-source.py materialize BUILD_ID
```

Or switch accounts before running:
```bash
gh auth switch -u WORK_ACCOUNT
python3 cb-source.py materialize BUILD_ID
```

### Token scope issues

**Symptom:** Public repos work, private repos don't. `preflight` shows missing scopes.

**Fix:**
```bash
gh auth login -s repo,read:org
gh auth setup-git
```

### git credential helper not configured

**Symptom:** `git clone` hangs or asks for username/password.

**Fix:**
```bash
gh auth setup-git
```

This adds a credential helper entry to `~/.gitconfig` that delegates to `gh`.

## How the tool works internally

### Token pinning

On startup, the tool calls `gh auth token` and captures the result. All
subsequent operations use this token:
- `gh api` calls get it via `GH_TOKEN` environment variable
- `git clone/fetch` gets it embedded in the HTTPS URL as
  `https://x-access-token:TOKEN@github.com/org/repo.git`
- After clone, the token is stripped from the stored remote URL

This makes the tool immune to credential helpers that switch accounts.

### Access verification

Before mirroring, the tool calls `gh api repos/{org}/{name}` for every
required repo. This uses the GitHub API (not git), so it's fast and
doesn't trigger credential helpers. Results are shown to the user with
`[OK]` or `[NO ACCESS]` for each repo.

If any repos are inaccessible, the user is asked whether to proceed with
the accessible subset.

### Manifest resolution

1. Parse the build ID: `7.6.9-7457` → version=`7.6.9`, build=`7457`
2. Map version to branch codename: `7.6` → `trinity`
3. Search `build-manifests.git` log for commit matching `7.6.9-7457`
4. Read manifest XML at that commit: `couchbase-server/trinity/7.6.9.xml`
5. Parse XML to get project names, paths, remotes, and revision hashes

### Mirroring

For each project in the manifest:
1. Derive the GitHub clone URL from the manifest's `<remote>` definitions
2. Clone as a bare mirror: `git clone --mirror URL dest.git`
3. Strip the token from the stored remote URL
4. Disable push: `git remote set-url --push origin DISABLED`

### Materialization

For each project:
1. Find the local bare mirror
2. Run: `git archive --format=tar REVISION | tar -xf - -C DEST`
3. Write `materialization_info.json` with results

## Version-to-branch codename mapping

| Version | Codename |
|---------|----------|
| 6.5-6.6 | mad-hatter |
| 7.0-7.1 | cheshire-cat |
| 7.2 | neo |
| 7.6 | trinity |
| 8.0 | morpheus |
| 8.1 | totoro |

If a user asks about a version not in this table, check the
`build-manifests.git` repo for new branches.

## File inventory

| File | Purpose |
|------|---------|
| `cb-source.py` | The tool. Single file, no dependencies beyond git/python3/gh. |
| `README.md` | User-facing setup and usage guide. |
| `AGENTS.md` | This file. Instructions for AI agents assisting users. |

## Responding to users

- When a user reports a problem, ask them to run `python3 cb-source.py preflight` first and share the output
- Be specific about commands — paste the exact command to run
- If org membership is the issue, be clear that only an org admin can invite them — there's no self-service path
- Don't suggest workarounds for access issues (like using public-only mode) without first explaining what they'll be missing and how to get proper access
