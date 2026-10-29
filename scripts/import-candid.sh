#!/usr/bin/env bash

source "$(dirname "$0")/lib/utils.sh" "$@"

# The bindings track the same pinned release as the local wasm downloads, so a
# regeneration is reproducible and only moves when ICDC_CORE_VERSION is bumped.
source "$BUILD_SCRIPTS_DIR/download.icdc.common.sh"

ICDC_CORE_REPO="AntonioVentilii/icdc-core"

download_did() {
  local file_path="$1"
  local out_path="$2"

  local raw_url="https://raw.githubusercontent.com/${ICDC_CORE_REPO}/refs/tags/${ICDC_CORE_VERSION}/${file_path}"
  local tmp_path="$(mktemp)"

  echo "Downloading ${raw_url} -> REPO_ROOT/${out_path}"

  if ! curl -fsSL "$raw_url" -o "$tmp_path"; then
    echo "Failed to download ${file_path} from ${ICDC_CORE_REPO}@${ICDC_CORE_VERSION}."
    rm -f "$tmp_path"
    return 1
  fi

  mkdir -p "$(dirname "$out_path")"
  {
    echo "// Generated from ${ICDC_CORE_REPO} ${ICDC_CORE_VERSION} for file '${file_path}'"
    echo ""
    cat "$tmp_path"
  } >"$out_path"

  rm -f "$tmp_path"
}

cd "$PROJECT_ROOT"

download_did src/registry/registry.did src/declarations/registry/registry.did
download_did src/clearing/clearing.did src/declarations/clearing/clearing.did
