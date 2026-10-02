#!/usr/bin/env bash
cd "$(dirname "$0")/.." || exit 1
ok=1
need() { grep -qiE "$2" "$1" || { echo "missing in $1: $2"; ok=0; }; }
[ -f render.yaml ] || { echo "no render.yaml"; ok=0; }
need render.yaml 'healthCheckPath'
need render.yaml 'MONGODB_URI'
need render.yaml 'numInstances: 1'
need README.md '^#+ .*conflict'
need README.md 'sticky sessions'
need README.md 'redis'
need README.md '^## .*scal'
need README.md 'frame p95 of [0-9.]+ ms'
need README.md 'atlas'
need README.md 'waking'
[ $ok -eq 1 ] && echo DOC_OK
[ $ok -eq 1 ]
