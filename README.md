# Desk Escape

A mobile client for [OpenCode](https://opencode.ai) — control your AI coding agent from your phone or tablet.

Desk Escape connects remotely to an OpenCode server over HTTP (LAN, Tailscale, or myfritz.link) and gives you a native mobile workspace: agent chat with real-time streaming, a full terminal, file browser, diff viewer, and session management.

## Features

- **Agent Chat** — Send prompts, receive responses in real-time via SSE streaming. Supports slash commands, context attachments, and offline queuing.
- **Terminal** — Full-screen PTY terminal powered by xterm.js in a WebView. Connects to the server's shell over WebSocket.
- **File Browser** — Browse the remote workspace, view file status (modified/added/deleted), and open unified diffs.
- **Session & Project Management** — Switch between sessions and projects. Create, delete, and navigate across workspaces.
- **7 Themes** — OLED Black, Dev Dark, Dev Light, Midnight Purple, Solarized Dark, Nord, and High Contrast. Sync with system dark/light mode.
- **Biometric Lock** — Optional Face ID / fingerprint authentication before revealing workspace content.
- **Offline Queue** — Prompts are buffered when disconnected and sent automatically on reconnection.
- **Auto-Reconnect** — Exponential backoff reconnection with visual status indicators.
- **Landscape Split-View** — On tablets in landscape, a file rail appears alongside the agent chat.
- **Command Palette** — Quick access to sessions, projects, slash commands, and app actions.
- **Message Search** — Full-text search across the current session's chat history.
- **Multi-Server Profiles** — Save and switch between multiple OpenCode server connections.

## Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) (LTS recommended)
- [Bun](https://bun.sh/) >= 1.3.0
- [Expo CLI](https://docs.expo.dev/get-started/installation/) (`bunx expo`)
- Android Studio (for Android builds) or Xcode (for iOS builds)
- A running [OpenCode](https://opencode.ai) server

### Install

```bash
git clone https://github.com/involvex/Desk-Escape.git
cd Desk-Escape
bun install
```

The `postinstall` script automatically builds the terminal shell HTML asset.

### Run

```bash
# Android
bun run android

# iOS
bun run ios

# Web
bun run web
```

### Connect

1. Start your OpenCode server (default port: `4096`)
2. Open Desk Escape on your device
3. Enter the server address (e.g., `http://100.x.x.x:4096` for Tailscale, or `http://localhost:4096` for local)
4. Optionally enable authentication and enter credentials
5. Tap **Test Connection**, then **Connect**

## Project Structure

```
Desk-Escape/
├── App.tsx                  # Root component with provider hierarchy
├── app.json                 # Expo configuration
├── index.ts                 # Entry point
├── src/
│   ├── api/                 # OpenCode SDK client, hooks, event bus, PTY, reconnection
│   ├── assets/              # Generated terminal shell HTML
│   ├── components/          # UI components (AgentChat, TerminalPanel, FileDrawer, etc.)
│   ├── context/             # React contexts (Connection, Theme, Orientation, Biometric, etc.)
│   ├── hooks/               # Custom hooks
│   ├── navigation/          # React Navigation stack (RootNavigator)
│   ├── screens/             # Screen components (Connection, Workspace, Settings, Plugins)
│   ├── services/            # Notification service
│   ├── types/               # TypeScript type definitions
│   └── utils/               # Utility functions
├── plugins/                 # Expo config plugins (cleartext network)
├── scripts/                 # Build scripts (terminal shell, validation)
├── docs/                    # Architecture documentation
└── android/                 # Generated Android native project
```

## Scripts

| Command                 | Description                                       |
| ----------------------- | ------------------------------------------------- |
| `bun run start`         | Start Expo dev server                             |
| `bun run android`       | Build and run on Android                          |
| `bun run ios`           | Build and run on iOS                              |
| `bun run web`           | Start web version                                 |
| `bun run check`         | Run lint, format, typecheck, and dependency check |
| `bun run lint`          | Run ESLint                                        |
| `bun run lint:fix`      | Run ESLint with auto-fix                          |
| `bun run format`        | Run Prettier                                      |
| `bun run typecheck`     | Run TypeScript type checking                      |
| `bun run doctor`        | Run Expo doctor diagnostics                       |
| `bun run android:clean` | Clean Android build artifacts                     |

## Documentation

- **[Architecture Guide](docs/ARCHITECTURE.md)** — Deep-dive into the project structure, data flow, and component design
- **[Contributing Guide](CONTRIBUTING.md)** — Development setup, code style, and contribution workflow
- **[Feature Suggestions](suggestions.md)** — Planned features and improvements

## License

MIT License. See [LICENSE](LICENSE) for details.
