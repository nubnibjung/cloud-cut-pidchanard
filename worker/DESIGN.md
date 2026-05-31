# Worker Design

## Queue Choice

The prototype uses the `processing_jobs` PostgreSQL table instead of Redis Streams. This lets API writes and job enqueue happen in one transaction, gives idempotency through a unique key, and simplifies local review. Redis Streams would be the next step when job throughput or consumer group fan-out requires it.

## Retry and Dead Letter

Workers claim due jobs, mark them `processing`, then either mark `completed` or reschedule with exponential backoff. Attempts use this schedule: immediate, +1s, +4s, +16s. After `max_attempts`, the job becomes `dead_letter` with the last error message.

## Idempotency

Every API enqueue writes a deterministic `idempotency_key`. `processing_jobs.idempotency_key` is unique, so repeated requests do not create duplicate processing. Handlers also write variants/exports using deterministic paths to make re-entry safe.

## ffmpeg CLI

The CLI keeps the prototype close to real production behavior and avoids binding-level codec issues. The tradeoff is process management: temp files, command timeouts, cancellation, and parsing stderr must be handled carefully.

## Long Videos

For 30-minute videos, the worker streams through ffmpeg and writes temp files on disk instead of loading media into memory. Temp directories are scoped by job id and cleaned on success/failure. Progress should be derived from ffmpeg stderr time markers.

## Cancel

Export cancel sets `export_jobs.status = 'cancelled'`. The worker checks before each segment and before concat. A production implementation should also terminate the child process through a cancellation token.

## Scaling

Multiple workers can run safely because jobs are claimed with `FOR UPDATE SKIP LOCKED`. Concurrency is controlled per worker process and, for exports, by workspace plan limits.

## Cost Estimate

A 5-minute 1080p export generally costs one full transcode. On a small CPU VM it may run near realtime or slower, so expect 5-15 minutes CPU time plus temporary disk roughly 1-3x the final output size.
