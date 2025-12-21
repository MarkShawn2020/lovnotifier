#!/bin/bash
# Lovnotifier 构建脚本
# 输出到 ~/Applications/Lovnotifier.app

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_NAME="Lovnotifier"
OUTPUT_DIR="$HOME/Applications"
APP_PATH="$OUTPUT_DIR/$APP_NAME.app"

echo "构建 $APP_NAME..."
echo "源码目录: $SCRIPT_DIR"
echo "输出目录: $APP_PATH"

# 确保输出目录存在
mkdir -p "$OUTPUT_DIR"

# 清理旧的 app
rm -rf "$APP_PATH"

# 创建 app 结构
mkdir -p "$APP_PATH/Contents/MacOS"
mkdir -p "$APP_PATH/Contents/Resources"

# 复制 Info.plist
cp "$SCRIPT_DIR/resources/Info.plist" "$APP_PATH/Contents/"

# 创建 PkgInfo
echo -n "APPL????" > "$APP_PATH/Contents/PkgInfo"

# 复制核心二进制
cp "$SCRIPT_DIR/vendor/terminal-notifier" "$APP_PATH/Contents/MacOS/"
chmod +x "$APP_PATH/Contents/MacOS/terminal-notifier"

# 复制脚本
cp "$SCRIPT_DIR/src/lovnotifier-send.sh" "$APP_PATH/Contents/MacOS/lovnotifier-send"
cp "$SCRIPT_DIR/src/activate.sh" "$APP_PATH/Contents/Resources/"
chmod +x "$APP_PATH/Contents/MacOS/lovnotifier-send"
chmod +x "$APP_PATH/Contents/Resources/activate.sh"

# 复制资源
cp "$SCRIPT_DIR/resources/AppIcon.icns" "$APP_PATH/Contents/Resources/"

# 从原始 app 复制必要的 nib 文件（如果存在）
ORIGINAL_APP="/Users/mark/@lovstudio/apps/Lovnotifier.app"
if [ -d "$ORIGINAL_APP/Contents/Resources/en.lproj" ]; then
    cp -r "$ORIGINAL_APP/Contents/Resources/en.lproj" "$APP_PATH/Contents/Resources/"
fi
if [ -f "$ORIGINAL_APP/Contents/Resources/Terminal.icns" ]; then
    cp "$ORIGINAL_APP/Contents/Resources/Terminal.icns" "$APP_PATH/Contents/Resources/"
fi

echo "✓ 构建完成: $APP_PATH"
echo ""
echo "发送入口: $APP_PATH/Contents/MacOS/lovnotifier-send"
