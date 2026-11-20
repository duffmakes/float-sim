#!/usr/bin/env bash
# Serves Float Sim locally (browsers block ES modules / WASM from file://).
cd "$(dirname "$0")"
PORT="${1:-8765}"
echo "Float Sim → http://localhost:$PORT"
python3 -m http.server "$PORT" --bind 127.0.0.1
