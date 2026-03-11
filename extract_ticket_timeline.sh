#!/usr/bin/env bash
#
# extract_ticket_timeline.sh - Extract ticket timeline from Supportal/Zendesk
#
# Fetches ticket metadata and generates a readable timeline JSON file
# without downloading any attachments or snapshots.
#
# Usage:
#   ./extract_ticket_timeline.sh <ticket_number> [output_directory]
#
# Example:
#   ./extract_ticket_timeline.sh 75546
#   ./extract_ticket_timeline.sh 75546 /path/to/custom/dir
#
###############################################################################
# LOAD ENVIRONMENT CONFIGURATION
###############################################################################

# Load .env file if it exists (machine-specific configuration)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$SCRIPT_DIR/.env" ]; then
    set -a  # automatically export all variables
    source "$SCRIPT_DIR/.env"
    set +a
fi

###############################################################################
# CONFIGURATION
###############################################################################

# Base directory where tickets are stored
BASE_DIR="${BASE_DIR:-/mnt/d/couchbaselogs/support}"

# Log file (set to /dev/null to suppress)
LOG_FILE="${EXTRACT_TICKET_LOG:-/dev/null}"

###############################################################################
# PREFLIGHT CHECKS
###############################################################################

set -euo pipefail

_check_dep() {
    if ! command -v "$1" &>/dev/null; then
        echo "ERROR: Required tool '$1' not found." >&2
        [ -n "${2:-}" ] && echo "  Install: $2" >&2
        return 1
    fi
}

preflight() {
    local fail=0
    _check_dep curl                                       || fail=1
    _check_dep jq "https://jqlang.github.io/jq/download/" || fail=1
    if [ "$fail" -ne 0 ]; then
        echo "Aborting: missing dependencies." >&2
        exit 1
    fi

    # Verify connectivity to supportal (requires VPN in most environments)
    echo "Checking connectivity to supportal.couchbase.com..." >&2
    if ! curl -sf --connect-timeout 5 --max-time 10 \
        -o /dev/null "https://supportal.couchbase.com" 2>/dev/null; then
        echo "ERROR: Cannot reach supportal.couchbase.com" >&2
        echo "  - Ensure you are connected to the Couchbase VPN" >&2
        echo "  - Verify DNS resolution: nslookup supportal.couchbase.com" >&2
        echo "  - Test manually: curl -v https://supportal.couchbase.com" >&2
        exit 1
    fi
    echo "Supportal reachable." >&2
}

###############################################################################
# CORE FUNCTIONS
###############################################################################

# get_ticket <ticket_number> <output_dir>
# Fetch ticket data from supportal's Zendesk API.
get_ticket() {
    local ticket_number="$1"
    local output_dir="$2"
    local url="https://supportal.couchbase.com/zendesk/ticket/${ticket_number}/status"
    local output_file="${output_dir}/ticket_${ticket_number}.raw"

    echo "=== Fetching ticket $ticket_number from Supportal ===" >&2
    curl -s "$url" > "$output_file"
    if [ $? -ne 0 ]; then
        echo "ERROR: Failed to fetch ticket $ticket_number" >&2
        return 1
    fi
    echo "Saved raw data to: $output_file" >&2

    # Build a readable timeline
    echo "=== Generating ticket timeline ===" >&2
    jq -r '
        [.timeline_events[] | select(.markdown?)]
        | sort_by(.timestamp)
        | .[]
        | "\(.timestamp)\n\(.author.name)\n\(.markdown)\n"
    ' "$output_file" > "${output_dir}/ticket_timeline.json" 2>/dev/null || true
    
    if [ -f "${output_dir}/ticket_timeline.json" ]; then
        echo "Timeline saved to: ${output_dir}/ticket_timeline.json" >&2
    fi

    # Extract basic metadata
    local customer_name org_name created_at updated_at status priority subject
    customer_name=$(jq -r '.ticket.requester.name // .requester.name // "Unknown"' "$output_file" 2>/dev/null)
    org_name=$(jq -r '.ticket.organization.name // .organization.name // .ticket.organization // "Unknown"' "$output_file" 2>/dev/null)
    created_at=$(jq -r '.ticket.created_at // .created_at // "Unknown"' "$output_file" 2>/dev/null)
    updated_at=$(jq -r '.ticket.updated_at // .updated_at // "Unknown"' "$output_file" 2>/dev/null)
    status=$(jq -r '.ticket.status // .status // "Unknown"' "$output_file" 2>/dev/null)
    priority=$(jq -r '.ticket.priority // .priority // "Unknown"' "$output_file" 2>/dev/null)
    subject=$(jq -r '.ticket.subject // .subject // "Unknown"' "$output_file" 2>/dev/null)

    # Output summary
    echo "" >&2
    echo "=== Ticket Summary ===" >&2
    echo "Ticket #: $ticket_number" >&2
    echo "Subject: $subject" >&2
    echo "Customer: $customer_name" >&2
    echo "Organization: $org_name" >&2
    echo "Status: $status" >&2
    echo "Priority: $priority" >&2
    echo "Created: $created_at" >&2
    echo "Updated: $updated_at" >&2
    echo "" >&2
    echo "Files created:" >&2
    echo "  - $output_file" >&2
    echo "  - ${output_dir}/ticket_timeline.json" >&2
}

###############################################################################
# MAIN
###############################################################################

extract_ticket() {
    local ticket_number="$1"
    local ticket_dir="$BASE_DIR/$ticket_number"

    # Create ticket directory if it doesn't exist
    mkdir -p "$ticket_dir"
    
    echo "=== Saving to: $ticket_dir ===" >&2
    cd "$ticket_dir" || { echo "Failed to cd to $ticket_dir" >&2; return 1; }

    get_ticket "$ticket_number" "$(pwd)"
}

###############################################################################
# ENTRYPOINT
###############################################################################

if [ $# -lt 1 ]; then
    echo "Usage: $(basename "$0") <ticket_number>" >&2
    echo "" >&2
    echo "Arguments:" >&2
    echo "  ticket_number       The Zendesk ticket number to fetch" >&2
    echo "" >&2
    echo "What this does:" >&2
    echo "  - Fetches ticket metadata from Supportal/Zendesk API" >&2
    echo "  - Generates ticket_<number>.raw (full JSON response)" >&2
    echo "  - Generates ticket_timeline.json (formatted timeline)" >&2
    echo "  - Saves to: $BASE_DIR/<ticket_number>/" >&2
    echo "  - Does NOT download snapshots, attachments, or ticket files" >&2
    echo "" >&2
    echo "Example:" >&2
    echo "  $(basename "$0") 75546" >&2
    echo "" >&2
    echo "Configuration (via environment variables):" >&2
    echo "  BASE_DIR    Base directory for tickets (default: /mnt/d/couchbaselogs/support)" >&2
    exit 1
fi

preflight
extract_ticket "$1"
