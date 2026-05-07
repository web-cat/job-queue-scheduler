# Job Queue Scheduler (Web-CAT Execution Service)

Kubernetes-based grading-as-a-service backend for Web-CAT. It accepts grading jobs, queues them in Postgres, runs each job in an isolated Kubernetes Job (one pod per submission), stores results, and optionally POSTs results back to a callback URL.

## High-level flow

- **1) Build + push grader image**: A language/assignment-specific grader container must exist in a registry (ex: GHCR).
- **2) Register the grader image in the DB**: Before the API will accept submissions for an image tag, that tag must be stored in the `image_configs` table via `POST /api/v1/images`.
- **3) Submit jobs**: Clients submit `POST /api/v1/jobs` with files (or a single zip) + the `docker_image_tag`. The dispatcher later schedules and runs the grading job.
- **4) Get results**: Poll `GET /api/v1/jobs/:id` or `GET /api/v1/jobs/:id/results`. If a `callback_url` was provided, the service will POST results back when the job completes.

## Local development (Docker Compose)

## Get Started (onboarding)

If you're new to the repo, follow this checklist end-to-end.

### Pre-req

- Have Docker Desktop installed

### Steps

- Clone this repo
- Go to the **execution service** directory:

```bash
cd execution-service
```

- Create a `.env` file:
  - Copy & paste the contents of `.env.example` into a new `.env`
  - Fill out the values (reach out to Sy for values)
- Start Docker Desktop
- Start the stack (use `--build` the first time, or after dependency/Dockerfile changes):

```bash
docker compose -f docker-compose.dev.yml up --build
```

- If you already built previously and nothing changed, you can run:

```bash
docker compose -f docker-compose.dev.yml up
```

- In another terminal, run DB migrations (first time, and whenever migrations change):

```bash
docker compose -f docker-compose.dev.yml exec app node ace migration:run
```

## Deployment on Discovery

See `infra/README.md` for:
- how to redeploy Postgres and the API+dispatcher on Discovery
- how to build/push the API image
- how to wipe PVC contents for a fresh restart

## Tests

Run the Adonis/Japa tests (functional + unit) from the `execution-service` package:

```bash
cd execution-service
docker compose -f docker-compose.dev.yml up
```
In another terminal, run:
```bash
cd execution-service
npm test
```

## Useful local commands

Connect to Postgres with `psql` (replace `DB_USER` and `DB_NAME`):

```bash
docker compose -f docker-compose.dev.yml exec database_service psql -U DB_USER -d DB_NAME
```

Stop containers:

```bash
docker compose -f docker-compose.dev.yml down
```

Wipe local Postgres data (deletes the Compose volume):

```bash
docker compose -f docker-compose.dev.yml down -v
```
