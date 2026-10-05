use tauri_plugin_dialog::DialogExt;

#[tauri::command]
pub async fn save_deliverable(
    app: tauri::AppHandle,
    name: String,
    bytes: Vec<u8>,
) -> Result<bool, String> {
    let extension = match name.rsplit('.').next() {
        Some("pptx") => "pptx",
        Some("docx") => "docx",
        Some("html") => "html",
        _ => return Err("不支持的文件格式".into()),
    };
    if name.contains(['/', '\\']) || bytes.is_empty() || bytes.len() > 128 * 1024 * 1024 {
        return Err("导出文件无效或过大".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let selected = app
            .dialog()
            .file()
            .set_file_name(&name)
            .add_filter(
                if extension == "html" {
                    "HTML 网页"
                } else {
                    "Office 文档"
                },
                &[extension],
            )
            .blocking_save_file();
        let Some(selected) = selected else {
            return Ok(false);
        };
        let path = selected
            .into_path()
            .map_err(|_| "无法读取保存位置".to_owned())?;
        std::fs::write(path, bytes)
            .map_err(|_| "文件保存失败，请检查目录权限和可用空间".to_owned())?;
        Ok(true)
    })
    .await
    .map_err(|_| "文件保存失败".to_owned())?
}
