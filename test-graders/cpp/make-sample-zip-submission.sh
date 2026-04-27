#!/usr/bin/env bash
set -euo pipefail

# Writes: test-graders/cpp/sample-submission-cpp.zip

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT_ZIP="${OUT_ZIP:-$SCRIPT_DIR/sample-submission-cpp.zip}"
WORK_DIR="${WORK_DIR:-$SCRIPT_DIR/sample-submission-cpp}"

if ! command -v zip >/dev/null 2>&1; then
  echo "ERROR: 'zip' is required." >&2
  exit 1
fi

rm -rf "$WORK_DIR"
mkdir -p "$WORK_DIR/src"

# Must exist at submission root after extraction for the cpp grader.
cat >"$WORK_DIR/submission.cpp" <<'EOF'
int add(int a, int b) { return a + b; }
int sub(int a, int b) { return a - b; }
EOF

cat >"$WORK_DIR/src/extra.cpp" <<'EOF'
int unused_helper() { return 42; }
EOF

cat >"$WORK_DIR/README.txt" <<'EOF'
Sample folder-structured C++ submission for the execution service.
EOF

rm -f "$OUT_ZIP"
(cd "$WORK_DIR" && zip -qr "$OUT_ZIP" .)

echo "Wrote: $OUT_ZIP"

