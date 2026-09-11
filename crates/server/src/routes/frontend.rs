use axum::{
    body::Body,
    http::HeaderValue,
    response::{IntoResponse, Response},
};
use reqwest::{StatusCode, header};
use rust_embed::RustEmbed;

#[derive(RustEmbed)]
#[folder = "../../packages/local-web/dist"]
struct Assets;

pub(super) async fn serve_frontend(
    axum::extract::OriginalUri(uri): axum::extract::OriginalUri,
    axum::extract::Path(path): axum::extract::Path<String>,
) -> Response {
    // Nested API misses can reach the outer wildcard. Never redirect them back
    // through Vite's /api proxy or turn them into the embedded SPA document.
    if uri.path() == "/api" || uri.path().starts_with("/api/") {
        return StatusCode::NOT_FOUND.into_response();
    }
    if let Some(response) = development_frontend(&uri) {
        return response;
    }
    let path = path.trim_start_matches('/');
    serve_file(path).await
}

pub(super) async fn serve_frontend_root(
    axum::extract::OriginalUri(uri): axum::extract::OriginalUri,
) -> Response {
    if let Some(response) = development_frontend(&uri) {
        return response;
    }
    serve_file("index.html").await
}

fn development_frontend(uri: &axum::http::Uri) -> Option<Response> {
    // Release builds always use their packaged assets, even with inherited dev env.
    if !cfg!(debug_assertions) {
        return None;
    }
    let origin = match std::env::var("VK_DEV_FRONTEND_ORIGIN") {
        Ok(origin) => origin,
        Err(std::env::VarError::NotPresent) => return None,
        Err(_) => return Some(dev_configuration_error()),
    };
    let backend_port = std::env::var("BACKEND_PORT")
        .ok()
        .and_then(|value| value.parse::<u16>().ok());
    Some(match dev_redirect_location(&origin, backend_port, uri) {
        Ok(location) => Response::builder()
            .status(StatusCode::TEMPORARY_REDIRECT)
            .header(header::LOCATION, location)
            .header(header::CACHE_CONTROL, "no-store")
            .body(Body::empty())
            .unwrap(),
        Err(()) => dev_configuration_error(),
    })
}

fn dev_configuration_error() -> Response {
    (
        StatusCode::SERVICE_UNAVAILABLE,
        "Invalid development frontend configuration. Start with pnpm run dev and use distinct frontend/backend ports.",
    )
        .into_response()
}

fn dev_redirect_location(
    origin: &str,
    backend_port: Option<u16>,
    uri: &axum::http::Uri,
) -> Result<HeaderValue, ()> {
    let url = reqwest::Url::parse(origin).map_err(|_| ())?;
    let port = url.port_or_known_default().ok_or(())?;
    if url.scheme() != "http"
        || !matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"))
        || !url.username().is_empty()
        || url.password().is_some()
        || url.path() != "/"
        || url.query().is_some()
        || url.fragment().is_some()
        || port == 0
        || backend_port.is_none_or(|backend| backend == port || backend == 0)
    {
        return Err(());
    }
    // Concatenate the fixed origin: URL::join would let a //path change authority.
    let path = uri.path_and_query().map_or("/", |value| value.as_str());
    HeaderValue::from_str(&format!("{}{}", url.origin().ascii_serialization(), path))
        .map_err(|_| ())
}

async fn serve_file(path: &str) -> Response {
    let file = Assets::get(path);

    match file {
        Some(content) => {
            let mime = mime_guess::from_path(path).first_or_octet_stream();

            Response::builder()
                .status(StatusCode::OK)
                .header(
                    header::CONTENT_TYPE,
                    HeaderValue::from_str(mime.as_ref()).unwrap(),
                )
                .body(Body::from(content.data.into_owned()))
                .unwrap()
        }
        None => {
            // For SPA routing, serve index.html for unknown routes
            if let Some(index) = Assets::get("index.html") {
                Response::builder()
                    .status(StatusCode::OK)
                    .header(header::CONTENT_TYPE, HeaderValue::from_static("text/html"))
                    .body(Body::from(index.data.into_owned()))
                    .unwrap()
            } else {
                Response::builder()
                    .status(StatusCode::NOT_FOUND)
                    .body(Body::from("404 Not Found"))
                    .unwrap()
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn unmatched_api_routes_never_reach_frontend_redirect_or_assets() {
        // Match the production router's nesting and wildcard precedence, using
        // the actual frontend handlers rather than testing a string predicate.
        let router = axum::Router::new()
            .route("/", axum::routing::get(serve_frontend_root))
            .route("/{*path}", axum::routing::get(serve_frontend))
            .nest(
                "/api",
                axum::Router::new().route(
                    "/known",
                    axum::routing::get(|| async { "known API response" }),
                ),
            );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
        let client = reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(std::time::Duration::from_secs(5))
            .build()
            .unwrap();
        for path in [
            "/api",
            "/api/",
            "/api/nonexistent?query=1",
            "/api/missing/deep",
        ] {
            let response = client
                .get(format!("http://{address}{path}"))
                .send()
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::NOT_FOUND, "{path}");
            assert!(!response.headers().contains_key(header::LOCATION), "{path}");
            assert!(!response.text().await.unwrap().contains("<html"), "{path}");
        }
        let response = client
            .get(format!("http://{address}/api/known"))
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.text().await.unwrap(), "known API response");
        server.abort();
        let _ = server.await;
    }

    #[test]
    fn dev_redirect_preserves_encoded_path_and_query() {
        let uri = "/projects/a%20b?tab=board&query=x%2Fy".parse().unwrap();
        assert_eq!(
            dev_redirect_location("http://localhost:3000", Some(3001), &uri).unwrap(),
            "http://localhost:3000/projects/a%20b?tab=board&query=x%2Fy"
        );
        let uri = "//evil.example/path?q=1".parse().unwrap();
        assert_eq!(
            dev_redirect_location("http://127.0.0.1:3000", Some(3001), &uri).unwrap(),
            "http://127.0.0.1:3000//evil.example/path?q=1"
        );
    }

    #[test]
    fn dev_redirect_rejects_invalid_external_or_looping_origins() {
        let uri = "/".parse().unwrap();
        for origin in [
            "",
            "not a URL",
            "https://localhost:3000",
            "http://evil.example:3000",
            "http://user@localhost:3000",
            "http://localhost:3000/path",
            "http://localhost:3000?x=1",
            "http://localhost:3000#x",
            "http://localhost:3001",
            "http://localhost:0",
        ] {
            assert!(
                dev_redirect_location(origin, Some(3001), &uri).is_err(),
                "{origin}"
            );
        }
        assert!(dev_redirect_location("http://localhost:3000", None, &uri).is_err());
    }
}
