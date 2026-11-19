#!/usr/bin/env bash

source "$(dirname "$0")/../lib/utils.sh" "$@"

echo "Starting clearing initialization on $NETWORK..."

REGISTRY=$(dfx canister id registry --network "$NETWORK")
echo "Setting registry canister ID $REGISTRY in clearing canister..."
dfx canister call clearing set_registry_canister "(principal \"$REGISTRY\")" --network "$NETWORK"

echo "Configuring balance domain policies (Settlement, ViciXp)..."
dfx canister call clearing update_domain_policy "(record {
  domain = variant { Settlement };
  policy = record {
    deposits_enabled = true;
    protocol_fee_ratio_override = null;
    label = \"Settlement\";
    withdrawals_enabled = true;
    insurance_fund_fee_ratio_override = null;
  };
})" --network "$NETWORK"

dfx canister call clearing update_domain_policy "(record {
  domain = variant { ViciXp };
  policy = record {
    deposits_enabled = true;
    protocol_fee_ratio_override = null;
    label = \"ViciXp\";
    withdrawals_enabled = true;
    insurance_fund_fee_ratio_override = null;
  };
})" --network "$NETWORK"

# 2. Register collateral (ICRC): allowed_balance_domains enforced on deposit/withdraw.
#    ICP → Settlement only. VXP → ViciXp only (in-app Playground experience).
#    Override VXP ledger: VXP_LEDGER=principal-text (must match app VITE_VXP_LEDGER_CANISTER_ID).
#    asset_id strings must match on register_icrc_asset and update_asset_price (opaque; lowercase defaults below).

CLEARING_DOMAINS_SETTLEMENT="vec { variant { Settlement } }"
CLEARING_DOMAINS_VICIXP="vec { variant { ViciXp } }"

ICP_LEDGER="$(cd "$PROJECT_ROOT" && npx tsx scripts/lib/ledger-id.ts icp)"
VXP_LEDGER="${VXP_LEDGER:-$(cd "$PROJECT_ROOT" && npx tsx scripts/lib/ledger-id.ts vxp)}"
ICP_ASSET_ID="${ICP_ASSET_ID:-icp}"
VXP_ASSET_ID="${VXP_ASSET_ID:-vxp}"

USD_DECIMALS=4

echo "Registering ICP collateral asset (asset_id=$ICP_ASSET_ID, domains: Settlement)..."
dfx canister call clearing register_icrc_asset "(record {
    asset_id = \"$ICP_ASSET_ID\";
    ledger_id = principal \"$ICP_LEDGER\";
    haircut_bps = 1000 : nat16;
    oracle_id = null;
    is_enabled = true;
    allowed_balance_domains = $CLEARING_DOMAINS_SETTLEMENT;
})" --network "$NETWORK"

dfx canister call clearing update_asset_price "(record {
    asset_id = \"$ICP_ASSET_ID\";
    price = record { decimal = record { value = 30000 : nat; decimals = $USD_DECIMALS : nat8 }; oracle_id = null; timestamp = null };
})" --network "$NETWORK"

echo "Registering VXP collateral asset (asset_id=$VXP_ASSET_ID, domains: ViciXp; ledger $VXP_LEDGER)..."
dfx canister call clearing register_icrc_asset "(record {
    asset_id = \"$VXP_ASSET_ID\";
    ledger_id = principal \"$VXP_LEDGER\";
    haircut_bps = 0 : nat16;
    oracle_id = null;
    is_enabled = true;
    allowed_balance_domains = $CLEARING_DOMAINS_VICIXP;
})" --network "$NETWORK"

dfx canister call clearing update_asset_price "(record {
    asset_id = \"$VXP_ASSET_ID\";
    price = record { decimal = record { value = 10000 : nat; decimals = $USD_DECIMALS : nat8 }; oracle_id = null; timestamp = null };
})" --network "$NETWORK"

VUSD_LEDGER=$(dfx canister id ledger --network "$NETWORK")
echo "Guaranteeing Clearing canister as controller of vUSD Ledger..."
CLEARING_CANISTER=$(dfx canister id clearing --network "$NETWORK")
CURRENT_CONTROLLERS=$(dfx canister status "$VUSD_LEDGER" --network "$NETWORK" 2>&1 | grep "Controllers:" | cut -d: -f2 || echo "")
if [[ ! "$CURRENT_CONTROLLERS" == *"$CLEARING_CANISTER"* ]]; then
  echo "Adding $CLEARING_CANISTER as controller to $VUSD_LEDGER..."
  dfx canister update-settings "$VUSD_LEDGER" --network "$NETWORK" --add-controller "$CLEARING_CANISTER" || echo "Warning: Could not add controller. This might be expected if you are not a controller yourself."
fi

echo "Clearing initialization complete."
