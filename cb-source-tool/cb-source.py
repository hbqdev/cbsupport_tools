#!/usr/bin/env python3
"""
cb-source.py - Couchbase Server Source Code Mirror & Materialization Tool

Mirror Couchbase Server git repositories and materialize specific builds
by build ID, extracting the exact source code for each component at the
revision pinned in the build manifest.

SETUP:
    1. Install prerequisites: git, python3, gh (GitHub CLI)
    2. Authenticate with GitHub:
         gh auth login
         gh auth setup-git      # configures git credential helper
    3. Ensure your GitHub account has access to the 'couchbase' org
       (required for private repos like backup, eventing-ee, etc.)

QUICK START:
    # Materialize a specific build (mirrors required repos automatically)
    ./cb-source.py materialize 7.6.9-7457

    # List recent builds
    ./cb-source.py list

    # Materialize the latest build for a version line
    ./cb-source.py materialize --latest 7.6

    # Full mirror of all repos from all Couchbase orgs (~250GB)
    ./cb-source.py mirror-all

DIRECTORY STRUCTURE CREATED:
    ./couchbase_code/
    ├── couchbase/                  # Bare git mirrors from github.com/couchbase
    │   ├── build-manifests.git     # Build manifest repository (mirrored first)
    │   ├── ns_server.git
    │   ├── kv_engine.git
    │   └── ...
    ├── couchbasedeps/              # Bare git mirrors from github.com/couchbasedeps
    ├── couchbaselabs/              # Bare git mirrors from github.com/couchbaselabs
    ├── blevesearch/                # Bare git mirrors from github.com/blevesearch
    └── materialized_builds/
        └── 7.6.9-7457/            # Extracted source tree for this build
            ├── ns_server/
            ├── kv_engine/
            ├── goproj/src/github.com/couchbase/query/
            └── materialization_info.json

ENVIRONMENT:
    CB_SOURCE_DIR   Override the base directory (default: ./couchbase_code)
"""

import argparse
import json
import os
import re
import subprocess
import sys
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse

# ---------------------------------------------------------------------------
# Version-to-branch codename mapping
# ---------------------------------------------------------------------------
BRANCH_MAP = {
    "7.6": "trinity",
    "7.2": "neo",
    "7.1": "cheshire-cat",
    "7.0": "cheshire-cat",
    "8.0": "morpheus",
    "8.1": "totoro",
    "6.6": "mad-hatter",
    "6.5": "mad-hatter",
}

# Key components to materialize by default (others are optional dependencies)
KEY_COMPONENTS = {
    "query", "indexing", "kv_engine", "ns_server", "goxdcr",
    "eventing", "cbft", "couchstore", "memcached", "platform",
    "phosphor", "couchdb", "analytics", "backup",
}

# GitHub orgs to mirror when using mirror-all
ALL_ORGS = ["couchbase", "couchbaselabs", "couchbasecloud", "membase"]

# Build manifests repository name
MANIFESTS_REPO_NAME = "build-manifests"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def git_cmd(repo_path, *args, timeout=120):
    """Run a git command and return (ok, stdout, stderr)."""
    cmd = ["git", "-C", str(repo_path)] + list(args)
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return result.returncode == 0, result.stdout.strip(), result.stderr.strip()
    except subprocess.TimeoutExpired:
        return False, "", "timeout"
    except Exception as e:
        return False, "", str(e)


def run_cmd(cmd, timeout=300, shell=False):
    """Run a command and return (ok, stdout, stderr)."""
    try:
        result = subprocess.run(
            cmd, capture_output=True, text=True, timeout=timeout, shell=shell
        )
        return result.returncode == 0, result.stdout.strip(), result.stderr.strip()
    except subprocess.TimeoutExpired:
        return False, "", "timeout"
    except Exception as e:
        return False, "", str(e)


def remote_fetch_to_org(fetch_url):
    """
    Extract the GitHub org name from a manifest remote fetch URL.

    Examples:
        https://github.com/couchbase/      -> couchbase
        ssh://git@github.com/couchbase/     -> couchbase
        https://github.com/couchbasedeps/   -> couchbasedeps
    """
    url = fetch_url.rstrip("/")
    return url.split("/")[-1]


def remote_fetch_to_https(fetch_url, repo_name):
    """
    Construct an HTTPS clone URL from a manifest remote fetch URL.

    Always returns HTTPS regardless of whether the manifest uses SSH,
    since gh auth setup-git handles credentials for HTTPS.
    """
    org = remote_fetch_to_org(fetch_url)
    return f"https://github.com/{org}/{repo_name}.git"


# ---------------------------------------------------------------------------
# Core class
# ---------------------------------------------------------------------------

