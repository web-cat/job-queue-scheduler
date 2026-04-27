#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

usage() {
  cat >&2 <<'EOF'
Usage:
  BASE_URL="https://.../api/v1" SERVICE_API_KEY="..." ./scripts/submit-n-jobs.sh <count> <docker_image_tag> <input_path>

Arguments:
  count            Number of jobs to submit
  docker_image_tag Image tag registered in /images (e.g. ghcr.io/.../test-grader-java8:latest)
  input_path       Path to a file or directory to upload.
                  - If a directory: it is zipped once and uploaded as a single .zip (preserves folder structure)
                  - If a file: it is uploaded as-is (zip is treated as zip submission; other files are flat)

Optional env vars:
  CONCURRENCY          (default 10) max parallel submissions
  SUBMISSION_ID_BASE   (default 800000) starting submission_id
  OUT_DIR              (default ./tmp/submit-n) where to write job_ids.txt + failures.txt
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

COUNT="${1:-}"
IMAGE_TAG="${2:-}"
INPUT_PATH="${3:-}"

BASE_URL="${BASE_URL:-}"
SERVICE_API_KEY="${SERVICE_API_KEY:-}"

if [[ -z "$COUNT" || -z "$IMAGE_TAG" || -z "$INPUT_PATH" ]]; then
  usage
  exit 2
fi

if [[ -z "$BASE_URL" ]]; then
  echo "ERROR: BASE_URL is required" >&2
  exit 2
fi

if [[ -z "$SERVICE_API_KEY" ]]; then
  echo "ERROR: SERVICE_API_KEY is required (sent as X-API-Key)" >&2
  exit 2
fi

if ! [[ "$COUNT" =~ ^[0-9]+$ ]] || [[ "$COUNT" -le 0 ]]; then
  echo "ERROR: count must be a positive integer" >&2
  exit 2
fi

CONCURRENCY="${CONCURRENCY:-10}"
SUBMISSION_ID_BASE="${SUBMISSION_ID_BASE:-800000}"
OUT_DIR="${OUT_DIR:-./tmp/submit-n}"

mkdir -p "$OUT_DIR"
jobs_out="$OUT_DIR/job_ids.txt"
fail_out="$OUT_DIR/failures.txt"
: >"$jobs_out"
: >"$fail_out"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

upload_path="$INPUT_PATH"

if [[ -d "$INPUT_PATH" ]]; then
  if ! command -v zip >/dev/null 2>&1; then
    echo "ERROR: input_path is a directory; 'zip' is required to create an archive" >&2
    exit 2
  fi
  archive="$tmp/submission.zip"
  (cd "$INPUT_PATH" && zip -qr "$archive" .)
  upload_path="$archive"
fi

submit_one() {
  local i="$1"
  local submission_id="$((SUBMISSION_ID_BASE + i))"

  local resp http_code body job_id
  resp="$(
    curl -sS -X POST "${BASE_URL}/jobs" \
      -H "X-API-Key: ${SERVICE_API_KEY}" \
      -F "submission_id=${submission_id}" \
      --form-string "docker_image_tag=${IMAGE_TAG}" \
      -F "files=@${upload_path}" \
      -w $'\n%{http_code}\n'
  )"

  http_code="$(printf '%s' "$resp" | tail -n 1)"
  body="$(printf '%s' "$resp" | sed '$d')"

  if [[ "$http_code" != "201" ]]; then
    printf 'i=%s submission_id=%s http=%s\n' "$i" "$submission_id" "$http_code" >>"$fail_out"
    return 0
  fi

  job_id="$(
    python3 -c 'import json,sys; raw=sys.stdin.read().strip(); data=json.loads(raw); print(data.get("data",{}).get("job_id",""))' \
      <<<"$body" 2>/dev/null || true
  )"

  if [[ -z "$job_id" ]]; then
    printf '%s\n' "$body" > "${OUT_DIR}/last_parse_fail_body.txt"
    printf 'i=%s submission_id=%s http=%s parse_job_id_failed body_len=%s\n' \
      "$i" "$submission_id" "$http_code" "$(printf '%s' "$body" | wc -c | tr -d ' ')" >>"$fail_out"
    return 0
  fi

  printf '%s\n' "$job_id" >>"$jobs_out"
}

export -f submit_one
export BASE_URL SERVICE_API_KEY IMAGE_TAG upload_path SUBMISSION_ID_BASE OUT_DIR jobs_out fail_out

echo "Submitting COUNT=${COUNT} jobs (CONCURRENCY=${CONCURRENCY})"
echo "BASE_URL=${BASE_URL}"
echo "IMAGE_TAG=${IMAGE_TAG}"
echo "INPUT_PATH=${INPUT_PATH}"
echo "OUT_DIR=${OUT_DIR}"

seq 1 "$COUNT" | xargs -n 1 -P "$CONCURRENCY" -I '{}' bash -lc 'submit_one "$@"' _ '{}'

ok_count="$(wc -l <"$jobs_out" | tr -d ' ')"
fail_count="$(wc -l <"$fail_out" | tr -d ' ')"

echo ""
echo "Done."
echo "Succeeded: ${ok_count}"
echo "Failed:    ${fail_count}"
echo "Job IDs:   ${jobs_out}"
echo "Failures:  ${fail_out}"

