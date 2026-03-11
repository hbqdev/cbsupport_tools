#!/usr/bin/env bash
#
# prep_ticket.sh - Standalone ticket preparation tool for Couchbase Support
#
# Downloads ticket metadata, snapshots, attachments, and ticket files from
# Supportal/Zendesk into an organized directory structure.
#
# Usage:
#   ./prep_ticket.sh <ticket_number>
#   ./prep_ticket.sh s3init              # Authenticate AWS SSO before first use
#
# Example:
#   ./prep_ticket.sh s3init              # One-time SSO login
#   ./prep_ticket.sh 75546
#
###############################################################################
# REQUIREMENTS
###############################################################################
#
# System tools (install via your package manager):
#   - curl        : HTTP requests
#   - wget        : Snapshot file list fetching
#   - jq          : JSON processing (https://jqlang.github.io/jq/)
#   - unzip       : Archive extraction
#   - tar         : Archive extraction
#   - md5sum      : Attachment deduplication (coreutils)
#
# Couchbase-specific tools:
#   - s3dl        : S3 download tool for supportal-hosted files
#                   Install: pip install git+https://github.com/couchbaselabs/s3dl.git
#
# AWS configuration (required for s3dl / ticket_files downloads):
#   - aws-cli     : Install: https://docs.aws.amazon.com/cli/latest/userguide/install-cliv2.html
#   - Configure a profile in ~/.aws/credentials:
#       [supportal]
#       aws_access_key_id = ...
#       aws_secret_access_key = ...
#     Or use `aws sso login --profile supportal` if SSO is configured.
#
# Network access:
#   - Must be able to reach supportal.couchbase.com (may require VPN)
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
# CONFIGURATION - Edit these to match your environment
###############################################################################

# Base directory where ticket directories are created.
# Each ticket gets a subdirectory: $DIR_TICKETS/<ticket_number>/
DIR_TICKETS="${DIR_TICKETS:-/mnt/d/couchbaselogs/support}"

# AWS profile used by s3dl and aws-cli for downloading ticket files.
export AWS_DEFAULT_PROFILE="${AWS_DEFAULT_PROFILE:-supportal}"
export S3DL_DEFAULT_PROFILE="${S3DL_DEFAULT_PROFILE:-supportal}"
export BOTO_PROFILE="${BOTO_PROFILE:-supportal}"
export AWS_PROFILE="${AWS_PROFILE:-supportal}"

# Log file for download progress messages (set to /dev/null to suppress)
LOG_FILE="${PREP_TICKET_LOG:-/dev/null}"

###############################################################################
# PREFLIGHT CHECKS
###############################################################################

set -euo pipefail

# Cleanup function for interrupted downloads
cleanup() {
    echo "" >&2
    echo "=== Caught interrupt, cleaning up background processes ===" >&2
    # Kill all background jobs spawned by this script
    jobs -p | xargs -r kill 2>/dev/null || true
    # Wait for them to terminate
    wait 2>/dev/null || true
    echo "=== Cleanup complete. You may need to restart VPN if connections are stuck ===" >&2
    exit 130
}

# Trap SIGINT (Ctrl+C) and SIGTERM to cleanup properly
trap cleanup SIGINT SIGTERM

_check_dep() {
    if ! command -v "$1" &>/dev/null; then
        echo "ERROR: Required tool '$1' not found." >&2
        [ -n "${2:-}" ] && echo "  Install: $2" >&2
        return 1
    fi
}

preflight() {
    local fail=0
    _check_dep curl                                                    || fail=1
    _check_dep wget                                                    || fail=1
    _check_dep jq    "https://jqlang.github.io/jq/download/"          || fail=1
    _check_dep unzip "apt install unzip / brew install unzip"          || fail=1
    _check_dep tar                                                     || fail=1
    _check_dep aws   "https://docs.aws.amazon.com/cli/latest/userguide/install-cliv2.html" || fail=1
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

    mkdir -p "$DIR_TICKETS"
}

###############################################################################
# AWS SSO LOGIN
###############################################################################

# Authenticate to AWS SSO (required before first use if using SSO-based credentials)
s3init() {
    echo "Logging in to AWS SSO with profile: ${AWS_PROFILE}" >&2
    aws sso login --profile "${AWS_PROFILE}"
}

