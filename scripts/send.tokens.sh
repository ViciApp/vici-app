#!/usr/bin/env bash

source "$(dirname "$0")/lib/utils.sh" "$@"

# Usage: ./scripts/send.tokens.sh [principal] [amount] [--local|--staging|--production]  (from repo root)
# Off the local replica it also needs CONFIRM_REAL_TRANSFER=<network> (staging or ic).

if [[ -z "${1:-}" || "$1" == --* ]]; then
  if [[ -n "${2:-}" && "$2" != --* ]]; then
      PRINCIPAL=$2
  else
      read -r -p "Enter the PRINCIPAL: " PRINCIPAL
  fi
else
  PRINCIPAL=$1
fi

CKUSDC_AMOUNT=30000000

args=()
for arg in "$@"; do
    if [[ "$arg" != --* ]]; then
        args+=("$arg")
    fi
done

if [[ ${#args[@]} -ge 1 ]]; then
    PRINCIPAL=${args[0]}
fi

if [[ ${#args[@]} -ge 2 ]]; then
    CKUSDC_AMOUNT=$(echo "${args[1]} * 1000000" | bc)
fi

echo "Transfer on $NETWORK:"
echo "  ledger: ckusdc_ledger ($(dfx canister id ckusdc_ledger --network "$NETWORK"))"
echo "  from:   dfx identity $(dfx identity whoami)"
echo "  to:     $PRINCIPAL"
echo "  amount: $CKUSDC_AMOUNT base units (1 ckUSDC = 1000000)"

# On staging and ic, dfx.json points ckusdc_ledger at the mainnet ckUSDC ledger,
# so the transfer spends real funds. Naming the network in the confirmation
# keeps a recalled command line from sending them by accident.
if [[ "$NETWORK" != "local" && "${CONFIRM_REAL_TRANSFER:-}" != "$NETWORK" ]]; then
  echo "Error: on '$NETWORK' this sends real ckUSDC. Re-run with CONFIRM_REAL_TRANSFER=$NETWORK to send it." >&2
  exit 1
fi

dfx canister call ckusdc_ledger --network "$NETWORK" icrc1_transfer "(record {from=null; to=record { owner= principal \"$PRINCIPAL\";}; amount=$CKUSDC_AMOUNT; fee=null; memo=null; created_at_time=null;})"
