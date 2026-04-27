#!/bin/sh
set -eu

SUBMISSION_DIR="/grading/submission"
OUT_DIR="/grading/output"
WORK_DIR="/tmp/grader-python"
PAYLOAD_DIR="/tmp/payload"

mkdir -p "$OUT_DIR" "$WORK_DIR" "$PAYLOAD_DIR"

payload_zip="$OUT_DIR/payload-python.zip"
payload_log="$PAYLOAD_DIR/run.log"
results_file="$OUT_DIR/results.json"

export PAYLOAD_DIR
export payload_zip

echo "python-zip grader starting" >"$payload_log"

if [ ! -d "$SUBMISSION_DIR" ]; then
  echo "ERROR: /grading/submission missing" >>"$payload_log"
  cat >"$results_file" <<EOF
{ "correctness_score": 0, "tool_score": 0, "comments": "Missing submission directory", "comment_format": 0, "test_output": "missing /grading/submission", "exit_code": 1, "runtime_ms": 1 }
EOF
  python - <<'PY'
import os, zipfile
out = os.environ["payload_zip"]
os.makedirs(os.path.dirname(out), exist_ok=True)
with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED) as z:
    z.writestr("metadata.txt", "grader=python-zip\nerror=missing_submission_dir\n")
PY
  exit 1
fi

cp -R "$SUBMISSION_DIR"/. "$WORK_DIR"/

start_ms="$(date +%s%3N 2>/dev/null || true)"

python -m unittest -v /home/grader/tests/test_submission.py >>"$payload_log" 2>&1
exit_code="$?"

end_ms="$(date +%s%3N 2>/dev/null || true)"
runtime_ms="1"
if [ -n "${start_ms:-}" ] && [ -n "${end_ms:-}" ]; then
  runtime_ms="$((end_ms - start_ms))"
fi

total="$(grep -Eo 'Ran [0-9]+ test' "$payload_log" | tail -n 1 | awk '{print $2}' || echo 0)"
if grep -qE '^OK$' "$payload_log"; then
  passed="$total"
else
  failures="$(grep -Eo 'failures=[0-9]+' "$payload_log" | tail -n 1 | cut -d= -f2 || echo 0)"
  errors="$(grep -Eo 'errors=[0-9]+' "$payload_log" | tail -n 1 | cut -d= -f2 || echo 0)"
  failed="$((failures + errors))"
  passed="$((total - failed))"
fi

if [ "$total" -gt 0 ]; then
  correctness_score="$((passed * 100 / total))"
else
  correctness_score="0"
fi

cat >"$PAYLOAD_DIR/metadata.txt" <<EOF
grader=python-zip
exit_code=$exit_code
passed=$passed
total=$total
runtime_ms=$runtime_ms
EOF

# Create the zip payload using Python's stdlib (no external `zip` binary needed).
python - <<'PY'
import os, zipfile
payload_dir = os.environ["PAYLOAD_DIR"]
out = os.environ["payload_zip"]
with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED) as z:
    for name in ("run.log", "metadata.txt"):
        p = os.path.join(payload_dir, name)
        if os.path.exists(p):
            z.write(p, arcname=name)
PY

cat >"$results_file" <<EOF
{
  "correctness_score": $correctness_score,
  "tool_score": 100,
  "comments": "Python zip-payload test grader finished.",
  "comment_format": 0,
  "test_output": "passed $passed/$total",
  "exit_code": $exit_code,
  "runtime_ms": $runtime_ms
}
EOF

exit "$exit_code"

