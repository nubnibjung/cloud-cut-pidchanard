use std::path::PathBuf;

#[derive(Clone, Debug)]
pub struct Config {
    pub database_url: String,
    pub jwt_secret: String,
    pub api_addr: String,
    pub storage_public_base_url: String,
    pub ffmpeg_path: String,
    pub ffprobe_path: String,
}

impl Config {
    pub fn from_env() -> Self {
        Self {
            database_url: std::env::var("DATABASE_URL").unwrap_or_else(|_| "postgres://cloudcut:cloudcut@localhost:5432/cloudcut".to_string()),
            jwt_secret: std::env::var("JWT_SECRET").unwrap_or_else(|_| "dev-secret-change-me".to_string()),
            api_addr: std::env::var("API_ADDR").unwrap_or_else(|_| "127.0.0.1:8080".to_string()),
            storage_public_base_url: std::env::var("STORAGE_PUBLIC_BASE_URL").unwrap_or_else(|_| "http://localhost:8080/uploads".to_string()),
            ffmpeg_path: std::env::var("FFMPEG_PATH").unwrap_or_else(|_| discover_ffmpeg_tool("ffmpeg.exe", "ffmpeg")),
            ffprobe_path: std::env::var("FFPROBE_PATH").unwrap_or_else(|_| discover_ffmpeg_tool("ffprobe.exe", "ffprobe")),
        }
    }
}

fn discover_ffmpeg_tool(exe_name: &str, command_name: &str) -> String {
    let Some(local_app_data) = std::env::var_os("LOCALAPPDATA") else {
        return command_name.to_string();
    };

    let winget_packages = PathBuf::from(local_app_data).join("Microsoft").join("WinGet").join("Packages");
    let Ok(packages) = std::fs::read_dir(winget_packages) else {
        return command_name.to_string();
    };

    for package in packages.flatten() {
        let package_path = package.path();
        let Ok(builds) = std::fs::read_dir(package_path) else {
            continue;
        };

        for build in builds.flatten() {
            let candidate = build.path().join("bin").join(exe_name);
            if candidate.exists() {
                return candidate.display().to_string();
            }
        }
    }

    command_name.to_string()
}
