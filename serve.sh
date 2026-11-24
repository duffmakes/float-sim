#!/usr/bin/env bash
# Serves Float Sim locally (browsers block ES modules / WASM from file://).
# "Solve with Capytaine" works when this Python has Capytaine (pip install capytaine): $FLOATSIM_PYTHON if set,
# else the first of python3 / python on the PATH that has it (an activated virtual environment comes first).
cd "$(dirname "$0")"
PORT="${1:-8765}"
PY=""
for c in "$FLOATSIM_PYTHON" python3 python; do
  [ -n "$c" ] && command -v "$c" >/dev/null 2>&1 && "$c" -c 'import capytaine' >/dev/null 2>&1 && { PY="$c"; break; }
done
[ -z "$PY" ] && PY="$(command -v python3 || command -v python)"
exec "$PY" tools/serve.py --port "$PORT"
