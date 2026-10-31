#!/usr/bin/env bash

# deploy-markets.sh — register a batch of prediction markets from a JSON file.
#
# Usage:
#   ./scripts/deploy-markets.sh <markets-json-file> [--local|--staging|--production]
#
# `--staging` targets icdc-core staging; `--production` (alias `--ic`) targets icdc-core
# production — the registry the live Vici frontend reads. See
# docs/engine-integration.md ("icdc-core deployments: staging and production").
#
# Examples:
#   ./scripts/deploy-markets.sh scripts/data/markets.json --local
#   ./scripts/deploy-markets.sh scripts/data/markets.deck-2026.json --staging
#   npm run deploy:markets -- scripts/data/markets.deck-2026.json --production
#
# The file is a JSON array of market objects (see scripts/data/markets.json).
#
# Consumed per row: title, description, resolution?, expiryDate (ISO), locale, outcomes?
#   - `resolution` (the compulsory on-chain settlement clause) defaults to
#     `description` when a row omits it, matching the icdc-core backfill.
#   - a non-empty `outcomes` array makes the market Categorical; else Binary.
#
# NOT consumed by this script (kept for parity with the FE create flow, but
# `add_series` has no field for them):
#   - `categories` — market TAGS live off-chain in the Juno `MARKET_METADATA`
#     collection (written via the satellite, see market-tags.services.ts), not
#     on the registry series. A deck deployed here registers UNTAGGED; tag it
#     separately (admin UI, or a future metadata seeder).
#   - `inviteOnly` — trading_access is fixed to `Open` here.
#   - `balanceDomain` — fixed to `ViciXp` here.
#   - `consensus` and any other unknown keys are ignored.
#
# Markets are attributed to the Vici engine and settled by the VICI oracle.
# Override via env:
#   ORACLE_ID=...        (default VICI_ORACLE_V1 — the oracle must already exist;
#                         init.registry.sh registers it before calling this)
#   VICI_ENGINE_ID=...   (default eng_0)
#
# NOTE: this only registers market metadata via `add_series` — it does NOT seed
# prices, liquidity, or quotes. A freshly registered market opens with an empty
# order book (mid-price defaults to 0.5 until real orders arrive).

# Capture the markets file (first positional) before utils.sh consumes "$@" for
# network-flag parsing.
MARKETS_FILE="${1:-}"
if [[ -z "$MARKETS_FILE" || "$MARKETS_FILE" == -* || "$MARKETS_FILE" == "local" || "$MARKETS_FILE" == "staging" || "$MARKETS_FILE" == "ic" || "$MARKETS_FILE" == "production" ]]; then
	echo "Usage: $0 <markets-json-file> [--local|--staging|--production]" >&2
	exit 1
fi
shift

source "$(dirname "$0")/lib/utils.sh" "$@"

# BSD/macOS `sed`/`tr` raise "illegal byte sequence" on multibyte UTF-8 (e.g.
# "Mbappé", curly quotes) under a UTF-8 locale. Force a byte-wise locale so the
# escaping + slugify below pass those bytes through untouched; dfx still receives
# the original UTF-8 (the byte values of `"`/`\` never collide with UTF-8
# continuation bytes, so byte-wise escaping is safe).
export LC_ALL=C

if [ ! -f "$MARKETS_FILE" ]; then
	echo "Error: markets file '$MARKETS_FILE' not found." >&2
	exit 1
fi

ORACLE_ID="${ORACLE_ID:-VICI_ORACLE_V1}"

# Keep in sync with src/lib/constants/icdc.constants.ts. The script runs as the
# registry canister controller, so `engine_id` is optional (controllers bypass
# the check), but we attribute seeded markets to the Vici engine for consistency
# with frontend-created ones.
VICI_ENGINE_ID="${VICI_ENGINE_ID:-eng_0}"

slugify() {
	printf '%s' "$1" |
		tr '[:upper:]' '[:lower:]' |
		sed -E 's/[^a-z0-9]+/-/g; s/^-+|-+$//g'
}

length=$(jq '. | length' "$MARKETS_FILE")

