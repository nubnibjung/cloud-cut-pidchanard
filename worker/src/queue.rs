use chrono::{DateTime, Duration, Utc};
use serde_json::Value;
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

use crate::error::WorkerResult;

#[derive(Debug, Clone, FromRow)]
pub struct Job {
    pub id: Uuid,
    pub kind: String,
    pub payload: Value,
    pub attempts: i32,
    pub max_attempts: i32,
}

#[derive(Clone)]
pub struct JobQueue {
    pool: PgPool,
}

impl JobQueue {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    pub async fn claim_next(&self) -> WorkerResult<Option<Job>> {
        let mut tx = self.pool.begin().await?;
        let job = sqlx::query_as::<_, Job>(
            "SELECT id, kind, payload, attempts, max_attempts
             FROM processing_jobs
             WHERE status IN ('queued', 'failed') AND next_run_at <= now()
             ORDER BY created_at
             FOR UPDATE SKIP LOCKED
             LIMIT 1",
        )
        .fetch_optional(&mut *tx)
        .await?;

        if let Some(job) = &job {
            sqlx::query("UPDATE processing_jobs SET status = 'processing', attempts = attempts + 1, updated_at = now() WHERE id = $1")
                .bind(job.id)
                .execute(&mut *tx)
                .await?;
        }
        tx.commit().await?;
        Ok(job)
    }

    pub async fn finish(&self, job: Job, result: WorkerResult<()>) -> WorkerResult<()> {
        match result {
            Ok(()) => {
                sqlx::query("UPDATE processing_jobs SET status = 'completed', error_message = NULL, updated_at = now() WHERE id = $1")
                    .bind(job.id)
                    .execute(&self.pool)
                    .await?;
            }
            Err(err) => {
                let next_attempt = job.attempts + 1;
                let error_message = err.to_string();
                if next_attempt >= job.max_attempts {
                    sqlx::query("UPDATE processing_jobs SET status = 'dead_letter', error_message = $2, updated_at = now() WHERE id = $1")
                        .bind(job.id)
                        .bind(error_message)
                        .execute(&self.pool)
                        .await?;
                } else {
                    sqlx::query("UPDATE processing_jobs SET status = 'failed', next_run_at = $2, error_message = $3, updated_at = now() WHERE id = $1")
                        .bind(job.id)
                        .bind(next_run_at(next_attempt))
                        .bind(error_message)
                        .execute(&self.pool)
                        .await?;
                }
            }
        }
        Ok(())
    }
}

pub fn backoff_seconds(attempt: i32) -> i64 {
    match attempt {
        0 | 1 => 1,
        2 => 4,
        _ => 16,
    }
}

pub fn next_run_at(attempt: i32) -> DateTime<Utc> {
    Utc::now() + Duration::seconds(backoff_seconds(attempt))
}
