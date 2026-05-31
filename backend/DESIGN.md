# Backend and Database Design

## Technology Choices

Axum is used because its extractor model keeps authentication, validation, and state injection explicit while still composing cleanly with Tower middleware for request IDs, tracing, CORS, and future rate limiting.

SQLx is used with raw SQL migrations. This gives reviewer-visible schema design, keeps PostgreSQL-specific indexes and constraints first-class, and avoids ORM abstraction around JSONB, partial indexes, and queue claims.

The queue uses a PostgreSQL job table in this prototype. It is durable, transactional with API writes, easy to test, and sufficient for the challenge scope. Redis remains in docker-compose for rate limits and a future Redis Streams migration when throughput becomes the bottleneck.

## Normalization and Denormalization

Users, workspaces, memberships, projects, assets, tracks, clips, effects, exports, and jobs are normalized so authorization and cleanup have clear ownership boundaries.

JSONB is intentionally used for flexible editor data: project settings, asset metadata, clip transform, effect params, text positions, and operation payloads. These fields change often during product iteration and are normally fetched as part of larger timeline documents.

## Soft Delete and Cleanup

User-facing destructive actions set `deleted_at`. List queries filter `deleted_at IS NULL`, and partial indexes keep active reads fast. The worker cleanup job permanently removes projects after 30 days, exports after expiry, orphaned assets after 7 days, and deleted accounts after 90 days.

Foreign keys use `ON DELETE CASCADE` only where hard cleanup is correct: workspace-owned children and timeline-owned children. Soft delete is still the public behavior.

## Timeline Position

`track_position_ms` is stored as milliseconds because video editing actions snap to time, not pixels. Pixels are only a zoom-dependent UI projection. Milliseconds make export ordering, snap, trim, and collaboration payloads deterministic.

## Operation Log Growth

Operation logs grow fastest. For production, partition by month or by hash(project_id) plus monthly range, retain recent partitions hot, and archive old partitions to object storage. Reconnect reads use `(project_id, server_seq)`; audit/archive reads use `(project_id, created_at)`.

## Estimated Rows

For 1,000 users with 10 projects each and 30 clips per project:

- users: 1,000
- workspaces: roughly 1,000
- projects: 10,000
- tracks: 40,000 at 4 tracks/project
- clips: 300,000
- clip_effects: 300,000 to 900,000 depending on effect usage
- assets: 100,000 to 300,000 depending reuse
- operation_logs: millions; assume 100 operations/project/day means 1,000,000 rows/day

## Concurrency

Timeline writes run in transactions and write a monotonic `server_seq`. Conflict resolution is last-write-wins using server sequence. Property-level merge is possible by limiting PATCH payloads to changed fields. Clients reconcile optimistic state when the server operation arrives.

## Pagination

Cursor pagination uses stable sort keys such as `(updated_at, id)` for projects and `(created_at, id)` for exports. The cursor encodes the last seen tuple; subsequent queries use it as a strict boundary.

## Upload Flow

The backend issues a presigned URL or local upload target, the browser uploads directly to storage, then `confirm-upload` creates an `assets` row and processing jobs. Uploading through the backend is avoided because it ties API capacity to large file transfer duration and increases memory/bandwidth pressure.

## Batch Operations

Batch clip operations should be atomic for editor consistency. Partial success makes undo, operation logs, and remote sync ambiguous.

## API Versioning

Breaking changes should move under `/v2` while compatible response additions stay in `/v1`. Operation event payloads should carry explicit `schemaVersion`.

## Authorization

Authentication lives in an extractor. Workspace role checks live in service/query functions because project-scoped resources need database context. Middleware remains responsible for cross-cutting concerns like request ID and tracing.

## Errors

The API uses typed `AppError` and converts each error into a consistent JSON response with status code, category, message, and request ID.
