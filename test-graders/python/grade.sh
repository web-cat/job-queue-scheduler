#!/bin/sh
set -eu

SUBMISSION_DIR="/grading/submission"
OUT_DIR="/grading/output"
WORK_DIR="/tmp/grader-python"
mkdir -p "$OUT_DIR" "$WORK_DIR"

payload_file="$OUT_DIR/payload-python.txt"
results_file="$OUT_DIR/results.json"

echo "python grader starting" >"$payload_file"

if [ ! -d "$SUBMISSION_DIR" ]; then
  echo "ERROR: /grading/submission missing" >>"$payload_file"
  cat >"$results_file" <<EOF
{ "correctness_score": 0, "tool_score": 0, "comments": "Missing submission directory", "comment_format": 0, "test_output": "missing /grading/submission", "exit_code": 1, "runtime_ms": 1 }
EOF
  exit 1
fi

cp -R "$SUBMISSION_DIR"/. "$WORK_DIR"/

start_ms="$(date +%s%3N 2>/dev/null || true)"

# Run built-in unittest suite against /tmp/grader-python/submission.py
python -m unittest -v /home/grader/tests/test_submission.py >>"$payload_file" 2>&1
exit_code="$?"

end_ms="$(date +%s%3N 2>/dev/null || true)"
runtime_ms="1"
if [ -n "${start_ms:-}" ] && [ -n "${end_ms:-}" ]; then
  runtime_ms="$((end_ms - start_ms))"
fi

total="$(grep -Eo 'Ran [0-9]+ test' "$payload_file" | tail -n 1 | awk '{print $2}' || echo 0)"
if grep -qE '^OK$' "$payload_file"; then
  passed="$total"
else
  failures="$(grep -Eo 'failures=[0-9]+' "$payload_file" | tail -n 1 | cut -d= -f2 || echo 0)"
  errors="$(grep -Eo 'errors=[0-9]+' "$payload_file" | tail -n 1 | cut -d= -f2 || echo 0)"
  failed="$((failures + errors))"
  passed="$((total - failed))"
fi

if [ "$total" -gt 0 ]; then
  correctness_score="$((passed * 100 / total))"
else
  correctness_score="0"
fi

# Always produce an additional payload artifact.
printf 'python payload: passed %s/%s\n' "$passed" "$total" >>"$payload_file"

cat >"$results_file" <<EOF
{
  "correctness_score": $correctness_score,
  "tool_score": 100,
  "comments": "Python test grader finished.",
  "comment_format": 0,
  "test_output": "passed $passed/$total",
  "exit_code": $exit_code,
  "runtime_ms": $runtime_ms
}
EOF

exit "$exit_code"

