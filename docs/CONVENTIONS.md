# Code Conventions

## Project Structure

```
execution-service/
├── app/
│   ├── controllers/          # HTTP request handlers (thin, delegate to services)
│   │   ├── jobs_controller.ts
│   │   ├── queue_controller.ts
│   │   ├── images_controller.ts
│   │   ├── config_controller.ts
│   │   ├── metrics_controller.ts
│   │   └── health_controller.ts
│   ├── models/               # Lucid ORM models
│   │   ├── job.ts
│   │   ├── job_result.ts
│   │   ├── image_config.ts
│   │   ├── system_setting.ts
│   │   └── callback_log.ts
│   ├── services/             # Business logic (this is where the real work happens)
│   │   ├── scheduler_service.ts
│   │   ├── job_lifecycle_service.ts
│   │   ├── dispatcher_service.ts
│   │   ├── file_service.ts
│   │   ├── callback_service.ts
│   │   ├── metrics_service.ts
│   │   ├── k8s_service.ts
│   │   └── strategies/
│   │       ├── scheduler_strategy.ts    # Interface
│   │       ├── hrrn_strategy.ts
│   │       ├── fifo_strategy.ts
│   │       └── priority_strategy.ts
│   ├── validators/           # Request validation (VineJS)
│   │   ├── job_validator.ts
│   │   ├── image_config_validator.ts
│   │   └── config_validator.ts
│   └── exceptions/           # Custom error classes
│       └── handler.ts
├── database/
│   └── migrations/           # Lucid migrations (numbered, never edit existing ones)
├── config/                   # AdonisJS config files
├── start/
│   └── routes.ts             # All route definitions
├── providers/
│   └── api_provider.ts       # Response wrapper (already exists)
└── tests/
```

## Naming Conventions

- **Files:** `snake_case.ts` (e.g., `jobs_controller.ts`, `scheduler_service.ts`)
- **Classes:** `PascalCase` (e.g., `JobsController`, `SchedulerService`)
- **Methods/functions:** `camelCase` (e.g., `dequeueNextJob`, `markCompleted`)
- **Database columns:** `snake_case` (e.g., `submitted_at`, `docker_image_tag`)
- **Route paths:** `kebab-case` or `camelCase` as per AdonisJS convention
- **Constants:** `UPPER_SNAKE_CASE` (e.g., `MAX_FILE_SIZE`)

## Controller Pattern

Controllers are thin. They parse the request, call a service, and return the response. No business logic in controllers.

```typescript
// Good
export default class JobsController {
  async store({ request, response }: HttpContext) {
    const payload = await request.validateUsing(createJobValidator)
    const job = await jobLifecycleService.submitJob(payload)
    return response.created(job)
  }
}

// Bad — business logic in the controller
export default class JobsController {
  async store({ request, response }: HttpContext) {
    const imageConfig = await ImageConfig.findByOrFail('docker_image_tag', request.input('docker_image_tag'))
    if (!imageConfig.isActive) throw new Error('...')
    const job = await Job.create({ ... })
    // ... 30 more lines of logic
  }
}
```

## Service Pattern

Services contain all business logic. They are plain TypeScript classes. They interact with models and other services.

```typescript
export class JobLifecycleService {
  async submitJob(payload: CreateJobPayload): Promise<Job> {
    // Validate image config exists and is active
    // Store files to disk
    // Create job record
    // Return job with queue position
  }

  async markCompleted(jobId: number, results: JobResults, actualRuntime: number): Promise<void> {
    // Update job status
    // Insert job_results
    // Update image_configs rolling average
  }
}
```

## Validation

Use VineJS validators (AdonisJS built-in) for all request validation.

```typescript
import vine from '@vinejs/vine'

export const createJobValidator = vine.compile(
  vine.object({
    docker_image_tag: vine.string().trim().maxLength(255),
    submission_id: vine.number(),
    callback_url: vine.string().url().optional(),
    user_id: vine.number().optional(),
    course_id: vine.number().optional(),
    assignment_name: vine.string().maxLength(255).optional(),
    priority: vine.number().min(1).max(10).optional(),
  })
)
```

## Error Handling

Use the existing exception handler. All errors return consistent JSON:

```json
{
  "error": {
    "code": "JOB_NOT_FOUND",
    "message": "Job with ID 142 not found"
  }
}
```

Define custom exception classes for domain errors:

```typescript
export class JobNotFoundException extends Exception {
  static status = 404
  static code = 'JOB_NOT_FOUND'
}
```

## Database Access

- Use Lucid models for all standard queries
- Raw SQL is only acceptable for the HRRN dequeue query (too complex for the query builder)
- Always use transactions when updating multiple tables together
- Never use `SELECT *` in raw queries — list columns explicitly

## Environment Variables

- All config values come from environment variables
- Use AdonisJS `env.ts` for type-safe env access
- Never hardcode database URLs, credentials, or paths
- `.env.example` must document every variable

## Response Format

The existing API provider wraps all responses in `{ data: ... }`. Do not manually wrap responses. Just return the data from your controller and the provider handles the rest.

For error responses, throw exceptions — the exception handler formats them consistently.

## Migrations

- Never edit an existing migration file
- Create new migration files for schema changes
- Name format: `XXXXXX_create_table_name.ts` or `XXXXXX_add_column_to_table.ts`
- Always include both `up()` and `down()` methods
- Test that `down()` actually reverses `up()` cleanly

## Git Conventions

- Branch naming: `feature/task-XX-short-description` (e.g., `feature/task-03-job-submission`)
- Commit messages: present tense, descriptive (e.g., "Add job submission endpoint with file upload")
- PRs require at least one review before merging
- Keep PRs focused on one task — don't mix features

## Testing

- Write tests alongside the feature, not as a separate task
- Integration tests go in `tests/functional/`
- Unit tests for services go in `tests/unit/`
- Use the AdonisJS test runner (Japa)
- Every endpoint should have at least one happy-path test and one error test
