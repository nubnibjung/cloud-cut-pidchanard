FROM rust:1.88-bookworm AS builder

WORKDIR /app

COPY Cargo.toml Cargo.lock ./
COPY backend/Cargo.toml backend/Cargo.toml
COPY worker/Cargo.toml worker/Cargo.toml
COPY backend backend
COPY worker worker

RUN cargo build --release --locked -p backend -p worker

FROM debian:bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /app/target/release/backend /usr/local/bin/backend
COPY --from=builder /app/target/release/worker /usr/local/bin/worker

RUN mkdir -p uploads tmp

EXPOSE 8080

CMD ["backend"]
