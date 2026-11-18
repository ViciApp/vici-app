#!/usr/bin/env bash

source "$(dirname "$0")/lib/utils.sh" "$@"

"$SCRIPT_DIR/import-candid.sh" --"$NETWORK"

"$SCRIPT_DIR/compile-idl-js.sh" --"$NETWORK"

# The backend vendors the engine bindings byte-for-byte (pinned by
# backend/tests/shared-drift/declarations.test.ts). Copy after compile-idl-js,
# whose trailing format pass is what the backend copy must match.
for canister in clearing registry; do
  cp "$PROJECT_ROOT/src/declarations/$canister/"* "$PROJECT_ROOT/backend/src/declarations/$canister/"
done
