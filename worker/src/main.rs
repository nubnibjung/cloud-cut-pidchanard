use std::time::Duration;

use sqlx::postgres::PgPoolOptions;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use worker::{processor::Processor, queue::JobQueue};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::registry()
        .with(tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "worker=info".into()))
        .with(tracing_subscriber::fmt::layer())
        .init();

    let database_url = std::env::var("DATABASE_URL").unwrap_or_else(|_| "postgres://cloudcut:cloudcut@localhost:5432/cloudcut".to_string());
    let poll_ms = std::env::var("WORKER_POLL_MS").ok().and_then(|value| value.parse().ok()).unwrap_or(1000);
    let pool = PgPoolOptions::new().max_connections(5).connect(&database_url).await?;
    let queue = JobQueue::new(pool.clone());
    let processor = Processor::new(pool);

    loop {
        if let Some(job) = queue.claim_next().await? {
            let result = processor.process(&job).await;
            queue.finish(job, result).await?;
        } else {
            tokio::time::sleep(Duration::from_millis(poll_ms)).await;
        }
    }
}
