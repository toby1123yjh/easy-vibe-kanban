import fs from "fs";
import path from "path";

type BundledAgent = {
  /** npm package name */
  pkg: string;
  /** key in the package.json "bin" map */
  binKey: string;
  /** env var receiving the full launch command (shell-words quoted) */
  cmdEnv: string;
  /** env var receiving the bundled package version */
  versionEnv: string;
  /** fallback binary candidates relative to the package dir */
  fallbacks: string[];
};

const BUNDLED_AGENTS: BundledAgent[] = [
  {
    pkg: "@openai/codex",
    binKey: "codex",
    cmdEnv: "VK_BUNDLED_CODEX_CMD",
    versionEnv: "VK_BUNDLED_CODEX_VERSION",
    fallbacks: ["bin/codex.js"],
  },
  {
    // The claude-code package installs a platform-native binary via its
    // postinstall script; the manifest bin may point at bin/claude.exe even
    // on unix, so probe a few candidates.
    pkg: "@anthropic-ai/claude-code",
    binKey: "claude",
    cmdEnv: "VK_BUNDLED_CLAUDE_CMD",
    versionEnv: "VK_BUNDLED_CLAUDE_VERSION",
    fallbacks: ["bin/claude.exe", "bin/claude", "cli.js"],
  },
];

function isTruthyEnv(value: string | undefined): boolean {
  if (!value) return false;
  const v = value.trim().toLowerCase();
  return v !== "" && v !== "0" && v !== "false" && v !== "no" && v !== "off";
}

/**
 * Locate an installed package directory by walking node_modules upwards from
 * this script. Handles both hoisted (npx cache) and nested installs without
 * relying on require.resolve, which can be blocked by "exports" maps.
 */
function findPackageDir(pkgName: string): string | null {
  let dir = __dirname;
  for (let i = 0; i < 12; i++) {
    const candidate = path.join(dir, "node_modules", pkgName);
    if (fs.existsSync(path.join(candidate, "package.json"))) {
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

const quote = (p: string) => `"${p}"`;

function resolveAgentCommand(
  agent: BundledAgent,
): { cmd: string; version: string } | null {
  const pkgDir = findPackageDir(agent.pkg);
  if (!pkgDir) return null;

  let manifest: { version?: string; bin?: string | Record<string, string> };
  try {
    manifest = JSON.parse(
      fs.readFileSync(path.join(pkgDir, "package.json"), "utf8"),
    );
  } catch {
    return null;
  }

  const manifestBin =
    typeof manifest.bin === "string" ? manifest.bin : manifest.bin?.[agent.binKey];
  const candidates = [manifestBin, ...agent.fallbacks].filter(
    (c): c is string => Boolean(c),
  );

  for (const rel of candidates) {
    const binPath = path.join(pkgDir, rel);
    if (!fs.existsSync(binPath)) continue;
    const cmd = /\.(c|m)?js$/i.test(binPath)
      ? `${quote(process.execPath)} ${quote(binPath)}`
      : quote(binPath);
    return { cmd, version: manifest.version ?? "" };
  }
  return null;
}

/**
 * Pin & ship: expose the coding-agent CLIs pinned as dependencies of this
 * package to the server via environment variables, so executors spawn a
 * known-good agent version instead of whatever is on the user's PATH.
 *
 * Opt out with VK_USE_SYSTEM_AGENTS=1. Pre-set VK_BUNDLED_*_CMD values win.
 * Missing packages (e.g. local dev, install scripts disabled) silently fall
 * back to PATH lookups in the server.
 */
export function setupBundledAgents(): void {
  if (isTruthyEnv(process.env.VK_USE_SYSTEM_AGENTS)) return;

  for (const agent of BUNDLED_AGENTS) {
    if (process.env[agent.cmdEnv]) continue;
    const resolved = resolveAgentCommand(agent);
    if (!resolved) {
      if (process.env.VIBE_KANBAN_DEBUG) {
        console.error(
          `Bundled agent ${agent.pkg} not found; falling back to PATH lookup.`,
        );
      }
      continue;
    }
    process.env[agent.cmdEnv] = resolved.cmd;
    if (resolved.version) {
      process.env[agent.versionEnv] = resolved.version;
    }
    if (process.env.VIBE_KANBAN_DEBUG) {
      console.error(
        `Bundled agent: ${agent.pkg}@${resolved.version} -> ${resolved.cmd}`,
      );
    }
  }
}
