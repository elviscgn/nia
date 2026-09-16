#!/bin/zsh
set -euo pipefail

if ! command -v brew >/dev/null 2>&1; then
  echo "Homebrew is required. Install it first, then rerun this script."
  exit 1
fi

missing=()
command -v cmake >/dev/null 2>&1 || missing+=(cmake)
command -v ninja >/dev/null 2>&1 || missing+=(ninja)

if (( ${#missing[@]} > 0 )); then
  echo "Installing missing build tools: ${missing[*]}"
  brew install ${missing[@]}
else
  echo "macOS build tools are ready."
fi
