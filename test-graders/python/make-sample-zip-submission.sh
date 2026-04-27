#!/usr/bin/env bash
set -euo pipefail

# Writes: test-graders/python/sample-submission-python.zip

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT_ZIP="${OUT_ZIP:-$SCRIPT_DIR/sample-submission-python.zip}"
WORK_DIR="${WORK_DIR:-$SCRIPT_DIR/sample-submission-python}"

if ! command -v zip >/dev/null 2>&1; then
  echo "ERROR: 'zip' is required." >&2
  exit 1
fi

rm -rf "$WORK_DIR"
mkdir -p "$WORK_DIR/src"

# Must exist at submission root after extraction for the python grader tests.
cat >"$WORK_DIR/submission.py" <<'EOF'
def add(a, b):
    return a + b

def sub(a, b):
    return a - b
EOF

cat >"$WORK_DIR/src/helper.py" <<'EOF'
def identity(x):
    return x
EOF

cat >"$WORK_DIR/README.txt" <<'EOF'
Sample folder-structured Python submission for the execution service.
EOF

rm -f "$OUT_ZIP"
(cd "$WORK_DIR" && zip -qr "$OUT_ZIP" .)

echo "Wrote: $OUT_ZIP"

