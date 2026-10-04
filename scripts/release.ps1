<#
.SYNOPSIS
  Cuts a release: bump, changelog, verify, commit, tag. Pushes only on request.

.DESCRIPTION
  Release flow for this repo. The tag is the trigger: `.github/workflows/release.yml`
  fires on `v*` tags and publishes the signed APK. So this script's job is to
  produce a correct commit and a correct tag, and to push them when asked.

  What this script deliberately does NOT do:

  - `git add .`. It stages exactly three paths (package.json, bun.lock,
    CHANGELOG.md) and then verifies nothing outside that set is staged. A blanket
    add swept unrelated in-progress work into the release commit and pushed it.
  - Push by default. Nothing leaves the machine without -Push.
  - Let `bun pm version` commit or tag implicitly. It runs with
    `--no-git-tag-version` so this script owns the commit and the tag, and can
    therefore use a real commit message.

  It refuses to start when the working tree is dirty. `bun pm version` also
  refuses, but only after it has already rewritten package.json, leaving a
  half-applied bump behind; checking first makes that failure impossible.

.PARAMETER Increment
  patch (default), minor, or major.

.PARAMETER Version
  An explicit version to set, e.g. 1.2.3. Overrides -Increment.

.PARAMETER Push
  Push the release commit and tag to origin. Omit to stop after tagging.

.PARAMETER DryRun
  Print the plan and exit. Nothing is modified.

.PARAMETER Yes
  Skip the confirmation prompt. Implied by -DryRun.

.PARAMETER SkipChecks
  Skip `bun run check` and the local Android build. Use only when CI will catch it.

.PARAMETER SkipChangelog
  Do not regenerate CHANGELOG.md. See the note on the changelog step below: the
  generator is not a declared dependency, so that step is already best-effort.

.EXAMPLE
  ./scripts/release.ps1 -DryRun
  Show what a patch release would do without touching anything.

.EXAMPLE
  ./scripts/release.ps1 -Increment minor
  Bump, changelog, verify, commit, tag. Nothing is pushed.

.EXAMPLE
  ./scripts/release.ps1 -Version 1.2.0 -Push
  Set an exact version and publish, which triggers the release workflow.
#>
[CmdletBinding()]
param(
  [ValidateSet("patch", "minor", "major")]
  [string]$Increment = "patch",

  [string]$Version,

  [switch]$Push,

  [switch]$DryRun,

  [switch]$Yes,

  [switch]$SkipChecks,

  [switch]$SkipChangelog
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

# The only paths a release commit is allowed to touch.
$ReleasePaths = @("package.json", "bun.lock", "CHANGELOG.md")

function Write-Step($Message) {
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Write-Note($Message) {
  Write-Host "    $Message" -ForegroundColor DarkGray
}

# Runs a native command and turns a non-zero exit into a terminating error.
# The failure-description parameter is named OnFailure, not What: `What` is a
# reserved PowerShell common parameter (SupportsShouldProcess) and cannot be
# redeclared this way.
function Invoke-Native {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments,
    [string]$OnFailure = ""
  )

  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) {
    if (-not $OnFailure) {
      $OnFailure = "$FilePath $($Arguments -join ' ')"
    }
    throw "Failed: $OnFailure (exit code $LASTEXITCODE)"
  }
}

