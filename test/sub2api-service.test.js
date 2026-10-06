const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeBaseUrl,
  normalizeAccountQuota,
  summarizeAccountQuotas,
  didSnapshotAdvance
} = require("../src/main/sub2api-service");

test("normalizes a Sub2API base URL", () => {
  assert.equal(normalizeBaseUrl("http://localhost:8080/"), "http://localhost:8080");
  assert.throws(() => normalizeBaseUrl("file:///tmp/sub2api"));
});

test("sums all known account quotas without capping the aggregate at 100 percent", () => {
  const summary = summarizeAccountQuotas([
    { remainingPercent: 100, upstreamSampledAt: "2026-08-12T10:00:00Z" },
    { remainingPercent: 75, upstreamSampledAt: "2026-08-12T11:00:00Z" },
    { remainingPercent: 50, upstreamSampledAt: "2026-08-12T09:00:00Z" }
  ]);
  assert.equal(summary.remainingPercent, 225);
  assert.equal(summary.capacityPercent, 300);
  assert.equal(summary.accountCount, 3);
  assert.equal(summary.knownAccountCount, 3);
  assert.equal(summary.unknownAccountCount, 0);
  assert.equal(summary.upstreamSampledAt, "2026-08-12T11:00:00Z");
});

test("reports unknown relay quota snapshots instead of treating them as zero", () => {
  const summary = summarizeAccountQuotas([
    { remainingPercent: 80 },
    { remainingPercent: null },
    { remainingPercent: undefined }
  ]);
  assert.equal(summary.remainingPercent, 80);
  assert.equal(summary.capacityPercent, 300);
  assert.equal(summary.knownAccountCount, 1);
  assert.equal(summary.unknownAccountCount, 2);
});

test("keeps the aggregate unknown when no account has a usable snapshot", () => {
  const summary = summarizeAccountQuotas([
    { remainingPercent: null },
    { remainingPercent: undefined }
  ]);
  assert.equal(summary.remainingPercent, null);
  assert.equal(summary.knownAccountCount, 0);
  assert.equal(summary.unknownAccountCount, 2);
});

test("maps server utilization to remaining quota", () => {
  const quota = normalizeAccountQuota(
    {
      id: 42,
      name: "Plus A",
      platform: "openai",
      type: "oauth",
      status: "active",
      extra: { codex_usage_updated_at: "2026-07-28T11:59:58Z" }
    },
    {
      source: "active",
      updated_at: "2026-07-28T12:00:00Z",
      five_hour: {
        utilization: 12.4,
        resets_at: "2026-07-28T15:00:00Z"
      },
      seven_day: {
        utilization: 37.4,
        resets_at: "2026-08-03T12:00:00Z"
      }
    }
  );

  assert.equal(quota.id, "42");
  assert.equal(quota.remainingPercent, 63);
  assert.equal(quota.usedPercent, 37.4);
  assert.equal(quota.resetsAt, "2026-08-03T12:00:00Z");
  assert.equal(quota.fiveHour.remainingPercent, 88);
  assert.equal(quota.fiveHour.resetsAt, "2026-07-28T15:00:00Z");
  assert.equal(quota.sevenDay.remainingPercent, 63);
  assert.equal(quota.upstreamSampledAt, "2026-07-28T11:59:58Z");
});

test("sums the five-hour window across every relay account", () => {
  const accounts = [
    { fiveHour: { remainingPercent: 100 }, sevenDay: { remainingPercent: 20 } },
    { fiveHour: { remainingPercent: 75 }, sevenDay: { remainingPercent: 30 } },
    { fiveHour: { remainingPercent: 40 }, sevenDay: { remainingPercent: 50 } }
  ];
  const summary = summarizeAccountQuotas(accounts, "5h");
  assert.equal(summary.quotaWindow, "5h");
  assert.equal(summary.remainingPercent, 215);
  assert.equal(summary.capacityPercent, 300);
  assert.equal(summary.knownAccountCount, 3);
});

test("keeps unknown server quota unknown instead of inventing a percentage", () => {
  const quota = normalizeAccountQuota(
    { id: 7, name: "No snapshot", platform: "openai", type: "oauth" },
    null
  );
  assert.equal(quota.remainingPercent, null);
  assert.equal(quota.resetsAt, null);
});

test("only accepts an actually newer upstream snapshot", () => {
  assert.equal(
    didSnapshotAdvance("2026-07-28T12:00:00Z", "2026-07-28T12:00:01Z"),
    true
  );
  assert.equal(
    didSnapshotAdvance("2026-07-28T12:00:00Z", "2026-07-28T12:00:00Z"),
    false
  );
  assert.equal(didSnapshotAdvance(null, "2026-07-28T12:00:00Z"), true);
  assert.equal(didSnapshotAdvance(null, null), false);
});
