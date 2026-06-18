# Desk Escape — Android terminal smoke test (device or emulator)
# Prerequisites: adb, OpenCode server, Metro on :8081
param(
  [string]$Device = "",
  [string]$OpenCodeUrl = "http://127.0.0.1:4096"
)

$ErrorActionPreference = "Stop"
$adb = if ($Device) { "adb -s $Device" } else { "adb" }

Write-Host "==> Checking adb device..."
& $adb.Split(" ") devices -l
$serial = (& $adb.Split(" ") devices | Select-String "device$" | Select-Object -First 1)
if (-not $serial) {
  Write-Error "No Android device/emulator connected. Plug in phone or start an AVD."
}

Write-Host "==> PTY WebSocket validation (host)..."
Push-Location $PSScriptRoot\..
bun scripts/validate-pty-ws.mjs $OpenCodeUrl
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Pop-Location

Write-Host "==> adb reverse for Metro + OpenCode..."
& $adb.Split(" ") reverse tcp:8081 tcp:8081 | Out-Null
& $adb.Split(" ") reverse tcp:4096 tcp:4096 | Out-Null

Write-Host "==> Launching Desk Escape..."
& $adb.Split(" ") shell am force-stop com.deskescape.app | Out-Null
& $adb.Split(" ") shell am start -n com.deskescape.app/.MainActivity | Out-Null

Write-Host @"

Manual terminal checks on device:
  1. Connect to OpenCode (emulator: http://10.0.2.2:4096, phone: Tailscale/LAN URL)
  2. Open workspace → tap Terminal pill
  3. Status bar should show "Shell connected" (green)
  4. Type: pwd, ls — shell output should appear full-screen
  5. Switch Agent ↔ Terminal — chat should not be covered

Logcat (terminal / WebView):
  adb logcat -s ReactNativeJS chromium

"@