function Invoke-Git {
  param(
    [Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments,
    [string]$OnFailure = ""
  )

  if (-not $OnFailure) {
    $OnFailure = "git $($Arguments -join ' ')"
  }
  Invoke-Native -FilePath "git" -Arguments $Arguments -OnFailure $OnFailure
}

function Get-PackageVersion {
  $json = Get-Content "package.json" -Raw | ConvertFrom-Json
  return [string]$json.version
}

function Get-DirtyPaths {
  # `--porcelain` is stable and machine-readable. Any non-empty result means the
  # tree is not clean.
  $output = & git status --porcelain
  if ($LASTEXITCODE -ne 0) {
    throw "Failed: git status (exit code $LASTEXITCODE)"
  }
  return @($output | Where-Object { $_.Trim() -ne "" })
}

function Get-TargetVersion {
  param(
    [Parameter(Mandatory = $true)][string]$Current,
    [Parameter(Mandatory = $true)][ValidateSet("patch", "minor", "major")][string]$By
  )

  # Computed here rather than by asking bun. `bun pm version <increment>
  # --no-git-tag-version` still *writes* package.json - that flag only suppresses
  # the git commit and tag - so using it to preview the target mutated the
  # working tree during a dry run. patch/minor/major are unambiguous.
  $m = [regex]::Match($Current, "^(\d+)\.(\d+)\.(\d+)$")
  if (-not $m.Success) {
    throw "Current version '$Current' is not a plain major.minor.patch, so it cannot be incremented automatically. Pass -Version explicitly."
  }

  $major = [int]$m.Groups[1].Value
  $minor = [int]$m.Groups[2].Value
  $patch = [int]$m.Groups[3].Value

  switch ($By) {
    "patch" { return "$major.$minor.$($patch + 1)" }
    "minor" { return "$major.$($minor + 1).0" }
    "major" { return "$($major + 1).0.0" }
  }
}

function Confirm-Action {
  param([string]$Question)

  if ($Yes) { return $true }

  Write-Host ""
  $answer = Read-Host "$Question [y/N]"
  return $answer -match "^(y|yes)$"
}

# ---------------------------------------------------------------------------
# Preflight
# ---------------------------------------------------------------------------

Write-Step "Preflight"

if (-not (Test-Path "package.json")) {
  throw "package.json not found. Run this from the repository root."
}

# Wrapped in @() deliberately: a PowerShell function unrolls its return value, so
# a one-element array arrives as a bare string and an empty one as $null. Under
# Set-StrictMode, `.Count` on either of those throws rather than returning 0/1.
$dirty = @(Get-DirtyPaths)
if ($dirty.Count -gt 0) {
  Write-Host ""
  Write-Host "Refusing to release: the working tree is not clean." -ForegroundColor Red
  Write-Host ""
  Write-Host "  $($dirty.Count) path(s) have uncommitted changes:" -ForegroundColor Red
  foreach ($path in $dirty | Select-Object -First 20) {
    Write-Host "    $path" -ForegroundColor DarkYellow
  }
  if ($dirty.Count -gt 20) {
    Write-Host "    ... and $($dirty.Count - 20) more" -ForegroundColor DarkYellow
  }
  Write-Host ""
  Write-Host "A release must not absorb unrelated work. Commit or stash these" -ForegroundColor Yellow
  Write-Host "first, then re-run. 'git stash -u' is usually what you want." -ForegroundColor Yellow
  exit 1
}

$currentVersion = Get-PackageVersion
Write-Note "current version: $currentVersion"

# Releasing from a feature branch would tag work that was never merged.
$branch = (& git rev-parse --abbrev-ref HEAD).Trim()
if ($LASTEXITCODE -ne 0) {
  throw "Failed: could not determine the current branch."
}
if ($branch -eq "HEAD") {
  throw "Detached HEAD. Check out a branch before releasing."
}
Write-Note "branch: $branch"

$originHead = (& git symbolic-ref --short refs/remotes/origin/HEAD 2>$null)
if ($LASTEXITCODE -eq 0 -and $originHead) {
  $defaultBranch = $originHead -replace "^origin/", ""
  if ($branch -ne $defaultBranch) {
    throw "Not on the default branch (expected '$defaultBranch', currently '$branch'). Check out '$defaultBranch' first."
  }
  Write-Note "default branch: $defaultBranch"
} else {
  Write-Note "default branch: unknown (origin/HEAD not set); skipping branch check"
}

$unpushed = & git log "@{u}..HEAD" --oneline 2>$null
if ($LASTEXITCODE -eq 0 -and $unpushed) {
  throw "The current branch has unpushed commits. Push or reset them before releasing."
}

# ---------------------------------------------------------------------------
# Plan
# ---------------------------------------------------------------------------

Write-Step "Plan"

if ($Version) {
  $targetVersion = $Version.Trim().TrimStart("v")
  $versionSource = "explicit"
} else {
  $targetVersion = Get-TargetVersion -Current $currentVersion -By $Increment
  $versionSource = $Increment
}

if ($targetVersion -notmatch "^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$") {
  throw "Target version '$targetVersion' is not a valid version."
}

$tagName = "v$targetVersion"

if ($targetVersion -eq $currentVersion) {
  throw "Target version $targetVersion equals the current version. Nothing to release."
}

if (& git tag --list $tagName) {
  throw "Tag '$tagName' already exists. Bump past it or delete the tag first."
}

Write-Note "increment:     $versionSource"
Write-Note "target version: $currentVersion -> $targetVersion"
Write-Note "tag:           $tagName"

# ---------------------------------------------------------------------------
# Dry run
# ---------------------------------------------------------------------------

if ($DryRun) {
  Write-Step "Dry run - no changes made"
  Write-Host ""
  Write-Host "  Would run:" -ForegroundColor Green
  if (-not $SkipChangelog) {
    Write-Host "    bun run changelog            (best-effort)" -ForegroundColor DarkGray
  } else {
    Write-Host "    (changelog skipped)" -ForegroundColor DarkGray
  }
  if (-not $SkipChecks) {
    Write-Host "    bun run check" -ForegroundColor DarkGray
    Write-Host "    bunx expo prebuild --platform android" -ForegroundColor DarkGray
    Write-Host "    bunx expo run:android --variant release --no-bundler --no-install" -ForegroundColor DarkGray
  } else {
    Write-Host "    (checks and build skipped)" -ForegroundColor DarkGray
  }
  Write-Host "    bun pm version $targetVersion --no-git-tag-version" -ForegroundColor DarkGray
  Write-Host "    git add package.json bun.lock CHANGELOG.md" -ForegroundColor DarkGray
  Write-Host "    git commit -m `"chore(release): $targetVersion`"" -ForegroundColor DarkGray
  Write-Host "    git tag -a $tagName -m `"$targetVersion`"" -ForegroundColor DarkGray
  if ($Push) {
    Write-Host "    git push origin $branch" -ForegroundColor DarkGray
    Write-Host "    git push origin $tagName" -ForegroundColor DarkGray
  } else {
    Write-Host "    (not pushing; pass -Push to publish)" -ForegroundColor DarkGray
  }
  Write-Host ""
  exit 0
}

if (-not (Confirm-Action "Release $currentVersion -> $targetVersion and tag '$tagName'?")) {
  Write-Host "Aborted. Nothing was changed." -ForegroundColor Yellow
  exit 1
}

# ---------------------------------------------------------------------------
# Changelog and verification
# ---------------------------------------------------------------------------

# Best-effort on purpose. `bun run changelog` shells out to
# `conventional-changelog`, which is neither declared in devDependencies nor
# installed, so this step fails on a clean checkout. Release notes for the
# published artifact come from the workflow's `generate_release_notes: true`
# anyway, so a missing local generator must not block a release.
if ($SkipChangelog) {
  Write-Step "Skipping changelog generation (-SkipChangelog)"
} else {
  Write-Step "Generating changelog"
  & bun run changelog
  if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "  Changelog generation failed (exit $LASTEXITCODE) and is being skipped." -ForegroundColor Yellow
    Write-Host "  'conventional-changelog' is not a declared dependency." -ForegroundColor DarkYellow
    Write-Host "  Release notes for the artifact come from the workflow's" -ForegroundColor DarkYellow
    Write-Host "  'generate_release_notes: true', so this is not fatal." -ForegroundColor DarkYellow
    Write-Host "  Pass -SkipChangelog to silence this, or add the dependency to use it." -ForegroundColor DarkYellow
    Write-Host ""
  }
}

