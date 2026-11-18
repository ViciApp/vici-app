#!/bin/bash
set -euo pipefail

_COMMON_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -z "${PROJECT_ROOT:-}" ]]; then
	source "$_COMMON_DIR/../lib/utils.sh"
fi

# Pin so deploys are reproducible. Bump deliberately when vici-icrc ships
# a release we want to track.
VICI_ICRC_VERSION="${VICI_ICRC_VERSION:-v0.0.1}"
DIR="$PROJECT_ROOT/target/ic"
mkdir -p "$DIR"

rm -f "$DIR"/vici_minter.*

"$SCRIPTS_LIB/download-immutable.sh" \
	"https://github.com/ViciApp/vici-icrc/releases/download/$VICI_ICRC_VERSION/minter.wasm.gz" \
	"$DIR/vici_minter.wasm.gz"
gunzip -f "$DIR/vici_minter.wasm.gz"

"$SCRIPTS_LIB/download-immutable.sh" \
	"https://github.com/ViciApp/vici-icrc/releases/download/$VICI_ICRC_VERSION/minter.did" \
	"$DIR/vici_minter.did"
