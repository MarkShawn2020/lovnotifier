<p align="center">
  <img src="docs/images/cover.png" alt="Lovnotifier Cover" width="100%">
</p>

<h1 align="center">
  <img src="assets/logo.svg" width="32" height="32" alt="Logo" align="top">
  Lovnotifier
</h1>

<p align="center">
  <strong>Desktop notification hub for developers</strong><br>
  <sub>macOS</sub>
</p>

---

## Features

- **Float Window** - Always-on-top draggable widget showing pending notifications
- **System Tray** - Quick access to message queue from menu bar
- **tmux Integration** - Click to navigate directly to tmux session/window/pane
- **Global Shortcut** - Press `F4` to consume the oldest notification
- **HTTP API** - Receive notifications from CLI tools, scripts, or CI/CD
- **Persistent Queue** - Messages survive app restarts
- **History** - Track completed notifications

## Installation

### From Source

```bash
# Clone repository
git clone https://github.com/nicepkg/lovnotifier.git
cd lovnotifier

# Install dependencies
pnpm install

# Build for production
pnpm tauri:build
```

The built app will be in `src-tauri/target/release/bundle/`.

## Usage

### Sending Notifications

Send a POST request to `http://localhost:23567/notify`:

```bash
curl -X POST http://localhost:23567/notify \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Build Complete",
    "project": "my-app",
    "tmux_session": "dev",
    "tmux_window": "1",
    "tmux_pane": "0"
  }'
```

### API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/notify` | Add notification to queue |
| GET | `/queue` | List pending notifications |
| DELETE | `/queue/:id` | Remove notification by ID |

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `F4` | Consume oldest notification and navigate to tmux |

## Tech Stack

- **Frontend**: React 19, TailwindCSS, Framer Motion, Radix UI
- **Backend**: Rust, Tauri 2.0, Warp
- **Build**: Vite, TypeScript

## License

[Apache-2.0](LICENSE)