###############################################################################
# HELPER FUNCTIONS
###############################################################################

# Log a colored message to LOG_FILE
_log_color() {
    local color="$1" message="$2"
    local ts
    ts=$(date '+%Y-%m-%dT%H:%M:%S.%3N%z')
    echo -e "$ts \e[${color}m$message\e[0m" >> "$LOG_FILE"
}

# Extract all zip/tar archives in the current directory (parallel)
_extract_archives() {
    local has_archives=0
    for i in *.zip *.tar*; do 
        if [ -f "$i" ]; then
            has_archives=1
            break
        fi
    done
    
    if [ "$has_archives" -eq 1 ]; then
        echo "=== Extracting archives... ===" >&2
    fi
    
    for i in *.zip; do [ -f "$i" ] && unzip -qo "$i" & done
    for i in *.tar*; do [ -f "$i" ] && tar -xf "$i" & done
    wait
    
    if [ "$has_archives" -eq 1 ]; then
        echo "=== Extraction complete ===" >&2
    fi
}

# Post-download hook - override by exporting PREP_TICKET_POST_DOWNLOAD_HOOK
# to a script path or function name if you need custom processing.
_postdownload() {
    if [ -n "${PREP_TICKET_POST_DOWNLOAD_HOOK:-}" ]; then
        echo "Running post-download hook: $PREP_TICKET_POST_DOWNLOAD_HOOK" >&2
        bash -c "$PREP_TICKET_POST_DOWNLOAD_HOOK"
    fi
}

###############################################################################
# CORE DOWNLOAD FUNCTIONS
###############################################################################

