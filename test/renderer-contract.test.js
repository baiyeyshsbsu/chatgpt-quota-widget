const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("every renderer element binding exists in index.html", () => {
  const root = path.join(__dirname, "..", "src", "renderer");
  const renderer = fs.readFileSync(path.join(root, "renderer.js"), "utf8");
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const boundIds = [...renderer.matchAll(/\$\("([^"]+)"\)/g)].map((match) => match[1]);
  const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
  const missing = [...new Set(boundIds)].filter((id) => !htmlIds.has(id));
  assert.deepEqual(missing, []);
});

test("renderer has no manual quota mutation bridge calls", () => {
  const renderer = fs.readFileSync(
    path.join(__dirname, "..", "src", "renderer", "renderer.js"),
    "utf8"
  );
  for (const forbidden of [
    "setManualRemainingPercent",
    "resetAllAccountQuotas",
    "prepareResetAllAccountQuotas",
    "confirmResetAllAccountQuotas",
    "setResetCount",
    "getActiveAccount",
    "setActiveAccount",
    "select-account",
    "selectAccount"
  ]) {
    assert.equal(renderer.includes(forbidden), false, `${forbidden} must not be exposed`);
  }
});
