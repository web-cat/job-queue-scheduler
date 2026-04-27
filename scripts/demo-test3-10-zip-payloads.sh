#!/usr/bin/env bash
set -euo pipefail

# Demo test 3:
# Submit 10 zip submissions to the same zip-payload grader image.
#
# Prereqs:
# - Push graders: ./scripts/push-test-graders.sh
# - Register image config for test-grader-java8-zip (via ./scripts/submit-test-grader-jobs.sh)

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

./test-graders/java8/make-sample-zip-submission.sh

COUNT="${COUNT:-10}"
CONCURRENCY="${CONCURRENCY:-5}"
OUT_DIR="${OUT_DIR:-./tmp/demo-test3}"

BASE_URL="$BASE_URL" SERVICE_API_KEY="$SERVICE_API_KEY" \
  COUNT="$COUNT" CONCURRENCY="$CONCURRENCY" OUT_DIR="$OUT_DIR" \
  ./scripts/submit-n-jobs.sh "$COUNT" "$JAVA_ZIP_TAG" "test-graders/java8/sample-submission-java8.zip"

echo ""
echo "Job IDs saved to ${OUT_DIR}/job_ids.txt"