class CouchbaseSource:
    def __init__(self, base_dir):
        self.base_dir = Path(base_dir).resolve()
        self.manifests_repo = self.base_dir / "couchbase" / f"{MANIFESTS_REPO_NAME}.git"
        self.output_base = self.base_dir / "materialized_builds"
        # Capture the active gh token at init time, before any git operations
        # can trigger credential helpers that may switch the active account.
        self._gh_token = self._fetch_gh_token()

    # -- Preflight & access verification ------------------------------------

    def verify_prerequisites(self):
        """
        Check that all required tools are installed and configured.
        Returns (ok, issues_list).
        """
        issues = []

        # 1. git
        ok, out, err = run_cmd(["git", "--version"])
        if ok:
            print(f"  [OK]   git: {out}")
        else:
            issues.append("git is not installed or not in PATH")
            print(f"  [FAIL] git: not found")

        # 2. gh CLI
        ok, out, err = run_cmd(["gh", "--version"])
        if ok:
            version_line = out.split("\n")[0]
            print(f"  [OK]   gh:  {version_line}")
        else:
            issues.append(
                "gh (GitHub CLI) is not installed. "
                "Install from https://cli.github.com/"
            )
            print(f"  [FAIL] gh:  not found (install from https://cli.github.com/)")
            # Can't check further without gh
            return len(issues) == 0, issues

        # 3. gh auth
        ok, out, err = run_cmd(["gh", "auth", "status"])
        combined = out + "\n" + err
        if ok:
            # Show which account is active
            active_account = None
            all_accounts = []
            for line in combined.split("\n"):
                line_s = line.strip()
                if "logged in" in line_s.lower():
                    all_accounts.append(line_s)
                if "active account: true" in line_s.lower():
                    # The previous "Logged in" line is the active one
                    if all_accounts:
                        active_account = all_accounts[-1]
            if active_account:
                print(f"  [OK]   gh auth: {active_account}")
            else:
                print(f"  [OK]   gh auth: authenticated")

            # Show all accounts if more than one
            if len(all_accounts) > 1:
                print(f"         ({len(all_accounts)} accounts configured, "
                      f"switch with: gh auth switch -u USERNAME)")
        else:
            issues.append(
                "gh is not authenticated. Run: gh auth login"
            )
            print(f"  [FAIL] gh auth: not authenticated")
            print(f"         Run: gh auth login")
            return len(issues) == 0, issues

        # 4. git credential helper (gh auth setup-git)
        ok, out, err = run_cmd(
            ["git", "config", "--global", "credential.https://github.com.helper"]
        )
        if not ok or not out:
            # Also check the generic credential helper
            ok2, out2, _ = run_cmd(
                ["git", "config", "--global", "credential.helper"]
            )
            if not ok2 or not out2:
                issues.append(
                    "git credential helper not configured for GitHub. "
                    "Run: gh auth setup-git"
                )
                print(f"  [WARN] git credential helper: not configured")
                print(f"         Run: gh auth setup-git")
            else:
                print(f"  [OK]   git credential helper: {out2}")
        else:
            print(f"  [OK]   git credential helper: configured")

        # 5. Python version
        py_ver = sys.version.split()[0]
        print(f"  [OK]   python: {py_ver}")

        # 6. GitHub org membership
        print()
        print("  Checking GitHub org membership...")
        required_orgs = ["couchbase", "couchbaselabs", "couchbasecloud", "membase"]
        env = {**os.environ}
        if self._gh_token:
            env["GH_TOKEN"] = self._gh_token

        ok_orgs, out_orgs, _ = run_cmd(
            ["gh", "api", "user/memberships/orgs", "--jq",
             ".[].organization.login"],
            timeout=15,
        )
        member_orgs = set(out_orgs.split()) if ok_orgs else set()

        # Also get the username for reporting
        _, gh_user, _ = run_cmd(["gh", "api", "user", "--jq", ".login"],
                                timeout=10)

        all_orgs_ok = True
        for org in required_orgs:
            if org in member_orgs:
                print(f"  [OK]   {org}: member")
            else:
                all_orgs_ok = False
                print(f"  [FAIL] {org}: not a member")

        if not all_orgs_ok:
            missing = [o for o in required_orgs if o not in member_orgs]
            issues.append(
                f"GitHub account '{gh_user}' is not a member of: "
                + ", ".join(missing)
            )
            print()
            print(f"  Your account ({gh_user}) needs membership in the orgs above.")
            print(f"  Ask an org admin to invite your GitHub account, or")
            print(f"  switch to an account that already has access:")
            print(f"    gh auth switch -u YOUR_WORK_ACCOUNT")

        # 7. Token scopes
        print()
        ok_scope, scope_out, scope_err = run_cmd(["gh", "auth", "status"])
        scope_combined = scope_out + "\n" + scope_err
        has_repo_scope = False
        has_read_org = False
        for line in scope_combined.split("\n"):
            if "token scopes" in line.lower():
                has_repo_scope = "'repo'" in line
                has_read_org = "'read:org'" in line
                break

        if has_repo_scope:
            print(f"  [OK]   token scope: repo (private repo access)")
        else:
            issues.append("Token missing 'repo' scope (needed for private repos)")
            print(f"  [FAIL] token scope: missing 'repo'")
            print(f"         Re-auth with: gh auth login -s repo,read:org")

        if has_read_org:
            print(f"  [OK]   token scope: read:org (org membership check)")
        else:
            issues.append("Token missing 'read:org' scope")
            print(f"  [FAIL] token scope: missing 'read:org'")
            print(f"         Re-auth with: gh auth login -s repo,read:org")

        return len(issues) == 0, issues

    def check_repo_access(self, org, repo_name, timeout=15):
        """
        Test if a remote git repo is accessible without cloning it.
        Uses 'gh api' with the token captured at startup (via GH_TOKEN env),
        so it's immune to credential-helper side-effects that can switch
        the active gh account during git operations.
        Returns (accessible: bool, error_hint: str).
        """
        env = None
        if self._gh_token:
            env = {**os.environ, "GH_TOKEN": self._gh_token}

        cmd = ["gh", "api", f"repos/{org}/{repo_name}", "--jq", ".full_name"]
        try:
            result = subprocess.run(
                cmd, capture_output=True, text=True, timeout=timeout, env=env,
            )
            if result.returncode == 0 and result.stdout.strip():
                return True, ""
            err = result.stderr.strip()
            if "not found" in err.lower() or "404" in err:
                return False, "private/restricted (requires org access)"
            return False, err.split("\n")[0] if err else "unknown error"
        except subprocess.TimeoutExpired:
            return False, "timeout (network issue?)"
        except Exception as e:
            return False, str(e)

    def verify_build_access(self, remotes, projects, key_only=True):
        """
        Check access to every repo required by a build manifest.
        Returns (accessible_list, restricted_list, skipped_list).

        Each entry is a dict with: name, url, remote, status, reason.
        """
        accessible = []
        restricted = []
        skipped = []

        # Collect unique repos to check
        repos_to_check = []
        seen = set()
        for p in projects:
            if key_only:
                is_key = any(
                    k in p["name"].lower() or k in p["path"].lower()
                    for k in KEY_COMPONENTS
                )
                if not is_key:
                    skipped.append({
                        "name": p["name"],
                        "remote": p["remote"],
                        "status": "skipped",
                        "reason": "not a key component",
                    })
                    continue

            remote_name = p["remote"]
            fetch_url = remotes.get(remote_name, "")
            if not fetch_url:
                restricted.append({
                    "name": p["name"],
                    "remote": remote_name,
                    "url": "?",
                    "status": "error",
                    "reason": f"unknown remote '{remote_name}'",
                })
                continue

            org = remote_fetch_to_org(fetch_url)
            url = remote_fetch_to_https(fetch_url, p["name"])
            repo_key = f"{org}/{p['name']}"
            if repo_key in seen:
                continue
            seen.add(repo_key)
            repos_to_check.append((p["name"], p["remote"], org, url))

        # Check access in parallel for speed
        print(f"Checking access to {len(repos_to_check)} repositories...")

        with ThreadPoolExecutor(max_workers=8) as executor:
            futures = {
                executor.submit(self.check_repo_access, org, name): (name, remote, url)
                for name, remote, org, url in repos_to_check
            }
            for future in as_completed(futures):
                name, remote, url = futures[future]
                try:
                    ok, reason = future.result()
                except Exception as e:
                    ok, reason = False, str(e)

                entry = {
                    "name": name,
                    "remote": remote,
                    "url": url,
                }
                if ok:
                    entry["status"] = "accessible"
                    accessible.append(entry)
                else:
                    entry["status"] = "restricted"
                    entry["reason"] = reason
                    restricted.append(entry)

        return accessible, restricted, skipped

    # -- Auth helpers -------------------------------------------------------

    @staticmethod
    def _fetch_gh_token():
        """Fetch the active gh CLI auth token (call once at startup)."""
        ok, token, err = run_cmd(["gh", "auth", "token"], timeout=10)
        if ok and token:
            return token
        return None

    def _get_gh_token(self):
        """Return the gh token captured at init time."""
        return self._gh_token

    def _authed_url(self, https_url):
        """Inject the active gh token into an HTTPS URL for git operations.

        This ensures git uses the same account as 'gh auth status',
        regardless of credential-helper configuration.
        """
        token = self._get_gh_token()
        if not token:
            return https_url
        # https://github.com/org/repo.git -> https://x-access-token:TOKEN@github.com/org/repo.git
        return https_url.replace("https://", f"https://x-access-token:{token}@", 1)

    # -- Setup & mirror management ------------------------------------------

    def ensure_setup(self):
        """Ensure build-manifests repo is mirrored. Clone it if missing."""
        if self.manifests_repo.exists():
            print(f"Build manifests repo exists: {self.manifests_repo}")
            self._update_mirror(self.manifests_repo)
            return True

        print("Cloning build-manifests repository (first-time setup)...")
        self.base_dir.mkdir(parents=True, exist_ok=True)
        org_dir = self.base_dir / "couchbase"
        org_dir.mkdir(parents=True, exist_ok=True)

        url = f"https://github.com/couchbase/{MANIFESTS_REPO_NAME}.git"
        ok, out, err = run_cmd([
            "git", "clone", "--mirror", self._authed_url(url),
            str(self.manifests_repo)
        ], timeout=600)

        if not ok:
            print(f"ERROR: Failed to clone {url}")
            print(f"  {err}")
            print()
            print("Make sure you have:")
            print("  1. git installed")
            print("  2. gh CLI installed and authenticated: gh auth login")
            print("  3. git credential helper configured: gh auth setup-git")
            print("  4. Access to the couchbase GitHub org")
            return False

        # Set clean URL (no token) and disable push
        run_cmd(["git", "-C", str(self.manifests_repo),
                 "remote", "set-url", "origin", url])
        run_cmd(["git", "-C", str(self.manifests_repo),
                 "remote", "set-url", "--push", "origin", "DISABLED"])

        print("Build manifests repo cloned successfully.")
        return True

    def _update_mirror(self, repo_path):
        """Update an existing bare mirror.

        Temporarily injects the active gh token into the remote URL
        for the fetch, then restores the clean URL.
        """
        # Get current remote URL
        _, current_url, _ = git_cmd(repo_path, "remote", "get-url", "origin")

        # Temporarily set authed URL for the fetch
        authed = self._authed_url(current_url) if current_url else None
        if authed and authed != current_url:
            git_cmd(repo_path, "remote", "set-url", "origin", authed)

        ok, out, err = git_cmd(repo_path, "remote", "update", "--prune", timeout=120)

        # Restore clean URL
        if authed and authed != current_url:
            git_cmd(repo_path, "remote", "set-url", "origin", current_url)

        if ok:
            print(f"  Updated: {repo_path.name}")
        else:
            print(f"  Update failed for {repo_path.name}: {err}")
        return ok

    def _clone_mirror(self, url, dest_path):
        """Clone a bare mirror of a repo.

        Uses the active gh token to authenticate, bypassing credential-helper
        routing issues when multiple GitHub accounts are configured.
        """
        if dest_path.exists():
            return self._update_mirror(dest_path)

        dest_path.parent.mkdir(parents=True, exist_ok=True)
        print(f"  Cloning: {url}")

        # Use token-authed URL for the clone
        authed = self._authed_url(url)
        ok, out, err = run_cmd([
            "git", "clone", "--mirror", authed, str(dest_path)
        ], timeout=600)

        if not ok:
            if "not found" in err.lower() or "could not read" in err.lower():
                print(f"  FAILED (private repo - requires org access): {url}")
            else:
                print(f"  FAILED: {err}")
            return False

        # Set the remote URL to the clean (non-authed) URL so tokens aren't stored
        run_cmd(["git", "-C", str(dest_path),
                 "remote", "set-url", "origin", url])
        # Disable push
        run_cmd(["git", "-C", str(dest_path),
                 "remote", "set-url", "--push", "origin", "DISABLED"])
        return True

    # -- Manifest operations ------------------------------------------------

    def find_build_commit(self, version, build_num):
        """Find the commit in build-manifests that corresponds to a build."""
        search = f"{version}-{build_num}"
        ok, output, err = git_cmd(
            self.manifests_repo,
            "log", "--oneline", "--all", f"--grep={search}", "-n", "1"
        )
        if ok and output:
            return output.split()[0]
        return None

    def get_manifest_path(self, version):
        """Get the manifest file path within the repo for a version."""
        parts = version.split(".")
        major_minor = f"{parts[0]}.{parts[1]}"
        branch = BRANCH_MAP.get(major_minor)
        if not branch:
            print(f"WARNING: No branch mapping for {major_minor}, trying master")
            branch = "master"
        return f"couchbase-server/{branch}/{version}.xml"

    def get_manifest_content(self, version, build_num):
        """Retrieve the manifest XML content for a specific build."""
        commit = self.find_build_commit(version, build_num)
        manifest_path = self.get_manifest_path(version)

        if commit:
            ok, content, err = git_cmd(
                self.manifests_repo,
                "show", f"{commit}:{manifest_path}"
            )
            if ok:
                return content
            print(f"WARNING: Could not read manifest at commit {commit}, trying HEAD")

        # Fallback: try HEAD
        ok, content, err = git_cmd(
            self.manifests_repo,
            "show", f"HEAD:{manifest_path}"
        )
        if ok:
            return content

        return None

    def parse_manifest(self, manifest_content):
        """Parse manifest XML. Returns (remotes_dict, projects_list)."""
        root = ET.fromstring(manifest_content)

        # Parse remotes: name -> fetch URL
        remotes = {}
        for remote in root.findall("remote"):
            remotes[remote.get("name")] = remote.get("fetch", "")

        # Default remote
        default_elem = root.find("default")
        default_remote = (
            default_elem.get("remote", "couchbase")
            if default_elem is not None else "couchbase"
        )

        # Parse projects
        projects = []
        for project in root.findall("project"):
            name = project.get("name")
            remote_name = project.get("remote", default_remote)
            projects.append({
                "name": name,
                "path": project.get("path", name),
                "remote": remote_name,
                "revision": project.get("revision"),
                "groups": project.get("groups", "").split(","),
            })

        return remotes, projects

    # -- Build listing ------------------------------------------------------

    def list_builds(self, prefix=None, limit=50):
        """List available builds from manifest repo."""
        ok, output, err = git_cmd(
            self.manifests_repo,
            "log", "--oneline", "--all", "-1000"
        )
        if not ok:
            print(f"Error reading manifest repo: {err}")
            return []

        pattern = re.compile(r"couchbase-server \w+ build (\d+\.\d+\.\d+-\d+)")
        builds = []
        for line in output.split("\n"):
            match = pattern.search(line)
            if match:
                bid = match.group(1)
                if prefix is None or bid.startswith(prefix):
                    builds.append(bid)

        return builds[:limit]

    def get_latest_build(self, prefix):
        """Get the latest build ID for a version prefix (e.g. '7.6')."""
        builds = self.list_builds(prefix=prefix, limit=500)
        if not builds:
            return None

        def parse_ver(v):
            return tuple(int(p) for p in v.replace("-", ".").split("."))

        builds.sort(key=parse_ver, reverse=True)
        return builds[0]

    # -- Targeted mirroring -------------------------------------------------

    def mirror_repos_for_build(self, remotes, projects, key_only=True,
                               skip_repos=None):
        """Mirror only the repos needed for a specific build.

        Args:
            skip_repos: Optional set of repo names to skip (e.g. known restricted).
        """
        skip_repos = skip_repos or set()
        to_mirror = []
        skipped_restricted = 0

        for p in projects:
            if key_only:
                is_key = any(
                    k in p["name"].lower() or k in p["path"].lower()
                    for k in KEY_COMPONENTS
                )
                if not is_key:
                    continue

            if p["name"] in skip_repos:
                skipped_restricted += 1
                continue

            remote_name = p["remote"]
            fetch_url = remotes.get(remote_name, "")
            if not fetch_url:
                print(f"  WARNING: Unknown remote '{remote_name}' for {p['name']}")
                continue

            org = remote_fetch_to_org(fetch_url)
            clone_url = remote_fetch_to_https(fetch_url, p["name"])
            local_path = self.base_dir / org / f"{p['name']}.git"

            to_mirror.append((clone_url, local_path, p["name"]))

        if skipped_restricted:
            print(f"  Skipping {skipped_restricted} restricted repos "
                  f"(identified in access check)")
        print(f"Mirroring {len(to_mirror)} repositories...")
        success = 0
        failed = 0

        for clone_url, local_path, name in to_mirror:
            ok = self._clone_mirror(clone_url, local_path)
            if ok:
                success += 1
            else:
                failed += 1

        print(f"Mirror complete: {success} OK, {failed} failed")
        return failed == 0

    # -- Full org mirroring -------------------------------------------------

    def mirror_all_repos(self, orgs=None, parallel=4, update_only=False):
        """Mirror all repos from specified GitHub orgs using gh CLI."""
        if orgs is None:
            orgs = ALL_ORGS

        # Verify gh is available
        ok, out, err = run_cmd(["gh", "auth", "status"])
        if not ok:
            print("ERROR: gh CLI not authenticated.")
            print("  Run: gh auth login")
            return False

        for org in orgs:
            print(f"\n=== Mirroring {org} ===")
            org_dir = self.base_dir / org
            org_dir.mkdir(parents=True, exist_ok=True)

            # List repos
            ok, output, err = run_cmd([
                "gh", "repo", "list", org,
                "--limit", "5000",
                "--json", "name,url",
                "-q", '.[] | "\\(.name)\\t\\(.url)"'
            ], timeout=120)

            if not ok:
                print(f"  ERROR listing repos for {org}: {err}")
                continue

            repos = []
            for line in output.split("\n"):
                if "\t" in line:
                    name, url = line.split("\t", 1)
                    repos.append((name, url))

            print(f"  Found {len(repos)} repos")

            for name, url in repos:
                dest = org_dir / f"{name}.git"
                if update_only and not dest.exists():
                    continue
                self._clone_mirror(url, dest)

        print("\n=== Full mirror complete ===")
        return True

    # -- Materialization ----------------------------------------------------

    def _resolve_local_repo(self, remotes, project):
        """Find the local bare mirror path for a manifest project."""
        remote_name = project["remote"]
        fetch_url = remotes.get(remote_name, "")

        if not fetch_url:
            return None

        org = remote_fetch_to_org(fetch_url)
        repo_path = self.base_dir / org / f"{project['name']}.git"
        if repo_path.exists():
            return repo_path

        # Some remotes map to the same org (e.g. couchbase-priv -> couchbase)
        # Try the couchbase directory as a fallback for -priv repos
        if "priv" in remote_name:
            alt = self.base_dir / "couchbase" / f"{project['name']}.git"
            if alt.exists():
                return alt

        return None

    def archive_project(self, remotes, project, output_dir, key_only=True):
        """Archive a single project at the manifest-pinned revision."""
        name = project["name"]
        path = project["path"]
        revision = project["revision"]

        if key_only:
            is_key = any(
                k in name.lower() or k in path.lower()
                for k in KEY_COMPONENTS
            )
            if not is_key:
                return {"name": name, "status": "skipped", "reason": "not key component"}

        repo_path = self._resolve_local_repo(remotes, project)
        if not repo_path:
            return {"name": name, "status": "not_found",
                    "reason": "mirror not found (run materialize to auto-mirror)"}

        dest_path = output_dir / path
        dest_path.mkdir(parents=True, exist_ok=True)

        try:
            cmd = (
                f'git -C "{repo_path}" archive --format=tar {revision}'
                f' | tar -xf - -C "{dest_path}"'
            )
            proc = subprocess.run(cmd, shell=True, capture_output=True, timeout=300)

            if proc.returncode != 0:
                err_msg = proc.stderr.decode() if isinstance(proc.stderr, bytes) else proc.stderr
                return {"name": name, "status": "failed",
                        "reason": f"archive failed: {err_msg}"}

        except subprocess.TimeoutExpired:
            return {"name": name, "status": "failed", "reason": "timeout"}
        except Exception as e:
            return {"name": name, "status": "failed", "reason": str(e)}

        return {"name": name, "status": "success", "path": str(dest_path)}

    def materialize(self, version_build, workers=8, key_only=True,
                    mirror_only=False, skip_mirror=False, force=False,
                    auto_yes=False):
        """
        Full workflow: resolve manifest -> mirror needed repos -> materialize.

        Args:
            version_build: Build ID like "7.6.9-7457"
            workers:       Parallel extraction workers
            key_only:      Only materialize key components
            mirror_only:   Just mirror repos, don't extract source
            skip_mirror:   Skip mirroring (assume repos are already mirrored)
            force:         Re-materialize even if output directory exists
            auto_yes:      Don't prompt, proceed with accessible repos
        """
        print(f"{'=' * 60}")
        print(f"  Build: {version_build}")
        print(f"  Base:  {self.base_dir}")
        print(f"  Mode:  {'key components only' if key_only else 'all components'}")
        print(f"{'=' * 60}")

        # Parse build ID
        match = re.match(r"(\d+\.\d+\.\d+)-(\d+)", version_build)
        if not match:
            print(f"ERROR: Invalid build ID format: {version_build}")
            print("  Expected format: VERSION-BUILD_NUM (e.g. 7.6.9-7457)")
            return False

        version, build_num = match.groups()

        # Ensure build-manifests repo exists
        if not self.ensure_setup():
            return False

        # Get manifest
        print(f"\nLooking up manifest for {version_build}...")
        content = self.get_manifest_content(version, build_num)
        if not content:
            print(f"ERROR: Could not find manifest for {version_build}")
            print(f"  Try: ./cb-source.py list --prefix {version[:3]}")
            return False

        remotes, projects = self.parse_manifest(content)
        print(f"Manifest has {len(projects)} projects, "
              f"{len(remotes)} remotes")

        # Verify access before mirroring
        restricted_names = set()
        if not skip_mirror:
            print(f"\nVerifying repository access...")
            accessible, restricted, _ = self.verify_build_access(
                remotes, projects, key_only=key_only
            )
            restricted_names = {r["name"] for r in restricted}

            # Report results
            total_checked = len(accessible) + len(restricted)
            print(f"\n  Accessible:  {len(accessible)}/{total_checked} repos")

            if restricted:
                print(f"  Restricted:  {len(restricted)}/{total_checked} repos")
                print()
                for r in sorted(restricted, key=lambda x: x["name"]):
                    print(f"    [NO ACCESS] {r['name']:30s} "
                          f"{r.get('reason', '')}")
                print()
                print("  These repos are PRIVATE to the 'couchbase' GitHub org.")
                print("  Your GitHub account does not have access.")
                print()
                print("  To fix this:")
                print("    1. Request membership in the 'couchbase' GitHub org")
                print("    2. Ensure you're logged in with the correct account:")
                print("         gh auth status")
                print("         gh auth switch -u YOUR_WORK_ACCOUNT  (if needed)")
                print("    3. Refresh git credentials:")
                print("         gh auth setup-git")
                print("    4. Run this command again")

            if not accessible:
                print("\nERROR: No repositories are accessible. Cannot continue.")
                print("  Check your GitHub authentication:")
                print("    gh auth status")
                print("    gh auth login")
                print("    gh auth setup-git")
                return False

            if restricted and not auto_yes:
                print()
                answer = input(f"  Continue with {len(accessible)} "
                               f"accessible repos? [y/N] ").strip().lower()
                if answer not in ("y", "yes"):
                    print("Aborted. Fix access and try again.")
                    return False
            elif restricted and auto_yes:
                print()
                print(f"  --yes: proceeding with {len(accessible)} "
                      f"accessible repos")

            # Mirror only accessible repos (skip restricted)
            print(f"\nMirroring {len(accessible)} repositories...")
            self.mirror_repos_for_build(
                remotes, projects, key_only=key_only,
                skip_repos=restricted_names,
            )

        if mirror_only:
            print("\nMirror-only mode: skipping materialization.")
            return True

        # Check if already materialized
        output_dir = self.output_base / version_build
        if output_dir.exists() and not force:
            print(f"\nAlready materialized: {output_dir}")
            print("  Use --force to re-materialize")
            return True

        if output_dir.exists() and force:
            import shutil
            print(f"\n--force: removing previous materialization...")
            shutil.rmtree(output_dir)

        # Materialize
        print(f"\nMaterializing {version_build} (workers={workers})...")
        output_dir.mkdir(parents=True, exist_ok=True)

        results = []
        success = failed = skipped = 0

        with ThreadPoolExecutor(max_workers=workers) as executor:
            futures = {
                executor.submit(
                    self.archive_project, remotes, p, output_dir, key_only
                ): p["name"]
                for p in projects
            }

            for future in as_completed(futures):
                name = futures[future]
                try:
                    result = future.result()
                    results.append(result)

                    if result["status"] == "success":
                        success += 1
                        print(f"  OK  {name}")
                    elif result["status"] == "skipped":
                        skipped += 1
                    else:
                        failed += 1
                        print(f"  FAIL {name}: {result.get('reason', '?')}")
                except Exception as e:
                    failed += 1
                    results.append({"name": name, "status": "failed", "reason": str(e)})
                    print(f"  FAIL {name}: {e}")

        # Write results metadata
        info = {
            "version": version_build,
            "materialized_at": datetime.now().isoformat(),
            "total_projects": len(projects),
            "success": success,
            "failed": failed,
            "skipped": skipped,
            "key_only": key_only,
            "results": results,
        }
        info_file = output_dir / "materialization_info.json"
        with open(info_file, "w") as f:
            json.dump(info, f, indent=2)

        print(f"\n{'=' * 60}")
        print(f"  Done: {success} extracted, {failed} failed, {skipped} skipped")
        print(f"  Output: {output_dir}")
        print(f"{'=' * 60}")

        return failed == 0


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def cmd_preflight(args, src):
    """Check prerequisites, auth, and optionally verify access for a build."""
    print("Checking prerequisites...")
    print()
    ok, issues = src.verify_prerequisites()
    print()

    if issues:
        print("Issues found:")
        for issue in issues:
            print(f"  - {issue}")
        print()

    # If a build ID is given, also verify repo access for that build
    build_id = getattr(args, "build_id", None)
    if build_id and ok:
        print(f"{'=' * 60}")
        print(f"Verifying repo access for build: {build_id}")
        print(f"{'=' * 60}")

        if not src.ensure_setup():
            return 1

        match = re.match(r"(\d+\.\d+\.\d+)-(\d+)", build_id)
        if not match:
            print(f"ERROR: Invalid build ID format: {build_id}")
            return 1

        version, build_num = match.groups()
        content = src.get_manifest_content(version, build_num)
        if not content:
            print(f"ERROR: Could not find manifest for {build_id}")
            return 1

        remotes, projects = src.parse_manifest(content)
        key_only = not getattr(args, "all_components", False)

        print()
        accessible, restricted, skipped = src.verify_build_access(
            remotes, projects, key_only=key_only
        )

        # Summary
        print()
        print(f"{'=' * 60}")
        print(f"  Access Summary for {build_id}")
        print(f"{'=' * 60}")
        print(f"  Accessible:   {len(accessible):3d} repos")
        if restricted:
            print(f"  Restricted:   {len(restricted):3d} repos (private)")
        print(f"  Skipped:      {len(skipped):3d} (not key components)")
        print()

        if accessible:
            print("  Accessible repositories:")
            for r in sorted(accessible, key=lambda x: x["name"]):
                print(f"    [OK]   {r['name']}")
        if restricted:
            print()
            print("  Restricted repositories (require org access):")
            for r in sorted(restricted, key=lambda x: x["name"]):
                print(f"    [--]   {r['name']:30s} {r.get('reason', '')}")

        print()
        total = len(accessible) + len(restricted)
        pct = (len(accessible) / total * 100) if total else 0
        print(f"  You can materialize {len(accessible)}/{total} "
              f"key components ({pct:.0f}%)")

        if restricted:
            print()
            print("  To access restricted repos:")
            print("    1. Request membership in the 'couchbase' GitHub org")
            print("    2. Run: gh auth refresh")
            print("    3. Run this check again to verify")

        return 0 if ok else 1

    if ok:
        print("All prerequisites met. Ready to mirror and materialize builds.")
    else:
        print("Fix the issues above before proceeding.")

    return 0 if ok else 1


