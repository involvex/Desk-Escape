# Privacy Policy — Desk Escape

**Last updated:** August 3, 2026

## Overview

Desk Escape is a mobile client for the [OpenCode](https://opencode.ai) AI coding
agent. You run your own OpenCode server; Desk Escape connects to it over your
local network or a tunnel (Cloudflare Tunnel, ngrok, Tailscale, etc.).

Your OpenCode server is the only component that contacts your AI provider
(OpenAI, Anthropic, Google, etc.). Desk Escape itself **never** sends your
conversations, code, or API keys to any third party — not to us, not to Google,
not to any analytics network.

## Data we collect

| Category                  | What                                        | Why                       | Shared?                                                        |
| ------------------------- | ------------------------------------------- | ------------------------- | -------------------------------------------------------------- |
| Server connection details | Host, port, password, optional TLS settings | To connect to your server | **Never** — stored on-device only                              |
| Chat & session data       | Prompts, responses, tool calls, files       | To render the workspace   | **Never** — kept only on your server and on-device for display |
| Crash reports             | Stack traces (optional)                     | To fix crashes            | **No analytics SDK** — none is included                        |

## On-device storage

All connection profiles, secure credentials, and cached session data are stored
**entirely on your device** using:

- `expo-secure-store` — for server passwords and biometric flags (backed by
  the Android Keystore / iOS Keychain).
- `expo-sqlite` / `AsyncStorage` — for connection profiles and message cache.

Nothing is written to cloud storage, iCloud Keychain sync, or any backup
unless your operating system does so (you control OS-level backups).

## Crash reporting

Desk Escape does **not** bundle or configure any crash-reporting SDK
(no Sentry, no Firebase Crashlytics, no Bugsnag). If a crash occurs, the
Android/iOS system log is the only record.

## Third-party services

Desk Escape is a thin client. The only network calls it makes are:

1. To **your OpenCode server** (which you control).
2. To `expo.dev` — only for Expo's OTA update manifest check (standard Expo
   runtime behaviour). No user data is sent; only app-version metadata.

No ads, no trackers, no telemetry SDKs, no usage analytics are present.

## Your rights

Because we collect no personal data, there is nothing to export, correct, or
delete from our side. You own all data in your OpenCode sessions.

## Changes to this policy

Any changes will be announced in the GitHub release notes and, if material,
updated here with a new "last updated" date.

## Contact

Questions? Open an issue at
https://github.com/involvex/Desk-Escape/issues or email
support@involvex.dev.
