use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::LazyLock;
use std::sync::Mutex;
use tauri::{menu::Menu, tray::TrayIconBuilder, Emitter, Manager};
use warp::Filter;

#[cfg(target_os = "macos")]
use cocoa::appkit::{NSWindow, NSWindowCollectionBehavior};
#[cfg(target_os = "macos")]
use cocoa::base::{id, nil};
#[cfg(target_os = "macos")]
use objc::runtime::{BOOL, YES};
#[cfg(target_os = "macos")]
use objc::*;

// ============================================================================
// Review Queue Types & State
// ============================================================================

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ReviewItem {
    pub id: String,
    pub seq: u64,
    pub title: String,
    pub project: Option<String>,
    pub timestamp: u64,
    pub tmux_session: Option<String>,
    pub tmux_window: Option<String>,
    pub tmux_pane: Option<String>,
    pub session_id: Option<String>,
    pub project_path: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct NotifierSettings {
    pub notify: bool,
    pub float_window: bool,
    pub menu_bar: bool,
    pub shortcut: String,
}

impl Default for NotifierSettings {
    fn default() -> Self {
        Self {
            notify: true,
            float_window: true,
            menu_bar: true,
            shortcut: "F4".to_string(),
        }
    }
}

// Global review queue
static REVIEW_QUEUE: LazyLock<Mutex<Vec<ReviewItem>>> = LazyLock::new(|| Mutex::new(Vec::new()));

// Global completed queue
static COMPLETED_QUEUE: LazyLock<Mutex<Vec<ReviewItem>>> = LazyLock::new(|| Mutex::new(Vec::new()));

// Global auto-increment sequence number
static REVIEW_SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);

// Notification server port
const NOTIFY_SERVER_PORT: u16 = 23567;

// ============================================================================
// Path Helpers
// ============================================================================

fn get_data_dir() -> PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("lovnotifier")
}

fn get_config_dir() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("lovnotifier")
}

fn get_review_queue_path() -> PathBuf {
    get_data_dir().join("review_queue.json")
}

fn get_completed_queue_path() -> PathBuf {
    get_data_dir().join("completed_queue.jsonl")
}

fn get_review_seq_path() -> PathBuf {
    get_data_dir().join("review_seq")
}

fn get_settings_path() -> PathBuf {
    get_config_dir().join("settings.json")
}

// ============================================================================
// Persistence Functions
// ============================================================================

fn load_review_queue() {
    let path = get_review_queue_path();
    println!("[Lovnotifier] Loading review queue from {:?}", path);
    if path.exists() {
        if let Ok(content) = fs::read_to_string(&path) {
            match serde_json::from_str::<Vec<ReviewItem>>(&content) {
                Ok(items) => {
                    println!("[Lovnotifier] Loaded {} items from review queue", items.len());
                    let mut queue = REVIEW_QUEUE.lock().unwrap();
                    *queue = items;
                }
                Err(e) => {
                    println!("[Lovnotifier] Failed to parse review queue: {}", e);
                }
            }
        }
    }
}

fn save_review_queue() {
    let path = get_review_queue_path();
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let queue = REVIEW_QUEUE.lock().unwrap();
    if let Ok(json) = serde_json::to_string_pretty(&*queue) {
        let _ = fs::write(&path, json);
    }
}

fn load_completed_queue() {
    let path = get_completed_queue_path();
    if path.exists() {
        if let Ok(content) = fs::read_to_string(&path) {
            let mut queue = COMPLETED_QUEUE.lock().unwrap();
            for line in content.lines() {
                if let Ok(item) = serde_json::from_str::<ReviewItem>(line) {
                    queue.push(item);
                }
            }
        }
    }
}

fn persist_completed_item(item: &ReviewItem) {
    let path = get_completed_queue_path();
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(json) = serde_json::to_string(item) {
        use std::io::Write;
        if let Ok(mut file) = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
        {
            let _ = writeln!(file, "{}", json);
        }
    }
}