def cmd_setup(args, src):
    """Initial setup: mirror build-manifests."""
    ok = src.ensure_setup()
    if ok:
        print("\nSetup complete. You can now list or materialize builds.")
    return 0 if ok else 1


def cmd_list(args, src):
    """List available builds."""
    if not src.ensure_setup():
        return 1

    prefix = getattr(args, "prefix", None)
    limit = getattr(args, "limit", 50)

    builds = src.list_builds(prefix=prefix, limit=limit)
    if not builds:
        msg = f"No builds found"
        if prefix:
            msg += f" matching '{prefix}'"
        print(msg)
        return 1

    print(f"Available builds{f' (prefix: {prefix})' if prefix else ''}:")
    for b in builds:
        existing = "M" if (src.output_base / b).exists() else " "
        print(f"  [{existing}] {b}")

    total = len(builds)
    print(f"\nShowing {total} builds. [M] = already materialized")
    if prefix is None:
        print("Tip: use --prefix 7.6 to filter by version")
    return 0


def cmd_latest(args, src):
    """Show or materialize the latest build for a version prefix."""
    if not src.ensure_setup():
        return 1

    latest = src.get_latest_build(args.prefix)
    if not latest:
        print(f"No builds found for prefix: {args.prefix}")
        return 1

    print(f"Latest build for {args.prefix}: {latest}")

    if args.materialize:
        return 0 if src.materialize(
            latest,
            workers=args.workers,
            key_only=not args.all_components,
        ) else 1

    return 0


