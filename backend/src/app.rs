use axum::{
    extract::DefaultBodyLimit,
    http::{header::CACHE_CONTROL, HeaderValue},
    routing::{get, patch, post},
    Router,
};
use sqlx::PgPool;
use std::{fs, path::PathBuf, time::Duration};
use tower_http::{
    compression::CompressionLayer,
    cors::CorsLayer,
    request_id::{MakeRequestUuid, PropagateRequestIdLayer, SetRequestIdLayer},
    services::ServeDir,
    set_header::SetResponseHeader,
    trace::TraceLayer,
};

use crate::{assets, auth, collaboration, config::Config, exports, projects, storage, timeline, workspaces};

#[derive(Clone)]
pub struct AppState {
    pub config: Config,
    pub pool: PgPool,
}

pub fn build_router(config: Config, pool: PgPool) -> Router {
    let state = AppState { config, pool };

    // Ensure uploads dir exists so ServeDir doesn't panic
    let uploads_dir = PathBuf::from("uploads");
    fs::create_dir_all(&uploads_dir).ok();

    Router::new()
        // Health
        .route("/health", get(|| async { "ok" }))

        // Auth
        .route("/auth/register", post(auth::handlers::register))
        .route("/auth/login", post(auth::handlers::login))
        .route("/auth/refresh", post(auth::handlers::refresh))
        .route("/auth/me", get(auth::handlers::me))

        // Workspaces
        .route("/workspaces", get(workspaces::handlers::list).post(workspaces::handlers::create))
        .route("/workspaces/:id", get(workspaces::handlers::get).patch(workspaces::handlers::update).delete(workspaces::handlers::delete))
        .route("/workspaces/:id/pin", axum::routing::put(workspaces::handlers::pin).delete(workspaces::handlers::unpin))
        .route("/workspaces/:id/members", get(workspaces::handlers::list_members))
        .route("/workspaces/:id/invite", post(workspaces::handlers::invite))
        .route("/workspaces/:id/members/:user_id", patch(workspaces::handlers::update_member).delete(workspaces::handlers::remove_member))

        // Projects
        .route("/projects", get(projects::handlers::list).post(projects::handlers::create))
        .route("/projects/:id", get(projects::handlers::detail).patch(projects::handlers::update).delete(projects::handlers::soft_delete))
        .route("/projects/:id/duplicate", post(projects::handlers::duplicate))
        .route("/projects/:id/pin", axum::routing::put(projects::handlers::pin).delete(projects::handlers::unpin))

        // Timeline – Tracks
        .route("/projects/:id/tracks", post(timeline::handlers::create_track))
        .route("/projects/:id/tracks/:track_id", patch(timeline::handlers::update_track).delete(timeline::handlers::delete_track))

        // Timeline – Clips
        .route("/projects/:id/clips", post(timeline::handlers::create_clip))
        .route("/projects/:id/clips/batch", post(timeline::handlers::batch_clips))
        .route("/projects/:id/clips/:clip_id", patch(timeline::handlers::update_clip).delete(timeline::handlers::delete_clip))
        .route("/projects/:id/clips/:clip_id/split", post(timeline::handlers::split_clip))

        // Timeline – Effects
        .route("/projects/:id/clips/:clip_id/effects", post(timeline::handlers::create_effect))
        .route("/projects/:id/clips/:clip_id/effects/reorder", patch(timeline::handlers::reorder_effects))
        .route("/projects/:id/clips/:clip_id/effects/:effect_id", patch(timeline::handlers::update_effect).delete(timeline::handlers::delete_effect))

        // Timeline – Transitions
        .route("/projects/:id/transitions", post(timeline::handlers::create_transition))
        .route("/projects/:id/transitions/:transition_id", patch(timeline::handlers::update_transition).delete(timeline::handlers::delete_transition))

        // Timeline – Text Overlays
        .route("/projects/:id/text-overlays", post(timeline::handlers::create_text_overlay))
        .route("/projects/:id/text-overlays/:overlay_id", patch(timeline::handlers::update_text_overlay).delete(timeline::handlers::delete_text_overlay))

        // Exports
        .route("/projects/:id/exports", get(exports::handlers::list_exports).post(exports::handlers::create_export))
        .route("/exports/:id", get(exports::handlers::get_export).delete(exports::handlers::cancel_export))

        // Assets — 4 GB limit for video upload
        .route("/upload", post(storage::handlers::upload_file)
            .layer(DefaultBodyLimit::max(storage::handlers::UPLOAD_LIMIT)))
        .route("/assets/presigned-url", post(assets::handlers::presigned_url))
        .route("/assets/confirm-upload", post(assets::handlers::confirm_upload))
        .route("/assets", get(assets::handlers::list_assets))
        .route("/assets/:id", get(assets::handlers::get_asset).delete(assets::handlers::delete_asset))

        // Collaboration
        .route("/projects/:id/operations", get(collaboration::sync::operations_after))

        // gzip/brotli for the JSON API. Applied before /uploads is mounted so media
        // files (already compressed, and served with Range requests) are left alone.
        .layer(CompressionLayer::new())

        // Static file serving for local uploads. Every file is stored under a fresh
        // UUID name and never rewritten, so browsers may cache it indefinitely.
        .nest_service(
            "/uploads",
            SetResponseHeader::if_not_present(
                ServeDir::new("uploads"),
                CACHE_CONTROL,
                // Only successful responses — a 404 must not be remembered for a year
                |response: &axum::http::Response<_>| {
                    let status = response.status();
                    (status.is_success() || status == axum::http::StatusCode::NOT_MODIFIED)
                        .then(|| HeaderValue::from_static("public, max-age=31536000, immutable"))
                },
            ),
        )

        .with_state(state)
        .layer(PropagateRequestIdLayer::x_request_id())
        .layer(SetRequestIdLayer::x_request_id(MakeRequestUuid))
        .layer(TraceLayer::new_for_http())
        // Let browsers cache the CORS preflight instead of repeating it before each request
        .layer(CorsLayer::permissive().max_age(Duration::from_secs(24 * 60 * 60)))
}
