use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;
use std::time::Duration;
use tauri::ipc::Channel;
use tauri::Manager;
use tokio::sync::watch;

const KIE_SEEDREAM_MODELS: [&str; 1] = ["seedream/5-pro-text-to-image"];

#[derive(Default)]
struct ChatCancellationState {
    requests: Mutex<HashMap<String, watch::Sender<bool>>>,
}

#[derive(Clone, Serialize)]
struct ChatStreamEvent {
    event: String,
    data: String,
}

impl ChatStreamEvent {
    fn new(event: &str, data: impl Into<String>) -> Self {
        Self {
            event: event.into(),
            data: data.into(),
        }
    }
}

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

fn uses_kie_market(provider: &str) -> bool {
    provider.to_ascii_lowercase().contains("kie.ai")
}

fn has_custom_header(headers_json: &str, expected: &str) -> bool {
    serde_json::from_str::<Value>(headers_json.trim())
        .ok()
        .and_then(|value| value.as_object().cloned())
        .is_some_and(|headers| headers.keys().any(|key| key.eq_ignore_ascii_case(expected)))
}

fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(20))
        .timeout(Duration::from_secs(600))
        .build()
        .map_err(|error| format!("无法创建网络客户端：{error}"))
}

fn stream_delta(payload: &Value, anthropic: bool) -> Option<&str> {
    if anthropic {
        payload
            .pointer("/delta/text")
            .and_then(Value::as_str)
            .or_else(|| {
                payload
                    .pointer("/content_block/text")
                    .and_then(Value::as_str)
            })
    } else {
        payload
            .pointer("/choices/0/delta/content")
            .and_then(Value::as_str)
    }
}

fn complete_response_text(payload: &Value, anthropic: bool) -> Option<&str> {
    if anthropic {
        payload.pointer("/content/0/text").and_then(Value::as_str)
    } else {
        payload
            .pointer("/choices/0/message/content")
            .and_then(Value::as_str)
    }
}

fn parse_sse_line(line: &[u8], anthropic: bool) -> Option<String> {
    let line = String::from_utf8_lossy(line);
    let data = line.trim().strip_prefix("data:").map(str::trim)?;
    if data.is_empty() || data == "[DONE]" {
        return None;
    }
    let payload = serde_json::from_str::<Value>(data).ok()?;
    let delta = stream_delta(&payload, anthropic)?;
    if delta.is_empty() {
        return None;
    }
    Some(delta.to_owned())
}

