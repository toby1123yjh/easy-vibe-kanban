import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function catalog(locale) {
  const source = JSON.parse(
    readFileSync(
      new URL(
        `../../packages/web-core/src/i18n/locales/${locale}/agent-config.json`,
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const result = {};
  function visit(object, prefix = "") {
    for (const [key, value] of Object.entries(object)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (value && typeof value === "object") visit(value, path);
      else {
        assert.equal(typeof value, "string", path);
        assert.ok(value.trim(), path);
        result[path] = value;
      }
    }
  }
  visit(source);
  return result;
}

const english = catalog("en");
test("native file write guards compare protocol statuses, not translated labels", () => {
  const source = readFileSync(
    new URL(
      "../../packages/web-core/src/shared/dialogs/settings/settings/AgentConfigurationSettingsPanel.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(source, /file\.parse_status\s*!==\s*['"]unsupported['"]/);
  assert.doesNotMatch(source, /file\.parse_status\s*[!=]==?\s*tc\(/);
});

for (const locale of ["zh-Hans", "zh-Hant"]) {
  test(`${locale}/agent-config: translated keys and interpolation match English`, () => {
    const translated = catalog(locale);
    assert.deepEqual(
      Object.keys(translated).sort(),
      Object.keys(english).sort(),
    );
    for (const [key, value] of Object.entries(english)) {
      const parameters = (text) => (text.match(/{{.*?}}/g) ?? []).sort();
      assert.deepEqual(parameters(translated[key]), parameters(value), key);
      assert.notEqual(
        translated[key],
        value,
        `${key}: untranslated product copy`,
      );
    }
  });
}
