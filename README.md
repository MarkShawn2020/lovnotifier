<p align="center">
  <img src="docs/images/cover.png" alt="Lovnotifier Cover" width="100%">
</p>

<h1 align="center">Lovnotifier</h1>

<p align="center">
  <strong>macOS notifications for tmux sessions with click-to-activate</strong><br>
  <sub>macOS</sub>
</p>

---

## Features

- **Native macOS Notifications** - Uses `terminal-notifier` for system-native alerts
- **Click-to-Activate** - Click notification to jump directly to the tmux session/window/pane
- **iTerm2 Integration** - Automatically focuses the correct iTerm2 tab
- **Lightweight** - Simple shell scripts, no dependencies beyond tmux

## Installation

```bash
# Clone the repository
git clone https://github.com/user/lovnotifier.git
cd lovnotifier

# Build the app
./build.sh
```

The app will be installed to `~/Applications/Lovnotifier.app`.

## Usage

```bash
# Basic notification
lovnotifier-send -title "Build Complete" -message "Your project compiled successfully"

# With tmux session context (enables click-to-activate)
lovnotifier-send -title "Task Done" -message "Check results" \
  -session "dev" -window "1" -pane "0"
```

### Parameters

| Parameter | Description |
|-----------|-------------|
| `-title` | Notification title |
| `-message` | Notification body |
| `-session` | tmux session name (enables click-to-activate) |
| `-window` | tmux window index |
| `-pane` | tmux pane index |
| `-group` | Notification group ID |
| `-sound` | Notification sound |

## How It Works

1. `lovnotifier-send` dispatches notifications via `terminal-notifier`
2. When clicked, the `-execute` callback triggers `activate.sh`
3. `activate.sh` uses AppleScript to focus iTerm2 and switch to the correct tmux session/window/pane

## Requirements

- macOS
- tmux
- iTerm2 (for click-to-activate)

## License

MIT
