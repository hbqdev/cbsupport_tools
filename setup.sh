#!/usr/bin/env bash
# One-time setup for cbsupport_tools on a new machine.
# Run: bash setup.sh

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
ENV_FILE="$REPO_ROOT/.env"
JIRA_ENV_FILE="$HOME/.couchbase-support/jira.env"

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
info() { printf '  %s\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
err()  { printf '  \033[31m✗\033[0m %s\n' "$*"; }

prompt_with_default() {
  local prompt="$1" default="$2" value
  if [[ -n "$default" ]]; then
    read -r -p "  $prompt [$default]: " value
    echo "${value:-$default}"
  else
    read -r -p "  $prompt: " value
    echo "$value"
  fi
}

echo ""
bold "cbsupport_tools — one-time setup"
info "Repo: $REPO_ROOT"
echo ""

# ── 1. User name (for ticket response signatures) ─────────────────────────────
bold "1. User identity"
info "Your name is used as the signature on customer ticket responses."
EXISTING_GIT_NAME="$(git config user.name 2>/dev/null || true)"
USER_NAME="$(prompt_with_default "Full name (for ticket signatures)" "$EXISTING_GIT_NAME")"
if [[ -z "$USER_NAME" ]]; then
  err "Name is required."
  exit 1
fi
ok "Name: $USER_NAME"

# ── 2. Tickets download directory ─────────────────────────────────────────────
echo ""
bold "2. Ticket download directory"
info "Downloaded ticket data (cbcollect zips, logs, JSON) will be stored here."
EXISTING_DIR=""
if [[ -f "$ENV_FILE" ]]; then
  EXISTING_DIR="$(grep -E '^DIR_TICKETS=' "$ENV_FILE" | cut -d= -f2- | tr -d '"' || true)"
fi
DEFAULT_DIR="${EXISTING_DIR:-$HOME/tickets}"
DIR_TICKETS="$(prompt_with_default "Tickets directory" "$DEFAULT_DIR")"
DIR_TICKETS="${DIR_TICKETS/#\~/$HOME}"  # expand leading ~

if [[ ! -d "$DIR_TICKETS" ]]; then
  read -r -p "  Directory does not exist. Create it? [Y/n]: " create_dir
  if [[ "${create_dir:-y}" =~ ^[Yy] ]]; then
    mkdir -p "$DIR_TICKETS"
    ok "Created: $DIR_TICKETS"
  else
    warn "Directory not created — you will need to create it before using prep_ticket_aws.sh"
  fi
else
  ok "Directory exists: $DIR_TICKETS"
fi

# Write / update .env
if [[ -f "$ENV_FILE" ]]; then
  # Update existing line or append
  if grep -q '^DIR_TICKETS=' "$ENV_FILE"; then
    sed -i '' "s|^DIR_TICKETS=.*|DIR_TICKETS=$DIR_TICKETS|" "$ENV_FILE"
  else
    echo "DIR_TICKETS=$DIR_TICKETS" >> "$ENV_FILE"
  fi
else
  cat > "$ENV_FILE" << EOF
DIR_TICKETS=$DIR_TICKETS
EOF
fi
ok "Wrote DIR_TICKETS to $ENV_FILE"

# ── 3. AWS SSO credentials ────────────────────────────────────────────────────
echo ""
bold "3. AWS SSO (for downloading cbcollect snapshots)"
info "prep_ticket_aws.sh uses an AWS SSO profile to access the Supportal S3 bucket."
info "The profile name is typically 'supportal'."

EXISTING_AWS_PROFILE=""
if [[ -f "$ENV_FILE" ]]; then
  EXISTING_AWS_PROFILE="$(grep -E '^AWS_PROFILE=' "$ENV_FILE" | cut -d= -f2- | tr -d '"' || true)"
fi
DEFAULT_PROFILE="${EXISTING_AWS_PROFILE:-supportal}"
AWS_PROFILE_NAME="$(prompt_with_default "AWS SSO profile name" "$DEFAULT_PROFILE")"

# Write to .env
if grep -q '^AWS_PROFILE=' "$ENV_FILE" 2>/dev/null; then
  sed -i '' "s|^AWS_PROFILE=.*|AWS_PROFILE=$AWS_PROFILE_NAME|" "$ENV_FILE"
else
  echo "AWS_PROFILE=$AWS_PROFILE_NAME" >> "$ENV_FILE"
fi
ok "Wrote AWS_PROFILE to $ENV_FILE"

# Check if profile is configured in AWS config
if aws configure list-profiles 2>/dev/null | grep -q "^${AWS_PROFILE_NAME}$"; then
  ok "AWS profile '$AWS_PROFILE_NAME' found in ~/.aws/config"
  info "To authenticate: aws sso login --profile $AWS_PROFILE_NAME"
else
  warn "AWS profile '$AWS_PROFILE_NAME' not found in ~/.aws/config"
  echo ""
  info "Add it manually to ~/.aws/config:"
  cat << AWSCFG
    [profile $AWS_PROFILE_NAME]
    sso_start_url  = https://couchbase.awsapps.com/start
    sso_region     = us-east-1
    sso_account_id = <your-account-id>
    sso_role_name  = <your-role-name>
    region         = us-east-1
AWSCFG
  info "Then run: aws sso login --profile $AWS_PROFILE_NAME"
fi

# ── 4. Jira credentials ───────────────────────────────────────────────────────
echo ""
bold "4. Jira credentials"
info "Used by agents to query CBSE/MB/CBIT tickets via the Jira REST API."
info "Get your API token at: https://id.atlassian.com/manage-profile/security/api-tokens"
echo ""

mkdir -p "$HOME/.couchbase-support"

EXISTING_EMAIL=""
EXISTING_KEY=""
if [[ -f "$JIRA_ENV_FILE" ]]; then
  EXISTING_EMAIL="$(grep -E '^JIRA_USER_EMAIL=' "$JIRA_ENV_FILE" | cut -d= -f2- | tr -d '"' || true)"
  EXISTING_KEY="$(grep -E '^JIRA_API_KEY=' "$JIRA_ENV_FILE" | cut -d= -f2- | tr -d '"' || true)"
fi

JIRA_EMAIL="$(prompt_with_default "Jira email" "$EXISTING_EMAIL")"
if [[ -n "$EXISTING_KEY" ]]; then
  read -r -p "  Jira API key [keep existing]: " JIRA_KEY_INPUT
  JIRA_KEY="${JIRA_KEY_INPUT:-$EXISTING_KEY}"
else
  read -r -p "  Jira API key: " JIRA_KEY
fi

cat > "$JIRA_ENV_FILE" << EOF
JIRA_INSTANCE_URL=https://api.atlassian.com/ex/jira/7fa05bac-b453-4b39-9ec3-830a6365e08a
JIRA_USER_EMAIL=$JIRA_EMAIL
JIRA_API_KEY=${JIRA_KEY:-${JIRA_KEY_INPUT:-}}
EOF
chmod 600 "$JIRA_ENV_FILE"
ok "Wrote $JIRA_ENV_FILE"

# Smoke test Jira credentials
echo ""
info "Testing Jira connectivity..."
set +e
JIRA_TEST="$(source "$JIRA_ENV_FILE" && curl -s --max-time 8 \
  -u "$JIRA_USER_EMAIL:$JIRA_API_KEY" \
  -H "Accept: application/json" \
  "$JIRA_INSTANCE_URL/rest/api/2/issue/MB-65738" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['fields']['summary'])" 2>&1)"
