# Desk Escape Plugins & Companion Tools

Desk Escape is designed to work alongside a small set of companion tools that
make running an OpenCode server and staying connected from mobile as seamless
as possible.

---

## Recommended: `@involvex/opencode-autoweb-plugin`

**What it does:** Automatically launches `opencode web` when OpenCode starts, so
the Desk Escape mobile client always has a healthy server to connect to — no
manual `opencode web` step required.

The plugin handles:

- Spawning `opencode web --port <port> --hostname <hostname>` on OpenCode startup.
- Avoiding double-spawns if `opencode web` is already running.
- Resolving configuration from **three layers** (highest precedence first):
  1. Plugin options in `opencode.json`
  2. Environment variables (`OPENCODE_WEB_PORT`, `OPENCODE_WEB_HOSTNAME`, …)
  3. Your existing OpenCode `server` config / hardcoded defaults.

**Default behaviour:** port `5000`, hostname `127.0.0.1`, auto-start **on**.

### Quick install

Add the plugin to your **global** OpenCode configuration so it runs everywhere:

```bash
# Interactive setup (recommended)
bun dlx @involvex/opencode-autoweb-plugin setup
```

Or manually add it to `~/.config/opencode/opencode.json`:

```json
{
  "plugin": ["@involvex/opencode-autoweb-plugin@latest"]
}
```

To customise the port or hostname:

```json
{
  "plugin": [
    [
      "@involvex/opencode-autoweb-plugin@latest",
      {
        "port": 5000,
        "hostname": "0.0.0.0",
        "autoStart": true
      }
    ]
  ]
}
```

### Environment variables

| Variable                 | Default     | Description            |
| ------------------------ | ----------- | ---------------------- |
| `OPENCODE_WEB_PORT`      | `5000`      | Web server listen port |
| `OPENCODE_WEB_HOSTNAME`  | `127.0.0.1` | Bind address           |
| `OPENCODE_WEB_MDNS`      | `false`     | Enable mDNS advert.    |
| `OPENCODE_WEB_AUTOSTART` | `true`      | Auto-spawn on startup  |

### Connecting from Desk Escape

1. Start (or restart) OpenCode **with the autoweb plugin installed**.
2. On the **Add Connection** screen in Desk Escape, enter:
   - **Local network:** `http://192.168.1.100:5000` (replace with your machine's LAN IP)
   - **Tailscale / VPN:** `http://100.x.x.x:5000` (your Tailscale IP)
   - **Localhost (dev):** `http://10.0.2.2:5000` (Android emulator) or `http://localhost:5000`
3. If you set `OPENCODE_SERVER_PASSWORD`, enter the same password when prompted.
4. Tap **Test Connection**, then **Connect**.

### Uninstalling

```bash
bun dlx @involvex/opencode-autoweb-plugin unregister
```

This removes the plugin entry from your global OpenCode config.

> **Tip:** The `opencode web` process serves a browser UI on the same port — you
> can keep it open in a desktop browser while you work from your phone for a
> seamless multi-screen workflow.

---

## Installing Custom / Third-Party Plugins

Desk Escape itself is not a plugin host, but it can _recommend_ plugins from the
OpenCode marketplace through a curated in-app list. If you'd like to see a
particular OpenCode plugin surfaced in the app, [open an issue](https://github.com/involvex/Desk-Escape/issues) with the plugin name and use
case.
