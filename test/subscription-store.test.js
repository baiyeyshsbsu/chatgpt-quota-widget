/**
 * Unit tests for the manual renewal reminder store (subscription-store.js).
 * The store is injectable (filePath + clock), so everything runs without Electron.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  createSubscriptionStore,
  parseDeadline,
  statusOf,
  daysLeftOf,
  DAY_MS,
  ALERT_THROTTLE_MS
} = require("../src/main/subscription-store.js");

function localDate(y, m, d, hh = 0, mm = 0) {
  return new Date(y, m - 1, d, hh, mm, 0, 0).getTime();
}

function makeClock(startMs) {
  let current = startMs;
  const fn = () => current;
  fn.advance = (ms) => { current += ms; };
  fn.set = (ms) => { current = ms; };
  return fn;
}

function tempStore(t, now) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "subs-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return createSubscriptionStore({ filePath: path.join(dir, "subscriptions.json"), now });
}

/* ---------------- date semantics ---------------- */

test("parseDeadline treats a bare date as local end-of-day", () => {
  const ms = parseDeadline("2026-10-09");
  assert.equal(ms, new Date(2026, 9, 9, 23, 59, 59, 0).getTime());
  assert.equal(parseDeadline(""), null);
  assert.equal(parseDeadline("nonsense"), null);
});

test("daysLeftOf counts calendar days, not 24h ceilings", () => {
  const deadline = parseDeadline("2026-10-09");
  assert.equal(daysLeftOf(deadline, localDate(2026, 10, 6, 1)), 3);
  assert.equal(daysLeftOf(deadline, localDate(2026, 10, 6, 23)), 3);
  assert.equal(daysLeftOf(deadline, localDate(2026, 10, 9, 23, 30)), 0);
  assert.equal(daysLeftOf(deadline, localDate(2026, 10, 10, 0, 1)), -1);
  assert.equal(daysLeftOf(null, localDate(2026, 10, 6)), null);
});

test("statusOf: due within remindBeforeDays, expired past the day", () => {
  const now = localDate(2026, 10, 6);
  assert.equal(statusOf({ renewsAt: "2026-10-09", remindBeforeDays: 3 }, now), "due");
  assert.equal(statusOf({ renewsAt: "2026-10-10", remindBeforeDays: 3 }, now), "ok");
  assert.equal(statusOf({ renewsAt: "2026-10-06", remindBeforeDays: 3 }, now), "due");
  assert.equal(statusOf({ renewsAt: "2026-10-05", remindBeforeDays: 3 }, now), "expired");
  assert.equal(statusOf({ renewsAt: null, remindBeforeDays: 3 }, now), "ok");
});

/* ---------------- add / update / manual date ---------------- */

test("add validates the date and applies settings defaults", (t) => {
  const store = tempStore(t, makeClock(localDate(2026, 10, 6, 0)));
  assert.throws(() => store.add({ name: "x", renewsAt: "garbage" }), /续费日期无效/);
  const item = store.add({ name: "Cloudflare", renewsAt: "2026-11-05" });
  assert.equal(item.cycleDays, 30);
  assert.equal(item.remindBeforeDays, 3);
  assert.equal(item.daysLeft, 30);
  assert.equal(item.status, "ok");
  assert.equal(store.list().length, 1);
});

test("update with a manual date records history and clears alert state", (t) => {
  const clock = makeClock(localDate(2026, 10, 6));
  const store = tempStore(t, clock);
  const item = store.add({ name: "VPS", renewsAt: "2026-10-08" });
  store.snooze(item.id, 60 * 60 * 1000);
  const updated = store.update(item.id, { renewsAt: "2026-12-01", name: "VPS Pro" });
  assert.equal(updated.name, "VPS Pro");
  assert.equal(updated.daysLeft, 56);
  assert.equal(updated.snoozedUntil, null);
  assert.equal(updated.history.length, 1);
  assert.equal(updated.history[0].source, "manual-date");
  assert.equal(parseDeadline(updated.history[0].to), parseDeadline("2026-12-01"));
  assert.throws(() => store.update(item.id, { renewsAt: "nope" }), /续费日期无效/);
  assert.throws(() => store.update("missing-id", {}), /订阅不存在/);
});

/* ---------------- renew semantics ---------------- */

test("renew from today: +cycleDays measured from the click", (t) => {
  const clock = makeClock(localDate(2026, 10, 6, 10));
  const store = tempStore(t, clock);
  const item = store.add({ name: "API", renewsAt: "2026-10-07", cycleDays: 30 });
  const renewed = store.renew(item.id);
  const expected = clock() + 30 * DAY_MS;
  assert.equal(parseDeadline(renewed.renewsAt), expected);
  assert.equal(renewed.history[0].source, "manual");
  assert.equal(renewed.history[0].days, 30);
  assert.equal(renewed.status, "ok");
});

test("renew from old deadline stacks when the deadline is in the future", (t) => {
  const clock = makeClock(localDate(2026, 10, 6, 10));
  const store = tempStore(t, clock);
  const item = store.add({
    name: "Domain",
    renewsAt: "2026-10-20",
    cycleDays: 30,
    renewFrom: "oldDeadline"
  });
  const renewed = store.renew(item.id);
  assert.equal(parseDeadline(renewed.renewsAt), parseDeadline("2026-10-20") + 30 * DAY_MS);
});

