#!/bin/bash
set -euo pipefail

_COMMON_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -z "${PROJECT_ROOT:-}" ]]; then
	source "$_COMMON_DIR/../lib/utils.sh"
fi

DIR="$PROJECT_ROOT/target/icdc"
mkdir -p "$DIR"

ICDC_CORE_VERSION="v0.1.8"
