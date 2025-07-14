#!/bin/bash

set -e

DATA_DIR="/var/cb/data/"

if [ ! -d "$DATA_DIR" ]; then
    echo "Error: Directory '$DATA_DIR' does not exist"
    exit 1
fi

THRESHOLD=2147483647

VULNERABLE_KVSTORES=0
TOTAL_KVSTORES=0
GLOBAL_MAX_MAXSN=0

if ! command -v /opt/couchbase/bin/magma_dump > /dev/null 2>&1; then
    echo "Error: /opt/couchbase/bin/magma_dump not found"
    exit 1
fi

# Find all magma.* directories
magma_dirs=$(find "$DATA_DIR" -type d -name 'magma.*' 2>/dev/null 2>&1 | sort)


run_magma_dump_treestate() {
    local magma_dir="$1"
    local kvstore_num="$2"

    # 7.6.0
    if magma_raw_output=$(/opt/couchbase/bin/magma_dump "$magma_dir/" tree-state --latest --kvstore "$kvstore_num" 2>&1); then
        if echo "$magma_raw_output" | grep -q maxSn; then
            echo "$magma_raw_output"
            return 0
        fi
    fi

    # < 7.6
    if magma_raw_output=$(/opt/couchbase/bin/magma_dump "$magma_dir/" --tree-state-latest --kvstore "$kvstore_num" 2>&1); then
        if echo "$magma_raw_output" | grep -q maxSn; then
            echo "$magma_raw_output"
            return 0
        fi
    fi

    return 1
}

for magma_dir in $magma_dirs; do
    echo "Processing: $magma_dir"

    # Find all kvstore-* directories within this magma directory
    kvstore_dirs=$(find "$magma_dir" -maxdepth 1 -type d -name 'kvstore-*' 2>/dev/null 2>&1 | sort -V)

    for kvstore_dir in $kvstore_dirs; do
        kvstore_num=$(basename "$kvstore_dir" | sed 's/kvstore-//')

        TOTAL_KVSTORES=$((TOTAL_KVSTORES + 1))

        if magma_raw_output=$(run_magma_dump_treestate "$magma_dir" "$kvstore_num"); then
            highest_maxsn=$(echo "$magma_raw_output" | grep maxSn | tr -d ' ,' | cut -d: -f2 | sort -nr | head -1)

            if [ -n "$highest_maxsn" ]; then

                # Update global maximum
                if [ "$highest_maxsn" -gt "$GLOBAL_MAX_MAXSN" ]; then
                    GLOBAL_MAX_MAXSN=$highest_maxsn
                fi

                if [ "$highest_maxsn" -gt "$THRESHOLD" ]; then
                    echo "  kvstore-$kvstore_num: maxSn=$highest_maxsn (VULNERABLE)"
                    VULNERABLE_KVSTORES=$((VULNERABLE_KVSTORES + 1))
                else
                    echo "  kvstore-$kvstore_num: maxSn=$highest_maxsn (OK)"
                fi
            else
                echo "  kvstore-$kvstore_num: FAILED to extract maxSn"
            fi
        else
            echo "  kvstore-$kvstore_num: FAILED to run magma_dump"
        fi
    done
done

echo
echo "=================================================="

if [ "$VULNERABLE_KVSTORES" -gt 0 ]; then
    STATUS="VULNERABLE"
    exit_code=1
else
    STATUS="OK"
    exit_code=0
fi

echo "Status:$STATUS, maxSn:$GLOBAL_MAX_MAXSN, VBucketsImpacted:$VULNERABLE_KVSTORES/$TOTAL_KVSTORES"

exit $exit_code
