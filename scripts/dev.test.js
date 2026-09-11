const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  backendWatchArgs,
  configuredProcessHost,
  withDevelopmentEnvironment,
  resolveDevelopmentPorts,
} = require("./dev");

test("backend watch rebuilds the process host before the server", () => {
  assert.deepEqual(backendWatchArgs({}), [
    "watch",
    "-w",
    "crates",
    "-x",
    "build -p local-deployment --bin agent-process-host",
    "-x",
    "run --bin server",
  ]);
});

test("an explicit process host path is preserved", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-kanban-dev-"));
  const hostPath = path.join(directory, "agent-process-host");
  fs.writeFileSync(hostPath, "test");

  try {
    assert.equal(
      configuredProcessHost({ VIBE_KANBAN_AGENT_PROCESS_HOST: hostPath }),
      hostPath,
    );
    assert.throws(
      () =>
        configuredProcessHost({
          VIBE_KANBAN_AGENT_PROCESS_HOST: path.join(directory, "missing"),
        }),
      /does not exist/,
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("development environment derives ports and disables Vite auto-open", () => {
  const env = withDevelopmentEnvironment(
    {
      frontend: 3100,
      backend: 3101,
      preview_proxy: 3102,
    },
    {},
  );

  assert.equal(env.FRONTEND_PORT, "3100");
  assert.equal(env.BACKEND_PORT, "3101");
  assert.equal(env.PREVIEW_PROXY_PORT, "3102");
  assert.equal(env.VK_ALLOWED_ORIGINS, "http://localhost:3100");
  assert.equal(env.VITE_OPEN, "false");
  assert.equal(env.VK_DEV_FRONTEND_ORIGIN, "http://localhost:3100");
});

test("dev origin follows the actual frontend port, never an inherited origin", () => {
  const env = withDevelopmentEnvironment(
    { frontend: 3000, backend: 3001, preview_proxy: 3002 },
    {
      FRONTEND_PORT: "4100",
      BACKEND_PORT: "4101",
      VK_DEV_FRONTEND_ORIGIN: "https://evil.example",
    },
  );
  assert.equal(env.VK_DEV_FRONTEND_ORIGIN, "http://localhost:4100");
  for (const FRONTEND_PORT of ["0", "65536", "abc", "3001", "-1", "3000evil"]) {
    assert.throws(
      () =>
        withDevelopmentEnvironment(
          { frontend: 3000, backend: 3001, preview_proxy: 3002 },
          { FRONTEND_PORT },
        ),
      /ports/,
    );
  }
});

test("sibling dev commands retain allocated ports even when already occupied", async () => {
  const env = {
    FRONTEND_PORT: "4100",
    BACKEND_PORT: "4101",
    PREVIEW_PROXY_PORT: "4102",
  };
  assert.deepEqual(
    await resolveDevelopmentPorts(env, () => {
      throw new Error("must not allocate against a running sibling");
    }),
    { frontend: "4100", backend: "4101", preview_proxy: "4102" },
  );
  let allocated = 0;
  await resolveDevelopmentPorts({}, async () => {
    allocated++;
    return {};
  });
  assert.equal(allocated, 1);
});
