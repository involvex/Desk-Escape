const {
  AndroidConfig,
  withAndroidManifest,
  withDangerousMod,
} = require("@expo/config-plugins");
const fs = require("node:fs");
const path = require("node:path");

const NETWORK_SECURITY_CONFIG = `<?xml version="1.0" encoding="utf-8"?>
<!-- Desk Escape connects to user-run OpenCode servers over HTTP/ws on LAN/Tailscale. -->
<network-security-config>
  <base-config cleartextTrafficPermitted="true" />
</network-security-config>
`;

function withCleartextNetwork(config) {
  config = withAndroidManifest(config, (config) => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(
      config.modResults,
    );
    application.$["android:usesCleartextTraffic"] = "true";
    application.$["android:networkSecurityConfig"] =
      "@xml/network_security_config";
    return config;
  });

  return withDangerousMod(config, [
    "android",
    async (config) => {
      const xmlDir = path.join(
        config.modRequest.platformProjectRoot,
        "app/src/main/res/xml",
      );
      fs.mkdirSync(xmlDir, { recursive: true });
      fs.writeFileSync(
        path.join(xmlDir, "network_security_config.xml"),
        NETWORK_SECURITY_CONFIG,
        "utf8",
      );
      return config;
    },
  ]);
}

module.exports = withCleartextNetwork;
