#[derive(Clone, Debug)]
pub struct Config {
    pub database_url: String,
    pub jwt_secret: String,
    pub api_addr: String,
    pub storage_public_base_url: String,
}

impl Config {
    pub fn from_env() -> Self {
        Self {
            database_url: std::env::var("DATABASE_URL").unwrap_or_else(|_| "postgres://cloudcut:cloudcut@localhost:5432/cloudcut".to_string()),
            jwt_secret: std::env::var("JWT_SECRET").unwrap_or_else(|_| "dev-secret-change-me".to_string()),
            api_addr: std::env::var("API_ADDR").unwrap_or_else(|_| "127.0.0.1:8080".to_string()),
            storage_public_base_url: std::env::var("STORAGE_PUBLIC_BASE_URL").unwrap_or_else(|_| "http://localhost:8080/uploads".to_string()),
        }
    }
}
