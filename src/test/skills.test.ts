// The YAML subset skills use in their frontmatter.
import assert from "node:assert/strict";
import { test } from "node:test";
import { frontmatterScalars } from "../skills.ts";

test("frontmatterScalars: plain, quoted, block and multi-line values", () => {
  const keys = frontmatterScalars(
    [
      "name: deploy # a comment",
      'description: "Use #tags: \\"quoted\\""',
      "single: 'it''s # kept'",
      "literal: |",
      "  one",
      "  two",
      "folded: >-",
      "  one",
      "  two",
      "plain: first",
      "  second",
      "metadata:",
      "  owner: me",
    ].join("\n"),
  );
  assert.equal(keys.get("name"), "deploy");
  assert.equal(keys.get("description"), 'Use #tags: "quoted"');
  assert.equal(keys.get("single"), "it's # kept");
  assert.equal(keys.get("literal"), "one\ntwo");
  assert.equal(keys.get("folded"), "one two");
  assert.equal(keys.get("plain"), "first second");
  assert.equal(keys.get("metadata"), "", "a nested map has no scalar value");
});
