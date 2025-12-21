#!/bin/bash
# Lovnotifier 通知发送器
# 用法: lovnotifier-send -title "标题" -message "内容" -session "xxx" -window "x" -pane "x"

export PATH="$HOME/bin:/opt/homebrew/bin:$PATH"

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
        *) shift ;;
    esac
done

echo "[SEND] parsed title=$TITLE message=$MESSAGE session=$SESSION window=$WINDOW pane=$PANE group=$GROUP" >> "$LOG"

if [ ! -x "$NOTIFIER_BIN" ]; then
    echo "[SEND] error: missing terminal-notifier binary at $NOTIFIER_BIN" >> "$LOG"
    exit 1
fi

# 后台运行 terminal-notifier 并处理用户点击
(
    CMD=(
        "$NOTIFIER_BIN"
        -title "${TITLE:-通知}"
        -message "${MESSAGE:-}"
        -group "${GROUP:-lovnotifier}"
    )

    # terminal-notifier 用 -execute 处理点击回调
    if [ -n "$SESSION" ]; then
        CMD+=( -execute "bash '$ACTIVATE_SCRIPT' '$SESSION' '$WINDOW' '$PANE'" )
    fi

    echo "[SEND] cmd: ${CMD[*]}" >> "$LOG"
    "${CMD[@]}" 2>> "$LOG"
    echo "[SEND] terminal-notifier done" >> "$LOG"
) &

echo "[SEND] dispatched to background" >> "$LOG"
exit 0
