# IzzyOnDroid Submission Checklist

Step-by-step guide to file the inclusion request for `com.deskescape.app`
in the IzzyOnDroid F-Droid repository.

IzzyOnDroid is the fastest OSS distribution channel — typical inclusion is
1-3 days after filing. It serves pre-built APKs directly from GitHub releases.

**Pre-condition: a signed APK must be attached to a GitHub release tag before filing.**

---

## Prerequisites

- [ ] Signed release APK (not AAB) exists and is attached to a GitHub tag
      (e.g. `https://github.com/involvex/Desk-Escape/releases/tag/v1.1.0`)
- [ ] APK is signed with `android/app/release.keystore`
- [ ] SHA-256 fingerprint confirmed: see `distribution/SIGNING-KEY-FINGERPRINTS.md`
- [ ] Privacy policy is live and accessible (see `distribution/privacy-policy.md` or the
      GitHub Pages link in the README)
- [ ] `fastlane/metadata/android/en-US/` contains the short + full app description
- [ ] `app.json` `version` and `android.versionCode` are set correctly in the tagged commit

---

## Step 1 — Produce a signed release APK

The `release.yml` GitHub Actions workflow builds a signed APK from any `v*` tag
and attaches it to the GitHub Release automatically. To test locally first:

```bash
# Decode your keystore into android/app/release.keystore
# (base64-decoded from the KEYSTORE_BASE64 secret)
bun run build:terminal-shell
cd android
./gradlew assembleRelease
# Output: app/build/outputs/apk/release/app-release.apk
```

Verify:

```bash
apksigner verify --print-certs app/build/outputs/apk/release/app-release.apk
```

Confirm the output matches the fingerprint in `SIGNING-KEY-FINGERPRINTS.md`.

---

## Step 2 — Attach APK to GitHub release

Push a tag:

```bash
git tag v1.1.0
git push --tags
```

The `release.yml` workflow will build, sign, and attach `app-release.apk` to the
release at `https://github.com/involvex/Desk-Escape/releases/tag/v1.1.0`.

---

## Step 3 — Verify the APK

```bash
# Confirm package id and version
aapt dump badging app-release.apk | grep -E "package:|versionCode|versionName"
# Expected:
#   package: name='com.deskescape.app' versionCode='<N>' versionName='<X.Y.Z>'

# Confirm signing fingerprint matches distribution/SIGNING-KEY-FINGERPRINTS.md
apksigner verify --print-certs app-release.apk | grep SHA-256
```

---

## Step 4 — File the inclusion issue

1. Register a Codeberg account at <https://codeberg.org> (free, no payment).
2. Go to: https://codeberg.org/IzzyOnDroid/repodata/issues
3. Click **"New Issue"**.
4. Paste the body from `INCLUSION-REQUEST.md` into the issue body.
5. Submit.

---

## Step 5 — Monitor and respond

- IzzyOnDroid maintainers typically respond within 1–3 days.
- Common requests:
  - Confirm the APK URL pattern resolves correctly
  - Confirm the signing-key fingerprint via `apksigner` output
  - Clarification on anti-features
- Once accepted, the app appears in the next IzzyOnDroid index build (usually
  within 24 hours).

---

## Step 6 — After acceptance

- Add the IzzyOnDroid badge to `README.md`:
  ```markdown
  [![IzzyOnDroid](https://img.shields.io/badge/izzyondroid-available-brightgreen.svg)](https://apt.izzysoft.de/fdroid/index/details?q=cc.agentlabs.opencode)
  ```
- Update the distribution table in README to mark F-Droid / IzzyOnDroid as "Live".
- When mainline F-Droid later accepts the app, comment on this issue:
  "Desk Escape has been accepted into mainline F-Droid — please auto-delist
  per policy."

---

## Reference

- IzzyOnDroid inclusion policy: https://apt.izzysoft.de/fdroid/index/info
- Codeberg issues: https://codeberg.org/IzzyOnDroid/repodata/issues