fn load_review_seq() {
    if let Ok(content) = fs::read_to_string(get_review_seq_path()) {
        if let Ok(seq) = content.trim().parse::<u64>() {
            REVIEW_SEQ.store(seq, std::sync::atomic::Ordering::SeqCst);
        }
    }
}

fn next_review_seq() -> u64 {
    let seq = REVIEW_SEQ.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    let path = get_review_seq_path();
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let _ = fs::write(&path, (seq + 1).to_string());
    seq
}

fn migrate_from_lovcode() {
    let old_dir = dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("lovcode");
    let new_dir = get_data_dir();

    if old_dir.exists() && !new_dir.exists() {
        println!("[Lovnotifier] Migrating data from Lovcode...");
        let _ = fs::create_dir_all(&new_dir);
        for file in ["review_queue.json", "completed_queue.jsonl", "review_seq"] {
            let src = old_dir.join(file);
            let dst = new_dir.join(file);
            if src.exists() {
                if let Err(e) = fs::copy(&src, &dst) {
                    println!("[Lovnotifier] Failed to migrate {}: {}", file, e);
                } else {
                    println!("[Lovnotifier] Migrated {}", file);
                }
            }
        }
    }
}

// ============================================================================
// Settings Commands
// ============================================================================

#[tauri::command]
fn get_settings() -> NotifierSettings {
    let path = get_settings_path();
    if path.exists() {
        if let Ok(content) = fs::read_to_string(&path) {
            if let Ok(settings) = serde_json::from_str(&content) {
                return settings;
            }
        }
    }
    NotifierSettings::default()
}

#[tauri::command]
fn save_settings(settings: NotifierSettings) -> Result<(), String> {
    let path = get_settings_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())?;
    Ok(())
}

// ============================================================================
// Review Queue Commands
// ============================================================================

