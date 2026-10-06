const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const main = fs.readFileSync(path.join(root, "src", "main", "main.js"), "utf8");
const renderer = fs.readFileSync(path.join(root, "src", "renderer", "renderer.js"), "utf8");

test("personal quota remains available from the local Codex provider", () => {
  assert.match(main, /require\("\.\/quota-service"\)/);
  const match = main.match(
    /async function readCurrentQuota\(\) \{([\s\S]*?)\n\}\n\nasync function readQuotaForMode/
  );
  assert.ok(match, "readCurrentQuota must be present");
  assert.match(match[1], /getQuotaWithNetworkRetry\(\)/);
  assert.doesNotMatch(match[1], /sub2api|listAccountQuotas|getAccountQuota/);
});

test("Sub2API account cache has an independent five-minute refresh loop", () => {
  assert.match(main, /SUB2API_REFRESH_INTERVAL_MS\s*=\s*5\s*\*\s*60\s*\*\s*1000/);
  assert.match(
    main,
    /setInterval\(\(\) => \{[\s\S]*refreshSub2apiAccountCache\(\)[\s\S]*SUB2API_REFRESH_INTERVAL_MS/
  );
});

test("main view can switch between personal and relay aggregate quota", () => {
  assert.match(main, /usage-mode:get/);
  assert.match(main, /usage-mode:set/);
  assert.match(main, /summarizeAccountQuotas/);
  assert.match(renderer, /changeUsageMode\("personal"\)/);
  assert.match(renderer, /changeUsageMode\("relay"\)/);
  assert.match(renderer, /RELAY_REFRESH_INTERVAL_MS\s*=\s*5\s*\*\s*60\s*\*\s*1000/);
});

test("quota window can switch independently between seven-day and five-hour data", () => {
  assert.match(main, /quota-window:get/);
  assert.match(main, /quota-window:set/);
  assert.match(main, /summarizeAccountQuotas\(result\.accounts, getQuotaWindow\(\)\)/);
  assert.match(renderer, /changeQuotaWindow\("7d"\)/);
  assert.match(renderer, /changeQuotaWindow\("5h"\)/);
});

test("relay mode persists even before Sub2API is connected", () => {
  const handler = main.match(
    /ipcMain\.handle\("usage-mode:set",([\s\S]*?)\n  \}\);/
  );
  assert.ok(handler);
  assert.match(handler[1], /setUsageMode\(mode\)/);
  assert.match(handler[1], /refreshSub2apiAccountCache\(\)\.catch/);
  assert.doesNotMatch(handler[1], /await refreshSub2apiAccountCache/);
});

test("account list cannot select or overwrite the main-view account", () => {
  for (const forbidden of [
    "getActiveAccount",
    "setActiveAccount",
    "select-account",
    "selectAccount"
  ]) {
    assert.equal(renderer.includes(forbidden), false, `${forbidden} must not control the main view`);
  }
  assert.doesNotMatch(renderer, /renderQuota\(\{\s*\.\.\.quota/);
});
