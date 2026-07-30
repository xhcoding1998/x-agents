use serde_json::{json, Value};
use std::path::Path;
use std::time::Duration;
use tauri::Manager;

fn provider_url(base_url: &str, path: &str) -> String {
    format!(
        "{}/{}",
        base_url.trim_end_matches('/'),
        path.trim_start_matches('/')
    )
}

fn uses_anthropic_messages(provider: &str) -> bool {
    provider.to_ascii_lowercase().contains("anthropic")
        || provider.to_ascii_lowercase().contains("claude")
}

fn has_custom_header(headers_json: &str, expected: &str) -> bool {
    serde_json::from_str::<Value>(headers_json.trim())
        .ok()
        .and_then(|value| value.as_object().cloned())
        .is_some_and(|headers| {
            headers
                .keys()
                .any(|key| key.eq_ignore_ascii_case(expected))
        })
}

fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|error| format!("无法创建网络客户端：{error}"))
}

fn apply_custom_headers(
    mut request: reqwest::RequestBuilder,
    headers_json: &str,
) -> Result<reqwest::RequestBuilder, String> {
    let trimmed = headers_json.trim();
    if trimmed.is_empty() || trimmed == "{}" {
        return Ok(request);
    }

    let headers: Value = serde_json::from_str(trimmed)
        .map_err(|error| format!("自定义请求头 JSON 无效：{error}"))?;
    let object = headers
        .as_object()
        .ok_or_else(|| "自定义请求头必须是 JSON 对象".to_string())?;

    for (key, value) in object {
        let value = value
            .as_str()
            .ok_or_else(|| format!("请求头 {key} 的值必须是字符串"))?;
        let header_name = reqwest::header::HeaderName::from_bytes(key.as_bytes())
            .map_err(|error| format!("请求头名称 {key} 无效：{error}"))?;
        let header_value = reqwest::header::HeaderValue::from_str(value)
            .map_err(|error| format!("请求头 {key} 的值无效：{error}"))?;
        request = request.header(header_name, header_value);
    }

    Ok(request)
}

#[tauri::command]
async fn test_model_endpoint(
    provider: String,
    base_url: String,
    api_key: String,
    headers_json: String,
) -> Result<String, String> {
    if base_url.trim().is_empty() {
        return Err("请填写服务地址".into());
    }

    let client = http_client()?;
    let anthropic = uses_anthropic_messages(&provider);
    let models_path = if anthropic { "v1/models" } else { "models" };
    let mut request = client.get(provider_url(&base_url, models_path));
    if anthropic {
        if !api_key.trim().is_empty()
            && !has_custom_header(&headers_json, "x-api-key")
        {
            request = request.header("x-api-key", api_key.trim());
        }
        if !has_custom_header(&headers_json, "anthropic-version") {
            request = request.header("anthropic-version", "2023-06-01");
        }
    } else if !api_key.trim().is_empty() {
        request = request.bearer_auth(api_key.trim());
    }
    request = apply_custom_headers(request, &headers_json)?;

    let response = request
        .send()
        .await
        .map_err(|error| format!("连接失败：{error}"))?;
    let status = response.status();

    if status.is_success() {
        Ok(format!("连接成功 · HTTP {}", status.as_u16()))
    } else {
        let body = response.text().await.unwrap_or_default();
        let short_body: String = body.chars().take(160).collect();
        Err(format!("服务返回 HTTP {}：{}", status.as_u16(), short_body))
    }
}

#[tauri::command]
async fn send_chat_message(
    provider: String,
    base_url: String,
    api_key: String,
    model: String,
    api_path: String,
    headers_json: String,
    input: String,
) -> Result<String, String> {
    if base_url.trim().is_empty() || model.trim().is_empty() {
        return Err("请先配置对话模型的服务地址和模型 ID".into());
    }

    let client = http_client()?;
    let path = if api_path.trim().is_empty() {
        if uses_anthropic_messages(&provider) {
            "v1/messages"
        } else {
            "chat/completions"
        }
    } else {
        api_path.trim()
    };
    let anthropic = uses_anthropic_messages(&provider);
    let system_prompt =
        "你是漫剧制作 Agent。请用简洁、专业的中文回复，并明确下一步可执行动作。";
    let mut request = if anthropic {
        client.post(provider_url(&base_url, path)).json(&json!({
            "model": model,
            "max_tokens": 4096,
            "system": system_prompt,
            "messages": [
                {
                    "role": "user",
                    "content": input
                }
            ],
            "stream": false
        }))
    } else {
        client.post(provider_url(&base_url, path)).json(&json!({
            "model": model,
            "messages": [
                {
                    "role": "system",
                    "content": system_prompt
                },
                {
                    "role": "user",
                    "content": input
                }
            ],
            "stream": false
        }))
    };

    if anthropic {
        if !api_key.trim().is_empty()
            && !has_custom_header(&headers_json, "x-api-key")
        {
            request = request.header("x-api-key", api_key.trim());
        }
        if !has_custom_header(&headers_json, "anthropic-version") {
            request = request.header("anthropic-version", "2023-06-01");
        }
    } else if !api_key.trim().is_empty() {
        request = request.bearer_auth(api_key.trim());
    }
    request = apply_custom_headers(request, &headers_json)?;

    let response = request
        .send()
        .await
        .map_err(|error| format!("请求失败：{error}"))?;
    let status = response.status();
    let payload: Value = response
        .json()
        .await
        .map_err(|error| format!("无法解析模型响应：{error}"))?;

    if !status.is_success() {
        let message = payload
            .pointer("/error/message")
            .and_then(Value::as_str)
            .unwrap_or("模型服务返回错误");
        return Err(format!("HTTP {}：{}", status.as_u16(), message));
    }

    if anthropic {
        payload
            .pointer("/content/0/text")
            .and_then(Value::as_str)
            .map(str::to_owned)
            .ok_or_else(|| "Anthropic 响应中没有可用文本".into())
    } else {
        payload
            .pointer("/choices/0/message/content")
            .and_then(Value::as_str)
            .map(str::to_owned)
            .ok_or_else(|| "模型响应中没有可用文本".into())
    }
}

#[tauri::command]
async fn save_project_source(
    app: tauri::AppHandle,
    project_id: String,
    file_name: String,
    content: String,
) -> Result<String, String> {
    let safe_project_id: String = project_id
        .chars()
        .filter(|character| character.is_ascii_alphanumeric() || *character == '-')
        .collect();
    if safe_project_id.is_empty() {
        return Err("项目 ID 无效".into());
    }

    let safe_file_name = Path::new(&file_name)
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "文件名无效".to_string())?;

    let project_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法获取应用数据目录：{error}"))?
        .join("projects")
        .join(safe_project_id)
        .join("source");

    std::fs::create_dir_all(&project_dir).map_err(|error| format!("无法创建项目目录：{error}"))?;
    let path = project_dir.join(safe_file_name);
    std::fs::write(&path, content).map_err(|error| format!("无法保存文件：{error}"))?;

    Ok(path.to_string_lossy().into_owned())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            test_model_endpoint,
            send_chat_message,
            save_project_source
        ])
        .run(tauri::generate_context!())
        .expect("error while running Manju Agent");
}
