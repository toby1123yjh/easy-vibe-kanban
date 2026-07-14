#!/usr/bin/env node

/**
 * Publish the running local-web dev server to your private Tailscale tailnet
 * over HTTPS, so you can open the UI from your phone / other devices.
 *
 * Usage:
 *   pnpm run share        # start sharing (reads the frontend port from .dev-ports.json)
 *   pnpm run share:off    # stop sharing (tailscale serve reset)
 *
 * Prereqs: `pnpm run dev` is already running, Tailscale is installed and signed
 * in, and MagicDNS + HTTPS certs are enabled in the Tailscale admin console.
 * See docs/ai-mobile/tailscale-local-access.md for the full design/setup.
 */

const fs = require("fs");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");

const PORTS_FILE = path.join(__dirname, "..", ".dev-ports.json");

/**
 * Read the frontend (Vite) port from the dev ports file written by
 * setup-dev-environment.js. We read the file directly rather than calling
 * getPorts(), because while `pnpm run dev` is running the port is in use and
 * the availability check would otherwise allocate a different one.
 */
function readFrontendPort() {
  if (!fs.existsSync(PORTS_FILE)) {
    console.error(
      "No .dev-ports.json found. Start the app first:\n  pnpm run dev"
    );
    process.exit(1);
  }
  let ports;
  try {
    ports = JSON.parse(fs.readFileSync(PORTS_FILE, "utf8"));
  } catch (error) {
    console.error("Failed to read .dev-ports.json:", error.message);
    process.exit(1);
  }
  if (!ports.frontend) {
    console.error("No frontend port in .dev-ports.json. Run:\n  pnpm run dev");
    process.exit(1);
  }
  return ports.frontend;
}

/**
 * Locate the Tailscale CLI across platforms. Tries PATH first, then the usual
 * install locations on Windows / macOS / Linux.
 */
function findTailscale() {
  const candidates = ["tailscale"];
  if (process.platform === "win32") {
    candidates.push("C:\\Program Files\\Tailscale\\tailscale.exe");
  } else if (process.platform === "darwin") {
    candidates.push(
      "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
      "/usr/local/bin/tailscale",
      "/opt/homebrew/bin/tailscale"
    );
  } else {
    candidates.push("/usr/bin/tailscale", "/usr/local/bin/tailscale");
  }

  for (const bin of candidates) {
    try {
      execFileSync(bin, ["version"], { stdio: "ignore" });
      return bin;
    } catch {
      // try next candidate
    }
  }
  return null;
}

/**
 * Resolve the tailnet HTTPS URL for this machine (https://<host>.ts.net).
 */
function getTailnetUrl(tailscale) {
  try {
    const out = execFileSync(tailscale, ["status", "--json"], {
      encoding: "utf8",
    });
    const dnsName = JSON.parse(out)?.Self?.DNSName;
    if (!dnsName) return null;
    return `https://${dnsName.replace(/\.$/, "")}`;
  } catch {
    return null;
  }
}

function main() {
  const off = process.argv.includes("--off");

  const tailscale = findTailscale();
  if (!tailscale) {
    console.error(
      "Tailscale CLI not found. Install it from https://tailscale.com/download\n" +
        "and make sure it is running and signed in."
    );
    process.exit(1);
  }

  if (off) {
    const result = spawnSync(tailscale, ["serve", "reset"], {
      stdio: "inherit",
    });
    if (result.status === 0) {
      console.log("Stopped sharing (tailscale serve reset).");
    }
    process.exit(result.status ?? 0);
  }

  const port = readFrontendPort();
  console.log(`Publishing local-web (localhost:${port}) to your tailnet...`);

  const result = spawnSync(tailscale, ["serve", "--bg", String(port)], {
    stdio: "inherit",
  });
  if (result.status !== 0) {
    console.error(
      "\ntailscale serve failed. Check that Tailscale is running and signed in,\n" +
        "and that HTTPS certificates are enabled in the admin console.\n" +
        `Manual fallback:  tailscale serve --bg ${port}`
    );
    process.exit(result.status ?? 1);
  }

  const url = getTailnetUrl(tailscale);
  console.log("\n✅ Shared on your private tailnet.");
  if (url) {
    console.log(
      `   Open on any device signed into your Tailscale account:\n   ${url}`
    );
  } else {
    console.log('   Run "tailscale serve status" to see the URL.');
  }
  console.log("\n   Stop sharing:  pnpm run share:off");
}

main();
