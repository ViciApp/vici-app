#!/usr/bin/env bash
#
# Local-only dev ergonomics for the icdc-core engine.
#
# A registry `--mode reinstall` wipes `eng_0.role_grants`. The intended source of
# truth is Juno's `ROLES` collection, and the `syncRoleToEngineOnSet` satellite hook
# mirrors writes into the registry, but only on writes, not on startup. So after a
# reset the engine's `role_grants` starts empty until role docs are re-saved or
# grants are replayed via `dfx`. Painful on a dev laptop where we reset often.
#
# If `DEV_CREATOR_PRINCIPAL` is set and we're on the local network, grant that
# principal `Creator` + `OracleAdmin` on the Vici engine and add it to
# `VICI_ORACLE_V1.authorized_principals` so `npm run init:icdc` leaves the env
# immediately usable by a signed-in II test user.
#
# This runs **after** `init:icdc-engine` (which registers the engine) and
# `init:registry` (which registers the oracle): both dependencies must exist
# before we can grant.
#
# This is intentionally out-of-band from Juno (no `roles` doc is written). It is a
# no-op on any non-local network (`staging` / `ic`; see `NETWORK` guard). The
# durable, cross-environment fix is a
# Juno-driven reconcile on the satellite, tracked as future work in
# `docs/engine-integration.md` ("Persistence across registry reinstalls").
#
# Env:
#   DEV_CREATOR_PRINCIPAL:  the II/Juno principal to bootstrap. Required; script
#                           exits 0 silently if unset (so the step is safe to wire
#                           unconditionally into `init:icdc`).
#   VICI_ENGINE_ID:         defaults to `eng_0`. Keep in sync with
#                           `src/lib/constants/icdc.constants.ts`.

# shellcheck source=scripts/lib/utils.sh
source "$(dirname "$0")/../lib/utils.sh" "$@"

set -euo pipefail

ENGINE_ID="${VICI_ENGINE_ID:-eng_0}"
ORACLE_ID="VICI_ORACLE_V1"

if [ "$NETWORK" != "local" ]; then
  # Gating here means the step is a no-op on any non-local network (`staging` / `ic`) even
  # when the env var is set, so we never accidentally bypass Juno as the source of truth for
  # real deployments.
  echo "init:icdc-dev-bootstrap: network is '$NETWORK' (not local), skipping."
  exit 0
fi

if [ -z "${DEV_CREATOR_PRINCIPAL:-}" ]; then
  echo "init:icdc-dev-bootstrap: DEV_CREATOR_PRINCIPAL not set, skipping."
  echo "  To auto-grant Creator + OracleAdmin on the Vici engine for your signed-in II user:"
  echo "    export DEV_CREATOR_PRINCIPAL=\"<your-II-principal>\""
  echo "    npm run init:icdc-dev-bootstrap"
  exit 0
fi

echo "init:icdc-dev-bootstrap: granting Creator + OracleAdmin on $ENGINE_ID to $DEV_CREATOR_PRINCIPAL"

# `grant_engine_role` returns `RoleAlreadyGranted` as an Err variant on replay. The dfx
# call itself still exits 0 (canister responded), so we just print the Candid output:
# the Err is self-documenting and not an error for our purposes.
for ROLE in Creator OracleAdmin; do
  dfx canister call --network "$NETWORK" registry grant_engine_role "(record {
    engine_id = \"$ENGINE_ID\";
    grantee = principal \"$DEV_CREATOR_PRINCIPAL\";
    role = variant { $ROLE }
  })"
done

# The oracle's `authorized_principals` is a BTreeSet, so duplicate adds are silent
# no-ops. A missing oracle (OracleNotFound) would indicate init:registry hasn't run:
# surface the error so the operator notices.
dfx canister call --network "$NETWORK" registry manage_oracle_principals "(record {
  oracle_id = \"$ORACLE_ID\";
  add_principals = vec { principal \"$DEV_CREATOR_PRINCIPAL\" };
  remove_principals = vec {}
})"

echo "init:icdc-dev-bootstrap: done."
