# cb-source — Couchbase Server Source Code Tool

Mirror Couchbase Server git repositories and extract (materialize) the exact
source tree for any build by its build ID (e.g. `7.6.9-7457`).

---

## Setup

There are two sides to setup: **GitHub access** (your account must be able
to see the repos) and **local tooling** (your machine must have the right
software configured to authenticate). Both must be in place before anything
works.

### Step 1 — GitHub account access

Couchbase Server source is spread across four GitHub organizations. Some
repos in these orgs are **private** — GitHub returns "not found" if your
account isn't a member.

| GitHub org | What's in it | Private repos? |
|------------|-------------|----------------|
| [couchbase](https://github.com/couchbase) | Core server repos (ns_server, kv_engine, query, ...) and enterprise repos (backup, query-ee, eventing-ee, cbftx, cbas-core) | Yes — enterprise components |
| [couchbaselabs](https://github.com/couchbaselabs) | Labs/experimental repos, some build deps (golang, gojsonsm) | Some |
| [couchbasecloud](https://github.com/couchbasecloud) | Cloud-related repos | Some |
| [membase](https://github.com/membase) | Legacy membase repos | Some |

**You need to be a member of all four orgs.** If you're not, private repos
will appear as "repository not found" — GitHub doesn't distinguish between
"doesn't exist" and "you can't see it."

**How to get access:**

1. Ask your manager or team lead to invite your GitHub account to the
   `couchbase`, `couchbaselabs`, `couchbasecloud`, and `membase` orgs
2. Accept the invitations at https://github.com/settings/organizations
3. Verify: go to https://github.com/orgs/couchbase/people and confirm
   you appear in the member list

### Step 2 — Install local tools

You need three things installed:

| Tool | What it does | Install |
|------|-------------|---------|
| **git** | Clones and archives repos | `sudo apt install git` (Linux) / `brew install git` (macOS) |
| **Python 3.6+** | Runs this script | Usually pre-installed on Linux/macOS |
| **gh** (GitHub CLI) | Handles GitHub authentication for git | [cli.github.com](https://cli.github.com/) |

Install `gh`:
```bash
# Linux (Debian/Ubuntu)
sudo apt install gh

# Linux (other) — see https://github.com/cli/cli/blob/trunk/docs/install_linux.md
# macOS
brew install gh
```

### Step 3 — Authenticate

The `gh` CLI manages your GitHub credentials. It needs to be logged in with
an account that has access to the four orgs above.

```bash
# Log in (opens a browser for OAuth)
gh auth login

# When prompted:
#   - GitHub.com (not Enterprise)
#   - HTTPS protocol
#   - Authenticate with a web browser
#   - The token needs scopes: repo, read:org
```

**If your token doesn't have the right scopes**, re-authenticate:
```bash
gh auth login -s repo,read:org
```

**Configure git to use gh for credentials:**
```bash
gh auth setup-git
```

This tells git to ask `gh` for credentials when accessing github.com over
HTTPS, instead of prompting for a username/password.

### Step 4 — Verify everything

Run the preflight check:

```bash
python3 cb-source.py preflight
```

You should see all `[OK]` entries:
```
  [OK]   git: git version 2.x.x
  [OK]   gh:  gh version 2.x.x
  [OK]   gh auth: Logged in to github.com account YOUR_USERNAME
  [OK]   git credential helper: configured
  [OK]   python: 3.x.x

  Checking GitHub org membership...
  [OK]   couchbase: member
  [OK]   couchbaselabs: member
  [OK]   couchbasecloud: member
  [OK]   membase: member

  [OK]   token scope: repo (private repo access)
  [OK]   token scope: read:org (org membership check)
```

If anything shows `[FAIL]`, fix it before proceeding. The output tells you
exactly what to do.

**To also verify access to every repo needed for a specific build:**
```bash
python3 cb-source.py preflight 7.6.9-7457
```

This probes each repo without downloading anything and reports:
```
  Accessible:    23/23 repos

  Accessible repositories:
    [OK]   backup
    [OK]   cbft
    [OK]   kv_engine
    ...

  You can materialize 23/23 key components (100%)
```

If any show `[NO ACCESS]`, see "Troubleshooting" below.

---

## Quick start

Once setup passes preflight:

```bash
cd ~/work

# Materialize a specific build
python3 cb-source.py materialize 7.6.9-7457
```

This will:
1. Create `./couchbase_code/` in the current directory
2. Clone the `build-manifests` repo (~60 MB, first run only)
3. Look up the manifest XML for the build
4. Verify access to every required repo
5. Mirror the repos needed for key components
6. Extract each component at its exact pinned revision

Subsequent builds reuse already-mirrored repos.

---

## Commands

### `preflight` — verify setup

```bash
python3 cb-source.py preflight                  # check tools, auth, org access
python3 cb-source.py preflight 7.6.9-7457       # also check repo access for a build
```

### `list` — browse available builds

```bash
python3 cb-source.py list                   # most recent 50 builds
python3 cb-source.py list --prefix 7.6      # only 7.6.x builds
python3 cb-source.py list --prefix 8.0 --limit 20
```

### `materialize` — mirror + extract source for a build

```bash
python3 cb-source.py materialize 7.6.9-7457             # specific build
python3 cb-source.py materialize --latest 7.6            # latest 7.6 build
python3 cb-source.py materialize 7.6.9-7457 --all-components  # include all deps
python3 cb-source.py materialize 7.6.9-7457 --force      # re-extract from scratch
python3 cb-source.py materialize 7.6.9-7457 --mirror-only # just clone repos
python3 cb-source.py materialize 7.6.9-7457 --skip-mirror # skip cloning
python3 cb-source.py materialize 7.6.9-7457 --workers 16  # more parallelism
python3 cb-source.py materialize 7.6.9-7457 -y            # non-interactive
```

### `mirror-all` — full mirror of every repo (~250 GB)

```bash
python3 cb-source.py mirror-all                 # all orgs
python3 cb-source.py mirror-all --org couchbase # single org
python3 cb-source.py mirror-all --update-only   # update existing only
```

### Global options

| Flag | Description |
|------|-------------|
| `--base-dir DIR` | Override base directory (default: `./couchbase_code`) |
| `CB_SOURCE_DIR` env var | Same as `--base-dir` |

---

## Directory structure

```
./couchbase_code/
├── couchbase/                          # bare git mirrors
│   ├── build-manifests.git
│   ├── ns_server.git
│   ├── kv_engine.git
│   └── ...
├── couchbasedeps/
├── couchbaselabs/
├── blevesearch/
└── materialized_builds/
    └── 7.6.9-7457/
        ├── ns_server/
        ├── kv_engine/
        ├── goproj/src/github.com/couchbase/query/
        └── materialization_info.json
```

---

## Key components

By default only these are materialized (`--all-components` for everything):

| Component | Description |
|-----------|-------------|
| ns_server | Cluster manager |
| kv_engine | KV storage engine |
| query | N1QL query engine |
| indexing | GSI / secondary index |
| cbft | Full-text search (FTS) |
| couchstore | Storage backend |
| couchdb | View engine |
| eventing | Eventing service |
| goxdcr | Cross-datacenter replication |
| backup | Backup & restore (private) |
| analytics | Analytics service |
| platform | Platform utilities |
| phosphor | Tracing library |
| memcached | Memcached protocol layer |

---

## How it works

1. **Build manifests** — Couchbase publishes an XML manifest for every CI
   build in `build-manifests.git`. Each manifest pins every component to
   an exact git commit hash.

2. **Version-to-branch mapping** — Versions map to codenames:
   6.5-6.6=`mad-hatter`, 7.0-7.1=`cheshire-cat`, 7.2=`neo`,
   7.6=`trinity`, 8.0=`morpheus`, 8.1=`totoro`

3. **Access verification** — Before cloning, `gh api` probes every required
   repo using the token captured at startup. Reports exactly what you can
   and can't access.

4. **Targeted mirroring** — Only clones repos referenced by the build
   manifest, not all 18,000+ repos across all orgs.

5. **Extraction** — `git archive` extracts each component at the exact
   pinned revision into the output directory.

---

## Troubleshooting

**Start here:**
```bash
python3 cb-source.py preflight 7.6.9-7457
```

**Repos showing `[NO ACCESS]` or "Repository not found"**

This means your GitHub account can't see those repos. Possible causes:

1. **Not an org member** — check `preflight` output for org membership.
   Ask your manager for an invite.
2. **Wrong account active** — if you have multiple GitHub accounts:
   ```bash
   gh auth status                # which account is active?
   gh auth switch -u ACCOUNT     # switch to your work account
   ```
3. **Token missing scopes** — the token needs `repo` and `read:org`:
   ```bash
   gh auth login -s repo,read:org
   ```
4. **Invitation not accepted** — check https://github.com/settings/organizations

**"gh: command not found"**

Install: https://cli.github.com/

**"fatal: could not read Username"**

Git can't authenticate. Run:
```bash
gh auth setup-git
```

**"All prerequisites met" but repos still fail**

If `preflight` passes but `materialize` fails, you may have a credential
helper that switches GitHub accounts during git operations. The script
handles this by pinning the token at startup, but if you see unexpected
behavior, try:
```bash
GH_TOKEN=$(gh auth token) python3 cb-source.py materialize 7.6.9-7457
```

**Re-materialize after a partial failure**
```bash
python3 cb-source.py materialize 7.6.9-7457 --force
```

---

## Disk space

| What | Size |
|------|------|
| build-manifests.git | ~60 MB |
| Key component mirrors (one build) | ~5-8 GB |
| Single materialized build (key only) | ~1.5-2 GB |
| Full mirror of all orgs | ~250 GB |
