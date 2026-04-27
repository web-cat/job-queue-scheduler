#!/bin/sh
set -eu

SUBMISSION_DIR="/grading/submission"
OUT_DIR="/grading/output"
WORK_DIR="/tmp/grader-cpp"
PAYLOAD_DIR="/tmp/payload"

mkdir -p "$OUT_DIR" "$WORK_DIR" "$PAYLOAD_DIR"

payload_zip="$OUT_DIR/payload-cpp.zip"
payload_log="$PAYLOAD_DIR/run.log"
results_file="$OUT_DIR/results.json"

echo "cpp-zip grader starting" >"$payload_log"

if [ ! -d "$SUBMISSION_DIR" ]; then
  echo "ERROR: /grading/submission missing" >>"$payload_log"
  cat >"$results_file" <<EOF
{ "correctness_score": 0, "tool_score": 0, "comments": "Missing submission directory", "comment_format": 0, "test_output": "missing /grading/submission", "exit_code": 1, "runtime_ms": 1 }
EOF
  (cd "$PAYLOAD_DIR" && zip -qr "$payload_zip" .) || true
  exit 1
fi

cp -R "$SUBMISSION_DIR"/. "$WORK_DIR"/
cp /home/grader/test_main.cpp "$WORK_DIR"/

if [ ! -f "$WORK_DIR/submission.cpp" ]; then
  echo "ERROR: expected submission.cpp at submission root" >>"$payload_log"
  cat >"$results_file" <<EOF
{ "correctness_score": 0, "tool_score": 0, "comments": "Missing submission.cpp", "comment_format": 0, "test_output": "missing submission.cpp", "exit_code": 1, "runtime_ms": 1 }
EOF
  (cd "$PAYLOAD_DIR" && zip -qr "$payload_zip" .) || true
  exit 1
fi

start_ms="$(date +%s%3N 2>/dev/null || true)"

g++ -O2 -std=c++17 -Wall -Wextra -o "$WORK_DIR/test" "$WORK_DIR/test_main.cpp" "$WORK_DIR/submission.cpp" >>"$payload_log" 2>&1 || {
  echo "g++ failed" >>"$payload_log"
  cat >"$results_file" <<EOF
{ "correctness_score": 0, "tool_score": 0, "comments": "Compilation failed", "comment_format": 0, "test_output": "g++ failed", "exit_code": 1, "runtime_ms": 1 }
EOF
  (cd "$PAYLOAD_DIR" && zip -qr "$payload_zip" .) || true
  exit 1
}

"$WORK_DIR/test" >>"$payload_log" 2>&1
exit_code="$?"

end_ms="$(date +%s%3N 2>/dev/null || true)"
runtime_ms="1"
if [ -n "${start_ms:-}" ] && [ -n "${end_ms:-}" ]; then
  runtime_ms="$((end_ms - start_ms))"
fi

passed="$(grep -Eo 'passed=[0-9]+' "$payload_log" | tail -n 1 | cut -d= -f2 || echo 0)"
total="$(grep -Eo 'total=[0-9]+' "$payload_log" | tail -n 1 | cut -d= -f2 || echo 0)"

if [ "$total" -gt 0 ]; then
  correctness_score="$((passed * 100 / total))"
else
  correctness_score="0"
fi

cat >"$PAYLOAD_DIR/metadata.txt" <<EOF
grader=cpp-zip
exit_code=$exit_code
passed=$passed
total=$total
runtime_ms=$runtime_ms
EOF

(cd "$PAYLOAD_DIR" && zip -qr "$payload_zip" .)

cat >"$results_file" <<EOF
{
  "correctness_score": $correctness_score,
  "tool_score": 100,
  "comments": "C++ zip-payload test grader finished.",
  "comment_format": 0,
  "test_output": "passed $passed/$total",
  "exit_code": $exit_code,
  "runtime_ms": $runtime_ms
}
EOF

exit "$exit_code"

