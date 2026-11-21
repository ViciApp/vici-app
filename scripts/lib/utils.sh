#!/usr/bin/env bash

set -euo pipefail

SCRIPTS_LIB="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPTS_ROOT="$(cd "$SCRIPTS_LIB/.." && pwd)"
PROJECT_ROOT="$(cd "$SCRIPTS_ROOT/.." && pwd)"
BUILD_SCRIPTS_DIR="$SCRIPTS_ROOT/build"

# Back-compat: historically `SCRIPT_DIR` meant the `scripts/` root (for data/, top-level tools).
export SCRIPTS_LIB SCRIPTS_ROOT PROJECT_ROOT BUILD_SCRIPTS_DIR
export SCRIPT_DIR="$SCRIPTS_ROOT"

NETWORK="local"

# dfx network names. `ic` is icdc-core production, `staging` is icdc-core staging
# (mirrors icdc-core's canister_ids.json). `--production` is an ergonomic alias for `ic`.
ACCEPTABLE_NETWORKS=("local" "staging" "ic")

# True when $1 is a network name (or the `production` alias), so a script that
# takes a positional file can reject a network passed in its place.
is_network_name() {
	local candidate=$1 net

	if [[ "$candidate" == "production" ]]; then
		return 0
	fi

	for net in "${ACCEPTABLE_NETWORKS[@]}"; do
		if [[ "$net" == "$candidate" ]]; then
			return 0
		fi
	done

	return 1
}

check_network() {
	local requested_network=$1

	requested_network=${requested_network#--}

	if [[ -z "$requested_network" ]]; then
		return 0
	fi

	for net in "${ACCEPTABLE_NETWORKS[@]}"; do
		if [[ "$net" == "$requested_network" ]]; then
			NETWORK="$requested_network"
			return 0
		fi
	done

	echo "Error: Network '$requested_network' is not supported. Acceptable networks are: ${ACCEPTABLE_NETWORKS[*]}"
	exit 1
}

# For scripts that reinstall canisters, mint tokens or set fixed prices. On
# `staging` and `ic` those canisters hold real state (the VXP and VICI entries in
# dfx.json carry no `remote` block and their `specified_id` is the mainnet id), so
# such a script stops before its first dfx call anywhere but the local replica.
require_local_network() {
	if [[ "$NETWORK" != "local" ]]; then
		echo "Error: $(basename "$0") runs on the local network only, not on '$NETWORK'." >&2
		exit 1
	fi
}

while [[ $# -gt 0 ]]; do
	case $1 in
		local | staging | ic)
			NETWORK="$1"
			shift
			;;
		--local)
			NETWORK="local"
			shift
			;;
		--staging)
			NETWORK="staging"
			shift
			;;
		--ic | --production | production)
			NETWORK="ic"
			shift
			;;
		*)
			if [[ "$1" == --* ]]; then
				check_network "${1#--}"
			fi
			shift
			;;
	esac
done

# Final validation: catches the case where `NETWORK` was set in the environment
# (bypassing the loop) but to an invalid value.
check_network "$NETWORK"

export NETWORK
echo "Using network: $NETWORK"
