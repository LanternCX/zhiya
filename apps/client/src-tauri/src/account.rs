use keyring::Entry;
use reqwest::{blocking::Client, header, Method};
use serde::Serialize;
use std::io::Read;
use std::{sync::Mutex, time::Duration};

static ACCOUNT_REQUEST_LOCK: Mutex<()> = Mutex::new(());

#[derive(Serialize)]
pub struct Response {
    status: u16,
    body: String,
}

fn allowed(method: &str, path: &str) -> bool {
    let fixed = matches!(
        (method, path),
        ("GET", "/me")
            | ("GET", "/learning/model")
            | ("POST", "/learning/socket-ticket")
            | ("GET", "/account-rules")
            | ("PATCH", "/me")
            | ("DELETE", "/me")
            | ("PUT", "/me/password")
            | ("PUT", "/me/avatar")
            | ("POST", "/auth/register/start")
            | ("POST", "/auth/register/complete")
            | ("POST", "/auth/login")
            | ("POST", "/auth/logout")
            | ("POST", "/auth/logout-all")
            | ("POST", "/auth/reset/start")
            | ("POST", "/auth/reset/complete")
            | ("POST", "/me/email/start")
            | ("POST", "/me/email/complete")
            | ("GET", "/courses")
            | ("POST", "/courses")
    );
    if fixed {
        return true;
    }
    let segments: Vec<_> = path.trim_matches('/').split('/').collect();
    matches!(
        (method, segments.as_slice()),
        ("GET" | "PATCH" | "DELETE", ["courses", id]) if !id.is_empty()
    ) || matches!(
        (method, segments.as_slice()),
        ("PUT", ["courses", id, "conversation"]) if !id.is_empty()
    ) || matches!(
        (method, segments.as_slice()),
        ("GET", ["courses", id, "materials"]) if !id.is_empty()
    ) || matches!(
        (method, segments.as_slice()),
        ("POST", ["courses", id, "material-uploads"]) if !id.is_empty()
    ) || matches!(
        (method, segments.as_slice()),
        ("POST", ["courses", id, "material-uploads", upload, "complete"])
            if !id.is_empty() && !upload.is_empty()
    ) || matches!(
        (method, segments.as_slice()),
        ("GET", ["courses", id, "materials", material, "download"])
            if !id.is_empty() && !material.is_empty()
    ) || matches!(
        (method, segments.as_slice()),
        ("DELETE", ["courses", id, "materials", material])
            if !id.is_empty() && !material.is_empty()
    )
}

#[test]
fn learning_bridge_accepts_only_fixed_learning_routes() {
    assert!(allowed("POST", "/learning/socket-ticket"));
    assert!(!allowed("GET", "/learning"));
    assert!(!allowed("POST", "/learning/action"));
    assert!(!allowed("POST", "/learning/sync"));
    assert!(!allowed("POST", "/learning/../auth/login"));
    assert!(!allowed("POST", "/learning/model"));
    assert!(allowed("GET", "/courses"));
    assert!(allowed("POST", "/courses"));
    assert!(allowed("PATCH", "/courses/course-id"));
    assert!(allowed("DELETE", "/courses/course-id"));
    assert!(allowed("PUT", "/courses/course-id/conversation"));
    assert!(allowed("GET", "/courses/course-id/materials"));
    assert!(allowed("POST", "/courses/course-id/material-uploads"));
    assert!(allowed(
        "POST",
        "/courses/course-id/material-uploads/upload-id/complete"
    ));
    assert!(allowed(
        "GET",
        "/courses/course-id/materials/material-id/download"
    ));
    assert!(allowed(
        "DELETE",
        "/courses/course-id/materials/material-id"
    ));
    assert!(!allowed("PUT", "/courses/course-id/other"));
    assert!(!allowed("DELETE", "/courses/course-id/conversation"));
}

fn request(
    path: String,
    method: String,
    body: Option<String>,
    expected_user: String,
) -> Result<Response, String> {
    if !allowed(&method, &path) {
        return Err("Invalid account request".into());
    }
    if cfg!(target_os = "android") {
        return Err("Android secure credential storage must be configured before use".into());
    }
    // Learning metadata and socket tickets cannot mutate native credentials.
    // Account identity changes retain their existing mutex.
    let learning = path.starts_with("/learning") || path.starts_with("/courses");
    let _guard = if learning {
        None
    } else {
        Some(
            ACCOUNT_REQUEST_LOCK
                .lock()
                .map_err(|_| "Account request unavailable")?,
        )
    };
    let base = api_origin()?;
    let entry = Entry::new("com.lanterncx.zhiya.session", base)
        .map_err(|_| "Secure storage unavailable")?;
    let token = match entry.get_password() {
        Ok(value) => value,
        Err(keyring::Error::NoEntry) => String::new(),
        Err(_) => return Err("Unable to read secure storage".into()),
    };
    let client = Client::builder()
        .timeout(Duration::from_secs(configured_request_timeout_seconds()))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "Network unavailable")?;
    let mut builder = client
        .request(
            Method::from_bytes(method.as_bytes()).map_err(|_| "Invalid method")?,
            format!("{}/api{}", base.trim_end_matches('/'), path),
        )
        .header(header::CONTENT_TYPE, "application/json")
        .header("X-Zhiya-Request", "1");
    if !token.is_empty() {
        builder = builder.header(header::COOKIE, format!("zhiya_session={token}"));
    }
    if !expected_user.is_empty() {
        builder = builder.header("X-Zhiya-User", expected_user);
    }
    if let Some(body) = body {
        builder = builder.body(body);
    }
    let response = builder
        .send()
        .map_err(|_| "Unable to connect to account server")?;
    let status = response.status().as_u16();
    if !learning {
        store_session(&entry, &client, base, response.headers())?;
    }
    let body = response
        .text()
        .map_err(|_| "Unable to read account response")?;
    Ok(Response { status, body })
}