#[tauri::command]
fn emit_review_queue(window: tauri::Window, items: Vec<ReviewItem>) -> Result<(), String> {
    window
        .emit("review-queue-update", items)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn get_review_queue() -> Vec<ReviewItem> {
    REVIEW_QUEUE.lock().unwrap().clone()
}

#[tauri::command]
fn get_completed_queue(limit: Option<usize>, offset: Option<usize>) -> Vec<ReviewItem> {
    let queue = COMPLETED_QUEUE.lock().unwrap();
    let skip = offset.unwrap_or(0);
    let take = limit.unwrap_or(50);
    queue.iter().rev().skip(skip).take(take).cloned().collect()
}

#[tauri::command]
fn dismiss_review_item(app_handle: tauri::AppHandle, id: String) -> Result<(), String> {
    let dismissed_item = {
        let mut queue = REVIEW_QUEUE.lock().unwrap();
        let pos = queue.iter().position(|item| item.id == id);
        pos.map(|i| queue.remove(i))
    };

    if let Some(mut item) = dismissed_item {
        item.timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        {
            let mut completed = COMPLETED_QUEUE.lock().unwrap();
            completed.push(item.clone());
        }

        persist_completed_item(&item);

        let pending = REVIEW_QUEUE.lock().unwrap().clone();
        let _ = app_handle.emit("review-queue-update", pending);

        update_tray_menu(&app_handle);
        save_review_queue();
    }

    Ok(())
}

#[tauri::command]
fn clear_completed_queue() -> Result<(), String> {
    {
        let mut queue = COMPLETED_QUEUE.lock().unwrap();
        queue.clear();
    }
    let path = get_completed_queue_path();
    if path.exists() {
        fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ============================================================================
// tmux Navigation
// ============================================================================

#[tauri::command]
fn navigate_to_tmux_pane(session: String, window: String, pane: String) -> Result<(), String> {
    println!(
        "[Lovnotifier] Navigate to tmux: session={}, window={}, pane={}",
        session, window, pane
    );

    #[cfg(target_os = "macos")]
    {
        let script = format!(
            r#"
            tell application "iTerm2"
                activate
                repeat with w in windows
                    repeat with t in tabs of w
                        repeat with s in sessions of t
                            if name of s contains "{}" then
                                select w
                                select t
                                select s
                                return "FOUND"
                            end if
                        end repeat
                    end repeat
                end repeat
                return "NOT_FOUND"
            end tell
        "#,
            session
        );

        let _ = std::process::Command::new("osascript")
            .args(["-e", &script])
            .output();

        if !window.is_empty() {
            let _ = std::process::Command::new("tmux")
                .args(["select-window", "-t", &format!("{}:{}", session, window)])
                .output();
        }
        if !pane.is_empty() {
            let _ = std::process::Command::new("tmux")
                .args([
                    "select-pane",
                    "-t",
                    &format!("{}:{}.{}", session, window, pane),
                ])
                .output();
        }
    }

    Ok(())
}

// ============================================================================
// Notification HTTP Server
// ============================================================================

#[derive(Debug, Deserialize)]
struct NotifyPayload {
    title: String,
    project: Option<String>,
    project_path: Option<String>,
    session_id: Option<String>,
    tmux_session: Option<String>,
    tmux_window: Option<String>,
    tmux_pane: Option<String>,
}

fn start_notify_server(app_handle: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        let app_handle = Arc::new(app_handle);

        let app_for_notify = app_handle.clone();
        let notify_route = warp::post()
            .and(warp::path("notify"))
            .and(warp::body::json())
            .map(move |payload: NotifyPayload| {
                let app = app_for_notify.clone();
                let item = ReviewItem {
                    id: format!(
                        "{}",
                        std::time::SystemTime::now()
                            .duration_since(std::time::UNIX_EPOCH)
                            .unwrap_or_default()
                            .as_millis()
                    ),
                    seq: next_review_seq(),
                    title: payload.title,
                    project: payload.project,
                    timestamp: std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_secs(),
                    tmux_session: payload.tmux_session,
                    tmux_window: payload.tmux_window,
                    tmux_pane: payload.tmux_pane,
                    session_id: payload.session_id,
                    project_path: payload.project_path,
                };

                {
                    let mut queue = REVIEW_QUEUE.lock().unwrap();
                    if item.tmux_session.is_some()
                        || item.tmux_window.is_some()
                        || item.tmux_pane.is_some()
                    {
                        queue.retain(|existing| {
                            existing.tmux_session != item.tmux_session
                                || existing.tmux_window != item.tmux_window
                                || existing.tmux_pane != item.tmux_pane
                        });
                    }
                    queue.push(item.clone());
                }

                let queue = REVIEW_QUEUE.lock().unwrap().clone();
                let _ = app.emit("review-queue-update", queue);
                update_tray_menu(&app);
                save_review_queue();

                warp::reply::json(&serde_json::json!({"ok": true, "id": item.id}))
            });

        let queue_route = warp::get().and(warp::path("queue")).map(|| {
            let queue = REVIEW_QUEUE.lock().unwrap().clone();
            warp::reply::json(&queue)
        });

        let dismiss_route = warp::delete()
            .and(warp::path("queue"))
            .and(warp::path::param::<String>())
            .map(move |id: String| {
                let mut queue = REVIEW_QUEUE.lock().unwrap();
                queue.retain(|item| item.id != id);
                warp::reply::json(&serde_json::json!({"ok": true}))
            });

        let routes = notify_route.or(queue_route).or(dismiss_route);

        println!(
            "[Lovnotifier] Notification server starting on port {}",
            NOTIFY_SERVER_PORT
        );
        warp::serve(routes)
            .run(([127, 0, 0, 1], NOTIFY_SERVER_PORT))
            .await;
    });
}

// ============================================================================
// Tray Menu
// ============================================================================

fn build_tray_menu<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<Menu<R>, tauri::Error> {
    use tauri::menu::{MenuBuilder, MenuItemBuilder};

    let queue = REVIEW_QUEUE.lock().unwrap();
    let mut menu_builder = MenuBuilder::new(app);

    if queue.is_empty() {
        let empty_item = MenuItemBuilder::with_id("empty", "No messages")
            .enabled(false)
            .build(app)?;
        menu_builder = menu_builder.item(&empty_item);
    } else {
        let mut sorted: Vec<_> = queue.iter().collect();
        sorted.sort_by_key(|item| item.timestamp);

        for item in sorted.iter().take(10) {
            let label = format!("#{} {}", item.seq, truncate_str(&item.title, 30));
            let menu_item =
                MenuItemBuilder::with_id(format!("msg:{}", item.id), label).build(app)?;
            menu_builder = menu_builder.item(&menu_item);
        }

        if queue.len() > 10 {
            let more_item =
                MenuItemBuilder::with_id("more", format!("... and {} more", queue.len() - 10))
                    .enabled(false)
                    .build(app)?;
            menu_builder = menu_builder.item(&more_item);
        }
    }

    menu_builder = menu_builder.separator();

    let toggle_float =
        MenuItemBuilder::with_id("tray_toggle_float", "Toggle Float Window").build(app)?;
    let settings_item = MenuItemBuilder::with_id("tray_settings", "Settings...").build(app)?;
    let quit_item = MenuItemBuilder::with_id("tray_quit", "Quit").build(app)?;

    menu_builder
        .item(&toggle_float)
        .item(&settings_item)
        .separator()
        .item(&quit_item)
        .build()
}

fn truncate_str(s: &str, max_len: usize) -> String {
    if s.chars().count() <= max_len {
        s.to_string()
    } else {
        let truncated: String = s.chars().take(max_len - 1).collect();
        format!("{}…", truncated)
    }
}

fn consume_review_item<R: tauri::Runtime>(app: &tauri::AppHandle<R>, msg_id: &str) {
    let item = {
        let queue = REVIEW_QUEUE.lock().unwrap();
        queue.iter().find(|i| i.id == msg_id).cloned()
    };

    if let Some(item) = item {
        if let (Some(session), Some(window), Some(pane)) =
            (&item.tmux_session, &item.tmux_window, &item.tmux_pane)
        {
            let _ = navigate_to_tmux_pane(session.clone(), window.clone(), pane.clone());
        }

        {
            let mut queue = REVIEW_QUEUE.lock().unwrap();
            if let Some(pos) = queue.iter().position(|i| i.id == msg_id) {
                let removed = queue.remove(pos);
                persist_completed_item(&removed);

                let mut completed = COMPLETED_QUEUE.lock().unwrap();
                completed.insert(0, removed);
                completed.truncate(100);
            }
        }

        let current_queue: Vec<ReviewItem> = REVIEW_QUEUE.lock().unwrap().clone();
        let _ = app.emit("review-queue-update", current_queue);
        update_tray_menu(app);
        save_review_queue();
    }
}

fn update_tray_menu<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    if let Some(tray) = app.tray_by_id("main-tray") {
        if let Ok(menu) = build_tray_menu(app) {
            let _ = tray.set_menu(Some(menu));
        }
        let count = REVIEW_QUEUE.lock().unwrap().len();
        let _ = tray.set_title(Some(count.to_string()));
    }
}

