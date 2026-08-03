# IzzyOnDroid Inclusion Request

**Title:** Include com.deskescape.app (Desk Escape)

**Body:**

> The body below is the exact template to paste into the new issue at
> https://codeberg.org/IzzyOnDroid/repodata/issues/new

---

**App name:** Desk Escape
**Package:** com.deskescape.app
**License:** MIT — https://github.com/involvex/Desk-Escape/blob/main/LICENSE
**Source code URL:** https://github.com/involvex/Desk-Escape
**Release URL:** https://github.com/involvex/Desk-Escape/releases
**APK URL pattern:** https://github.com/involvex/Desk-Escape/releases/download/v%v/app-release.apk
**APK SHA-256 (signing cert):** 4B:24:4E:3D:27:D4:10:72:B0:1D:01:DF:BC:CD:68:80:A0:60:6F:BA:4F:E1:66:16:99:D2:EB:71:BA:B4:25:9C
**Source code license:** [MIT](https://github.com/involvex/Desk-Escape/blob/main/LICENSE)
**App description:**
Desk Escape is a mobile (Android) client for the OpenCode AI coding agent.
It connects to a self-hosted OpenCode server over the local network,
Tailscale, or a self-hosted tunnel (Cloudflare Tunnel / ngrok). Features
include real-time streaming chat (SSE), a full-screen PTY terminal in a
WebView, a file browser with diff viewing, session and project management,
offline prompt queueing, biometric app lock, auto-reconnection, landscape
split-view for tablets, and multi-server connection profiles. The app is a
pure thin client — all AI model calls are handled by your own server, and
your API keys are never touched by the app.

**Why is this app open source / why are you publishing it here?**
Desk Escape is free and open-source under the MIT license with no ads, no
subscription, and no telemetry SDKs. Publishing it here makes it easily
discoverable and installable on F-Droid-compatible repositories.

**Anti-features:**

- **NonFreeNet:** The app connects to a user-self-hosted OpenCode server,
  which may in turn use proprietary AI APIs (OpenAI, Anthropic, Google
  Gemini). The app itself does not require or bundle any proprietary SDK.
  No usage data, analytics, or tracking is collected or sent.

**Privacy policy:** https://github.com/involvex/Desk-Escape/blob/main/distribution/privacy-policy.md

**Contact info / Maintainer:**
Involvex — support@involvex.dev — https://github.com/involvex
