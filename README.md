# CloudCut

Collaborative browser video editor prototype built with Rust, PostgreSQL, Redis, ffmpeg, React 19, shadcn-style UI primitives, Zustand, and Pusher-ready collaboration hooks.

## Tech Stack

- Backend: Rust, Axum, SQLx, PostgreSQL, JWT, Argon2, utoipa, tracing
- Worker: Rust, Tokio, PostgreSQL job table queue, ffmpeg/ffprobe CLI
- Frontend: React 19, TypeScript strict, Vite, Tailwind CSS, Zustand, Vitest
- Infra: Docker Compose for PostgreSQL and Redis

## Setup
Prerequisites
- [Rust](https://rust-lang.org/learn/get-started/)
- [Docker](https://docs.docker.com/desktop/setup/install/windows-install/)

```bash
docker compose up -d postgres redis
cargo install sqlx-cli --no-default-features --features postgres
cargo sqlx migrate run --source backend/migrations
cargo run -p backend
cargo run -p worker
cd frontend
pnpm install
pnpm dev
```

## Environment

See [.env.example](.env.example).

## Architecture

```text
React Editor -> Rust API -> PostgreSQL
                 |    |
                 |    +-> Pusher events
                 v
          processing_jobs table -> Rust worker -> ffmpeg -> local storage/S3-compatible URL
```

API docs are exposed at `/docs` when the backend is running.

## Current Prototype Scope

- Database migrations and seed data cover users, workspaces, assets, timeline, exports, jobs, and operations.
- Backend includes auth, project listing/detail, clip mutation with operation logging, asset confirm-upload job enqueue, export enqueue, auth/role helpers, request IDs, and typed errors.
- Worker includes retry/idempotency logic, ffmpeg command execution helpers, asset/export pipeline structure, and cleanup summary.
- Frontend includes editor layout, timeline tracks/clips, drag/trim/split/delete, playhead, zoom/snap helpers, inspector, asset browser, undo/redo, collaboration hooks, and tests.

## Known Limitations

- Storage is implemented as URL generation/local output placeholders; production R2/S3 signing should replace it.
- Pusher publishing is isolated behind a client boundary and can run disabled for local development.
- Export supports a basic single primary video track render path.

## Future Improvements

- Add multi-track compositing and text overlay rendering.
- Add Playwright E2E and CI.
- Replace operation last-write-wins with Yjs/Automerge for richer offline collaboration.
