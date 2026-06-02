use sqlx::{migrate::Migrator, postgres::PgPoolOptions, PgPool};

static MIGRATOR: Migrator = sqlx::migrate!("./migrations");

pub async fn connect(database_url: &str) -> anyhow::Result<PgPool> {
    let pool = PgPoolOptions::new()
        .max_connections(10)
        .connect(database_url)
        .await?;

    MIGRATOR.run(&pool).await?;
    Ok(pool)
}
