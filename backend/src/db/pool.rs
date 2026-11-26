use sqlx::{migrate::Migrator, postgres::PgPoolOptions, PgPool};

static MIGRATOR: Migrator = sqlx::migrate!("./migrations");

pub async fn connect(database_url: &str) -> anyhow::Result<PgPool> {
    let pool = PgPoolOptions::new()
        .max_connections(10)
        // Opening a Postgres connection (TLS + SCRAM handshake) is slow next to a
        // query. Keep a few ready so a burst of parallel requests — opening a
        // project, creating several tracks — never waits on new connections.
        .min_connections(5)
        .connect(database_url)
        .await?;

    MIGRATOR.run(&pool).await?;
    Ok(pool)
}
