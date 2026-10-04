import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const xtermJs = readFileSync(
  join(root, "node_modules/@xterm/xterm/lib/xterm.js"),
  "utf8",
);
const fitJs = readFileSync(
  join(root, "node_modules/@xterm/addon-fit/lib/addon-fit.js"),
  "utf8",
);
const xtermCss = readFileSync(
  join(root, "node_modules/@xterm/xterm/css/xterm.css"),
  "utf8",
);

const shellLogic = `
    (function () {
      function post(type, extra) {
        if (!window.ReactNativeWebView) return;
        window.ReactNativeWebView.postMessage(
          JSON.stringify(Object.assign({ type: type }, extra || {})),
        );
      }

      try {
        const config = window.__TERMINAL__ || {};
        if (!config.wsUrl) {
          post("error", { message: "Missing terminal URL" });
          return;
        }

        if (typeof Terminal === "undefined") {
          post("error", { message: "xterm.js failed to initialize" });
          return;
        }

        const FitAddonCtor =
          (window.FitAddon && window.FitAddon.FitAddon) || window.FitAddon;
        if (!FitAddonCtor) {
          post("error", { message: "xterm FitAddon failed to initialize" });
          return;
        }

        const term = new Terminal({
          cursorBlink: true,
          cursorStyle: "bar",
          fontSize: 14,
          fontFamily: "Menlo, Monaco, Consolas, monospace",
          scrollback: 5000,
          theme: {
            background: config.theme?.background || "#0a0a0a",
            foreground: config.theme?.foreground || "#f5f5f5",
            cursor: config.theme?.foreground || "#f5f5f5",
          },
        });

        const fitAddon = new FitAddonCtor();
        term.loadAddon(fitAddon);
        term.open(document.getElementById("terminal"));

        // The app theme can change while the WebView stays mounted. Exposing a
        // setter lets it repaint xterm in place instead of reloading the shell,
        // which would otherwise throw away the scrollback buffer.
        function applyTheme(theme) {
          if (!theme) return;
          if (theme.background) {
            document.body.style.background = theme.background;
            document.documentElement.style.setProperty(
              "--terminal-bg",
              theme.background,
            );
          }
          term.options.theme = {
            background: theme.background || "#0a0a0a",
            foreground: theme.foreground || "#f5f5f5",
            cursor: theme.foreground || "#f5f5f5",
          };
        }

        window.__TERMINAL_APPLY_THEME__ = applyTheme;

        function reportSize() {
          fitAddon.fit();
          post("resize", { cols: term.cols, rows: term.rows });
        }

        window.addEventListener("resize", reportSize);
        setTimeout(reportSize, 50);
        setTimeout(reportSize, 250);

        const ws = new WebSocket(config.wsUrl);
        ws.binaryType = "arraybuffer";

        // Writes from the app, waiting for a socket. The app queues too, but only
        // for the case where the panel is not mounted at all; here the socket state
        // is known synchronously, so a write that lands between the panel deciding
        // it is connected and this code running is held rather than dropped.
        let pendingWrites = [];

        function flushWrites() {
          if (ws.readyState !== WebSocket.OPEN) {
            return 0;
          }
          let sent = 0;
          while (pendingWrites.length > 0) {
            ws.send(pendingWrites.shift());
            sent += 1;
          }
          return sent;
        }

        ws.onopen = function () {
          reportSize();
          flushWrites();
          post("connected");
        };

        ws.onmessage = function (event) {
          if (event.data instanceof ArrayBuffer) {
            return;
          }
          if (typeof event.data === "string" && event.data) {
            term.write(event.data);
          }
        };

        ws.onclose = function (event) {
          post("disconnected", { code: event.code });
        };

        ws.onerror = function () {
          post("error", { message: "WebSocket error" });
        };

        // "Run in terminal" lands here. The OpenCode \`pty\` namespace has no HTTP
        // write, so this socket is the only path to the shell; the app reaches it
        // by injecting JS, exactly as it does for the theme. Reports whether the
        // write was sent or buffered \u2014 both are success, and only malformed or
        // empty input is a refusal. Lost outright when the page is reloaded, which
        // is why the app keeps its own queue for the not-mounted case.
        window.__TERMINAL_WRITE__ = function (text) {
          if (typeof text !== "string" || text.length === 0) {
            return false;
          }
          if (ws.readyState !== WebSocket.OPEN) {
            pendingWrites.push(text);
            return true;
          }
          ws.send(text);
          return true;
        };

        term.onData(function (data) {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(data);
          }
        });

        term.onResize(function (size) {
          post("resize", { cols: size.cols, rows: size.rows });
        });

        term.focus();
      } catch (err) {
        post("error", {
          message: err && err.message ? err.message : "Terminal init failed",
        });
      }
    })();
`;

const themeCssVars = `
    html,
    body {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: var(--terminal-bg, #0a0a0a);
    }
    #terminal {
      width: 100%;
      height: 100%;
    }
`;

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta
    name="viewport"
    content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no"
  />
  <style>
${xtermCss}${themeCssVars}  </style>
</head>
<body>
  <div id="terminal"></div>
  <script>${xtermJs}<\/script>
  <script>${fitJs}<\/script>
  <script>${shellLogic}<\/script>
</body>
</html>`;

const output = `/** Generated by scripts/build-terminal-shell.mjs — do not edit. */
export const TERMINAL_SHELL_HTML = ${JSON.stringify(html)};
`;

writeFileSync(join(root, "src/assets/terminal-shell-html.ts"), output, "utf8");
console.log("Wrote src/assets/terminal-shell-html.ts");
