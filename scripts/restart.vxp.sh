#!/usr/bin/env bash

source "$(dirname "$0")/lib/utils.sh" "$@"
require_local_network

echo "Restarting VXP on $NETWORK..."

echo "Creating canister IDs for vxp_minter, vxp_ledger, and vxp_index..."
dfx canister create vxp_minter --network "$NETWORK"
dfx canister create vxp_ledger --network "$NETWORK"
dfx canister create vxp_index --network "$NETWORK"

# Reinstall order matters: ledger init args reference the minter, and the
# index reads from the ledger.
echo "Deploying vxp_minter (reinstall)..."
dfx deploy vxp_minter --network "$NETWORK" --upgrade-unchanged --mode reinstall --yes

echo "Deploying vxp_ledger (reinstall)..."
dfx deploy vxp_ledger --network "$NETWORK" --upgrade-unchanged --mode reinstall --yes

echo "Deploying vxp_index (reinstall)..."
dfx deploy vxp_index --network "$NETWORK" --upgrade-unchanged --mode reinstall --yes

echo "Initializing VXP treasury for satellite..."

if [ -f "$SCRIPT_DIR/init/init.vxp-treasury.sh" ]; then
	bash "$SCRIPT_DIR/init/init.vxp-treasury.sh" "$@"
else
	echo "Warning: $SCRIPT_DIR/init/init.vxp-treasury.sh not found."
fi

echo "VXP restart and initialization complete!"