JIRA_RC=$?
set -e
if [[ $JIRA_RC -eq 0 ]]; then
  ok "Jira API works — MB-65738: $JIRA_TEST"
else
  warn "Jira test failed. Check your email/API key."
  info "You can rerun this script or edit $JIRA_ENV_FILE manually."
fi

# ── 5. Optional Jira MCP setup ────────────────────────────────────────────────
echo ""
bold "5. Jira MCP server (optional — Claude Code)"
info "Adds jira-mcp as an MCP tool so Claude Code agents can query Jira natively."
info "See docs/jira-mcp-setup.md for details."
echo ""
read -r -p "  Add Jira MCP to Claude Code now? [y/N]: " add_mcp
if [[ "${add_mcp:-n}" =~ ^[Yy] ]]; then
  if ! command -v claude &>/dev/null; then
    warn "claude CLI not found — skipping MCP setup. Install Claude Code first."
  elif ! command -v npx &>/dev/null; then
    warn "npx not found — install Node.js ≥ 18 first."
  else
    source "$JIRA_ENV_FILE"
    claude mcp add jira \
      -e JIRA_INSTANCE_URL="$JIRA_INSTANCE_URL" \
      -e JIRA_USER_EMAIL="$JIRA_USER_EMAIL" \
      -e JIRA_API_KEY="$JIRA_API_KEY" \
      -- npx jira-mcp
    ok "Added jira MCP server. Verify with: claude mcp list"
  fi
else
  info "Skipped. Run 'claude mcp add ...' later or see docs/jira-mcp-setup.md"
fi

# ── 6. User name git config check ─────────────────────────────────────────────
echo ""
bold "6. Git user.name (used for ticket response signatures)"
CURRENT_GIT_NAME="$(git config user.name 2>/dev/null || true)"
if [[ "$CURRENT_GIT_NAME" != "$USER_NAME" ]]; then
  read -r -p "  Set git config user.name to '$USER_NAME'? [Y/n]: " set_gitname
  if [[ "${set_gitname:-y}" =~ ^[Yy] ]]; then
    git config user.name "$USER_NAME"
    ok "Set git config user.name = $USER_NAME"
  else
    warn "git config user.name is still '$CURRENT_GIT_NAME'"
    info "Agents will use '$(git config user.name)' as the ticket signature."
  fi
else
  ok "git config user.name = $USER_NAME"
fi

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
bold "Setup complete."
echo ""
info "Summary:"
info "  Tickets dir:  $DIR_TICKETS  (.env)"
info "  AWS profile:  $AWS_PROFILE_NAME  (.env)"
info "  Jira creds:   $JIRA_ENV_FILE"
info "  Signature:    $(git config user.name)"
echo ""
info "Next steps:"
info "  1. Authenticate AWS:  aws sso login --profile $AWS_PROFILE_NAME"
info "  2. Test a ticket:     bash prep_ticket_aws.sh <ticket-number>"
info "  3. Run an analysis in Claude Code or Copilot:"
info "     Analyze ticket <number>"
echo ""