echo "Deploying $length markets from $MARKETS_FILE to $NETWORK (oracle=$ORACLE_ID, engine=$VICI_ENGINE_ID)..."

for ((i = 0; i < length; i++)); do
	market=$(jq -c ".[$i]" "$MARKETS_FILE")

	title=$(jq -r '.title' <<<"$market" | sed 's/\\/\\\\/g; s/"/\\"/g')
	description=$(jq -r '.description' <<<"$market" | sed 's/\\/\\\\/g; s/"/\\"/g')

	# Resolution clause: the compulsory on-chain description of how the market
	# settles. Defaults to the description when a row omits `.resolution`,
	# mirroring the icdc-core registry backfill so existing decks keep working.
	resolution=$(jq -r '.resolution // .description' <<<"$market" | sed 's/\\/\\\\/g; s/"/\\"/g')

	# BCP 47 locale tag for the market's title/description. Defaults to "en" when
	# the data file omits it. The icdc-core registry stores this as metadata and
	# does NOT include it in `series_id` hashing — translations remain off-chain.
	locale=$(jq -r '.locale // "en"' <<<"$market" | sed 's/\\/\\\\/g; s/"/\\"/g')

	expiration_iso=$(echo "$market" | jq -r '.expiryDate')

	underlying=$(slugify "$title")

	# BSD `date -j -f` treats the literal `Z` in this format as text and parses in
	# the local zone, so without `TZ=UTC` every instant shifts by the machine's
	# offset. `expiry_ns` and `start_ns` are immutable once registered.
	expiration_seconds=$(TZ=UTC date -j -f "%Y-%m-%dT%H:%M:%S.000Z" "$expiration_iso" "+%s" 2>/dev/null || date -d "$expiration_iso" "+%s")
	expiration_ns=$((expiration_seconds * 1000000000))

	# Optional `startDate` (ISO): trading opens at this instant (registry
	# `start_ns` — a staggered release schedule lives in the deck, not in cron).
	# Omitted => null => live immediately. add_series rejects a start in the past.
	start_iso=$(jq -r '.startDate // empty' <<<"$market")
	if [ -n "$start_iso" ]; then
		start_seconds=$(TZ=UTC date -j -f "%Y-%m-%dT%H:%M:%S.000Z" "$start_iso" "+%s" 2>/dev/null || date -d "$start_iso" "+%s" 2>/dev/null)
		if ! [[ "$start_seconds" =~ ^[0-9]+$ ]]; then
			echo "Error: unparseable startDate '$start_iso' for market: $title" >&2
			exit 1
		fi
		start_ns_candid="opt $((start_seconds * 1000000000))"
	else
		start_ns_candid="null"
	fi

	echo "Adding market: $title ($underlying)"

	outcomes_list=$(jq -r '.outcomes[]?' <<<"$market" | sed 's/"/\\"/g' | awk '{id=tolower($0); gsub(/[^a-z0-9]+/, "-", id); gsub(/^-+|-+$/, "", id); printf "record { id=\"%s\"; title=\"%s\"; description=null; icon_url=null }; ", id, $0}')
	if [ -n "$outcomes_list" ]; then
		outcomes_candid="opt vec { $outcomes_list }"
		payoff_type="variant { Categorical }"
	else
		outcomes_candid="null"
		payoff_type="variant { Binary }"
	fi

	dfx canister call --network "$NETWORK" registry add_series "(record {
        title = \"$title\";
        description = record { plain = \"$description\"; html = null; markdown = null };
        resolution = record { clause = \"$resolution\" };
        expiry_ns = $expiration_ns;
        underlying = \"$underlying\";
        strike = null;
        banner_url = null;
        price_precision = 8 : nat8;
        payoff_type = $payoff_type;
        payout_unit = variant { Fiat = variant { Usd } };
        outcomes = $outcomes_candid;
        icon_url = null;
        balance_domain = variant { ViciXp };
        oracle_source = \"$ORACLE_ID\";
        trading_access = vec { variant { Open } };
        engine_id = opt \"$VICI_ENGINE_ID\";
        locale = opt \"$locale\";
        start_ns = $start_ns_candid;
    })"
done

echo "Deployed $length markets from $MARKETS_FILE."
