#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if ! command -v gh >/dev/null 2>&1; then
  echo "ERROR: gh is not installed. Install GitHub CLI first." >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: docker is not installed." >&2
  exit 1
fi

OWNER="${GHCR_OWNER:-sytraore}"
REPO="${GHCR_REPO:-job-queue-scheduler}"
PLATFORM="${PLATFORM:-linux/amd64}"

echo "Logging into GHCR using gh auth token..."
gh auth token | docker login ghcr.io -u "$OWNER" --password-stdin

echo "Building & pushing test graders to ghcr.io/${OWNER}/${REPO} (platform=${PLATFORM})"

build_and_push() {
  local name="$1"
  local context="$2"
  local dockerfile="$3"
  local tag="ghcr.io/${OWNER}/${REPO}/${name}:latest"

  echo ""
  echo "==> ${tag}"
  docker buildx build --platform "$PLATFORM" \
    -t "$tag" \
    -f "$dockerfile" "$context" \
    --push
}

build_and_push "test-grader-java8"  "test-graders/java8"  "test-graders/java8/Dockerfile"
build_and_push "test-grader-java8-zip"  "test-graders/java8-zip"  "test-graders/java8-zip/Dockerfile"
build_and_push "test-grader-python-zip" "test-graders/python-zip" "test-graders/python-zip/Dockerfile"
build_and_push "test-grader-cpp-zip"    "test-graders/cpp-zip"    "test-graders/cpp-zip/Dockerfile"
build_and_push "test-grader-c-zip"      "test-graders/c-zip"      "test-graders/c-zip/Dockerfile"
build_and_push "test-grader-python" "test-graders/python" "test-graders/python/Dockerfile"
build_and_push "test-grader-cpp"    "test-graders/cpp"    "test-graders/cpp/Dockerfile"
build_and_push "test-grader-c"      "test-graders/c"      "test-graders/c/Dockerfile"

echo ""
echo "Done."

