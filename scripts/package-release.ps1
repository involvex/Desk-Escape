<#
.SYNOPSIS
    Desk Escape release packaging script.

.DESCRIPTION
    Bumps the version across app.json / package.json / build.gradle,
    rebuilds native assets, runs lint + typecheck as gates, commits,
    tags, and pushes the tag so `.github/workflows/release.yml` can
    build the signed APK on GitHub Actions.

    Optionally builds the APK locally with -BuildApk.

.PARAMETER Version
    Semantic version to release, e.g. "1.2.0". If omitted, the patch
    component of the current version is incremented.

.PARAMETER Bump
    Bump strategy instead of an explicit version. Values: major | minor | patch.
    Default: patch.

.PARAMETER BuildApk
    Also build the release APK locally (requires keystore env vars set).
    Useful for pre-testing before pushing the tag.

.PARAMETER NoPush
    Do everything except git push / push the tag. Useful for dry-run /
    CI preview.

.PARAMETER AllowUncommitted
    Allow releasing when the working tree has other uncommitted changes.
    They will be stashed and restored around the bump commit.

.EXAMPLE
    .\scripts\package-release.ps1                          # bump patch -> 1.1.1 -> v1.1.1
    .\scripts\package-release.ps1 -Bump minor              # -> v1.2.0
    .\scripts\package-release.ps1 -Version 2.0.0           # explicit
    .\scripts\package-release.ps1 -Version 1.1.0 -BuildApk -AllowUncommitted
#>
param(
    [string]$Version,
    [ValidateSet('major', 'minor', 'patch')]
    [string]$Bump = 'patch',
    [switch]$BuildApk,
    [switch]$NoPush,
    [switch]$AllowUncommitted
)

$ErrorActionPreference = 'Stop'

# Resolve repo root
$RepoRoot = (Get-Item $PSScriptRoot).Parent.FullName
Set-Location $RepoRoot

Write-Host "=== Desk Escape release packager ===" -ForegroundColor Cyan
Write-Host "Repo: $RepoRoot"

# ---------------------------------------------------------------
# 1. Determine version
# ---------------------------------------------------------------
if (-not $Version) {
    # Read current version from app.json
    $appJsonText = Get-Content "$RepoRoot\app.json" -Raw
    $appJson = $appJsonText | ConvertFrom-Json
    $currentVersion = $appJson.expo.version
    Write-Host "Current version: $currentVersion"

    # Parse version parts
    $parts = $currentVersion.Split('.')
    $major = [int]$parts[0]
    $minor = [int]$parts[1]
    $patch = [int]$parts[2]

    switch ($Bump) {
        'major' { $major++; $minor = 0; $patch = 0 }
        'minor' { $minor++; $patch = 0 }
        'patch' { $patch++ }
    }
    $Version = "$major.$minor.$patch"
}

# Validate semver
if ($Version -notmatch '^\d+\.\d+\.\d+$') {
    throw "Invalid version '$Version' — expected format like '1.2.0'"
}

# Derive versionCode: count commits or use a timestamp-free monotonic scheme.
# Simple scheme: major*10000 + minor*100 + patch
$versionParts = $Version.Split('.')
$majorPart = [int]$versionParts[0]
$minorPart = [int]$versionParts[1]
$patchPart = [int]$versionParts[2]
$versionCode = $majorPart * 10000 + $minorPart * 100 + $patchPart

$tag = "v$Version"

Write-Host "`nNew version:   $Version"
Write-Host "New versionCode: $versionCode"
Write-Host "New tag:         $tag"

# ---------------------------------------------------------------
# 2. Check for uncommitted changes
# ---------------------------------------------------------------
$status = git status --porcelain
if ($status) {
    if (-not $AllowUncommitted) {
        throw "Working tree has uncommitted changes. Use -AllowUncommitted to include them, or stash first."
    }
    Write-Host "[WARN] Uncommitted changes detected (will commit alongside version bump):" -ForegroundColor Yellow
    git status --short
    # Stash so we can do a clean commit
    git stash push -m "release-bump-stash" -- .
    $stashed = $true
} else {
    $stashed = $false
}

# ---------------------------------------------------------------
# 3. Patch version in app.json
# ---------------------------------------------------------------
Write-Host "`n--- Patching app.json ---" -ForegroundColor DarkGray
$appJson = (Get-Content "$RepoRoot\app.json" -Raw | ConvertFrom-Json)
$appJson.expo.version = $Version
$appJson.expo.android.versionCode = $versionCode
$appJson | ConvertTo-Json -Depth 30 | Set-Content "$RepoRoot\app.json"
Write-Host "app.json: version=$Version, versionCode=$versionCode"

# ---------------------------------------------------------------
# 4. Patch version in package.json
# ---------------------------------------------------------------
Write-Host "`n--- Patching package.json ---" -ForegroundColor DarkGray
$pkgJson = Get-Content "$RepoRoot\package.json" -Raw | ConvertFrom-Json
$pkgJson.version = $Version
$pkgJson | ConvertTo-Json -Depth 20 | Set-Content "$RepoRoot\package.json"
Write-Host "package.json: version=$Version"

# ---------------------------------------------------------------
# 5. Patch versionCode in android/app/build.gradle
# ---------------------------------------------------------------
Write-Host "`n--- Patching android/app/build.gradle ---" -ForegroundColor DarkGray
$gradleFile = "$RepoRoot\android\app\build.gradle"
$gradleText = Get-Content $gradleFile -Raw
# Replace versionName and versionCode lines
$gradleText = $gradleText -replace 'versionName "[\d.]+"', "versionName `"$Version`""
$gradleText = $gradleText -replace 'versionCode \d+', "versionCode $versionCode"
Set-Content -Path $gradleFile -Value $gradleText -NoNewline
Write-Host "build.gradle: versionName=$Version, versionCode=$versionCode"

# ---------------------------------------------------------------
# 6. Rebuild terminal shell asset
# ---------------------------------------------------------------
Write-Host "`n--- Building terminal shell asset ---" -ForegroundColor DarkGray
bun run build:terminal-shell

