#!/usr/bin/env bash
#
# Fund the Juno Satellite with VXP on the local (or staging) replica so serverless
# distribution hooks (icrc1_transfer from the satellite) can pay users.
#
# Prerequisites:
#   - `vxp_minter` and `vxp_ledger` deployed (`./scripts/deploy.sh` or your subset).
#   - Current `dfx` identity is a **controller** of `vxp_minter` (mint authority).
#
# The satellite principal must be the canister that runs Juno serverless functions
# (the account that sends VXP in `src/satellite/services/vxp-onboarding.services.ts`).
#
# Env:
#   VICI_JUNO_SATELLITE_PRINCIPAL: satellite canister id (default: dev id from juno.config.ts).
#   VXP_RESERVE_ID: skip add_reserve and use this reserve (e.g. after first run).
#   VXP_TREASURY_TOPUP_BASE_UNITS: minted amount (default: 1e11 = 10M VXP at 4 decimals).
#
# shellcheck source=scripts/lib/utils.sh
source "$(dirname "$0")/../lib/utils.sh" "$@"

set -euo pipefail

# The dev id stays a literal here: `ids.development` in juno.config.ts follows
# the JUNO_EMULATOR swap (the e2e job sets it), so reading it would change
# this default under the emulator.
SATELLITE="${VICI_JUNO_SATELLITE_PRINCIPAL:-auamu-4x777-77775-aaaaa-cai}"
TOPUP="${VXP_TREASURY_TOPUP_BASE_UNITS:-100000000000}"

echo "Satellite (VXP sender): $SATELLITE"
echo "Top-up amount (base units): $TOPUP"

RESERVE_ID=""

if [[ -n "${VXP_RESERVE_ID:-}" ]]; then
	RESERVE_ID="$VXP_RESERVE_ID"
	echo "Using VXP_RESERVE_ID=$RESERVE_ID"
else
	echo "Registering satellite as minter reserve (add_reserve)..."
	ADD_OUT="$(
		dfx canister call vxp_minter add_reserve "(
  record {
    allow_manual_topup = true;
    lifetime_received_minimum = null;
    label = \"juno_satellite_treasury\";
    enabled = true;
    target_balance = 1_000_000_000_000_000_000 : nat;
    max_topup_per_rebalance = null;
    account = record {
      owner = principal \"$SATELLITE\";
      subaccount = null;
    };
    allow_auto_rebalance = false;
    min_balance = 0 : nat;
    rate_limits = null;
    purpose = \"Juno satellite VXP user distribution\";
    max_balance = null;
    lifetime_received_maximum = opt (1_000_000_000_000_000_000 : nat);
  }
)" --network "$NETWORK" 2>&1
	)" || true

	if echo "$ADD_OUT" | grep -q 'Ok ='; then
		RESERVE_ID="$(echo "$ADD_OUT" | sed -n 's/.*Ok = \([0-9][0-9]*\) : nat64.*/\1/p')"
		if [[ -z "$RESERVE_ID" ]]; then
			RESERVE_ID="$(echo "$ADD_OUT" | sed -n 's/.*Ok = \([0-9][0-9]*\).*/\1/p')"
		fi
		echo "Registered reserve id: $RESERVE_ID"
	elif echo "$ADD_OUT" | grep -q 'ReserveAccountAlreadyExists'; then
		echo "$ADD_OUT"
		echo ""
		echo "Reserve for this satellite already exists. List reserves and re-run with VXP_RESERVE_ID set:"
		echo "  dfx canister call vxp_minter list_reserves --network $NETWORK --query"
		echo "  VXP_RESERVE_ID=<id> ./scripts/init/init.vxp-treasury.sh --$NETWORK"
		exit 1
	else
		echo "$ADD_OUT"
		exit 1
	fi
fi

echo "Manual top-up (mint to reserve $RESERVE_ID)..."
dfx canister call vxp_minter manual_topup_reserve "(
  record {
    reserve_id = $RESERVE_ID : nat64;
    amount = $TOPUP : nat;
    idempotency_key = opt \"local-treasury-$(date +%s)\";
  }
)" --network "$NETWORK"

echo "Done. Satellite $SATELLITE should show VXP on vxp_ledger (default subaccount)."
