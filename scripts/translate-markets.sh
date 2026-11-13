#!/usr/bin/env bash

# translate-markets.sh: bulk-set market translations for markets that already
# exist on the registry, from a deck JSON file.
#
# `deploy-markets.sh` registers markets on-chain (add_series) in their base
# locale; their per-locale title/description/outcomes live off-chain in the Juno
# `MARKET_TRANSLATIONS` collection and are written via the satellite's
# admin-guarded `app_upsert_market_translation` endpoint. This script closes that
# gap in bulk: for every deck row that carries a `translations` object, it
# upserts one translation per locale on the matching registry series.
#
# Expected per-row shape (alongside the usual deck fields):
#   {
#     "title": "Will Brazil win the 2026 World Cup?",   // English, the registry match key
#     "translations": {
#       "it": {
#         "title": "Il Brasile vincerà i Mondiali 2026?",
#         "description": "Si risolve SÌ se il Brasile alza il trofeo...",
#         "resolution": "Si risolve SÌ se il Brasile alza il trofeo il 19 luglio 2026.",
#         "outcomes": [{ "id": "yes", "title": "Sì" }, { "id": "no", "title": "No" }]
#       },
#       "es": { "title": "...", "description": "...", "resolution": "...", "outcomes": [...] }
#     }
#   }
# `description`/`resolution` default to an empty string and `outcomes` to an
# empty vec when absent. Rows without a non-empty `translations.<locale>.title`
# are skipped for that locale.
#
# Usage:
#   ./scripts/translate-markets.sh <markets-json-file> [--local|--staging|--production]
#   npm run translate:markets -- scripts/data/markets.deck-2026.json --production
#
# Auth: runs as the current dfx identity, which must be the markets' CREATOR
# (the identity that ran deploy-markets.sh) or a satellite ADMIN; see
# assertCanWriteMarketTranslation in
# src/satellite/services/market-translation.services.ts.
#
# Locales are validated satellite-side against SUPPORTED_LOCALES; an unsupported
# locale FAILs the upsert (counted, non-fatal). Matching is BY TITLE.

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
# a dfx canister alias here, so default by network (override with SATELLITE_ID).
case "$NETWORK" in
	ic | production) SATELLITE_ID="${SATELLITE_ID:-7scay-7yaaa-aaaal-asxqa-cai}" ;;
	local) SATELLITE_ID="${SATELLITE_ID:-$(dfx canister id satellite --network "$NETWORK" 2>/dev/null)}" ;;
	*) SATELLITE_ID="${SATELLITE_ID:-}" ;;
esac
if [ -z "$SATELLITE_ID" ]; then
	echo "Error: could not resolve satellite canister id for network '$NETWORK'. Set SATELLITE_ID=..." >&2
	exit 1
fi

echo "Translating markets from $MARKETS_FILE on $NETWORK (satellite=$SATELLITE_ID)..."

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

# --- 2. For each deck row × locale, upsert the translation on the series ---
TRANSLATED=0
MISSING=0
FAILED=0

# jq emits one TAB-delimited line per (title, locale): the English match-title,
# the locale, and a ready-made Candid `data = record { ... }` fragment. We do NOT
# use @tsv (it would double every backslash); we join with a literal tab and emit
# raw (-r). Text is rendered via @json so each field is a single line with no raw
# tabs/newlines; @json's escapes (\", \\, \n) are valid Candid text escapes too,
# and non-ASCII passes through as raw UTF-8 which Candid text accepts. series_id
# is filled in below once resolved from the registry.
while IFS=$'\t' read -r title locale data_candid; do
	[[ -z "$title" || -z "$locale" ]] && continue
	sid="${SID_BY_TITLE["$title"]:-}"
	if [[ -z "$sid" ]]; then
		echo "  SKIP (not on registry): [$locale] $title"
		MISSING=$((MISSING + 1))
		continue
	fi
	echo "  Translating [$locale]: $title ($sid)"
	# Guard each call: one transient/auth/locale failure must not abort the whole
	# bulk run (set -e is on via utils.sh). The upsert is idempotent, so re-running
	# retries any FAIL rows safely.
	if dfx canister call --network "$NETWORK" "$SATELLITE_ID" app_upsert_market_translation "(record {
        series_id = \"$sid\";
        locale = \"$locale\";
        data = $data_candid;
    })"; then
		TRANSLATED=$((TRANSLATED + 1))
	else
		echo "  FAIL: [$locale] $title ($sid)" >&2
		FAILED=$((FAILED + 1))
	fi
done < <(jq -r '
	def candid_text: @json;
	.[]
	| .title as $mt
	| (.translations // {}) | to_entries[]
	| select((.value.title // "") | test("\\S"))
	| [
		$mt,
		.key,
		( "record { title = " + (.value.title | candid_text)
		  + "; description = " + ((.value.description // "") | candid_text)
		  + "; resolution = " + ((.value.resolution // "") | candid_text)
		  + "; outcomes = vec { "
		  + ((.value.outcomes // [])
		     | map("record { id = " + (.id | candid_text) + "; title = " + (.title | candid_text) + " }")
		     | join("; "))
		  + " } }"
		)
	  ]
	| join("	")
' "$MARKETS_FILE")

echo "Done. Translated $TRANSLATED; failed $FAILED; $MISSING translation(s) had no matching registry series."
[[ "$FAILED" -gt 0 ]] && exit 1
exit 0
