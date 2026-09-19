const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { copyDevAssets } = require("./setup-dev-environment");

function directories(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vk-bootstrap-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const seed = path.join(root, "seed");
  const destination = path.join(root, "dev");
  fs.mkdirSync(seed);
  return { seed, destination };
}

test("bootstrap copies only config, never current or legacy database files", (t) => {
  const { seed, destination } = directories(t);
  fs.writeFileSync(path.join(seed, "config.json"), '{"theme":"SYSTEM"}');
  for (const name of ["db.sqlite", "dev.db", "db.v2.sqlite"]) {
    fs.writeFileSync(path.join(seed, name), "must not copy");
  }
  copyDevAssets(seed, destination);
  assert.deepEqual(fs.readdirSync(destination), ["config.json"]);
});

test("repeated bootstrap preserves developer config and database contents", (t) => {
  const { seed, destination } = directories(t);
  fs.writeFileSync(path.join(seed, "config.json"), "{}");
  copyDevAssets(seed, destination);
  fs.writeFileSync(path.join(destination, "config.json"), '{"custom":true}');
  fs.writeFileSync(path.join(destination, "db.v2.sqlite"), "existing database");
  copyDevAssets(seed, destination);
  assert.equal(
    fs.readFileSync(path.join(destination, "config.json"), "utf8"),
    '{"custom":true}',
  );
  assert.equal(
    fs.readFileSync(path.join(destination, "db.v2.sqlite"), "utf8"),
    "existing database",
  );
});

test("a missing bootstrap config is an explicit failure", (t) => {
  const { seed, destination } = directories(t);
  assert.throws(() => copyDevAssets(seed, destination), { code: "ENOENT" });
});
