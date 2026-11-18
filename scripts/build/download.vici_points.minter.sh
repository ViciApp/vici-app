#!/bin/bash
set -euo pipefail

_COMMON_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -z "${PROJECT_ROOT:-}" ]]; then
	source "$_COMMON_DIR/../lib/utils.sh"
fi

# Pin so deploys are reproducible. Bump deliberately when vici-points ships
# a release we want to track.
VICI_POINTS_VERSION="${VICI_POINTS_VERSION:-v0.0.2}"
DIR="$PROJECT_ROOT/target/ic"
mkdir -p "$DIR"

rm -f "$DIR"/vxp_minter.*

"$SCRIPTS_LIB/download-immutable.sh" \
	"https://github.com/ViciApp/vici-points/releases/download/$VICI_POINTS_VERSION/minter.wasm.gz" \
	"$DIR/vxp_minter.wasm.gz"
gunzip -f "$DIR/vxp_minter.wasm.gz"

"$SCRIPTS_LIB/download-immutable.sh" \
	"https://github.com/ViciApp/vici-points/releases/download/$VICI_POINTS_VERSION/minter.did" \
	"$DIR/vxp_minter.did"
