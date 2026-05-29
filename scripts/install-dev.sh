#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT/server"
npm install
npm run build
cat <<MSG
Built Antigravity Claude Code plugin.
Test with:
  claude --plugin-dir "$ROOT"
  /antigravity:setup
MSG
