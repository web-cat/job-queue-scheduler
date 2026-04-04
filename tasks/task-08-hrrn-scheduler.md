# Task 8: HRRN Scheduler Service

**Status:** Not Started
**Assignee:** (pick up)
**Priority:** HIGH — core scheduling logic
**Dependencies:** Task 1 (schema must exist)

## Context

This is the algorithmic core of the system. Read `/docs/ARCHITECTURE.md` for the HRRN explanation and the strategy pattern design.

## What to Build

### 1. Strategy Interface: `app/services/strategies/scheduler_strategy.ts`

```typescript
export interface SchedulerStrategy {
  dequeueNext(workerId: string): Promise<Job | null>
}
```

### 2. HRRN Strategy: `app/services/strategies/hrrn_strategy.ts`

Implement `dequeueNext(workerId)`:
- Execute the raw SQL HRRN dequeue query (see `/docs/DATABASE.md` for the exact query)
- Use `FOR UPDATE SKIP LOCKED` to prevent race conditions
- Set status = 'processing', started_at = NOW(), worker_pod_name = workerId
- Log the hrrn_score_at_dequeue
- Return the dequeued job or null if queue is empty

### 3. FIFO Strategy: `app/services/strategies/fifo_strategy.ts`

Same interface but ORDER BY `submitted_at ASC` instead of HRRN score. This is the fallback strategy.

### 4. Priority Strategy: `app/services/strategies/priority_strategy.ts`

ORDER BY `priority DESC, submitted_at ASC`. Higher priority first, ties broken by who submitted first.

### 5. Scheduler Service: `app/services/scheduler_service.ts`

```typescript
export class SchedulerService {
  private strategy: SchedulerStrategy

  async initialize(): Promise<void> {
    // Read scheduler_strategy from system_settings
    // Instantiate the appropriate strategy
  }

  async dequeueNext(workerId: string): Promise<Job | null> {
    // Refresh strategy from system_settings (allows runtime switching)
    // Delegate to active strategy
  }

  async getActiveStrategy(): Promise<string> {
    // Read from system_settings
  }
}
```

The service should re-read the `scheduler_strategy` setting periodically (e.g., every 10 dequeue calls or every 30 seconds) so that switching strategies via the API takes effect without restart.

### 6. Tests

Write tests that verify:
- HRRN ordering: a job waiting 60s with burst 10s (ratio 7.0) is dequeued before a job waiting 10s with burst 10s (ratio 2.0)
- FIFO ordering: earliest submitted_at is dequeued first regardless of burst time
- Priority ordering: highest priority first, ties broken by submitted_at
- Concurrent dequeue: 5 simultaneous calls each get a different job (SKIP LOCKED test)
- Strategy switching: change system_settings, verify next dequeue uses new strategy
- Empty queue: dequeueNext returns null

## Acceptance Criteria

- [ ] HRRN strategy correctly orders jobs by response ratio
- [ ] FIFO strategy orders by submission time
- [ ] Priority strategy orders by priority then submission time
- [ ] `FOR UPDATE SKIP LOCKED` prevents duplicate dequeues under concurrency
- [ ] Strategy can be switched at runtime via system_settings
- [ ] Empty queue returns null without errors