fn emit_sse_line(line: &[u8], anthropic: bool, on_event: &Channel<ChatStreamEvent>) -> bool {
    let Some(delta) = parse_sse_line(line, anthropic) else {
        return false;
    };
    let _ = on_event.send(ChatStreamEvent::new("delta", delta));
    true
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

async fn kie_credit_balance(
    client: &reqwest::Client,
    base_url: &str,
    api_key: &str,
    headers_json: &str,
) -> Result<String, String> {
    if api_key.trim().is_empty() {
        return Err("请先填写 Kie.ai API Key".into());
    }

    let request = client
        .get(provider_url(base_url, "api/v1/chat/credit"))
        .bearer_auth(api_key.trim());
    let request = apply_custom_headers(request, headers_json)?;
    let response = request
        .send()
        .await
        .map_err(|error| format!("连接 Kie.ai 失败：{error}"))?;
    let status = response.status();
    let payload: Value = response
        .json()
        .await
        .map_err(|error| format!("无法解析 Kie.ai 响应：{error}"))?;
    let code = payload.get("code").and_then(Value::as_i64);

    if !status.is_success() || code != Some(200) {
        let message = payload
            .get("msg")
            .and_then(Value::as_str)
            .or_else(|| payload.pointer("/error/message").and_then(Value::as_str))
            .unwrap_or("Kie.ai API Key 验证失败");
        return Err(format!("HTTP {}：{}", status.as_u16(), message));
    }

    Ok(payload
        .get("data")
        .map(Value::to_string)
        .unwrap_or_else(|| "未知".into()))
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
    if uses_kie_market(&provider) {
        let credits = kie_credit_balance(&client, &base_url, &api_key, &headers_json).await?;
        return Ok(format!("连接成功 · Kie.ai 剩余 {credits} 积分"));
    }

    let anthropic = uses_anthropic_messages(&provider);
    let models_path = if anthropic { "v1/models" } else { "models" };
    let mut request = client.get(provider_url(&base_url, models_path));
    if anthropic {
        if !api_key.trim().is_empty() && !has_custom_header(&headers_json, "x-api-key") {
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
async fn list_provider_models(
    provider: String,
    model_kind: String,
    base_url: String,
    api_key: String,
    headers_json: String,
) -> Result<Vec<String>, String> {
    if base_url.trim().is_empty() {
        return Err("请先选择供应商或填写 Base URL".into());
    }

    let client = http_client()?;
    if uses_kie_market(&provider) {
        kie_credit_balance(&client, &base_url, &api_key, &headers_json).await?;
        return Ok(KIE_SEEDREAM_MODELS
            .iter()
            .map(|model| (*model).to_owned())
            .collect());
    }

    let anthropic = uses_anthropic_messages(&provider);
    let models_path = if anthropic {
        "v1/models?limit=1000"
    } else {
        "models"
    };
    let mut request = client.get(provider_url(&base_url, models_path));

    if anthropic {
        if !api_key.trim().is_empty() && !has_custom_header(&headers_json, "x-api-key") {
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
        .map_err(|error| format!("拉取模型失败：{error}"))?;
    let status = response.status();
    let payload: Value = response
        .json()
        .await
        .map_err(|error| format!("无法解析模型列表：{error}"))?;

    if !status.is_success() {
        let message = payload
            .pointer("/error/message")
            .and_then(Value::as_str)
            .or_else(|| payload.pointer("/message").and_then(Value::as_str))
            .unwrap_or("供应商未返回模型列表");
        return Err(format!("HTTP {}：{}", status.as_u16(), message));
    }

    let source = payload
        .get("data")
        .and_then(Value::as_array)
        .or_else(|| payload.get("models").and_then(Value::as_array))
        .ok_or_else(|| "供应商响应中没有模型列表，可继续手动填写模型 ID".to_string())?;

    let mut models: Vec<String> = source
        .iter()
        .filter_map(|item| {
            item.as_str().map(str::to_owned).or_else(|| {
                ["id", "model", "name", "model_id"]
                    .iter()
                    .find_map(|key| item.get(key).and_then(Value::as_str).map(str::to_owned))
            })
        })
        .filter(|model| !model.trim().is_empty())
        .collect();

    models.sort_by_key(|model| model.to_ascii_lowercase());
    models.dedup();

    let kind = model_kind.to_ascii_lowercase();
    if kind == "image" || kind == "video" {
        let filtered: Vec<String> = models
            .iter()
            .filter(|model| {
                let normalized = model.to_ascii_lowercase();
                if kind == "image" {
                    normalized.contains("seedream")
                        || normalized.contains("seededit")
                        || normalized.contains("image")
                } else {
                    normalized.contains("seedance") || normalized.contains("video")
                }
            })
            .cloned()
            .collect();
        if !filtered.is_empty() {
            models = filtered;
        }
    }

    if models.is_empty() {
        Err("供应商没有返回可选模型，可继续手动填写模型 ID".into())
    } else {
        Ok(models)
    }
}

#[tauri::command]
async fn stream_chat_message(
    cancellation: tauri::State<'_, ChatCancellationState>,
    request_id: String,
    provider: String,
    base_url: String,
    api_key: String,
    model: String,
    api_path: String,
    headers_json: String,
    input: String,
    system_prompt: String,
    on_event: Channel<ChatStreamEvent>,
) -> Result<(), String> {
    if base_url.trim().is_empty() || model.trim().is_empty() {
        return Err("请先配置对话模型的服务地址和模型 ID".into());
    }
    if request_id.trim().is_empty() {
        return Err("请求 ID 无效".into());
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
    let system_prompt = if system_prompt.trim().is_empty() {
        "你是漫剧制作 Agent。请用简洁、专业的中文回复，并明确下一步可执行动作。"
    } else {
        system_prompt.trim()
    };
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
            "stream": true
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
            "stream": true
        }))
    };

    if anthropic {
        if !api_key.trim().is_empty() && !has_custom_header(&headers_json, "x-api-key") {
            request = request.header("x-api-key", api_key.trim());
        }
        if !has_custom_header(&headers_json, "anthropic-version") {
            request = request.header("anthropic-version", "2023-06-01");
        }
    } else if !api_key.trim().is_empty() {
        request = request.bearer_auth(api_key.trim());
    }
    request = apply_custom_headers(request, &headers_json)?;
    let (cancel_tx, mut cancel_rx) = watch::channel(false);
    cancellation
        .requests
        .lock()
        .map_err(|_| "无法创建取消信号".to_string())?
        .insert(request_id.clone(), cancel_tx);

    let mut response = tokio::select! {
        _ = cancel_rx.changed() => {
            cancellation.requests.lock().ok().and_then(|mut requests| requests.remove(&request_id));
            let _ = on_event.send(ChatStreamEvent::new("cancelled", ""));
            return Ok(());
        }
        result = request.send() => {
            match result {
                Ok(response) => response,
                Err(error) => {
                    cancellation.requests.lock().ok().and_then(|mut requests| requests.remove(&request_id));
                    return Err(format!("请求失败：{error}"));
                }
            }
        }
    };
    let status = response.status();

    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        cancellation
            .requests
            .lock()
            .ok()
            .and_then(|mut requests| requests.remove(&request_id));
        let message = serde_json::from_str::<Value>(&body)
            .ok()
            .and_then(|payload| {
                payload
                    .pointer("/error/message")
                    .and_then(Value::as_str)
                    .map(str::to_owned)
            })
            .unwrap_or_else(|| body.chars().take(200).collect());
        return Err(format!("HTTP {}：{}", status.as_u16(), message));
    }

    let _ = on_event.send(ChatStreamEvent::new("started", ""));
    let mut line_buffer: Vec<u8> = Vec::new();
    let mut raw_body: Vec<u8> = Vec::new();
    let mut emitted_delta = false;
    let mut cancelled = false;

    loop {
        let next_chunk = tokio::select! {
            _ = cancel_rx.changed() => {
                if *cancel_rx.borrow() {
                    cancelled = true;
                    None
                } else {
                    continue;
                }
            }
            result = response.chunk() => {
                match result {
                    Ok(chunk) => chunk,
                    Err(error) => {
                        cancellation.requests.lock().ok().and_then(|mut requests| requests.remove(&request_id));
                        return Err(format!("读取流式响应失败：{error}"));
                    }
                }
            }
        };

        let Some(chunk) = next_chunk else {
            break;
        };
        raw_body.extend_from_slice(&chunk);
        line_buffer.extend_from_slice(&chunk);

        while let Some(newline) = line_buffer.iter().position(|byte| *byte == b'\n') {
            let line: Vec<u8> = line_buffer.drain(..=newline).collect();
            emitted_delta |= emit_sse_line(&line, anthropic, &on_event);
        }
    }

    if !cancelled && !line_buffer.is_empty() {
        emitted_delta |= emit_sse_line(&line_buffer, anthropic, &on_event);
    }

    if !cancelled && !emitted_delta {
        if let Ok(payload) = serde_json::from_slice::<Value>(&raw_body) {
            if let Some(text) = complete_response_text(&payload, anthropic) {
                if !text.is_empty() {
                    let _ = on_event.send(ChatStreamEvent::new("delta", text));
                    emitted_delta = true;
                }
            }
        }
    }

    cancellation
        .requests
        .lock()
        .ok()
        .and_then(|mut requests| requests.remove(&request_id));

    if cancelled {
        let _ = on_event.send(ChatStreamEvent::new("cancelled", ""));
        return Ok(());
    }

    if !emitted_delta {
        return Err("模型响应中没有可用文本".into());
    }

    let _ = on_event.send(ChatStreamEvent::new("finished", ""));
    Ok(())
}

#[tauri::command]
fn cancel_chat_generation(
    cancellation: tauri::State<'_, ChatCancellationState>,
    request_id: String,
) -> Result<bool, String> {
    let requests = cancellation
        .requests
        .lock()
        .map_err(|_| "无法读取生成状态".to_string())?;
    Ok(requests
        .get(&request_id)
        .is_some_and(|sender| sender.send(true).is_ok()))
}

#[tauri::command]
async fn create_managed_output(
    app: tauri::AppHandle,
    project_id: String,
) -> Result<String, String> {
    let safe_project_id: String = project_id
        .chars()
        .filter(|character| character.is_ascii_alphanumeric() || *character == '-')
        .collect();
    if safe_project_id.is_empty() {
        return Err("项目 ID 无效".into());
    }

    let output_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法获取应用数据目录：{error}"))?
        .join("outputs")
        .join(safe_project_id);
    std::fs::create_dir_all(output_dir.join("source"))
        .map_err(|error| format!("无法创建应用输出目录：{error}"))?;

    Ok(output_dir.to_string_lossy().into_owned())
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

    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法获取应用数据目录：{error}"))?;
    let managed_output_dir = app_data_dir.join("outputs").join(&safe_project_id);
    let project_dir = if managed_output_dir.exists() {
        managed_output_dir.join("source")
    } else {
        app_data_dir
            .join("projects")
            .join(safe_project_id)
            .join("source")
    };

    std::fs::create_dir_all(&project_dir).map_err(|error| format!("无法创建项目目录：{error}"))?;
    let path = project_dir.join(safe_file_name);
    std::fs::write(&path, content).map_err(|error| format!("无法保存文件：{error}"))?;

    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
async fn read_project_source(app: tauri::AppHandle, path: String) -> Result<String, String> {
    if path.trim().is_empty() {
        return Err("原著文件路径为空".into());
    }

    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法获取应用数据目录：{error}"))?;
    let canonical_path = std::fs::canonicalize(Path::new(&path))
        .map_err(|error| format!("无法访问原著文件：{error}"))?;

    let allowed = [app_data_dir.join("projects"), app_data_dir.join("outputs")]
        .iter()
        .filter(|root| root.exists())
        .filter_map(|root| std::fs::canonicalize(root).ok())
        .any(|root| canonical_path.starts_with(root));

    if !allowed {
        return Err("拒绝读取项目资源目录之外的文件".into());
    }

    std::fs::read_to_string(&canonical_path).map_err(|error| format!("无法读取原著文件：{error}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(ChatCancellationState::default())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            test_model_endpoint,
            list_provider_models,
            stream_chat_message,
            cancel_chat_generation,
            create_managed_output,
            save_project_source,
            read_project_source
        ])
        .run(tauri::generate_context!())
        .expect("error while running Manju Agent");
}

#[cfg(test)]
mod tests {
    use super::{complete_response_text, parse_sse_line, uses_kie_market, KIE_SEEDREAM_MODELS};
    use serde_json::json;

    #[test]
    fn parses_openai_chat_completion_delta() {
        let line = r#"data: {"choices":[{"delta":{"content":"你好"}}]}"#;

        assert_eq!(
            parse_sse_line(line.as_bytes(), false).as_deref(),
            Some("你好")
        );
    }

    #[test]
    fn parses_anthropic_content_block_delta() {
        let line =
            r#"data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"世界"}}"#;

        assert_eq!(
            parse_sse_line(line.as_bytes(), true).as_deref(),
            Some("世界")
        );
    }

    #[test]
    fn ignores_sse_control_lines() {
        assert_eq!(parse_sse_line(b"event: message_start", true), None);
        assert_eq!(parse_sse_line(b"data: [DONE]", false), None);
    }

    #[test]
    fn reads_non_streaming_fallback_payloads() {
        let openai = json!({"choices": [{"message": {"content": "完整回复"}}]});
        let anthropic = json!({"content": [{"type": "text", "text": "完整回复"}]});

        assert_eq!(complete_response_text(&openai, false), Some("完整回复"));
        assert_eq!(complete_response_text(&anthropic, true), Some("完整回复"));
    }

    #[test]
    fn recognizes_kie_seedream_provider_and_model() {
        assert!(uses_kie_market("Kie.ai Seedream"));
        assert!(!uses_kie_market("字节火山方舟 Seedream"));
        assert_eq!(KIE_SEEDREAM_MODELS, ["seedream/5-pro-text-to-image"]);
    }
}
