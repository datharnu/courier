import assert from "node:assert/strict";
import { test } from "node:test";

import { readFileSync } from "node:fs";

import { WEB_PROTOCOL_FILES, differing, webCopy } from "../../scripts/sync-web-protocol.js";

test("/app/try runs the same protocol bytes as src/ts", () => {
  assert.equal(WEB_PROTOCOL_FILES.length, 6);
  assert.deepEqual(differing(), [], "run npm run web:sync");
});

test("the web copy only drops the .js suffix of relative imports", () => {
  const source = readFileSync("src/ts/handshake.ts", "utf8");
  const copy = webCopy(source);
  assert.ok(copy.includes('from "./bytes"') && !copy.includes('from "./bytes.js"'));
  assert.equal(copy.replace(/from "(\.{1,2}\/[^"]+)"/g, 'from "$1.js"'), source);
  assert.ok(copy.includes('from "@noble/ciphers/utils.js"'), "package subpaths keep their suffix");
});
