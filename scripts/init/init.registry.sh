#!/usr/bin/env bash

source "$(dirname "$0")/../lib/utils.sh" "$@"

# This script initializes the registry canister:
#   1. Registers the VICI_ORACLE_V1 oracle (needed to settle markets).
#   2. Authorises the deploying dfx principal, plus any additional principals
#      supplied via the ORACLE_EXTRA_PRINCIPALS env variable
#      (comma or space-separated list of Internet Identity principals).
#   3. Seeds the default market deck from scripts/data/markets.json by
#      delegating to scripts/deploy-markets.sh.
#
# To deploy a different deck (e.g. scripts/data/markets.deck-2026.json), call
# `deploy-markets.sh <file>` directly; see that script's usage. This init only
# wires the oracle + principals and seeds the default file.
#
# Notes on oracle authorisation:
#   The deploying dfx principal is almost never the same as the Internet Identity
#   principal the admin uses in the browser. To let an admin settle markets from
#   the UI, either:
#     - Pre-authorise their II principal here via ORACLE_EXTRA_PRINCIPALS, or
#     - Use the Admin > Oracle Authorisation panel in the app after deploy.

# Env-overridable so `ORACLE_ID=... npm run init:registry` both registers and
# seeds against the caller's oracle (the value is forwarded to deploy-markets.sh).
ORACLE_ID="${ORACLE_ID:-VICI_ORACLE_V1}"
DATA_FILE="$SCRIPT_DIR/data/markets.json"

DEPLOY_PRINCIPAL=$(dfx identity get-principal)

# Build a Candid `vec { principal "..."; ... }` list from dfx principal and any
# additional principals provided via ORACLE_EXTRA_PRINCIPALS (comma/space-separated).
build_principal_vec() {
  local -a principals=("$DEPLOY_PRINCIPAL")

  if [ -n "${ORACLE_EXTRA_PRINCIPALS:-}" ]; then
    local extras
    extras="${ORACLE_EXTRA_PRINCIPALS//,/ }"
    # shellcheck disable=SC2206
    principals+=($extras)
  fi

  # Deduplicate while preserving order.
  local -a unique=()
  local seen
  for p in "${principals[@]}"; do
    [ -z "$p" ] && continue
    seen=0
    for u in "${unique[@]}"; do
      [ "$u" = "$p" ] && seen=1 && break
    done
    [ "$seen" -eq 0 ] && unique+=("$p")
  done

  local entries=""
  for p in "${unique[@]}"; do
    entries+="principal \"$p\"; "
  done
  echo "vec { $entries}"
}

echo "Starting registry initialization on $NETWORK..."

PRINCIPAL_VEC=$(build_principal_vec)

echo "Registering oracle $ORACLE_ID with authorised principals:"
echo "  $PRINCIPAL_VEC"

# add_oracle fails with OracleAlreadyExists on re-run; we swallow the error and
# reconcile the principal list via manage_oracle_principals below.
dfx canister call --network "$NETWORK" registry add_oracle "(record {
    oracle_id = \"$ORACLE_ID\";
    metadata = record {
        name = \"Vici Oracle v1\";
        description = opt record {
            plain = \"Default settlement oracle for Vici prediction markets\";
            markdown = null;
            html = null
        };
        website = null
    };
    authorized_principals = $PRINCIPAL_VEC
})" 2>/dev/null || true

# Ensure all expected principals are present (no-op if oracle was freshly created).
dfx canister call --network "$NETWORK" registry manage_oracle_principals "(record {
    oracle_id = \"$ORACLE_ID\";
    add_principals = $PRINCIPAL_VEC;
    remove_principals = vec {}
})" >/dev/null

# Registry and clearing only accept USD payout_unit today (see icdc-core registry add_series).

# Seed the default market deck. The market-registration loop lives in
# scripts/deploy-markets.sh so any JSON deck can be deployed independently;
# here we just feed it the default file and forward the oracle/network/engine.
ORACLE_ID="$ORACLE_ID" "$SCRIPTS_ROOT/deploy-markets.sh" "$DATA_FILE" "$NETWORK"

echo "Registry initialization complete."
