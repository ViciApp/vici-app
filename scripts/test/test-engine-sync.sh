#!/usr/bin/env bash
#
# Smoke test for the Vici Engine <-> icdc-core registry integration.
#
# What it verifies (via dfx, no Juno SDK needed):
#   1. The Vici engine exists on the configured registry.
#   2. The engine's `admins` list contains the Juno satellite principal.
#   3. The engine's `allowed_roles` include both `Creator` and `OracleAdmin`.
#   4. `grant_engine_role` works for a sample principal when called by a controller.
#   5. `revoke_engine_role` reverses the grant.
#
# Does NOT exercise the satellite hook path (that requires writing to the Juno
# datastore, which in turn requires a signed Juno SDK client, out of scope here).
# To verify the hook end-to-end, run this script first, then manually:
#   a. Log into the app with an admin account.
#   b. Assign the CREATOR role to a test principal via the admin panel.
#   c. Re-run `scripts/test/test-engine-sync.sh`, which will show that principal
#      in `role_grants` on the Vici engine.
#
# Usage:
#   ./scripts/test/test-engine-sync.sh [--local|--staging]
#
# shellcheck source=scripts/lib/utils.sh
source "$(dirname "$0")/../lib/utils.sh" "$@"

set -euo pipefail

ENGINE_NAME="Vici"
EXPECTED_ENGINE_ID="${VICI_ENGINE_ID:-eng_0}"
SATELLITE_PRINCIPAL="${VICI_JUNO_SATELLITE_PRINCIPAL:-auamu-4x777-77775-aaaaa-cai}"
TEST_PRINCIPAL="${TEST_PRINCIPAL:-2vxsx-fae}"  # anonymous-ish test principal

pass() { echo "  PASS: $1"; }
fail() { echo "  FAIL: $1"; exit 1; }

echo "Testing Vici engine on $NETWORK..."

LIST_OUT="$(dfx canister call --network "$NETWORK" registry list_engines)"

# Isolate the single top-level `record { ... }` whose `engine_id = "$EXPECTED_ENGINE_ID"`.
# The brace counter handles nested `opt record { ... }` (description) and nested
# `vec { record { ... } }` (role_grants) without being tricked by them. Subsequent
# grep-based checks run against this slice only, so a pass for admins, allowed_roles,
# etc. cannot come from a different engine's record in the same output.
ENGINE_RECORD="$(printf '%s\n' "$LIST_OUT" | awk -v eid="$EXPECTED_ENGINE_ID" '
  {
    n = length($0)
    for (i = 1; i <= n; i++) {
      ch = substr($0, i, 1)
      if (ch == "{") {
        depth++
        if (depth == 2) { buf = ""; collecting = 1; continue }
      } else if (ch == "}") {
        if (depth == 2 && collecting) {
          if (buf ~ ("engine_id[[:space:]]*=[[:space:]]*\"" eid "\"")) {
            print buf
            exit
          }
          collecting = 0
        }
        depth--
      }
      if (collecting) buf = buf ch
    }
    if (collecting) buf = buf "\n"
  }
')"

if [ -z "$ENGINE_RECORD" ]; then
  fail "engine_id $EXPECTED_ENGINE_ID not found. list_engines output:
$LIST_OUT"
fi
pass "engine $EXPECTED_ENGINE_ID is registered"

if ! echo "$ENGINE_RECORD" | grep -q "name = \"$ENGINE_NAME\""; then
  fail "engine $EXPECTED_ENGINE_ID is registered under a different name (expected $ENGINE_NAME). record:
$ENGINE_RECORD"
fi
pass "engine name is $ENGINE_NAME"

# 2. Admins include satellite principal, scoped to this engine's record.
if ! echo "$ENGINE_RECORD" | grep -q "principal \"$SATELLITE_PRINCIPAL\""; then
  fail "satellite principal $SATELLITE_PRINCIPAL not in engine admins. Run scripts/init/init.icdc-engine.sh to reconcile."
fi
pass "satellite principal is an engine admin"

# 3. Allowed roles include Creator and OracleAdmin, scoped to this engine's record.
# Engines are laid out roughly as:
#   record { engine_id = "..."; ... allowed_roles = vec { variant { Creator }; variant { OracleAdmin } }; ... }
# We look for each variant independently inside `allowed_roles`: we cannot use a single
# `[^}]*` between them because `}` also terminates the inner `variant { ... }` braces.
ALLOWED_ROLES_LINE="$(echo "$ENGINE_RECORD" | grep -oE 'allowed_roles = vec \{[^;]*(\};[^;]*)*\};' | head -1)"
if [ -z "$ALLOWED_ROLES_LINE" ]; then
  ALLOWED_ROLES_LINE="$(echo "$ENGINE_RECORD" | grep -oE 'allowed_roles[^;]*' | head -1)"
fi

if ! echo "$ALLOWED_ROLES_LINE" | grep -qE 'variant \{ Creator \}'; then
  fail "allowed_roles does not contain variant { Creator } (allowed_roles slice: $ALLOWED_ROLES_LINE)"
fi
pass "allowed_roles contains Creator"

if ! echo "$ALLOWED_ROLES_LINE" | grep -qE 'variant \{ OracleAdmin \}'; then
  fail "allowed_roles does not contain variant { OracleAdmin } (allowed_roles slice: $ALLOWED_ROLES_LINE)"
fi
pass "allowed_roles contains OracleAdmin"

# 4. grant_engine_role works as controller (local only; skipping on staging to avoid state pollution).
if [ "$NETWORK" = "local" ]; then
  echo "Granting Creator role to $TEST_PRINCIPAL (dry-run check)..."
  GRANT_OUT="$(dfx canister call --network "$NETWORK" registry grant_engine_role "(record {
    engine_id = \"$EXPECTED_ENGINE_ID\";
    grantee = principal \"$TEST_PRINCIPAL\";
    role = variant { Creator }
  })")"

  if echo "$GRANT_OUT" | grep -qE 'Ok|RoleAlreadyGranted'; then
    pass "grant_engine_role succeeded (or role already granted)"
  else
    fail "grant_engine_role failed: $GRANT_OUT"
  fi

  echo "Revoking Creator role from $TEST_PRINCIPAL..."
  REVOKE_OUT="$(dfx canister call --network "$NETWORK" registry revoke_engine_role "(record {
    engine_id = \"$EXPECTED_ENGINE_ID\";
    grantee = principal \"$TEST_PRINCIPAL\";
    role = variant { Creator }
  })")"

  if echo "$REVOKE_OUT" | grep -qE 'Ok|RoleNotGranted'; then
    pass "revoke_engine_role succeeded (or role not granted)"
  else
    fail "revoke_engine_role failed: $REVOKE_OUT"
  fi
else
  echo "  SKIP: grant/revoke round-trip (not local)"
fi

echo ""
echo "All checks passed."