test("renew from old deadline falls back to now once expired", (t) => {
  const clock = makeClock(localDate(2026, 10, 6, 10));
  const store = tempStore(t, clock);
  const item = store.add({
    name: "Proxy",
    renewsAt: "2026-10-01",
    cycleDays: 7,
    renewFrom: "oldDeadline"
  });
  const renewed = store.renew(item.id);
  assert.equal(parseDeadline(renewed.renewsAt), clock() + 7 * DAY_MS);
});

test("renewAllDue only touches due/expired items", (t) => {
  const store = tempStore(t, makeClock(localDate(2026, 10, 6)));
  const due = store.add({ name: "due", renewsAt: "2026-10-07" });
  const fine = store.add({ name: "fine", renewsAt: "2026-12-01" });
  const renewed = store.renewAllDue();
  assert.equal(renewed.length, 1);
  assert.equal(renewed[0].id, due.id);
  assert.equal(renewed[0].history[0].source, "bulk");
  const stillFine = store.list().find((entry) => entry.id === fine.id);
  assert.equal(stillFine.history.length, 0);
});

/* ---------------- summary ---------------- */

test("summary normalizes amounts to a 30-day month and ignores archived items", (t) => {
  const store = tempStore(t, makeClock(localDate(2026, 10, 6)));
  store.add({ name: "monthly", renewsAt: "2026-11-01", amount: 100, cycleDays: 30 });
  store.add({ name: "yearly", renewsAt: "2026-11-01", amount: 1200, cycleDays: 365 });
  const archived = store.add({ name: "old", renewsAt: "2026-10-07", amount: 999 });
  store.update(archived.id, { archived: true });
  const summary = store.summary();
  assert.equal(summary.count, 2);
  assert.equal(summary.monthlyTotal, Math.round((100 + (1200 * 30) / 365) * 100) / 100);
  assert.equal(summary.level, "none");
});

/* ---------------- alert scan: throttle, snooze, mute ---------------- */

test("scan fires once per throttle window, respects snooze and mute", (t) => {
  const clock = makeClock(localDate(2026, 10, 6, 8));
  const store = tempStore(t, clock);
  const due = store.add({ name: "due", renewsAt: "2026-10-08" });
  const snoozed = store.add({ name: "snoozed", renewsAt: "2026-10-08" });
  const muted = store.add({ name: "muted", renewsAt: "2026-10-08" });
  store.update(muted.id, { muted: true });
  store.snooze(snoozed.id, 60 * 60 * 1000);

  let result = store.scan();
  assert.equal(result.level, "due");
  assert.deepEqual(result.alerts.map((item) => item.name), ["due"]);

  // Immediately again: throttled by persisted lastAlertAt.
  result = store.scan();
  assert.equal(result.alerts.length, 0);

  // Snooze expires after 1h: the snoozed item fires (it never alerted before),
  // while "due" stays silent because its 24h throttle is still in effect.
  clock.advance(61 * 60 * 1000);
  result = store.scan();
  assert.deepEqual(result.alerts.map((item) => item.name), ["snoozed"]);

  // Past the throttle window both still-unresolved items re-fire; muted never does.
  clock.advance(ALERT_THROTTLE_MS);
  result = store.scan();
  assert.deepEqual(result.alerts.map((item) => item.name).sort(), ["due", "snoozed"]);

  // Renewing clears alert state and resolves the items, so nothing re-fires.
  // (The muted item is still unresolved — it keeps the summary level at "due"
  // but never produces an alert.)
  store.renew(due.id);
  store.renew(snoozed.id);
  clock.advance(ALERT_THROTTLE_MS);
  result = store.scan();
  assert.equal(result.alerts.length, 0);
  assert.equal(result.level, "due");
});

test("scan stays silent when reminders are disabled", (t) => {
  const clock = makeClock(localDate(2026, 10, 6, 8));
  const store = tempStore(t, clock);
  store.add({ name: "due", renewsAt: "2026-10-07" });
  store.setSettings({ enabled: false });
  const result = store.scan();
  assert.equal(result.alerts.length, 0);
  assert.equal(result.level, "due");
});

/* ---------------- persistence ---------------- */

test("state survives a reload from the same file", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "subs-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const filePath = path.join(dir, "subscriptions.json");
  const clock = makeClock(localDate(2026, 10, 6));
  const first = createSubscriptionStore({ filePath, now: clock });
  const item = first.add({ name: "persisted", renewsAt: "2026-10-08", amount: 42 });
  first.renew(item.id);

  const second = createSubscriptionStore({ filePath, now: clock });
  const reloaded = second.list();
  assert.equal(reloaded.length, 1);
  assert.equal(reloaded[0].name, "persisted");
  assert.equal(reloaded[0].history.length, 1);
  assert.equal(reloaded[0].amount, 42);
  assert.ok(!fs.existsSync(`${filePath}.tmp`), "temp file should be renamed away");
});

test("a corrupt file falls back to empty defaults instead of throwing", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "subs-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const filePath = path.join(dir, "subscriptions.json");
  fs.writeFileSync(filePath, "{ not json");
  const store = createSubscriptionStore({ filePath, now: makeClock(localDate(2026, 10, 6)) });
  assert.deepEqual(store.list(), []);
  assert.equal(store.getSettings().defaultRemindBeforeDays, 3);
});
