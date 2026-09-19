#!/usr/bin/env node

const { spawnSync } = require("node:child_process");
const path = require("node:path");

// Python is only needed to maintain the checked-in snapshot, never at startup.
const candidates = process.env.PYTHON
  ? [[process.env.PYTHON, []]]
  : process.platform === "win32"
    ? [
        ["python", []],
        ["py", ["-3"]],
        ["python3", []],
      ]
    : [
        ["python3", []],
        ["python", []],
      ];

for (const [command, prefix] of candidates) {
  const probe = spawnSync(command, [...prefix, "-c", "import sqlite3"], {
    stdio: "ignore",
  });
  if (probe.error || probe.status !== 0) continue;
  const result = spawnSync(
    command,
    [
      ...prefix,
      path.join(__dirname, "prepare_dev_fixture.py"),
      ...process.argv.slice(2),
    ],
    { stdio: "inherit" },
  );
  if (result.error) console.error(result.error.message);
  process.exit(result.status ?? 1);
}
console.error(
  "Fixture maintenance requires Python 3 with sqlite3. Install Python or set PYTHON to its executable.",
);
process.exit(1);
