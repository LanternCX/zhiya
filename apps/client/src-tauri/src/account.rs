use keyring::Entry;
use reqwest::{blocking::Client, header, Method};
use serde::Serialize;
use std::{sync::Mutex, time::Duration};

static ACCOUNT_REQUEST_LOCK: Mutex<()> = Mutex::new(());

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Response {
    status: u16,
    body: String,
    request_id: String,
    retry_after: Option<String>,
}

fn allowed(method: &str, path: &str) -> bool {
    let fixed = matches!(
        (method, path),
        ("GET", "/me")
            | ("GET", "/learning/model")
            | ("POST", "/socket-ticket")
            | ("POST", "/agent/sessions")
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
            | ("GET", "/classes")
            | ("GET", "/conversations")
            | ("POST", "/courses")
    );
    if fixed {
        return true;
    }
    let segments: Vec<_> = path.trim_matches('/').split('/').collect();
    matches!(
        (method, segments.as_slice()),
        ("GET", ["classes", id] | ["classes", id, "shares"]) if !id.is_empty()
    ) || matches!(
        (method, segments.as_slice()),
        ("GET", ["agent", "sessions", id]) if !id.is_empty()
    ) || matches!(
        (method, segments.as_slice()),
        ("POST", ["agent", "sessions", id, "commands"]) if !id.is_empty()
    ) || matches!(
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
        ("GET", ["courses", id, "deliverables"]) if !id.is_empty()
    ) || matches!(
        (method, segments.as_slice()),
        ("GET", ["courses", id, "deliverables" | "deliverable-images", item])
            if !id.is_empty() && !item.is_empty()
    ) || matches!(
        (method, segments.as_slice()),
        ("GET" | "PUT", ["courses", id, "deliverables", item, "share"])
            if !id.is_empty() && !item.is_empty()
    ) || matches!(
        (method, segments.as_slice()),
        ("POST", ["courses", id, "deliverables", "import"]) if !id.is_empty()
    ) || matches!(
        (method, segments.as_slice()),
        ("DELETE", ["courses", id, "materials", material])
            if !id.is_empty() && !material.is_empty()
    )
}

#[test]
fn deliverable_bridge_allows_review_import_and_images() {
    assert!(allowed(
        "GET",
        "/courses/course-id/deliverables/deck-id/share"
    ));
    assert!(allowed(
        "PUT",
        "/courses/course-id/deliverables/deck-id/share"
    ));
    assert!(!allowed(
        "DELETE",
        "/courses/course-id/deliverables/deck-id/share"
    ));
    assert!(allowed("GET", "/courses/course-id/deliverables"));
    assert!(allowed("GET", "/courses/course-id/deliverables/deck-id"));
    assert!(allowed("POST", "/courses/course-id/deliverables/import"));
    assert!(allowed(
        "GET",
        "/courses/course-id/deliverable-images/image-id"
    ));
    assert!(!allowed(
        "DELETE",
        "/courses/course-id/deliverables/deck-id"
    ));
    assert!(!allowed("PATCH", "/courses/course-id/deliverables/deck-id"));
}

#[test]
fn learning_bridge_accepts_only_fixed_learning_routes() {
    assert!(allowed("GET", "/classes"));
    assert!(allowed("GET", "/classes/class-id"));
    assert!(allowed("GET", "/classes/class-id/shares"));
    assert!(!allowed("PUT", "/classes/class-id/shares"));
    assert!(allowed("POST", "/socket-ticket"));
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
    // Session metadata and socket tickets cannot mutate native credentials.
    // Account identity changes retain their existing mutex.
    let metadata =
        path == "/socket-ticket" || path.starts_with("/learning") || path.starts_with("/courses");
    let _guard = if metadata {
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
        .timeout(Duration::from_secs(
            if path.ends_with("/deliverables/import") {
                180
            } else {
                configured_request_timeout_seconds()
            },
        ))
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
    let retry_after = response
        .headers()
        .get(header::RETRY_AFTER)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned);
    let request_id = response
        .headers()
        .get("X-Request-ID")
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .to_owned();
    if !metadata {
        store_session(&entry, &client, base, response.headers())?;
    }
    let body = response
        .text()
        .map_err(|_| "Unable to read account response")?;
    Ok(Response {
        status,
        body,
        request_id,
        retry_after,
    })
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
