# job-queue-scheduler


## Pre-req:
    - Have Docker Desktop installed

## Get Started
- Clone repo
- Go to the **execution service** directory 
```bash
cd execution-service
```
- Create `.env` file
- Copy & Paste content of `.env.example` into new `.env` file
- Fill `.env` file
    - Reach out to **Sy** for APP_KEY and db secret credentials missing on the `.env.example` file
- Start docker desktop app
- Run this command:
```bash
docker compose -f docker-compose.dev.yml up --build
```
Use `--build` the first time or after Dockerfile / dependency changes so the image is up to date.

   - If you already built the app and there is no image/dependency changes, run just:
```bash 
docker compose -f docker-compose.dev.yml up
``` 
- In another terminal, run:
```bash
docker compose -f docker-compose.dev.yml exec app node ace migration:run
```
  - Run this command only the first time and everytime the migration files change.

## Useful Commands
### To view database and make some queries in the terminal (make sure to replace the DB_USER and DB_NAME with the actual values), run this command (it uses psql which is CLI for databases):
```bash
docker compose -f docker-compose.dev.yml exec database_service psql -U DB_USER -d DB_NAME
```
- **Note**: `\q — quit` to stop being in mode database view (psql)

### To stop the running database container, run:
```bash
docker compose -f docker-compose.dev.yml stop database_service
```

### To stop and remove the running database container, run:
```bash
docker compose -f docker-compose.dev.yml rm -sf database_service
```

### To stop all running containers, run:
```bash
docker compose -f docker-compose.dev.yml down
```

### To stop all running containers and delete the database volume (wipes Postgres data), run:
```bash
docker compose -f docker-compose.dev.yml down -v
```
