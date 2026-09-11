#!/usr/bin/env node

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const { getPorts } = require("./setup-dev-environment");

const ROOT_DIR = path.resolve(__dirname, "..");
const PROCESS_HOST_FILENAME =
  process.platform === "win32"
    ? "agent-process-host.exe"
    : "agent-process-host";

function defaultCargoCommand() {
  if (process.platform === "win32" && process.env.USERPROFILE) {
    const userCargo = path.join(
      process.env.USERPROFILE,
      ".cargo",
      "bin",
      "cargo.exe",
    );
    if (isFile(userCargo)) return userCargo;
  }
  return "cargo";
}

const CARGO_COMMAND = process.env.CARGO || defaultCargoCommand();

function targetDirectory(env) {
  const configured = env.CARGO_TARGET_DIR;
  return configured
    ? path.resolve(ROOT_DIR, configured)
    : path.join(ROOT_DIR, "target");
}

function processHostPath(env) {
  return path.join(targetDirectory(env), "debug", PROCESS_HOST_FILENAME);
}

function isFile(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function configuredProcessHost(env) {
  const configured = env.VIBE_KANBAN_AGENT_PROCESS_HOST;
  if (!configured) return null;

  const resolved = path.resolve(ROOT_DIR, configured);
  if (!isFile(resolved)) {
    throw new Error(
      `VIBE_KANBAN_AGENT_PROCESS_HOST does not exist: ${resolved}`,
    );
  }
  return configured;
}

function commandAvailable(command, args) {
  const result = spawnSync(command, args, {
    cwd: ROOT_DIR,
    stdio: "ignore",
    windowsHide: true,
  });
  return result.status === 0;
}

function pnpmInvocation(args) {
  const corepackPnpm = path.join(
    path.dirname(process.execPath),
    "node_modules",
    "corepack",
    "dist",
    "pnpm.js",
  );
  if (isFile(corepackPnpm)) {
    return { command: process.execPath, args: [corepackPnpm, ...args] };
  }
  return {
    command: process.platform === "win32" ? "pnpm.cmd" : "pnpm",
    args,
  };
}

function runPnpm(args, env) {
  const invocation = pnpmInvocation(args);
  return run(invocation.command, invocation.args, env);
}

function run(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: ROOT_DIR,
      env,
      stdio: "inherit",
      windowsHide: false,
      shell:
        process.platform === "win32" && command.toLowerCase().endsWith(".cmd"),
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
}

async function ensureProcessHost(env) {
  if (configuredProcessHost(env)) return;

  const result = await run(
    CARGO_COMMAND,
    ["build", "-p", "local-deployment", "--bin", "agent-process-host"],
    env,
  );
  if (result.code !== 0) {
    throw new Error(
      `agent-process-host build failed${result.signal ? ` (${result.signal})` : ""}`,
    );
  }

  const hostPath = processHostPath(env);
  if (!isFile(hostPath)) {
    throw new Error(`agent-process-host was not produced at ${hostPath}`);
  }
}

function backendWatchArgs(env) {
  const args = ["watch", "-w", "crates"];
  if (!configuredProcessHost(env)) {
    args.push("-x", "build -p local-deployment --bin agent-process-host");
  }
  args.push("-x", "run --bin server");
  return args;
}

async function startBackend(env) {
  // cargo-watch keeps running after a failed action. Build once up front so a
  // missing or uncompilable process host fails the development command before
  // the server can start, while the watch action still rebuilds on changes.
  await ensureProcessHost(env);

  if (commandAvailable(CARGO_COMMAND, ["watch", "--version"])) {
    const result = await run(CARGO_COMMAND, backendWatchArgs(env), env);
    process.exitCode = result.code ?? 1;
    return;
  }

  console.warn(
    "cargo-watch is unavailable; building agent-process-host once and running server without file watching.",
  );
  const result = await run(CARGO_COMMAND, ["run", "--bin", "server"], env);
  process.exitCode = result.code ?? 1;
}

async function startFrontend(env) {
  const result = await runPnpm(
    ["--filter", "@vibe/local-web", "run", "dev", "--strictPort"],
    env,
  );
  process.exitCode = result.code ?? 1;
}

function withDevelopmentEnvironment(ports, baseEnv = process.env) {
  const frontendPort = String(baseEnv.FRONTEND_PORT || ports.frontend);
  const backendPort = String(baseEnv.BACKEND_PORT || ports.backend);
  for (const port of [frontendPort, backendPort]) {
    if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
      throw new Error("Development ports must be integers between 1 and 65535");
    }
  }
  if (Number(frontendPort) === Number(backendPort)) {
    throw new Error("Frontend and backend must use distinct development ports");
  }
  return {
    ...baseEnv,
    FRONTEND_PORT: frontendPort,
    BACKEND_PORT: backendPort,
    VK_DEV_FRONTEND_ORIGIN: `http://localhost:${Number(frontendPort)}`,
    PREVIEW_PROXY_PORT:
      baseEnv.PREVIEW_PROXY_PORT || String(ports.preview_proxy),
    VK_ALLOWED_ORIGINS:
      baseEnv.VK_ALLOWED_ORIGINS ||
      `http://localhost:${baseEnv.FRONTEND_PORT || ports.frontend}`,
    VITE_VK_SHARED_API_BASE:
      baseEnv.VITE_VK_SHARED_API_BASE || baseEnv.VK_SHARED_API_BASE || "",
    VITE_OPEN: baseEnv.VITE_OPEN || "false",
    DISABLE_WORKTREE_CLEANUP: baseEnv.DISABLE_WORKTREE_CLEANUP || "1",
    RUST_LOG: baseEnv.RUST_LOG || "debug",
  };
}

async function main() {
  const mode = process.argv[2] || "all";
  if (!["all", "backend", "frontend"].includes(mode)) {
    throw new Error(`Unknown development mode: ${mode}`);
  }

  // Child commands inherit the resolved pair. Reallocation while their sibling
  // is already listening would otherwise move the saved ports behind its back.
  const ports = await resolveDevelopmentPorts(process.env);
  const env = withDevelopmentEnvironment(ports);

  if (mode === "backend") {
    await startBackend(env);
    return;
  }
  if (mode === "frontend") {
    await startFrontend(env);
    return;
  }

  const result = await runPnpm(
    [
      "exec",
      "concurrently",
      "--kill-others-on-fail",
      "pnpm run backend:dev:watch",
      "pnpm run local-web:dev",
    ],
    env,
  );
  process.exitCode = result.code ?? 1;
}

async function resolveDevelopmentPorts(env, allocate = getPorts) {
  if (env.FRONTEND_PORT && env.BACKEND_PORT && env.PREVIEW_PROXY_PORT) {
    return {
      frontend: env.FRONTEND_PORT,
      backend: env.BACKEND_PORT,
      preview_proxy: env.PREVIEW_PROXY_PORT,
    };
  }
  return allocate();
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}

module.exports = {
  backendWatchArgs,
  configuredProcessHost,
  processHostPath,
  targetDirectory,
  withDevelopmentEnvironment,
  resolveDevelopmentPorts,
};
