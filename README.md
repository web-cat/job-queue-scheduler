# job-queue-scheduler


## Pre-req:
    - Have Docker Desktop installed
    - have node 24.14.1 and npm 11.11 installed. (AdonisJS requirement).

## Get Started
- Fork repo
- Go to the **execution service** directory 
```bash
cd execution-service
```
- Create `.env` file
- Copy & Paste content of `.env.example` into new `.env` file
- Reach out to Sy for db secret credentials missing on the `.env.example` file
- Run:
```bash
node ace generate:key
```
- Copy the printed value into `APP_KEY` in `.env`.
- Install dependencies and packages
```bash
npm install
```
- Start docker desktop app
- Run this command (This will start only the database container):
```bash
docker compose up -d database_service
```
Remove the `-d` if you want logs in the terminal.
- Run:
```bash
node ace migration:run
```
- Run the project locally:
```bash
npm run dev
```
## To run app + database in Docker, run:
```bash
docker compose up --build
```

Use `--build` the first time or after Dockerfile / dependency changes so the image is up to date.

   - If you already built the app and there is no image/dependency changes, run just:
```bash 
docker compose up
``` 

## Useful Commands
### To view database and make some queries in the terminal (make sure to replace the DB_USER and DB_NAME with the actual values), run this command (it uses psql which is CLI for databases):
```bash
docker compose exec database_service psql -U DB_USER -d DB_NAME
```
- **Note**: `\q — quit` to stop being in mode database view (psql)

### To stop the running database container, run:
```bash
docker compose stop database_service
```

### To stop and remove the running database container, run:
```bash
docker compose rm -sf database_service
```

### To stop all running containers, run:
```bash
docker compose down
```

### To stop all running containers and delete the database volume (wipes Postgres data), run:
```bash
docker compose down -v
```