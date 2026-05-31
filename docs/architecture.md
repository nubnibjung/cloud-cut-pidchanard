# Architecture

CloudCut uses a service boundary between the interactive editor and video processing.

```text
Client
  -> Axum REST API
  -> PostgreSQL transactional state
  -> processing_jobs queue table
  -> Worker
  -> ffmpeg/ffprobe
  -> Storage URL
  -> Pusher event
```

The prototype chooses a PostgreSQL job table because it keeps migrations, idempotency, retries, audit, and tests in one durable system. Redis remains available for rate limits and future high-throughput stream processing.
