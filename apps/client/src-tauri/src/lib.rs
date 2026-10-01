mod account;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![account::account_request])
        .run(tauri::generate_context!())
        .expect("failed to run Zhiya");
}
