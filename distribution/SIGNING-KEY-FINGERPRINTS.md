# Signing Key Fingerprints

This file records the SHA-256 fingerprint(s) of the release signing key(s) used
to sign Desk Escape APKs. IzzyOnDroid (and other F-Droid-compatible repos)
verify that every APK update is signed with the same certificate.

---

## Production Release Key

| Field                | Value                                                                                             |
| -------------------- | ------------------------------------------------------------------------------------------------- |
| **Keystore**         | `android/app/release.keystore` (PKCS12)                                                           |
| **Alias**            | `desk-escape-key`                                                                                 |
| **Key algorithm**    | RSA 2048-bit                                                                                      |
| **Signature scheme** | SHA256withRSA                                                                                     |
| **Validity**         | 10 000 days (until 2053-12-19)                                                                    |
| **Store password**   | `desk-escape` (same as key password)                                                              |
| **Key password**     | `desk-escape` (same as store password)                                                            |
| **SHA-256**          | `4B:24:4E:3D:27:D4:10:72:B0:1D:01:DF:BC:CD:68:80:A0:60:6F:BA:4F:E1:66:16:99:D2:EB:71:BA:B4:25:9C` |
| **SHA-1**            | `DC:4C:6A:E7:FE:0E:67:7C:8A:60:29:2A:F5:E1:97:99:C3:F9:4B:52`                                     |

To verify locally:

```bash
apksigner verify --print-certs app-release.apk | grep SHA-256
```

The plaintext keystore passwords are stored only as GitHub repository secrets
(`KEYSTORE_BASE64`, `KEYSTORE_PASSWORD`, `KEY_ALIAS`, `KEY_PASSWORD`) — they are
**never** committed to the repository.

This signing key is intended to be used across **all** distribution channels
(GitHub Releases, Google Play, IzzyOnDroid, F-Droid) so users can update
in-place across stores.