fn api_origin() -> Result<&'static str, String> {
    let base = env!("ZHIYA_BUILD_API_ORIGIN");
    let url = reqwest::Url::parse(base).map_err(|_| "Invalid application configuration")?;
    let local = cfg!(debug_assertions)
        && url.scheme() == "http"
        && matches!(
            url.host_str(),
            Some("127.0.0.1") | Some("localhost") | Some("[::1]")
        );
    if (!local && url.scheme() != "https")
        || url.path() != "/"
        || url.query().is_some()
        || url.fragment().is_some()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("Invalid application configuration: HTTPS origin required".into());
    }
    Ok(base)
}

#[derive(Clone, Serialize)]
pub struct ModelPart {
    #[serde(skip_serializing_if = "Option::is_none")]
    status: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    bytes: Option<Vec<u8>>,
    done: bool,
}

#[tauri::command]
pub async fn model_request(
    body: String,
    expected_user: String,
    course: bool,
    on_event: tauri::ipc::Channel<ModelPart>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        if cfg!(target_os = "android") {
            return Err("Android secure credential storage must be configured before use".into());
        }
        let base = api_origin()?;
        let entry = Entry::new("com.lanterncx.zhiya.session", base)
            .map_err(|_| "Secure storage unavailable")?;
        let token = entry
            .get_password()
            .map_err(|_| "Unable to read secure storage")?;
        let client = Client::builder()
            .timeout(None)
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|_| "Network unavailable")?;
        let path = if course {
            "/api/learning/course/model"
        } else {
            "/api/learning/model"
        };
        let mut response = client
            .post(format!("{}{}", base.trim_end_matches('/'), path))
            .header(header::CONTENT_TYPE, "application/json")
            .header("X-Zhiya-Request", "1")
            .header("X-Zhiya-User", expected_user)
            .header(header::COOKIE, format!("zhiya_session={token}"))
            .body(body)
            .send()
            .map_err(|_| "Unable to connect to model proxy")?;
        on_event
            .send(ModelPart {
                status: Some(response.status().as_u16()),
                bytes: None,
                done: false,
            })
            .map_err(|_| "Stream closed")?;
        let mut buffer = [0u8; 8192];
        loop {
            let n = response
                .read(&mut buffer)
                .map_err(|_| "Unable to read model response")?;
            if n == 0 {
                break;
            }
            on_event
                .send(ModelPart {
                    status: None,
                    bytes: Some(buffer[..n].to_vec()),
                    done: false,
                })
                .map_err(|_| "Stream closed")?;
        }
        on_event
            .send(ModelPart {
                status: None,
                bytes: None,
                done: true,
            })
            .map_err(|_| "Stream closed".to_string())
    })
    .await
    .map_err(|_| "Model request failed".to_string())?
}

fn configured_request_timeout_seconds() -> u64 {
    env!("ZHIYA_BUILD_REQUEST_TIMEOUT_SECONDS")
        .parse()
        .expect("request timeout is validated by the build launcher")
}

fn store_session(
    entry: &Entry,
    client: &Client,
    base: &str,
    headers: &header::HeaderMap,
) -> Result<(), String> {
    for cookie in headers.get_all(header::SET_COOKIE) {
        let value = cookie.to_str().map_err(|_| "Invalid session response")?;
        if let Some(value) = value.strip_prefix("zhiya_session=") {
            let value = value.split(';').next().unwrap_or("");
            if value.is_empty() {
                match entry.delete_credential() {
                    Ok(()) | Err(keyring::Error::NoEntry) => (),
                    Err(_) => return Err("Unable to clear secure storage".into()),
                }
            } else {
                if value.len() != 64 || !value.bytes().all(|b| b.is_ascii_hexdigit()) {
                    return Err("Invalid session".into());
                }
                if entry.set_password(value).is_err() {
                    let _ = client
                        .post(format!("{}/api/auth/logout", base.trim_end_matches('/')))
                        .header(header::COOKIE, format!("zhiya_session={value}"))
                        .header("X-Zhiya-Request", "1")
                        .header(header::CONTENT_TYPE, "application/json")
                        .body("{}")
                        .send();
                    return Err("Unable to save login in secure storage".into());
                }
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn account_request(
    path: String,
    method: String,
    body: Option<String>,
    expected_user: String,
) -> Result<Response, String> {
    tauri::async_runtime::spawn_blocking(move || request(path, method, body, expected_user))
        .await
        .map_err(|_| "Account request failed".to_owned())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn account_bridge_rejects_other_destinations_and_operations() {
        for path in [
            "https://example.com",
            "//example.com",
            "/me/../admin",
            "/admin/users",
        ] {
            assert!(request(path.into(), "GET".into(), None, String::new()).is_err());
        }
        assert!(request("/me".into(), "TRACE".into(), None, String::new()).is_err());
    }
}
