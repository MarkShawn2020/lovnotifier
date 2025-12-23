#!/bin/bash
# Lovnotifier 构建脚本 v3.0
# 构建 Tauri 应用并复制到 ~/Applications

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_NAME="Lovnotifier"
OUTPUT_DIR="$HOME/Applications"
APP_PATH="$OUTPUT_DIR/$APP_NAME.app"

echo "构建 $APP_NAME (Tauri 2)..."
echo "源码目录: $SCRIPT_DIR"
echo "输出目录: $APP_PATH"

cd "$SCRIPT_DIR"

# 安装依赖（如果需要）
if [ ! -d "node_modules" ]; then
    echo "安装 npm 依赖..."
    pnpm install
fi

# 构建 Tauri 应用
echo "构建 Tauri 应用..."
pnpm tauri build

# 查找构建产物
BUILT_APP="$SCRIPT_DIR/src-tauri/target/release/bundle/macos/$APP_NAME.app"

if [ ! -d "$BUILT_APP" ]; then
    echo "错误：找不到构建产物 $BUILT_APP"
    exit 1
fi

# 确保输出目录存在
mkdir -p "$OUTPUT_DIR"

# 清理旧的 app
rm -rf "$APP_PATH"

# 复制新构建的 app
echo "复制到 $OUTPUT_DIR..."
cp -r "$BUILT_APP" "$OUTPUT_DIR/"

# 复制 shell 脚本到 app bundle
echo "添加 shell 脚本..."
cp "$SCRIPT_DIR/scripts/lovnotifier-send.sh" "$APP_PATH/Contents/MacOS/lovnotifier-send"
cp "$SCRIPT_DIR/scripts/activate.sh" "$APP_PATH/Contents/Resources/"
chmod +x "$APP_PATH/Contents/MacOS/lovnotifier-send"
chmod +x "$APP_PATH/Contents/Resources/activate.sh"

# 复制 terminal-notifier（用于可选的系统通知）
if [ -f "$SCRIPT_DIR/vendor/terminal-notifier" ]; then
    cp "$SCRIPT_DIR/vendor/terminal-notifier" "$APP_PATH/Contents/MacOS/"
    chmod +x "$APP_PATH/Contents/MacOS/terminal-notifier"
fi

echo ""
echo "构建完成: $APP_PATH"
echo ""
echo "Shell 入口: $APP_PATH/Contents/MacOS/lovnotifier-send"
echo "Tauri 应用: $APP_PATH"