// ============================================================================
// macOS Window Configuration
// ============================================================================

#[cfg(target_os = "macos")]
fn setup_float_window_macos(app: &tauri::App) {
    use objc::*;
    use tauri::Manager;

    if let Some(window) = app.get_webview_window("float") {
        if let Ok(ns_window) = window.ns_window() {
            unsafe {
                let ns_win: id = ns_window as id;
                ns_win.setAcceptsMouseMovedEvents_(YES);

                let behavior =
                    NSWindowCollectionBehavior::NSWindowCollectionBehaviorCanJoinAllSpaces
                        | NSWindowCollectionBehavior::NSWindowCollectionBehaviorStationary
                        | NSWindowCollectionBehavior::NSWindowCollectionBehaviorIgnoresCycle;
                ns_win.setCollectionBehavior_(behavior);
                ns_win.setLevel_(3);

                let current_style: u64 = msg_send![ns_win, styleMask];
                let new_style = current_style | (1 << 7);
                let _: () = msg_send![ns_win, setStyleMask: new_style];

                ns_win.setIgnoresMouseEvents_(cocoa::base::NO);
                let _: () = msg_send![ns_win, disableCursorRects];

                println!("[Lovnotifier] Float window macOS properties configured");
            }
        }
        let _ = window.hide();
    }
}

