# Test graders (for E2E + payload testing)

These images are **language-specific graders** intended to validate:

- that the grading container can compile/run code in the language runtime/toolchain
- that a small built-in **unit test suite** can be executed
- that the grader produces both:
  - `/grading/output/results.json` (parsed by the execution-service)
  - `/grading/output/payload-<lang>.txt` (stored as payload and served by `/api/v1/jobs/:id/payload`)

All graders:

- run as **non-root** (UID 10001)
- use `/tmp` for compilation/work because the pod has `readOnlyRootFilesystem: true`
- treat `/grading/submission` as read-only input

## Images

- `java8/` — Java 8 (old)
- `python/` — Python 3 (unittest)
- `cpp/` — g++ (C++)
- `c/` — gcc (C)

## Expected submission shape

These graders are for **testing** and therefore expect very simple submissions.

- **Java 8**: `Calculator.java` with:
  - `public static int add(int a, int b)`
  - `public static int sub(int a, int b)`
- **Python**: `submission.py` with:
  - `def add(a, b):`
  - `def sub(a, b):`
- **C**: `submission.c` with:
  - `int add(int a, int b);`
  - `int sub(int a, int b);`
- **C++**: `submission.cpp` with:
  - `int add(int a, int b);`
  - `int sub(int a, int b);`

If the expected file/symbols are missing, the grader marks the job failed and writes details into the payload file.

## Build + push

```bash
chmod +x scripts/*.sh
./scripts/push-test-graders.sh
```

## Register image configs + submit jobs

The helper script reads `SERVICE_API_KEY` from your environment. If you keep it in `execution-service/.env`:

```bash
cd execution-service
set -a
source .env
set +a
cd ..

BASE_URL="https://web-cat-execution-service.discovery.cs.vt.edu/api/v1" \
./scripts/submit-test-grader-jobs.sh
```

