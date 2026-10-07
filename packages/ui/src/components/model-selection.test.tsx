import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ModelList } from "./ModelList";

test("model rows match opaque IDs exactly and show the advertised empty effort label", () => {
  const html = renderToStaticMarkup(
    <ModelList
      models={[
        {
          id: "vendor/Foo",
          name: "Upper",
          reasoning_options: [{ id: "high", label: "High" }],
        },
        {
          id: "vendor/foo",
          name: "Lower",
          reasoning_options: [{ id: "", label: "No effort" }],
        },
      ]}
      selectedModelId="vendor/foo"
      selectedReasoningId=""
      searchQuery=""
      reasoningOptions={[{ id: "", label: "No effort" }]}
      onSelect={() => {}}
      onReasoningSelect={() => {}}
    />,
  );
  assert.equal((html.match(/title="No effort"/g) ?? []).length, 1);
  assert.equal((html.match(/bg-secondary text-high/g) ?? []).length, 1);
});
