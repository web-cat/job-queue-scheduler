#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# Required
BASE_URL="${BASE_URL:-}"
SERVICE_API_KEY="${SERVICE_API_KEY:-}"

if [[ -z "$BASE_URL" ]]; then
  echo "ERROR: BASE_URL is required. Example:" >&2
  echo "  BASE_URL='https://web-cat-execution-service.discovery.cs.vt.edu/api/v1' ..." >&2
  exit 1
fi

if [[ -z "$SERVICE_API_KEY" ]]; then
  echo "ERROR: SERVICE_API_KEY is required (sent as X-API-Key)." >&2
  exit 1
fi

# Optional knobs
COUNT="${COUNT:-200}"
CONCURRENCY="${CONCURRENCY:-25}"
SUBMISSION_ID_BASE="${SUBMISSION_ID_BASE:-900000}"
OUT_DIR="${OUT_DIR:-}"
AUTO_REGISTER_IMAGE="${AUTO_REGISTER_IMAGE:-0}"
DEBUG_RESPONSES="${DEBUG_RESPONSES:-0}"

OWNER="${GHCR_OWNER:-sytraore}"
REPO="${GHCR_REPO:-job-queue-scheduler}"
JAVA_TAG="${JAVA_TAG:-ghcr.io/${OWNER}/${REPO}/test-grader-java8:latest}"

tmp="$(mktemp -d)"
if [[ -z "$OUT_DIR" ]]; then
  trap 'rm -rf "$tmp"' EXIT
else
  mkdir -p "$OUT_DIR"
  echo "OUT_DIR=${OUT_DIR}"
  echo "Temp directory kept at: ${tmp}"
fi

cat > "${tmp}/Calculator.java" <<'EOF'
public class Calculator {
  public static int add(int a, int b) { return a + b; }
  public static int sub(int a, int b) { return a - b; }
}
EOF

if [[ -z "$OUT_DIR" ]]; then
  OUT_DIR="$tmp"
fi

jobs_out="${OUT_DIR}/job_ids.txt"
fail_out="${OUT_DIR}/failures.txt"

mkdir -p "${OUT_DIR}/responses"
: > "$jobs_out"
: > "$fail_out"

submit_one() {
  local i="$1"
  local submission_id="$((SUBMISSION_ID_BASE + i))"

  # Append status code as the last line so we can parse reliably without jq.
  local resp
  resp="$(
    curl -sS -X POST "${BASE_URL}/jobs" \
      -H "X-API-Key: ${SERVICE_API_KEY}" \
      -F "submission_id=${submission_id}" \
      --form-string "docker_image_tag=${JAVA_TAG}" \
      -F "files=@${tmp}/Calculator.java" \
      -w $'\n%{http_code}\n'
  )"

  local http_code
  http_code="$(printf '%s' "$resp" | tail -n 1)"
  local body
  # BSD/macOS `head` doesn't support `-n -1`. Use sed to drop the last line (http code).
  body="$(printf '%s' "$resp" | sed '$d')"

  if [[ "$http_code" != "201" ]]; then
    printf 'i=%s submission_id=%s http=%s\n' "$i" "$submission_id" "$http_code" >>"$fail_out"
    return 0
  fi

  # Extract job_id from { "data": { "job_id": ... } } response.
  # Use python for correctness (avoid brittle regex on JSON).
  local job_id
  job_id="$(
    python3 -c 'import json,sys; raw=sys.stdin.read().strip(); data=json.loads(raw); v=data.get("data",{}).get("job_id",""); print(v if v is not None else "")' <<<"$body" \
      2>/dev/null || true
  )"

  if [[ -z "$job_id" ]]; then
    # Always persist the raw body for debugging (JSON parse failures are otherwise opaque).
    printf '%s\n' "$body" > "${OUT_DIR}/responses/resp_${i}.txt"
    printf '%s\n' "$body" > "${OUT_DIR}/last_parse_fail_body.txt"
    printf 'i=%s submission_id=%s http=%s parse_job_id_failed body_len=%s\n' \
      "$i" "$submission_id" "$http_code" "$(printf '%s' "$body" | wc -c | tr -d ' ')" >>"$fail_out"
    return 0
  fi

  printf '%s\n' "$job_id" >>"$jobs_out"
}

export -f submit_one
export BASE_URL SERVICE_API_KEY JAVA_TAG SUBMISSION_ID_BASE tmp OUT_DIR jobs_out fail_out

maybe_register_image_config() {
  if [[ "$AUTO_REGISTER_IMAGE" != "1" ]]; then
    return 0
  fi

  # Idempotent-ish: expect 201 created or 409 already exists.
  curl -sS -o /dev/null -w '%{http_code}' -X POST "${BASE_URL}/images" \
    -H "X-API-Key: ${SERVICE_API_KEY}" \
    -H "Content-Type: application/json" \
    -d "{
      \"docker_image_tag\": \"${JAVA_TAG}\",
      \"display_name\": \"Test Grader (Java 8)\",
      \"timeout_seconds\": 60,
      \"memory_limit_mb\": 512,
      \"cpu_limit_millicores\": 500,
      \"max_retries\": 0,
      \"default_priority\": 5,
      \"default_estimated_runtime\": 5.0
    }" \
    | awk '{print "Image config POST /images => http=" $0}'
}

echo "Submitting COUNT=${COUNT} Java8 jobs with CONCURRENCY=${CONCURRENCY}"
echo "BASE_URL=${BASE_URL}"
echo "JAVA_TAG=${JAVA_TAG}"

maybe_register_image_config

seq 1 "$COUNT" | xargs -n 1 -P "$CONCURRENCY" -I '{}' bash -lc 'submit_one "$@"' _ '{}'

ok_count="$(wc -l <"$jobs_out" | tr -d ' ')"
fail_count="$(wc -l <"$fail_out" | tr -d ' ')"

echo ""
echo "Done."
echo "Succeeded: ${ok_count}"
echo "Failed:    ${fail_count}"
echo ""
echo "Job IDs saved to: ${jobs_out}"
if [[ "$fail_count" != "0" ]]; then
  echo "Failures saved to: ${fail_out}"
fi

if [[ -n "$OUT_DIR" ]]; then
  echo "Sample file used for upload: ${tmp}/Calculator.java"
fi