// ============================================================================
// Cursor Control (macOS)
// ============================================================================

#[derive(Serialize)]
struct CursorInWindow {
    supported: bool,
    in_window: bool,
    x: f64,
    y: f64,
}

#[tauri::command]
fn get_cursor_position_in_window(app_handle: tauri::AppHandle, label: String) -> CursorInWindow {
    #[cfg(target_os = "macos")]
    {
        use tauri::Manager;

        let mut result = CursorInWindow {
            supported: true,
            in_window: false,
            x: 0.0,
            y: 0.0,
        };

        if let Some(window) = app_handle.get_webview_window(&label) {
            if let Ok(ns_window) = window.ns_window() {
                unsafe {
                    let ns_win: id = ns_window as id;
                    let location: cocoa::foundation::NSPoint =
                        msg_send![class!(NSEvent), mouseLocation];
                    let window_point: cocoa::foundation::NSPoint =
                        msg_send![ns_win, convertPointFromScreen: location];
                    let content_view: id = msg_send![ns_win, contentView];

                    if content_view != nil {
                        let view_point: cocoa::foundation::NSPoint =
                            msg_send![content_view, convertPoint: window_point fromView: nil];
                        let view_bounds: cocoa::foundation::NSRect =
                            msg_send![content_view, bounds];
                        let width = view_bounds.size.width;
                        let height = view_bounds.size.height;
                        let local_x = view_point.x - view_bounds.origin.x;
                        let local_y = view_point.y - view_bounds.origin.y;
                        let flipped: BOOL = msg_send![content_view, isFlipped];

                        if local_x >= 0.0 && local_x <= width && local_y >= 0.0 && local_y <= height
                        {
                            result.in_window = true;
                            result.x = local_x;
                            result.y = if flipped == YES {
                                local_y
                            } else {
                                height - local_y
                            };
                        }
                    }
                }
            }
        }
        result
    }

    #[cfg(not(target_os = "macos"))]
    CursorInWindow {
        supported: false,
        in_window: false,
        x: 0.0,
        y: 0.0,
    }
}

#[derive(Serialize)]
struct CursorPosition {
    x: f64,
    y: f64,
}

#[tauri::command]
fn get_cursor_position() -> CursorPosition {
    #[cfg(target_os = "macos")]
    {
        unsafe {
            let location: cocoa::foundation::NSPoint =
                msg_send![class!(NSEvent), mouseLocation];
            let screen_height: cocoa::foundation::NSRect =
                msg_send![cocoa::appkit::NSScreen::mainScreen(nil), frame];
            CursorPosition {
                x: location.x,
                y: screen_height.size.height - location.y,
            }
        }
    }
    #[cfg(not(target_os = "macos"))]
    CursorPosition { x: 0.0, y: 0.0 }
}

