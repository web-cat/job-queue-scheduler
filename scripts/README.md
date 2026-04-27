# Scripts

## Build + push test grader images

Uses GitHub CLI auth (`gh auth token`) to login to GHCR, then builds/pushes all `test-graders/*` images.

```bash
chmod +x scripts/*.sh
./scripts/push-test-graders.sh
```

Optional env vars:
- `GHCR_OWNER` (default `sytraore`)
- `GHCR_REPO` (default `job-queue-scheduler`)
- `PLATFORM` (default `linux/amd64`)

## Register image configs + submit test jobs

Registers image configs for the repo’s test graders and submits a small set of sample jobs.

```bash
# Load SERVICE_API_KEY from execution-service/.env
cd execution-service
set -a
source .env
set +a
cd ..

BASE_URL="https://web-cat-execution-service.discovery.cs.vt.edu/api/v1" \
./scripts/submit-test-grader-jobs.sh
```

## Register image configs only (DB storage)

Registers all test grader image configs in the DB (no job submissions). Idempotent; `409` means the config already exists.

```bash
# Load SERVICE_API_KEY from execution-service/.env
cd execution-service
set -a
source .env
set +a
cd ..

BASE_URL="https://web-cat-execution-service.discovery.cs.vt.edu/api/v1" \
./scripts/register-image-configs.sh
```


## Load test: submit 200 Java8 jobs

Submits the Java8 test grader job `COUNT` times with up to `CONCURRENCY` requests in flight.

```bash
# Load SERVICE_API_KEY from execution-service/.env
cd execution-service
set -a
source .env
set +a
cd ..

BASE_URL="https://web-cat-execution-service.discovery.cs.vt.edu/api/v1" \
COUNT=200 \
CONCURRENCY=25 \
./scripts/load-test-submit-java8.sh
```

Notes:
- If you see `http=404` failures from `POST /jobs`, it usually means the `docker_image_tag` is not registered in `image_configs` yet.
  - Fix: run `./scripts/submit-test-grader-jobs.sh` once (it registers the image configs), or set `AUTO_REGISTER_IMAGE=1` for the load test script.

## Submit N jobs for a grader (generic)

Submits `count` jobs for the given `docker_image_tag` using either a file or a directory:
- If `input_path` is a **directory**, the script zips it once and uploads it as a single `.zip` submission (preserves folder structure).
- If `input_path` is a **file**, it uploads it as-is.

```bash
BASE_URL="https://web-cat-execution-service.discovery.cs.vt.edu/api/v1" \
CONCURRENCY=10 \
OUT_DIR=./tmp/submit-n \
./scripts/submit-n-jobs.sh 10 "ghcr.io/sytraore/job-queue-scheduler/test-grader-java8-zip:latest" \
  "test-graders/java8/sample-submission-java8.zip"
```

## Demo tests
First run:

- **Test 1 (4 languages, flat files)**: use 
```bash
BASE_URL="https://web-cat-execution-service.discovery.cs.vt.edu/api/v1" \
./scripts/submit-test-grader-jobs.sh
```
- **Test 2 (1 zip submission, zip payload artifacts)**:
  - Submit 4 zip jobs (Java/Python/C/C++):  
```bash
BASE_URL="https://web-cat-execution-service.discovery.cs.vt.edu/api/v1" \
./scripts/demo-test2-zip-payloads.sh
```
- **Test 3 (10 zip submissions, same grader, zip payloads)**:
```bash
BASE_URL="https://web-cat-execution-service.discovery.cs.vt.edu/api/v1" \
COUNT=10 CONCURRENCY=5 \
./scripts/demo-test3-10-zip-payloads.sh
```

