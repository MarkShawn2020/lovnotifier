#!/bin/bash
# Lovnotifier 通知发送器 v3.0
# 用法: lovnotifier-send -title "标题" -message "内容" -session "xxx" -window "x" -pane "x"
#
# 支持两种模式：
# 1. HTTP 模式（默认）：POST 到 Tauri 应用的 HTTP 服务器
# 2. 系统通知模式：通过 terminal-notifier 发送 macOS 系统通知

export PATH="$HOME/bin:/opt/homebrew/bin:$PATH"

# HTTP 服务器地址
HTTP_SERVER="http://127.0.0.1:23567/notify"

# 兼容模式：terminal-notifier 路径
APP_DIR="$HOME/Applications/Lovnotifier.app/Contents"
NOTIFIER_BIN="$APP_DIR/MacOS/terminal-notifier"
ACTIVATE_SCRIPT="$APP_DIR/Resources/activate.sh"

LOG="/tmp/lovnotifier-send.log"

TITLE=""
MESSAGE=""
SESSION=""
WINDOW=""
PANE=""
GROUP=""
SOUND=""
PROJECT=""
PROJECT_PATH=""
SESSION_ID=""
USE_SYSTEM_NOTIFY=""

echo "[SEND] ===== $(date) =====" >> "$LOG"
echo "[SEND] argv: $*" >> "$LOG"

# 解析参数
while [[ $# -gt 0 ]]; do
    case $1 in
        -title) TITLE="$2"; shift 2 ;;
        -message) MESSAGE="$2"; shift 2 ;;
        -session) SESSION="$2"; shift 2 ;;
        -window) WINDOW="$2"; shift 2 ;;
        -pane) PANE="$2"; shift 2 ;;
        -group) GROUP="$2"; shift 2 ;;
        -sound) SOUND="$2"; shift 2 ;;
        -project) PROJECT="$2"; shift 2 ;;
        -project-path) PROJECT_PATH="$2"; shift 2 ;;
        -session-id) SESSION_ID="$2"; shift 2 ;;
        -system-notify) USE_SYSTEM_NOTIFY="true"; shift ;;
        *) shift ;;
    esac
done

echo "[SEND] parsed title=$TITLE session=$SESSION window=$WINDOW pane=$PANE" >> "$LOG"

# 构建 JSON payload
build_json() {
    local json="{"
    json+="\"title\":\"${TITLE:-通知}\""

    [ -n "$PROJECT" ] && json+=",\"project\":\"$PROJECT\""
    [ -n "$PROJECT_PATH" ] && json+=",\"project_path\":\"$PROJECT_PATH\""
    [ -n "$SESSION_ID" ] && json+=",\"session_id\":\"$SESSION_ID\""
    [ -n "$SESSION" ] && json+=",\"tmux_session\":\"$SESSION\""
    [ -n "$WINDOW" ] && json+=",\"tmux_window\":\"$WINDOW\""
    [ -n "$PANE" ] && json+=",\"tmux_pane\":\"$PANE\""

    json+="}"
    echo "$json"
}

# 发送到 HTTP 服务器
send_http() {
    local json
    json=$(build_json)
    echo "[SEND] HTTP payload: $json" >> "$LOG"

    local response
    response=$(curl -s -X POST "$HTTP_SERVER" \
        -H "Content-Type: application/json" \
        -d "$json" \
        --connect-timeout 2 \
        --max-time 5 \
        2>> "$LOG")

    local exit_code=$?
    echo "[SEND] HTTP response: $response (exit: $exit_code)" >> "$LOG"

    return $exit_code
}

# 发送系统通知（可选）
send_system_notify() {
    if [ ! -x "$NOTIFIER_BIN" ]; then
        echo "[SEND] warning: terminal-notifier not found at $NOTIFIER_BIN" >> "$LOG"
        return 1
    fi

    (
        CMD=(
            "$NOTIFIER_BIN"
            -title "${TITLE:-通知}"
            -message "${MESSAGE:-}"
            -group "${GROUP:-lovnotifier}"
        )

        [ -n "$SOUND" ] && CMD+=( -sound "$SOUND" )

        if [ -n "$SESSION" ]; then
            CMD+=( -execute "bash '$ACTIVATE_SCRIPT' '$SESSION' '$WINDOW' '$PANE'" )
        fi

        echo "[SEND] system notify cmd: ${CMD[*]}" >> "$LOG"
        "${CMD[@]}" 2>> "$LOG"
        echo "[SEND] terminal-notifier done" >> "$LOG"
    ) &
}

# 主逻辑：优先使用 HTTP，可选系统通知
send_http

if [ -n "$USE_SYSTEM_NOTIFY" ]; then
    send_system_notify
fi

echo "[SEND] done" >> "$LOG"
exit 0
