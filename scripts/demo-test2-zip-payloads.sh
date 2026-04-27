#!/usr/bin/env bash
set -euo pipefail

# Demo test 2:
# Submit 1 zip submission for each language-specific zip-payload test grader.
#
# Prereqs:
# - Push graders: ./scripts/push-test-graders.sh
# - Register image configs: ./scripts/submit-test-grader-jobs.sh (or manually POST /images)
# - Have BASE_URL + SERVICE_API_KEY set (see scripts/README.md)

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

BASE_URL="${BASE_URL:-}"
SERVICE_API_KEY="${SERVICE_API_KEY:-}"
if [[ -z "$BASE_URL" || -z "$SERVICE_API_KEY" ]]; then
  echo "ERROR: BASE_URL and SERVICE_API_KEY are required" >&2
  exit 2
fi

OWNER="${GHCR_OWNER:-sytraore}"
REPO="${GHCR_REPO:-job-queue-scheduler}"

JAVA_ZIP_TAG="ghcr.io/${OWNER}/${REPO}/test-grader-java8-zip:latest"
PY_ZIP_TAG="ghcr.io/${OWNER}/${REPO}/test-grader-python-zip:latest"
CPP_ZIP_TAG="ghcr.io/${OWNER}/${REPO}/test-grader-cpp-zip:latest"
C_ZIP_TAG="ghcr.io/${OWNER}/${REPO}/test-grader-c-zip:latest"

./test-graders/java8/make-sample-zip-submission.sh
./test-graders/python/make-sample-zip-submission.sh
./test-graders/cpp/make-sample-zip-submission.sh
./test-graders/c/make-sample-zip-submission.sh

echo "Submitting 4 zip-payload demo jobs..."

BASE_URL="$BASE_URL" SERVICE_API_KEY="$SERVICE_API_KEY" \
  ./scripts/submit-n-jobs.sh 1 "$JAVA_ZIP_TAG" "test-graders/java8/sample-submission-java8.zip"

BASE_URL="$BASE_URL" SERVICE_API_KEY="$SERVICE_API_KEY" \
  ./scripts/submit-n-jobs.sh 1 "$PY_ZIP_TAG" "test-graders/python/sample-submission-python.zip"

BASE_URL="$BASE_URL" SERVICE_API_KEY="$SERVICE_API_KEY" \
  ./scripts/submit-n-jobs.sh 1 "$CPP_ZIP_TAG" "test-graders/cpp/sample-submission-cpp.zip"

BASE_URL="$BASE_URL" SERVICE_API_KEY="$SERVICE_API_KEY" \
  ./scripts/submit-n-jobs.sh 1 "$C_ZIP_TAG" "test-graders/c/sample-submission-c.zip"

echo ""
echo "Done. Use GET /api/v1/jobs/<id>/payload to download payload zip files."

