import assert from "node:assert/strict";
import { test } from "node:test";
import { greeting } from "./src/index.js";

test("greeting includes the name", () => {
  assert.match(greeting("Ada"), /Ada/);
});
