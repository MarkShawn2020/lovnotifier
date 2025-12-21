#!/bin/bash
# 通用 tmux 激活脚本
# 用法: activate.sh <session> <window> <pane>

export PATH="/opt/homebrew/bin:$PATH"

SESSION="$1"
WINDOW="$2"
PANE="$3"

LOG="/tmp/lovnotifier-debug.log"
echo "[ACTIVATE] $(date) session=$SESSION window=$WINDOW pane=$PANE" >> "$LOG"
echo "[ACTIVATE] PATH=$PATH" >> "$LOG"
echo "[ACTIVATE] TMUX=$TMUX" >> "$LOG"
echo "[ACTIVATE] tmux=$(command -v tmux)" >> "$LOG"

if [ -z "$SESSION" ]; then
    echo "[ACTIVATE] 错误: 缺少 session 参数" >> "$LOG"
    exit 1
fi

# tmux 状态
TMUX_LIST=$(tmux list-sessions -F '#S' 2>&1)
echo "[ACTIVATE] tmux list-sessions rc=$? out=$TMUX_LIST" >> "$LOG"
HAS_OUT=$(tmux has-session -t "$SESSION" 2>&1)
echo "[ACTIVATE] tmux has-session rc=$? out=$HAS_OUT" >> "$LOG"
WIN_LIST=$(tmux list-windows -t "$SESSION" -F '#I:#W' 2>&1)
echo "[ACTIVATE] tmux list-windows rc=$? out=$WIN_LIST" >> "$LOG"

# 激活 iTerm2 并切换到对应 tab
OSA_OUT=$(osascript <<EOF 2>&1
tell application "iTerm2"
    activate
    repeat with w in windows
        repeat with t in tabs of w
            repeat with s in sessions of t
                if name of s contains "$SESSION" then
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
EOF
)
OSA_RC=$?
echo "[ACTIVATE] osascript rc=$OSA_RC out=$OSA_OUT" >> "$LOG"

# 切换 tmux 窗口和 pane
if [ -n "$WINDOW" ]; then
    WIN_OUT=$(tmux select-window -t "${SESSION}:${WINDOW}" 2>&1)
    WIN_RC=$?
    echo "[ACTIVATE] select-window rc=$WIN_RC out=$WIN_OUT" >> "$LOG"
fi

if [ -n "$PANE" ]; then
    PANE_OUT=$(tmux select-pane -t "${SESSION}:${WINDOW}.${PANE}" 2>&1)
    PANE_RC=$?
    echo "[ACTIVATE] select-pane rc=$PANE_RC out=$PANE_OUT" >> "$LOG"
fi

echo "[ACTIVATE] 完成" >> "$LOG"