# cbd <ticket> <url>...
# Download files via s3dl into $DIR_TICKETS/<ticket>/, extract archives.
cbd() {
    local ticket="$1"
    shift
    cd "$DIR_TICKETS" || { echo "Failed to cd to $DIR_TICKETS" >&2; return 1; }
    mkdir -p "$ticket"
    cd "$ticket" || return 1

    for url in "$@"; do
        aws s3 cp "$url" . &
    done
    wait

    _log_color "31" "Download complete: $ticket"

    # Mark ticket number from S3 URL if present
    for url in "$@"; do
        if [[ "$url" =~ s3://[^/]+/[^/]+/([0-9]+) ]]; then
            touch "ticket_number_${BASH_REMATCH[1]}"
        fi
    done

    _extract_archives
    _log_color "31" "Extraction complete: $ticket"
    _postdownload
}

# cbsnap <ticket_name> <snapshot_url>
# Download a Capella/supportal snapshot's log files.
cbsnap() {
    if [ "$#" -ne 2 ]; then
        echo "Usage: cbsnap <TICKET_NAME> <SNAPSHOT_URL>" >&2
        return 1
    fi
    local ticket_name="$1"
    local snapshot_url="$2/log-files"
    local timeout=10
    local snapshot_dir="$DIR_TICKETS/$ticket_name"

    mkdir -p "$snapshot_dir"
    cd "$snapshot_dir" || return 1

    echo "Fetching file list from: $snapshot_url" >&2
    echo "$2" >> snapshot

    wget --timeout="$timeout" --tries=1 -qO - "$snapshot_url" \
        | jq -r '.. | .url_text? // empty' \
        | grep -v '^\s*$' > snapshot_files \
        || { echo "wget failed fetching snapshot file list" >&2; return 1; }

    local urls
    mapfile -t urls < snapshot_files
    echo "Downloading ${#urls[@]} files for $ticket_name" >&2
    cbd "$ticket_name" "${urls[@]}"
    echo "Snapshot download done: $snapshot_dir" >&2
}

# get_ticket <ticket_number>
# Fetch ticket data from supportal's Zendesk API.
get_ticket() {
    local ticket_number="$1"
    local url="https://supportal.couchbase.com/zendesk/ticket/${ticket_number}/status"
    local output_file="ticket_${ticket_number}.raw"

    curl -s "$url" > "$output_file"
    if [ $? -ne 0 ]; then
        echo "Failed to fetch ticket $ticket_number" >&2
        return 1
    fi
    echo "Saved to $output_file" >&2

    # Build a readable timeline
    jq -r '
        [.timeline_events[] | select(.markdown?)]
        | sort_by(.timestamp)
        | .[]
        | "\(.timestamp)\n\(.author.name)\n\(.markdown)\n"
    ' "$output_file" > ticket_timeline.json 2>/dev/null || true
}

###############################################################################
# MAIN: prep_ticket
###############################################################################

prep_ticket() {
    local ticket_number="$1"
    local ticket_dir="$DIR_TICKETS/$ticket_number"

    # --- 1. Create directory & fetch ticket data ---
    mkdir -p "$ticket_dir"
    cd "$ticket_dir" || { echo "Failed to cd to $ticket_dir" >&2; return 1; }

    echo "=== Fetching ticket $ticket_number ===" >&2
    get_ticket "$ticket_number"

    local raw_file="ticket_${ticket_number}.raw"
    if [ ! -f "$raw_file" ]; then
        echo "ERROR: Failed to fetch ticket data" >&2
        return 1
    fi

    # --- 2. Extract & download snapshot URLs ---
    echo "=== Extracting snapshot URLs ===" >&2
    local snapshot_urls
    snapshot_urls=$(jq -r '
        [
            (.timeline_events[]?.markdown? // ""),
            (.ticket.description? // ""),
            (.description? // ""),
            (.. | strings)
        ] | join(" ")
    ' "$raw_file" 2>/dev/null | \
        grep -oE 'https://supportal\.couchbase\.com/snapshot/[a-f0-9]+::[0-9]+' | \
        sort -u)

    local snapshot_count=0
    local snapshot_array="[]"

    if [ -n "$snapshot_urls" ]; then
        snapshot_count=$(echo "$snapshot_urls" | wc -l)
        snapshot_array=$(echo "$snapshot_urls" | jq -R -s 'split("\n") | map(select(length > 0))')

        echo "=== Found $snapshot_count snapshot(s), downloading ===" >&2
        while IFS= read -r url; do
            if [ -n "$url" ]; then
                echo "Downloading: $url" >&2
                cbsnap "$ticket_number" "$url" &
            fi
        done <<< "$snapshot_urls"
        wait
        echo "=== All snapshots downloaded ===" >&2
    else
        echo "=== No snapshots found in ticket ===" >&2
    fi

    # --- 3. Download zendesk attachments ---
    local attachment_count=0
    local attachment_array="[]"
    local attachment_dir="$ticket_dir/attachments"
    local num_attachments
    num_attachments=$(jq '.zendesk_attachments | length' "$raw_file" 2>/dev/null || echo 0)

    if [ "$num_attachments" -gt 0 ] 2>/dev/null; then
        mkdir -p "$attachment_dir"
        echo "=== Downloading $num_attachments zendesk attachment(s) ===" >&2

        attachment_array=$(jq '[.zendesk_attachments[] | {url: .mapped_content_url, created_at: .created_at}]' "$raw_file")

        while IFS= read -r att_url; do
            local fname
            fname=$(echo "$att_url" | grep -oP 'name=\K[^&]+' | sed 's/%20/_/g')
            if [ -z "$fname" ]; then
                fname="attachment_$(echo "$att_url" | md5sum | cut -c1-8)"
            fi
            if [ -f "$attachment_dir/$fname" ]; then
                local ts
                ts=$(date +%s%N | cut -c1-13)
                fname="${ts}_${fname}"
            fi
            echo "  Downloading attachment: $fname" >&2
            curl -sL -o "$attachment_dir/$fname" "$att_url" &
        done < <(jq -r '.zendesk_attachments[].mapped_content_url' "$raw_file")
        wait
        attachment_count=$(find "$attachment_dir" -type f | wc -l)
        echo "=== Downloaded $attachment_count attachment(s) to attachments/ ===" >&2
    else
        echo "=== No zendesk attachments found ===" >&2
    fi

    # --- 4. Download ticket files (S3-hosted uploads) ---
    local ticket_file_count=0
    local ticket_files_array="[]"
    local tfiles_dir="$ticket_dir/ticket_files"
    local num_tfiles
    num_tfiles=$(jq '.ticket_files | length' "$raw_file" 2>/dev/null || echo 0)

    if [ "$num_tfiles" -gt 0 ] 2>/dev/null; then
        mkdir -p "$tfiles_dir"
        echo "=== Downloading $num_tfiles ticket file(s) ===" >&2

        ticket_files_array=$(jq '[.ticket_files[] | {url: .url, url_text: .url_text, upload_ts: .upload_ts}]' "$raw_file")

        (
            cd "$tfiles_dir" || exit 1
            while IFS= read -r s3url; do
                echo "  Downloading ticket file: $(basename "$s3url")" >&2
                aws s3 cp "$s3url" . &
            done < <(jq -r '.ticket_files[] | (.url_text // .url)' "$raw_file")
            wait
        )
        ticket_file_count=$(find "$tfiles_dir" -type f | wc -l)
        echo "=== Downloaded $ticket_file_count ticket file(s) to ticket_files/ ===" >&2
    else
        echo "=== No ticket files found ===" >&2
    fi

    # --- 5. Extract metadata ---
    local cb_versions
    cb_versions=$(jq -r '
        [
            (.timeline_events[]?.markdown? // ""),
            (.ticket.description? // ""),
            (.. | strings)
        ] | join(" ")
    ' "$raw_file" 2>/dev/null | \
        grep -oE '[0-9]+\.[0-9]+\.[0-9]+(-[0-9]+)?' | \
        sort -V -u | \
        jq -R -s 'split("\n") | map(select(length > 0))')

    local env_type="unknown"
    local ticket_text
    ticket_text=$(jq -r '(.. | strings) | select(length > 0)' "$raw_file" 2>/dev/null | tr '[:upper:]' '[:lower:]')
    if echo "$ticket_text" | grep -qiE 'capella|cloud\.couchbase|aws|gcp|azure'; then
        env_type="cloud"
    elif echo "$ticket_text" | grep -qiE 'on-prem|on-premise|bare.?metal|vmware|self.?hosted'; then
        env_type="on-prem"
    fi

    local customer_name org_name created_at updated_at status priority subject
    customer_name=$(jq -r '.ticket.requester.name // .requester.name // "Unknown"' "$raw_file" 2>/dev/null)
    org_name=$(jq -r '.ticket.organization.name // .organization.name // .ticket.organization // "Unknown"' "$raw_file" 2>/dev/null)
    created_at=$(jq -r '.ticket.created_at // .created_at // "Unknown"' "$raw_file" 2>/dev/null)
    updated_at=$(jq -r '.ticket.updated_at // .updated_at // "Unknown"' "$raw_file" 2>/dev/null)
    status=$(jq -r '.ticket.status // .status // "Unknown"' "$raw_file" 2>/dev/null)
    priority=$(jq -r '.ticket.priority // .priority // "Unknown"' "$raw_file" 2>/dev/null)
    subject=$(jq -r '.ticket.subject // .subject // "Unknown"' "$raw_file" 2>/dev/null)

    local first_msg last_msg
    first_msg=$(jq -r '[.timeline_events[]? | select(.markdown?)] | sort_by(.timestamp) | first | .timestamp // "Unknown"' "$raw_file" 2>/dev/null)
    last_msg=$(jq -r '[.timeline_events[]? | select(.markdown?)] | sort_by(.timestamp) | last | .timestamp // "Unknown"' "$raw_file" 2>/dev/null)

    # --- 6. Output structured JSON to stdout ---
    jq -n \
        --arg ticket_number "$ticket_number" \
        --arg customer_name "$customer_name" \
        --arg organization "$org_name" \
        --arg created_at "$created_at" \
        --arg updated_at "$updated_at" \
        --arg status "$status" \
        --arg priority "$priority" \
        --arg subject "$subject" \
        --argjson couchbase_versions "$cb_versions" \
        --argjson snapshot_urls "$snapshot_array" \
        --arg snapshot_count "$snapshot_count" \
        --arg environment_type "$env_type" \
        --arg first_message "$first_msg" \
        --arg last_message "$last_msg" \
        --arg ticket_dir "$ticket_dir" \
        --arg attachment_count "$attachment_count" \
        --argjson attachments "$attachment_array" \
        --arg ticket_file_count "$ticket_file_count" \
        --argjson ticket_files "$ticket_files_array" \
        '{
            ticket_number: $ticket_number,
            customer_name: $customer_name,
            organization: $organization,
            created_at: $created_at,
            updated_at: $updated_at,
            status: $status,
            priority: $priority,
            subject: $subject,
            couchbase_versions: $couchbase_versions,
            snapshot_urls: $snapshot_urls,
            snapshot_count: ($snapshot_count | tonumber),
            environment_type: $environment_type,
            timeline_summary: {
                first_message: $first_message,
                last_message: $last_message
            },
            attachments: $attachments,
            attachment_count: ($attachment_count | tonumber),
            ticket_files: $ticket_files,
            ticket_file_count: ($ticket_file_count | tonumber),
            ticket_directory: $ticket_dir
        }'

    # --- 7. Save metadata to file ---
    jq -n \
        --arg ticket_number "$ticket_number" \
        --arg customer_name "$customer_name" \
        --arg organization "$org_name" \
        --arg created_at "$created_at" \
        --arg updated_at "$updated_at" \
        --arg status "$status" \
        --arg priority "$priority" \
        --arg subject "$subject" \
        --argjson couchbase_versions "$cb_versions" \
        --argjson snapshot_urls "$snapshot_array" \
        --arg snapshot_count "$snapshot_count" \
        --arg environment_type "$env_type" \
        --arg first_message "$first_msg" \
        --arg last_message "$last_msg" \
        --arg attachment_count "$attachment_count" \
        --argjson attachments "$attachment_array" \
        --arg ticket_file_count "$ticket_file_count" \
        --argjson ticket_files "$ticket_files_array" \
        '{
            ticket_number: $ticket_number,
            customer_name: $customer_name,
            organization: $organization,
            created_at: $created_at,
            updated_at: $updated_at,
            status: $status,
            priority: $priority,
            subject: $subject,
            couchbase_versions: $couchbase_versions,
            snapshot_urls: $snapshot_urls,
            snapshot_count: ($snapshot_count | tonumber),
            environment_type: $environment_type,
            timeline_summary: {
                first_message: $first_message,
                last_message: $last_message
            },
            attachments: $attachments,
            attachment_count: ($attachment_count | tonumber),
            ticket_files: $ticket_files,
            ticket_file_count: ($ticket_file_count | tonumber)
        }' > "ticket_metadata.json"

    echo "" >&2
    echo "=== Ticket preparation complete ===" >&2
    echo "Directory: $ticket_dir" >&2
    [ "$attachment_count" -gt 0 ] && echo "Attachments: $attachment_count file(s) in attachments/" >&2
    [ "$ticket_file_count" -gt 0 ] && echo "Ticket files: $ticket_file_count file(s) in ticket_files/" >&2
    echo "Metadata saved to: ticket_metadata.json" >&2
}

###############################################################################
# ENTRYPOINT
###############################################################################

if [ $# -lt 1 ]; then
    echo "Usage: $(basename "$0") <ticket_number>" >&2
    echo "       $(basename "$0") s3init" >&2
    echo "" >&2
    echo "Commands:" >&2
    echo "  <ticket_number>   Prepare a ticket directory with all data from Supportal" >&2
    echo "  s3init            Authenticate AWS SSO (run before first use)" >&2
    echo "" >&2
    echo "What prep does:" >&2
    echo "  - Fetches ticket metadata and timeline from Zendesk/Supportal" >&2
    echo "  - Downloads all snapshot cbcollects" >&2
    echo "  - Downloads Zendesk attachments" >&2
    echo "  - Downloads S3-hosted ticket files" >&2
    echo "  - Outputs structured JSON metadata" >&2
    echo "" >&2
    echo "Prerequisites:" >&2
    echo "  - VPN connection to reach supportal.couchbase.com" >&2
    echo "  - AWS SSO session (run: $(basename "$0") s3init)" >&2
    echo "" >&2
    echo "Configuration (via environment variables):" >&2
    echo "  DIR_TICKETS             Base directory for tickets (default: ~/tickets)" >&2
    echo "  AWS_PROFILE             AWS profile for s3dl (default: supportal)" >&2
    echo "  PREP_TICKET_LOG         Log file path (default: /dev/null)" >&2
    echo "  PREP_TICKET_POST_DOWNLOAD_HOOK" >&2
    echo "                          Command to run after each download completes" >&2
    exit 1
fi

case "$1" in
    s3init)
        _check_dep aws "https://docs.aws.amazon.com/cli/latest/userguide/install-cliv2.html" || exit 1
        s3init
        ;;
    *)
        preflight
        prep_ticket "$1"
        ;;
esac
