#!/usr/bin/env bash

source "$(dirname "$0")/lib/utils.sh" "$@"
require_local_network

echo "Restarting ICDC on $NETWORK..."

# Pre-create dependent canisters so minter/ledger/index can resolve their ids
# during init args.
echo "Creating canister IDs for ledger and clearing..."
dfx canister create ledger --network "$NETWORK"
dfx canister create clearing --network "$NETWORK"

echo "Deploying minter (reinstall)..."
dfx deploy minter --network "$NETWORK" --upgrade-unchanged --mode reinstall --yes

echo "Deploying ledger (reinstall)..."
dfx deploy ledger --network "$NETWORK" --upgrade-unchanged --mode reinstall --yes

echo "Deploying index (reinstall)..."
dfx deploy index --network "$NETWORK" --upgrade-unchanged --mode reinstall --yes

echo "Deploying clearing..."
dfx deploy clearing --network "$NETWORK" --upgrade-unchanged --mode reinstall --yes

echo "Deploying registry..."
dfx deploy registry --network "$NETWORK" --upgrade-unchanged --mode reinstall --yes

echo "Initializing registry and clearing..."

if [ -f "$SCRIPT_DIR/init/init.registry.sh" ]; then
    bash "$SCRIPT_DIR/init/init.registry.sh" "$@"
else
    echo "Warning: $SCRIPT_DIR/init/init.registry.sh not found."
fi

if [ -f "$SCRIPT_DIR/init/init.clearing.sh" ]; then
    bash "$SCRIPT_DIR/init/init.clearing.sh" "$@"
else
    echo "Warning: $SCRIPT_DIR/init/init.clearing.sh not found."
fi

echo "ICDC restart and initialization complete!"
