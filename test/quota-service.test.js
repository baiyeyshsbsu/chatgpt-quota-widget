const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeSnapshot } = require("../src/main/quota-service");

test("keeps five-hour and seven-day Codex windows separate", () => {
  const quota = normalizeSnapshot({
    limitId: "codex",
    primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: 1787630400 },
    secondary: { usedPercent: 60, windowDurationMins: 10080, resetsAt: 1788235200 }
  });

  assert.equal(quota.fiveHour.remainingPercent, 75);
  assert.equal(quota.fiveHour.windowDurationMins, 300);
  assert.equal(quota.sevenDay.remainingPercent, 40);
  assert.equal(quota.sevenDay.windowDurationMins, 10080);
  assert.equal(quota.remainingPercent, 40);
  assert.notEqual(quota.primary, null);
  assert.notEqual(quota.secondary, null);
});

test("does not invent a five-hour window when Codex returns only a weekly window", () => {
  const quota = normalizeSnapshot({
    primary: { usedPercent: 10, windowDurationMins: 10080, resetsAt: 1788235200 },
    secondary: null
  });

  assert.equal(quota.fiveHour, null);
  assert.equal(quota.sevenDay.remainingPercent, 90);
});

test("does not invent a weekly window when Codex returns only a five-hour window", () => {
  const quota = normalizeSnapshot({
    primary: { usedPercent: 30, windowDurationMins: 300, resetsAt: 1787630400 },
    secondary: null
  });

  assert.equal(quota.fiveHour.remainingPercent, 70);
  assert.equal(quota.sevenDay, null);
});
