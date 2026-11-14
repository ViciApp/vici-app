#!/usr/bin/env bash

# tag-markets.sh: bulk-set market metadata (tags) for markets that already
# exist on the registry, from a deck JSON file.
#
# `deploy-markets.sh` only registers markets on-chain (add_series); their tags
# live off-chain in the Juno `MARKET_METADATA` collection and are written via
# the satellite's admin/creator-guarded `app_upsert_market_metadata` endpoint.
# This script closes that gap in bulk: for every deck row whose title matches a
# registry series, it sets `tags` from the deck's `categories`.
#
# Usage:
#   ./scripts/tag-markets.sh <markets-json-file> [--local|--staging|--production]
#   npm run tag:markets -- scripts/data/markets.deck-2026.json --production
#
# Auth: runs as the current dfx identity, which must be the markets' CREATOR
# (the identity that ran deploy-markets.sh) or a satellite ADMIN; see
# assertCanWriteMarketMetadata in src/satellite/services/market-metadata.services.ts.
#
# Only `categories` -> `tags` is written here (whyNow/events/suggested/subtitle
# are left at their defaults / existing values). Unknown tags are dropped by the
# satellite's normalizeMarketTags. Matching is BY TITLE.

# Capture the deck file (first positional) before utils.sh consumes "$@".
MARKETS_FILE="${1:-}"
if [[ -z "$MARKETS_FILE" || "$MARKETS_FILE" == -* || "$MARKETS_FILE" == "local" || "$MARKETS_FILE" == "staging" || "$MARKETS_FILE" == "ic" || "$MARKETS_FILE" == "production" ]]; then
	echo "Usage: $0 <markets-json-file> [--local|--staging|--production]" >&2
	exit 1
fi
shift

source "$(dirname "$0")/lib/utils.sh" "$@"

# Byte-wise locale so sed/awk/string-compare handle non-ASCII titles (e.g.
# "Mbappé", curly quotes) without "illegal byte sequence" and so registry
# titles match the deck byte-for-byte.
export LC_ALL=C

if [ ! -f "$MARKETS_FILE" ]; then
	echo "Error: markets file '$MARKETS_FILE' not found." >&2
	exit 1
fi

# Resolve the Juno satellite canister id for this network. The satellite is not
# a dfx canister alias here, so default by network (override with SATELLITE_ID):
# production reads the id juno.config.ts pins.
case "$NETWORK" in
	ic | production) SATELLITE_ID="${SATELLITE_ID:-$(cd "$PROJECT_ROOT" && npx tsx scripts/lib/satellite-id.ts production)}" ;;
	local) SATELLITE_ID="${SATELLITE_ID:-$(dfx canister id satellite --network "$NETWORK" 2>/dev/null)}" ;;
	*) SATELLITE_ID="${SATELLITE_ID:-}" ;;
esac
if [ -z "$SATELLITE_ID" ]; then
	echo "Error: could not resolve satellite canister id for network '$NETWORK'. Set SATELLITE_ID=..." >&2
	exit 1
fi

echo "Tagging markets from $MARKETS_FILE on $NETWORK (satellite=$SATELLITE_ID)..."

# --- 1. Build title -> series_id from the registry (paginated) ---
# Parse via `--output json` + jq rather than regexing Candid: jq handles titles
# with escaped quotes/Unicode correctly, and we follow `next_cursor` so the map
# is complete even past one page (registries can exceed any single-page limit).
declare -A SID_BY_TITLE
CURSOR_ARG="null"
while :; do
	RESP=$(dfx canister call --network "$NETWORK" --query --output json registry list_series \
		"(record { limit = opt 1000 : opt nat64; cursor = $CURSOR_ARG })") || {
		echo "Failed to fetch series from registry." >&2
		exit 1
	}

	while IFS=$'\t' read -r sid title; do
		[[ -z "$sid" || -z "$title" ]] && continue
		SID_BY_TITLE["$title"]="$sid"
	done < <(echo "$RESP" | jq -r '.items[] | [.series_id, .title] | @tsv')

	NEXT=$(echo "$RESP" | jq -r '.next_cursor[0] // empty')
	[[ -z "$NEXT" ]] && break
	CURSOR_ARG="opt \"$NEXT\""
done

echo "Registry returned ${#SID_BY_TITLE[@]} series."

# --- 2. For each deck row, upsert tags on the matching series ---
TAGGED=0
MISSING=0
FAILED=0

while IFS=$'\t' read -r title tags_candid; do
	[[ -z "$title" ]] && continue
	sid="${SID_BY_TITLE["$title"]:-}"
	if [[ -z "$sid" ]]; then
		echo "  SKIP (not on registry): $title"
		MISSING=$((MISSING + 1))
		continue
	fi
	echo "  Tagging: $title ($sid) -> $tags_candid"
	# Guard each call: one transient/auth failure must not abort the whole bulk
	# run (set -e is on via utils.sh). The upsert is idempotent, so re-running
	# retries any FAIL rows safely.
	if dfx canister call --network "$NETWORK" "$SATELLITE_ID" app_upsert_market_metadata "(record {
        series_id = \"$sid\";
        data = record {
            why_now = null;
            events = vec {};
            tags = $tags_candid;
            suggested = false;
            subtitle = null;
        };
    })"; then
		TAGGED=$((TAGGED + 1))
	else
		echo "  FAIL: $title ($sid)" >&2
		FAILED=$((FAILED + 1))
	fi
done < <(jq -r '.[] | select((.categories // []) | length > 0)
	| [.title, ("vec { " + (.categories | map("\"" + . + "\"") | join("; ")) + " }")]
	| @tsv' "$MARKETS_FILE")

echo "Done. Tagged $TAGGED; failed $FAILED; $MISSING deck row(s) had no matching registry series."
[[ "$FAILED" -gt 0 ]] && exit 1
exit 0
