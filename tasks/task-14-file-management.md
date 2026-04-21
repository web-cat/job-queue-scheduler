# Task 14: File Management Service

**Status:** Started
**Assignee:** Sy
**Priority:** MEDIUM
**Dependencies:** Task 1

## What to Build

### Service: `app/services/file_service.ts`

**`storeSubmissionFiles(jobId, files)`**
- Create directory: `/data/submissions/{jobId}/input/`
- Move each uploaded file into the directory
- Validate: total upload size doesn't exceed a configurable limit (e.g., 50MB)
- Return the full path to the input directory

**`prepareOutputDirectory(jobId)`**
- Create directory: `/data/submissions/{jobId}/output/`
- Ensure it's writable
- Return the full path

**`getInputPath(jobId)`** — Returns `/data/submissions/{jobId}/input/`

**`getOutputPath(jobId)`** — Returns `/data/submissions/{jobId}/output/`

**`readResults(jobId)`**
- Read `/data/submissions/{jobId}/output/results.json`
- Parse as JSON
- Validate it has the expected fields (correctness_score, tool_score, etc.)
- If file is missing: throw a descriptive error
- If file is malformed JSON: throw a descriptive error
- If file is too large (>1MB): truncate test_output and comments fields
- Return the parsed results

**`cleanupSubmission(jobId)`**
- Delete the entire `/data/submissions/{jobId}/` directory recursively
- Handle "directory not found" gracefully (already cleaned up)
- Log the cleanup

**`getSubmissionDiskUsage()`**
- Return total disk usage of `/data/submissions/` in bytes
- Useful for metrics and monitoring

**`cleanupOrphanedDirectories(activeJobIds)`**
- List all directories in `/data/submissions/`
- For each directory, check if the job ID is in the activeJobIds set
- Delete directories that don't have a matching active job
- Return count of directories cleaned

### Configuration

Read the base path from an environment variable:
```
SUBMISSIONS_PATH=/data/submissions
```

Default to `/data/submissions` if not set.

### Error Handling

All file operations should:
- Catch and log specific errors (ENOSPC for disk full, EACCES for permissions, ENOENT for missing files)
- Throw descriptive domain errors that the caller can handle
- Never crash the application on file system errors

### Edge Cases

- Disk full during file upload → return 507 error to the client
- results.json doesn't exist → markFailed with "Grading container did not produce results"
- results.json is empty → markFailed with "Grading container produced empty results"
- results.json has unexpected structure → extract what we can, log a warning
- Upload contains path traversal attempt (../../../etc/passwd) → reject

## Acceptance Criteria

- [ ] Files are stored in the correct directory structure
- [ ] readResults correctly parses valid results.json
- [ ] readResults handles missing, empty, and malformed results gracefully
- [ ] cleanupSubmission removes directories without errors
- [ ] Path traversal attacks are prevented
- [ ] Disk full errors are handled with appropriate error responses
- [ ] Base path is configurable via environment variable
