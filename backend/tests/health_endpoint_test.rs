use axum::{body::Body, http::{Request, StatusCode}};
use backend::{app::build_router, config::Config};
use sqlx::postgres::PgPoolOptions;
use tower::ServiceExt;

#[tokio::test]
async fn health_endpoint_returns_ok() {
    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect_lazy("postgres://cloudcut:cloudcut@localhost:5432/cloudcut")
        .unwrap();
    let app = build_router(Config::from_env(), pool);
    let response = app
        .oneshot(Request::builder().uri("/health").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
}