# ---------------------------------------------------------------
# 7. Prebuild Android (regenerate native project)
# ---------------------------------------------------------------
Write-Host "`n--- Prebuild Android ---" -ForegroundColor DarkGray
& npx expo prebuild --platform android --no-install --clean 2>&1 | Write-Host

# ---------------------------------------------------------------
# 8. Restore stashed changes (merge version-bump commit on top)
# ---------------------------------------------------------------
if ($stashed) {
    Write-Host "`n--- Restoring stashed changes ---" -ForegroundColor DarkGray
    git stash pop
}

# ---------------------------------------------------------------
# 9. Run lint + typecheck as gates
# ---------------------------------------------------------------
Write-Host "`n--- Running lint + typecheck ---" -ForegroundColor DarkGray
$lintResult = bun run lint *>&1; Write-Host $lintResult
if ($LASTEXITCODE -ne 0) { throw "ESLint failed — aborting release." }

$typecheckResult = bun run typecheck *>&1; Write-Host $typecheckResult
if ($LASTEXITCODE -ne 0) { throw "TypeScript typecheck failed — aborting release." }

# ---------------------------------------------------------------
# 10. Optionally build APK locally
# ---------------------------------------------------------------
if ($BuildApk) {
    Write-Host "`n--- Building release APK ---" -ForegroundColor DarkGray

    # Ensure signing env is set
    $env:RELEASE_STORE_FILE = $env:RELEASE_STORE_FILE ? $env:RELEASE_STORE_FILE : "release.keystore"
    $env:RELEASE_STORE_PASSWORD = $env:RELEASE_STORE_PASSWORD ? $env:RELEASE_STORE_PASSWORD : "desk-escape"
    $env:RELEASE_KEY_ALIAS = $env:RELEASE_KEY_ALIAS ? $env:RELEASE_KEY_ALIAS : "desk-escape-key"
    $env:RELEASE_KEY_PASSWORD = $env:RELEASE_KEY_PASSWORD ? $env:RELEASE_KEY_PASSWORD : "desk-escape"

    Push-Location "$RepoRoot\android"
    try {
        & ./gradlew assembleRelease --no-daemon 2>&1 | Write-Host
    } finally {
        Pop-Location
    }

    $apkPath = "$RepoRoot\android\app\build\outputs\apk\release\app-release.apk"
    if (Test-Path $apkPath) {
        Copy-Item $apkPath "$RepoRoot\app-release.apk" -Force
        Write-Host "APK at: $RepoRoot\app-release.apk" -ForegroundColor Green
    } else {
        throw "APK was not produced — check build output."
    }
}

# ---------------------------------------------------------------
# 11. Commit version bump
# ---------------------------------------------------------------
Write-Host "`n--- Committing version bump ---" -ForegroundColor DarkGray
git add app.json package.json android/app/build.gradle
git commit -m "release: bump version to $Version (versionCode $versionCode)" | Write-Host

# ---------------------------------------------------------------
# 12. Update CHANGELOG.md (prepend entry)
# ---------------------------------------------------------------
Write-Host "`n--- Updating CHANGELOG.md ---" -ForegroundColor DarkGray
$changelogPath = "$RepoRoot\CHANGELOG.md"
$changelog = Get-Content $changelogPath -Raw

# Build a release date string
$releaseDate = (Get-Date).ToString("yyyy-MM-dd")

$newEntry = @"
## [$Version] - $releaseDate

### Changed
- Version bump to $Version (versionCode $versionCode).
- See [GitHub Release](https://github.com/involvex/Desk-Escape/releases/tag/$tag) for details.

"@

# Insert after the first "---" or at the top after the header
$lines = $changelog -split "`n"
$insertIndex = 0
for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match '^## \[' ) { $insertIndex = $i; break }
}
# If no ## entries found, insert after the first --- line
if ($insertIndex -eq 0) {
    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($lines[$i] -match '^---') { $insertIndex = $i + 1; break }
    }
}

$lines = $lines[0..($insertIndex - 1)] + $newEntry + $lines[$insertIndex..($lines.Count - 1)]
$lines -join "`n" | Set-Content $changelogPath

git add CHANGELOG.md
git commit --amend --no-edit | Write-Host

# ---------------------------------------------------------------
# 13. Tag + push (unless -NoPush)
# ---------------------------------------------------------------
if ($NoPush) {
    Write-Host "`n=== Skipping push (-NoPush) ===" -ForegroundColor Yellow
    Write-Host "Tag created locally: $tag"
    git tag $tag
}
else {
    Write-Host "`n--- Tagging + pushing ---" -ForegroundColor DarkGray
    git tag $tag
    git push origin main --tags
    Write-Host "`n=== Release triggered! ===" -ForegroundColor Green
    Write-Host "Tag: $tag pushed. GitHub Actions will build + sign the APK"
    Write-Host "and attach it to the GitHub Release automatically."
    Write-Host "Watch: https://github.com/involvex/Desk-Escape/actions"
}

Write-Host "`n=== Done ===" -ForegroundColor Cyan
Write-Host "Version: $Version (versionCode $versionCode)"
if ($BuildApk) { Write-Host "APK: app-release.apk (built locally)" -ForegroundColor Green }
