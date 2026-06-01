use axum::{extract::State, Json};
use serde::{Deserialize, Serialize};
use validator::Validate;

use crate::{app::AppState, auth::{jwt::{create_token, AuthUser}, password::{hash_password, verify_password}}, db::models::User, error::{AppError, AppResult}};

#[derive(Debug, Deserialize, Validate)]
pub struct AuthRequest {
    #[validate(email)]
    email: String,
    #[validate(length(min = 8))]
    password: String,
    #[validate(length(min = 1))]
    name: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct AuthResponse {
    access_token: String,
    user: PublicUser,
}

#[derive(Debug, Serialize)]
pub struct PublicUser {
    id: uuid::Uuid,
    email: String,
    name: String,
    avatar_url: Option<String>,
}

impl From<User> for PublicUser {
    fn from(user: User) -> Self {
        Self { id: user.id, email: user.email, name: user.name, avatar_url: user.avatar_url }
    }
}

pub async fn register(State(state): State<AppState>, Json(input): Json<AuthRequest>) -> AppResult<Json<AuthResponse>> {
    input.validate().map_err(|err| AppError::Validation(err.to_string()))?;
    let password_hash = hash_password(&input.password)?;

    let mut tx = state.pool.begin().await?;

    let display_name = input.name.as_deref().unwrap_or(&input.email).to_string();
    let user = sqlx::query_as::<_, User>(
        "INSERT INTO users (email, password_hash, name) VALUES (lower($1), $2, $3)
         RETURNING id, email, password_hash, name, avatar_url",
    )
    .bind(&input.email)
    .bind(password_hash)
    .bind(&display_name)
    .fetch_one(&mut *tx)
    .await?;

    // Auto-create a personal workspace so the user can start immediately
    let ws_name = format!("{}'s Workspace", user.name);
    let ws_slug = format!("ws-{}", user.id);
    sqlx::query(
        "WITH new_ws AS (
             INSERT INTO workspaces (name, slug, plan, owner_id) VALUES ($1, $2, 'free', $3)
             RETURNING id
         )
         INSERT INTO workspace_members (workspace_id, user_id, role)
         SELECT id, $3, 'owner' FROM new_ws",
    )
    .bind(&ws_name)
    .bind(&ws_slug)
    .bind(user.id)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

    let access_token = create_token(user.id, &state.config.jwt_secret)?;
    Ok(Json(AuthResponse { access_token, user: user.into() }))
}

pub async fn login(State(state): State<AppState>, Json(input): Json<AuthRequest>) -> AppResult<Json<AuthResponse>> {
    input.validate().map_err(|err| AppError::Validation(err.to_string()))?;
    let user = sqlx::query_as::<_, User>(
        "SELECT id, email, password_hash, name, avatar_url FROM users WHERE lower(email) = lower($1) AND deleted_at IS NULL",
    )
    .bind(&input.email)
    .fetch_optional(&state.pool)
    .await?
    .ok_or(AppError::Unauthorized)?;

    if !verify_password(&input.password, &user.password_hash) {
        return Err(AppError::Unauthorized);
    }

    let access_token = create_token(user.id, &state.config.jwt_secret)?;
    Ok(Json(AuthResponse { access_token, user: user.into() }))
}

pub async fn refresh(State(state): State<AppState>, auth: AuthUser) -> AppResult<Json<AuthResponse>> {
    let user = sqlx::query_as::<_, User>(
        "SELECT id, email, password_hash, name, avatar_url FROM users WHERE id = $1 AND deleted_at IS NULL",
    )
    .bind(auth.id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or(AppError::Unauthorized)?;
    let access_token = create_token(user.id, &state.config.jwt_secret)?;
    Ok(Json(AuthResponse { access_token, user: user.into() }))
}

pub async fn me(State(state): State<AppState>, auth: AuthUser) -> AppResult<Json<PublicUser>> {
    let user = sqlx::query_as::<_, User>(
        "SELECT id, email, password_hash, name, avatar_url FROM users WHERE id = $1 AND deleted_at IS NULL",
    )
    .bind(auth.id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or(AppError::Unauthorized)?;
    Ok(Json(user.into()))
}