if (-not $SkipChecks) {
  Write-Step "Verifying"
  Invoke-Native -FilePath "bun" -Arguments @("run", "check") -OnFailure "bun run check"

  Write-Step "Building release APK locally"
  Invoke-Native -FilePath "bunx" -Arguments @("expo", "prebuild", "--platform", "android") -OnFailure "expo prebuild"
  Invoke-Native -FilePath "bunx" -Arguments @("expo", "run:android", "--variant", "release", "--no-bundler", "--no-install") -OnFailure "expo run:android"
} else {
  Write-Step "Skipping checks and build (-SkipChecks)"
}

# ---------------------------------------------------------------------------
# Bump
# ---------------------------------------------------------------------------

Write-Step "Bumping version to $targetVersion"

# From here on the working tree carries an uncommitted version bump, so any later
# failure leaves a half-applied release. Wrap the mutating tail so the operator is
# told how to undo it instead of discovering the mess later.
try {
  # --no-git-tag-version: this script owns the commit and tag so the message and the
  # annotated tag are ours. Without it bun commits and tags on its own, and the
  # release commit becomes whatever happened to be staged at that moment.
  Invoke-Native -FilePath "bun" -Arguments @("pm", "version", $targetVersion, "--no-git-tag-version") -OnFailure "version bump"

  $actualVersion = Get-PackageVersion
  if ($actualVersion -ne $targetVersion) {
    throw "The version bump did not apply: expected $targetVersion, package.json says $actualVersion."
  }

  # -------------------------------------------------------------------------
  # Stage, verify, commit, tag
  # -------------------------------------------------------------------------

  Write-Step "Staging release files"
  # Args are passed positionally, not as @(...) : `@(...)` is not array splatting in
  # PowerShell, it is a single expression that collapses to one joined argument, and
  # git would then see a command literally named "add -- package.json".
  foreach ($path in $ReleasePaths) {
    Invoke-Git "add" "--" $path -OnFailure "git add $path"
  }

  # The safety net. If prebuild or the build wrote anything unexpected, or if the
  # tree changed between preflight and now, refuse to commit it.
  $staged = @((& git diff --cached --name-only) | Where-Object { $_.Trim() -ne "" })
  if ($LASTEXITCODE -ne 0) {
    throw "Failed: git diff --cached (exit code $LASTEXITCODE)"
  }
  $expected = @($ReleasePaths | Sort-Object)

  # "Nothing outside the release set" is the invariant that matters, and it is a
  # hard failure. "Every release file changed" is not: CHANGELOG.md is legitimately
  # unchanged when changelog generation is skipped, so that is a note, not an error.
  $unexpected = @($staged | Where-Object { $expected -notcontains $_ })
  if ($unexpected.Count -gt 0) {
    throw "Refusing to commit: these paths are staged but are not release files:`n  $($unexpected -join "`n  ")"
  }

  if ($staged.Count -eq 0) {
    throw "Refusing to commit: nothing is staged. The version bump changed no tracked file."
  }

  $unchanged = @($expected | Where-Object { $staged -notcontains $_ })

  foreach ($path in $staged) {
    Write-Note "staged $path"
  }
  foreach ($path in $unchanged) {
    Write-Note "unchanged, not staged: $path"
  }

  # Untracked leftovers are not staged, so they are not a commit risk, but they do
  # mean the tree is not what the operator may expect.
  $stillDirty = @(Get-DirtyPaths)
  if ($stillDirty.Count -gt 0) {
    Write-Note "note: $($stillDirty.Count) untracked path(s) left alone (not part of the release)"
  }

  Write-Step "Committing"
  Invoke-Git "commit" "-m" "chore(release): $targetVersion" -OnFailure "release commit"

  Write-Step "Tagging $tagName"
  Invoke-Git "tag" "-a" $tagName "-m" $targetVersion -OnFailure "creating tag $tagName"
} catch {
  Write-Host ""
  Write-Host "  Release aborted. No commit and no tag were created." -ForegroundColor Red
  Write-Host ""
  Write-Host "  package.json may now read $targetVersion, uncommitted. To undo the bump:" -ForegroundColor Yellow
  Write-Host "    git reset                        # unstage anything already staged" -ForegroundColor DarkGray
  Write-Host "    git checkout -- package.json bun.lock CHANGELOG.md" -ForegroundColor DarkGray
  Write-Host ""
  throw
}

Write-Step "Done"
Write-Host ""
Write-Host "  Commit: $(& git rev-parse --short HEAD)  Tag: $tagName" -ForegroundColor Green

# ---------------------------------------------------------------------------
# Push
# ---------------------------------------------------------------------------

if (-not $Push) {
  Write-Host ""
  Write-Host "  Not pushed. Review with:" -ForegroundColor Yellow
  Write-Host "    git show --stat HEAD" -ForegroundColor DarkGray
  Write-Host "    git tag -n99 $tagName" -ForegroundColor DarkGray
  Write-Host ""
  Write-Host "  Then publish with:" -ForegroundColor Yellow
  Write-Host "    git push origin $branch" -ForegroundColor DarkGray
  Write-Host "    git push origin $tagName" -ForegroundColor DarkGray
  Write-Host ""
  Write-Host "  Pushing $tagName triggers .github/workflows/release.yml, which builds" -ForegroundColor DarkGray
  Write-Host "  the signed APK and publishes it to the GitHub release." -ForegroundColor DarkGray
  exit 0
}

Write-Step "Pushing to origin"
Invoke-Git "push" "origin" $branch -OnFailure "git push origin $branch"
Invoke-Git "push" "origin" $tagName -OnFailure "git push origin $tagName"

Write-Host ""
Write-Host "  Pushed $tagName. The release workflow will build and publish the APK." -ForegroundColor Green
Write-Host "  Watch it: https://github.com/involvex/Desk-Escape/actions" -ForegroundColor DarkGray
Write-Host ""