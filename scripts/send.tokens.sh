#!/usr/bin/env bash

source "$(dirname "$0")/lib/utils.sh" "$@"

# Usage: ./scripts/send.tokens.sh [principal] [amount] [--local|--staging|--production]  (from repo root)

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

# The principal goes into a Candid literal, so anything but the textual
# principal form would change the call rather than fail it.
if [[ ! "$PRINCIPAL" =~ ^([a-z2-7]{5}-)*[a-z2-7]{1,5}$ ]]; then
    echo "Error: '$PRINCIPAL' is not a textual principal." >&2
    exit 1
fi

if [[ ${#args[@]} -ge 2 ]]; then
    if [[ ! "${args[1]}" =~ ^[0-9]+(\.[0-9]{1,6})?$ ]]; then
        echo "Error: amount '${args[1]}' must be ckUSDC with at most 6 decimals." >&2
        exit 1
    fi

    # `/ 1` at scale 0 drops the fraction bc keeps from the operand
    # (30.5 * 1000000 is 30500000.0), which a Candid nat rejects.
    CKUSDC_AMOUNT=$(echo "${args[1]} * 1000000 / 1" | bc)
fi

echo "Sending $CKUSDC_AMOUNT to $PRINCIPAL on $NETWORK..."

dfx canister call ckusdc_ledger --network "$NETWORK" icrc1_transfer "(record {from=null; to=record { owner= principal \"$PRINCIPAL\";}; amount=$CKUSDC_AMOUNT; fee=null; memo=null; created_at_time=null;})"
