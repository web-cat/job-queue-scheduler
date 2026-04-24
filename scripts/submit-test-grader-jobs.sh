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

OWNER="${GHCR_OWNER:-sytraore}"
REPO="${GHCR_REPO:-job-queue-scheduler}"

hdr() { echo ""; echo "==> $*"; }

api_post_json() {
  local path="$1"
  local body="$2"
  curl -sS -i -X POST "${BASE_URL}${path}" \
    -H "X-API-Key: ${SERVICE_API_KEY}" \
    -H "Content-Type: application/json" \
    -d "$body"
}

api_post_job() {
  local tag="$1"
  local submission_id="$2"
  shift 2
  curl -sS -i -X POST "${BASE_URL}/jobs" \
    -H "X-API-Key: ${SERVICE_API_KEY}" \
    -F "submission_id=${submission_id}" \
    --form-string "docker_image_tag=${tag}" \
    "$@"
}

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

JAVA_TAG="ghcr.io/${OWNER}/${REPO}/test-grader-java8:latest"
PY_TAG="ghcr.io/${OWNER}/${REPO}/test-grader-python:latest"
CPP_TAG="ghcr.io/${OWNER}/${REPO}/test-grader-cpp:latest"
C_TAG="ghcr.io/${OWNER}/${REPO}/test-grader-c:latest"

hdr "Registering image configs (idempotent-ish; 409 means already exists)"
api_post_json "/images" "{
  \"docker_image_tag\": \"${JAVA_TAG}\",
  \"display_name\": \"Test Grader (Java 8)\",
  \"timeout_seconds\": 60,
  \"memory_limit_mb\": 512,
  \"cpu_limit_millicores\": 500,
  \"max_retries\": 0,
  \"default_priority\": 5,
  \"default_estimated_runtime\": 5.0
}" | sed -n '1,40p'

api_post_json "/images" "{
  \"docker_image_tag\": \"${PY_TAG}\",
  \"display_name\": \"Test Grader (Python)\",
  \"timeout_seconds\": 60,
  \"memory_limit_mb\": 256,
  \"cpu_limit_millicores\": 250,
  \"max_retries\": 0,
  \"default_priority\": 5,
  \"default_estimated_runtime\": 5.0
}" | sed -n '1,40p'

api_post_json "/images" "{
  \"docker_image_tag\": \"${CPP_TAG}\",
  \"display_name\": \"Test Grader (C++)\",
  \"timeout_seconds\": 60,
  \"memory_limit_mb\": 256,
  \"cpu_limit_millicores\": 500,
  \"max_retries\": 0,
  \"default_priority\": 5,
  \"default_estimated_runtime\": 5.0
}" | sed -n '1,40p'

api_post_json "/images" "{
  \"docker_image_tag\": \"${C_TAG}\",
  \"display_name\": \"Test Grader (C)\",
  \"timeout_seconds\": 60,
  \"memory_limit_mb\": 256,
  \"cpu_limit_millicores\": 500,
  \"max_retries\": 0,
  \"default_priority\": 5,
  \"default_estimated_runtime\": 5.0
}" | sed -n '1,40p'

hdr "Preparing sample submissions"

cat > "${tmp}/Calculator.java" <<'EOF'
public class Calculator {
  public static int add(int a, int b) { return a + b; }
  public static int sub(int a, int b) { return a - b; }
}
EOF

cat > "${tmp}/submission.py" <<'EOF'
def add(a, b):
    return a + b

def sub(a, b):
    return a - b
EOF

cat > "${tmp}/submission.c" <<'EOF'
int add(int a, int b) { return a + b; }
int sub(int a, int b) { return a - b; }
EOF

cat > "${tmp}/submission.cpp" <<'EOF'
int add(int a, int b) { return a + b; }
int sub(int a, int b) { return a - b; }
EOF

hdr "Submitting one job per language"

hdr "Java 8 job"
api_post_job "${JAVA_TAG}" 10001 -F "files=@${tmp}/Calculator.java" | sed -n '1,80p'

hdr "Python job"
api_post_job "${PY_TAG}" 10002 -F "files=@${tmp}/submission.py" | sed -n '1,80p'

hdr "C job"
api_post_job "${C_TAG}" 10003 -F "files=@${tmp}/submission.c" | sed -n '1,80p'

hdr "C++ job"
api_post_job "${CPP_TAG}" 10004 -F "files=@${tmp}/submission.cpp" | sed -n '1,80p'

echo ""
echo "Submitted. Next: poll GET ${BASE_URL}/jobs/<job_id> and then GET .../payload"

