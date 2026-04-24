#!/bin/sh
set -eu

SUBMISSION_DIR="/grading/submission"
OUT_DIR="/grading/output"
OUT_FILE="$OUT_DIR/results.json"

# The API/dispatcher prepares the output dir, but be defensive.
mkdir -p "$OUT_DIR"

if [ -d "$SUBMISSION_DIR" ]; then
  file_count="$(find "$SUBMISSION_DIR" -type f 2>/dev/null | wc -l | tr -d ' ')"
  file_list="$(find "$SUBMISSION_DIR" -maxdepth 2 -type f 2>/dev/null | sed "s#^$SUBMISSION_DIR/##" | head -n 50)"
else
  file_count="0"
  file_list=""
fi

test_output="TestGrader: saw ${file_count} file(s). First files: $(printf '%s' "$file_list" | tr '\n' ' ' | head -c 300)"

# Minimal JSON string escape (quotes + backslashes + newlines/tabs).
json_escape() {
  printf '%s' "$1" \
    | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' \
    | tr '\n' ' ' \
    | tr '\t' ' '
}
escaped_test_output="$(json_escape "$test_output")"

# Emit something to container logs for debugging.
echo "$test_output"

# Write a minimal results.json that matches the API's known keys.
cat > "$OUT_FILE" <<EOF
{
  "correctness_score": 100,
  "tool_score": 100,
  "comments": "Test grader ran successfully.",
  "comment_format": 0,
  "test_output": "$escaped_test_output",
  "exit_code": 0,
  "runtime_ms": 1
}
EOF

exit 0

