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

Registers image configs for the 4 graders and submits 4 jobs using sample submissions.

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

