use backend::{app::build_router, config::Config, db::pool::connect};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::registry()
        .with(tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "backend=info,tower_http=info".into()))
        .with(tracing_subscriber::fmt::layer())
        .init();

    let config = Config::from_env();
    let pool = connect(&config.database_url).await?;
    let app = build_router(config.clone(), pool.clone());
    tokio::spawn(backend::worker::run(pool, config.clone()));
    let listener = tokio::net::TcpListener::bind(&config.api_addr).await?;
    tracing::info!(addr = %config.api_addr, "backend listening");
    axum::serve(listener, app).await?;
    Ok(())
}