#[tauri::command]
fn set_cursor(cursor_type: String) {
    #[cfg(target_os = "macos")]
    {
        unsafe {
            let cursor_class = class!(NSCursor);
            let cursor: id = match cursor_type.as_str() {
                "default" | "auto" => msg_send![cursor_class, arrowCursor],
                "pointer" => msg_send![cursor_class, pointingHandCursor],
                "text" => msg_send![cursor_class, IBeamCursor],
                "crosshair" => msg_send![cursor_class, crosshairCursor],
                "move" => msg_send![cursor_class, openHandCursor],
                "grab" => msg_send![cursor_class, openHandCursor],
                "grabbing" => msg_send![cursor_class, closedHandCursor],
                "not-allowed" => msg_send![cursor_class, operationNotAllowedCursor],
                "resize-ew" | "ew-resize" | "col-resize" => {
                    msg_send![cursor_class, resizeLeftRightCursor]
                }
                "resize-ns" | "ns-resize" | "row-resize" => {
                    msg_send![cursor_class, resizeUpDownCursor]
                }
                _ => msg_send![cursor_class, arrowCursor],
            };
            let _: () = msg_send![cursor, set];
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = cursor_type;
    }
}

// ============================================================================
// App Entry Point
// ============================================================================

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // Migrate data from Lovcode if needed
            migrate_from_lovcode();

            // Load persisted data
            load_review_seq();
            load_review_queue();
            load_completed_queue();

            // Start notification HTTP server
            start_notify_server(app.handle().clone());

            // Configure float window for macOS
            #[cfg(target_os = "macos")]
            setup_float_window_macos(app);

            // Register global shortcut F4
            #[cfg(desktop)]
            {
                use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Shortcut, ShortcutState};

                let f4_shortcut = Shortcut::new(None, Code::F4);
                let shortcut_app = app.handle().clone();

                app.handle().plugin(
                    tauri_plugin_global_shortcut::Builder::new()
                        .with_handler(move |_app, shortcut, event| {
                            if shortcut == &f4_shortcut && event.state() == ShortcutState::Pressed {
                                let oldest_id = {
                                    let queue = REVIEW_QUEUE.lock().unwrap();
                                    queue
                                        .iter()
                                        .min_by_key(|item| item.timestamp)
                                        .map(|item| item.id.clone())
                                };
                                if let Some(id) = oldest_id {
                                    consume_review_item(&shortcut_app, &id);
                                }
                            }
                        })
                        .build(),
                )?;

                app.global_shortcut().register(f4_shortcut)?;
            }

            // Create system tray
            let app_handle = app.handle();
            let initial_count = REVIEW_QUEUE.lock().unwrap().len();
            let tray_menu = build_tray_menu(app_handle)?;
            println!("[Lovnotifier] Tray init: queue has {} messages", initial_count);

            let _tray = TrayIconBuilder::with_id("main-tray")
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&tray_menu)
                .show_menu_on_left_click(true)
                .tooltip("Lovnotifier")
                .title(initial_count.to_string())
                .on_menu_event(|app, event| {
                    use tauri::WebviewWindowBuilder;
                    use tauri::WebviewUrl;

                    let id = event.id.as_ref();
                    if id.starts_with("msg:") {
                        let msg_id = &id[4..];
                        consume_review_item(app, msg_id);
                    } else if id == "tray_toggle_float" {
                        if let Some(window) = app.get_webview_window("float") {
                            if window.is_visible().unwrap_or(false) {
                                let _ = window.hide();
                            } else {
                                let _ = window.show();
                            }
                        } else {
                            if let Ok(window) = WebviewWindowBuilder::new(
                                app,
                                "float",
                                WebviewUrl::App("/float.html".into()),
                            )
                            .title("")
                            .inner_size(121.0, 48.0)
                            .position(100.0, 100.0)
                            .decorations(false)
                            .transparent(true)
                            .always_on_top(true)
                            .skip_taskbar(true)
                            .resizable(false)
                            .visible(true)
                            .focused(false)
                            .build()
                            {
                                let _ = window.show();
                            }
                        }
                    } else if id == "tray_settings" {
                        // Open settings window
                        if let Some(window) = app.get_webview_window("settings") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        } else {
                            if let Ok(window) = WebviewWindowBuilder::new(
                                app,
                                "settings",
                                WebviewUrl::App("/index.html".into()),
                            )
                            .title("Lovnotifier Settings")
                            .inner_size(400.0, 300.0)
                            .resizable(false)
                            .build()
                            {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                    } else if id == "tray_quit" {
                        std::process::exit(0);
                    }
                })
                .build(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_settings,
            save_settings,
            emit_review_queue,
            get_review_queue,
            get_completed_queue,
            dismiss_review_item,
            clear_completed_queue,
            navigate_to_tmux_pane,
            get_cursor_position_in_window,
            get_cursor_position,
            set_cursor,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