def cmd_materialize(args, src):
    """Mirror required repos and materialize a build."""
    version_build = args.build_id

    # Handle --latest
    if args.latest:
        version_build = src.get_latest_build(args.latest)
        if not version_build:
            print(f"No builds found for prefix: {args.latest}")
            return 1
        print(f"Latest build for {args.latest}: {version_build}")

    if not version_build:
        print("ERROR: Provide a build ID (e.g. 7.6.9-7457) or use --latest X.Y")
        return 1

    ok = src.materialize(
        version_build,
        workers=args.workers,
        key_only=not args.all_components,
        mirror_only=args.mirror_only,
        skip_mirror=args.skip_mirror,
        force=args.force,
        auto_yes=args.yes,
    )
    return 0 if ok else 1


def cmd_mirror_all(args, src):
    """Mirror all repos from Couchbase GitHub orgs."""
    orgs = args.org.split(",") if args.org else None
    ok = src.mirror_all_repos(
        orgs=orgs,
        parallel=args.parallel,
        update_only=args.update_only,
    )
    return 0 if ok else 1


def main():
    parser = argparse.ArgumentParser(
        description="Couchbase Server Source Code Mirror & Materialization Tool",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  %(prog)s preflight                      Check git, gh, and auth are working
  %(prog)s preflight 7.6.9-7457           Also verify repo access for a build
  %(prog)s setup                          Initial setup (clone build-manifests)
  %(prog)s list                           List recent builds
  %(prog)s list --prefix 7.6              List 7.6.x builds
  %(prog)s materialize 7.6.9-7457         Mirror + materialize a specific build
  %(prog)s materialize --latest 7.6       Mirror + materialize latest 7.6 build
  %(prog)s materialize 7.6.9-7457 --all-components  Include all dependencies
  %(prog)s materialize 7.6.9-7457 --mirror-only     Just mirror repos
  %(prog)s materialize 7.6.9-7457 --force Re-materialize from scratch
  %(prog)s mirror-all                     Full mirror of all orgs (~250GB)
  %(prog)s mirror-all --org couchbase     Mirror only the couchbase org

Note: Some repos (backup, eventing-ee, query-ee, cbftx, cbas-core) are private.
      Cloning them requires GitHub org membership for 'couchbase'.
      Public components (ns_server, kv_engine, query, indexing, etc.) work
      without org access.
        """,
    )

    parser.add_argument(
        "--base-dir",
        default=os.environ.get("CB_SOURCE_DIR", "./couchbase_code"),
        help="Base directory for mirrors and builds "
             "(default: ./couchbase_code or $CB_SOURCE_DIR)",
    )

    sub = parser.add_subparsers(dest="command", help="Command to run")

    # preflight
    p_pre = sub.add_parser(
        "preflight",
        help="Check prerequisites, auth, and repo access",
    )
    p_pre.add_argument("build_id", nargs="?",
                       help="Optional build ID to verify repo access (e.g. 7.6.9-7457)")
    p_pre.add_argument("--all-components", action="store_true",
                       help="Check access for all components, not just key ones")

    # setup
    sub.add_parser("setup", help="Initial setup: mirror build-manifests repo")

    # list
    p_list = sub.add_parser("list", help="List available builds")
    p_list.add_argument("--prefix", help="Version prefix filter (e.g. 7.6, 8.0)")
    p_list.add_argument("--limit", type=int, default=50,
                        help="Max builds to show (default: 50)")

    # materialize
    p_mat = sub.add_parser(
        "materialize",
        help="Mirror required repos and materialize a build",
    )
    p_mat.add_argument("build_id", nargs="?",
                       help="Build ID (e.g. 7.6.9-7457)")
    p_mat.add_argument("--latest", metavar="PREFIX",
                       help="Use latest build for version prefix (e.g. 7.6)")
    p_mat.add_argument("--all-components", action="store_true",
                       help="Materialize all components, not just key ones")
    p_mat.add_argument("--workers", type=int, default=8,
                       help="Parallel extraction workers (default: 8)")
    p_mat.add_argument("--mirror-only", action="store_true",
                       help="Only mirror repos, don't extract source")
    p_mat.add_argument("--skip-mirror", action="store_true",
                       help="Skip mirroring (assume repos already mirrored)")
    p_mat.add_argument("--force", action="store_true",
                       help="Re-materialize even if output dir exists")
    p_mat.add_argument("-y", "--yes", action="store_true",
                       help="Don't prompt, proceed with accessible repos")

    # mirror-all
    p_mirror = sub.add_parser(
        "mirror-all",
        help="Mirror ALL repos from Couchbase GitHub orgs (~250GB)",
    )
    p_mirror.add_argument("--org",
                          help="Comma-separated org names (default: all)")
    p_mirror.add_argument("--parallel", type=int, default=4,
                          help="Parallel clone/update jobs (default: 4)")
    p_mirror.add_argument("--update-only", action="store_true",
                          help="Only update existing mirrors, don't clone new")

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        return 1

    src = CouchbaseSource(args.base_dir)

    commands = {
        "preflight": cmd_preflight,
        "setup": cmd_setup,
        "list": cmd_list,
        "materialize": cmd_materialize,
        "mirror-all": cmd_mirror_all,
    }

    handler = commands.get(args.command)
    if handler:
        return handler(args, src)

    parser.print_help()
    return 1


if __name__ == "__main__":
    sys.exit(main())
