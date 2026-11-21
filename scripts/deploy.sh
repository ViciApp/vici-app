#!/usr/bin/env bash

source "$(dirname "$0")/lib/utils.sh" "$@"
require_local_network

# Some canisters depend on others, so we need to create them all before deploying
dfx canister create --all --network "$NETWORK"

dfx deploy cketh_minter --network "$NETWORK" --upgrade-unchanged --mode reinstall --yes
dfx deploy cketh_ledger --network "$NETWORK" --upgrade-unchanged --mode reinstall --yes

dfx deploy ckusdc_ledger --network "$NETWORK" --upgrade-unchanged --mode reinstall --yes
dfx deploy ckusdc_index --network "$NETWORK" --upgrade-unchanged --mode reinstall --yes

dfx deploy vxp_minter --network "$NETWORK" --upgrade-unchanged --mode reinstall --yes
dfx deploy vxp_ledger --network "$NETWORK" --upgrade-unchanged --mode reinstall --yes
dfx deploy vxp_index --network "$NETWORK" --upgrade-unchanged --mode reinstall --yes

dfx deploy vici_minter --network "$NETWORK" --upgrade-unchanged --mode reinstall --yes
dfx deploy vici_ledger --network "$NETWORK" --upgrade-unchanged --mode reinstall --yes
dfx deploy vici_index --network "$NETWORK" --upgrade-unchanged --mode reinstall --yes

dfx deploy minter --network "$NETWORK" --upgrade-unchanged --mode reinstall --yes
dfx deploy ledger --network "$NETWORK" --upgrade-unchanged --mode reinstall --yes
dfx deploy index --network "$NETWORK" --upgrade-unchanged --mode reinstall --yes

dfx deploy clearing --network "$NETWORK" --upgrade-unchanged
dfx deploy registry --network "$NETWORK" --upgrade-unchanged
