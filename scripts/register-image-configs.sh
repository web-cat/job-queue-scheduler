#!/usr/bin/env bash
set -euo pipefail

# Registers all test grader image configs in the API (DB storage).
# Idempotent: HTTP 409 means the config already exists.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

BASE_URL="${BASE_URL:-}"
SERVICE_API_KEY="${SERVICE_API_KEY:-}"

if [[ -z "$BASE_URL" || -z "$SERVICE_API_KEY" ]]; then
  echo "ERROR: BASE_URL and SERVICE_API_KEY are required." >&2
  echo "Example:" >&2
  echo "  BASE_URL='https://web-cat-execution-service.discovery.cs.vt.edu/api/v1' \\" >&2
  echo "  ./scripts/register-image-configs.sh" >&2
  exit 2
fi

OWNER="${GHCR_OWNER:-sytraore}"
REPO="${GHCR_REPO:-job-queue-scheduler}"

api_post_json() {
  local body="$1"
  curl -sS -o /dev/null -w '%{http_code}' -X POST "${BASE_URL}/images" \
    -H "X-API-Key: ${SERVICE_API_KEY}" \
    -H "Content-Type: application/json" \
    -d "$body"
}

register_one() {
  local tag="$1"
  local name="$2"
  local timeout="$3"
  local mem="$4"
  local cpu="$5"
  local retries="$6"
  local priority="$7"
  local est="$8"

  local code
  code="$(api_post_json "{
    \"docker_image_tag\": \"${tag}\",
    \"display_name\": \"${name}\",
    \"timeout_seconds\": ${timeout},
    \"memory_limit_mb\": ${mem},
    \"cpu_limit_millicores\": ${cpu},
    \"max_retries\": ${retries},
    \"default_priority\": ${priority},
    \"default_estimated_runtime\": ${est}
  }")"

  case "$code" in
    201) echo "201 Created - ${tag}" ;;
    409) echo "409 Exists  - ${tag}" ;;
    *)   echo "${code} Error  - ${tag}" ;;
  esac
}

echo "Registering test grader image configs..."

register_one "ghcr.io/${OWNER}/${REPO}/test-grader-java8:latest"      "Test Grader (Java 8)"              60 512 500 0 5 5.0
register_one "ghcr.io/${OWNER}/${REPO}/test-grader-java8-zip:latest"  "Test Grader (Java 8, zip payload)" 60 512 500 0 5 5.0
register_one "ghcr.io/${OWNER}/${REPO}/test-grader-python:latest"     "Test Grader (Python)"              60 256 250 0 5 5.0
register_one "ghcr.io/${OWNER}/${REPO}/test-grader-python-zip:latest" "Test Grader (Python, zip payload)" 60 256 250 0 5 5.0
register_one "ghcr.io/${OWNER}/${REPO}/test-grader-cpp:latest"        "Test Grader (C++)"                 60 256 500 0 5 5.0
register_one "ghcr.io/${OWNER}/${REPO}/test-grader-cpp-zip:latest"    "Test Grader (C++, zip payload)"    60 256 500 0 5 5.0
register_one "ghcr.io/${OWNER}/${REPO}/test-grader-c:latest"          "Test Grader (C)"                   60 256 500 0 5 5.0
register_one "ghcr.io/${OWNER}/${REPO}/test-grader-c-zip:latest"      "Test Grader (C, zip payload)"      60 256 500 0 5 5.0

echo "Done."

