const fs = require("node:fs");
const path = require("node:path");
const { app, safeStorage } = require("electron");

const DEFAULT_BASE_URL = "http://127.0.0.1:18080";
const REQUEST_TIMEOUT_MS = 30000;
const ACCOUNT_PAGE_SIZE = 100;
const USAGE_CONCURRENCY = 3;
const SNAPSHOT_POLL_ATTEMPTS = 14;
const SNAPSHOT_POLL_DELAY_MS = 400;

let configCache = null;
let quotaCache = [];
let accountMetadataCache = [];

function configPath() {
  return path.join(app.getPath("userData"), "sub2api-auth.json");
}

function normalizeBaseUrl(value) {
  const raw = String(value || DEFAULT_BASE_URL).trim().replace(/\/+$/, "");
  const parsed = new URL(raw);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw serviceError("sub2api_service", "Sub2API 地址必须使用 http 或 https");
  }
  return parsed.origin + parsed.pathname.replace(/\/+$/, "");
}

function loadConfig() {
  if (configCache) return configCache;
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath(), "utf8"));
    configCache = {
      baseUrl: normalizeBaseUrl(parsed.baseUrl),
      accessToken: decrypt(parsed.accessToken),
      refreshToken: decrypt(parsed.refreshToken),
      expiresAt: Number(parsed.expiresAt) || 0
    };
  } catch {
    configCache = {
      baseUrl: DEFAULT_BASE_URL,
      accessToken: "",
      refreshToken: "",
      expiresAt: 0
    };
  }
  return configCache;
}

function saveConfig() {
  const config = loadConfig();
  const target = configPath();
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({
    version: 1,
    baseUrl: config.baseUrl,
    accessToken: encrypt(config.accessToken),
    refreshToken: encrypt(config.refreshToken),
    expiresAt: config.expiresAt
  }, null, 2), "utf8");
  fs.renameSync(tmp, target);
}

function encrypt(value) {
  if (!value) return "";
  if (!safeStorage.isEncryptionAvailable()) {
    throw serviceError("sub2api_auth", "Windows 安全存储当前不可用，无法安全保存登录令牌");
  }
  return safeStorage.encryptString(value).toString("base64");
}

function decrypt(value) {
  if (!value || !safeStorage.isEncryptionAvailable()) return "";
  try {
    return safeStorage.decryptString(Buffer.from(value, "base64"));
  } catch {
    return "";
  }
}

function serviceError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

async function connect({ baseUrl, email, password, totpCode }) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  if (!String(email || "").trim() || !String(password || "")) {
    throw serviceError("sub2api_auth", "请输入 Sub2API 管理员邮箱和密码");
  }

  let auth = await rawRequest(normalizedBaseUrl, "/api/v1/auth/login", {
    method: "POST",
    body: { email: String(email).trim(), password: String(password) }
  });

  if (auth?.requires_2fa) {
    if (!String(totpCode || "").trim()) {
      return { connected: false, requires2fa: true, baseUrl: normalizedBaseUrl };
    }
    auth = await rawRequest(normalizedBaseUrl, "/api/v1/auth/login/2fa", {
      method: "POST",
      body: { temp_token: auth.temp_token, totp_code: String(totpCode).trim() }
    });
  }

  if (!auth?.access_token) {
    throw serviceError("sub2api_auth", "Sub2API 登录响应中没有访问令牌");
  }

  configCache = {
    baseUrl: normalizedBaseUrl,
    accessToken: auth.access_token,
    refreshToken: auth.refresh_token || "",
    expiresAt: Date.now() + Math.max(0, Number(auth.expires_in) || 0) * 1000
  };
  saveConfig();
  quotaCache = [];
  accountMetadataCache = [];
  return { connected: true, requires2fa: false, baseUrl: normalizedBaseUrl };
}

function disconnect() {
  const baseUrl = loadConfig().baseUrl;
  configCache = { baseUrl, accessToken: "", refreshToken: "", expiresAt: 0 };
  quotaCache = [];
  accountMetadataCache = [];
  try {
    fs.unlinkSync(configPath());
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  return getConnection();
}

function getConnection() {
  const config = loadConfig();
  return {
    connected: Boolean(config.accessToken || config.refreshToken),
    baseUrl: config.baseUrl,
    encryptionAvailable: safeStorage.isEncryptionAvailable()
  };
}

async function authenticatedRequest(apiPath, options = {}, retry = true) {
  const config = loadConfig();
  if (!config.accessToken && !config.refreshToken) {
    throw serviceError("sub2api_auth", "请先连接 Sub2API 管理员账号");
  }
  if ((!config.accessToken || (config.expiresAt && config.expiresAt <= Date.now() + 30000)) && config.refreshToken) {
    await refreshAccessToken();
  }
  try {
    return await rawRequest(config.baseUrl, apiPath, {
      ...options,
      token: config.accessToken
    });
  } catch (error) {
    if (retry && error?.status === 401 && config.refreshToken) {
      await refreshAccessToken();
      return authenticatedRequest(apiPath, options, false);
    }
    throw error;
  }
}

async function refreshAccessToken() {
  const config = loadConfig();
  if (!config.refreshToken) {
    throw serviceError("sub2api_auth", "Sub2API 登录已失效，请重新登录");
  }
  const auth = await rawRequest(config.baseUrl, "/api/v1/auth/refresh", {
    method: "POST",
    body: { refresh_token: config.refreshToken }
  });
  if (!auth?.access_token) {
    throw serviceError("sub2api_auth", "Sub2API 登录刷新失败");
  }
  config.accessToken = auth.access_token;
  config.refreshToken = auth.refresh_token || config.refreshToken;
  config.expiresAt = Date.now() + Math.max(0, Number(auth.expires_in) || 0) * 1000;
  saveConfig();
}

async function rawRequest(baseUrl, apiPath, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const headers = { Accept: "application/json" };
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    if (options.token) headers.Authorization = `Bearer ${options.token}`;
    const response = await fetch(`${baseUrl}${apiPath}`, {
      method: options.method || "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal
    });
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      // The status code below still provides a useful diagnostic.
    }
    if (!response.ok || (payload && typeof payload.code === "number" && payload.code !== 0)) {
      const error = serviceError(
        response.status === 401 || response.status === 403 ? "sub2api_auth" : "sub2api_service",
        payload?.message || `Sub2API 请求失败 (${response.status})`
      );
      error.status = response.status;
      throw error;
    }
    return payload && Object.prototype.hasOwnProperty.call(payload, "data") ? payload.data : payload;
  } catch (error) {
    if (error?.code?.startsWith?.("sub2api_")) throw error;
    if (error?.name === "AbortError" || error?.cause?.code || error?.code) {
      throw serviceError("sub2api_network", "无法连接 Sub2API 服务");
    }
    throw serviceError("sub2api_service", error?.message || "Sub2API 返回了无效响应");
  } finally {
    clearTimeout(timer);
  }
}

async function listOpenAIAccounts() {
  const accounts = [];
  let page = 1;
  let pages = 1;
  do {
    const query = new URLSearchParams({
      page: String(page),
      page_size: String(ACCOUNT_PAGE_SIZE),
      platform: "openai",
      type: "oauth"
    });
    const result = await authenticatedRequest(`/api/v1/admin/accounts?${query}`);
    const items = Array.isArray(result?.items) ? result.items : [];
    accounts.push(...items);
    pages = Math.max(1, Number(result?.pages) || 1);
    page += 1;
  } while (page <= pages);
  accountMetadataCache = accounts;
  return accounts;
}

function cacheAccountMetadata(account) {
  const id = String(account?.id ?? "");
  if (!id) return;
  const index = accountMetadataCache.findIndex((item) => String(item.id) === id);
  if (index >= 0) accountMetadataCache[index] = account;
  else accountMetadataCache.push(account);
}

async function getAccountMetadata(accountId) {
  const account = await authenticatedRequest(`/api/v1/admin/accounts/${accountId}`);
  if (!account) {
    throw serviceError("sub2api_service", `Sub2API 账号 ${accountId} 不存在`);
  }
  cacheAccountMetadata(account);
  return account;
}

function snapshotTimestamp(account) {
  return account?.extra?.codex_usage_updated_at || null;
}

function didSnapshotAdvance(before, after) {
  const beforeMs = Date.parse(before || "");
  const afterMs = Date.parse(after || "");
  if (!Number.isFinite(afterMs)) return false;
  return !Number.isFinite(beforeMs) || afterMs > beforeMs;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForNewSnapshot(accountId, beforeTimestamp) {
  let account = null;
  for (let attempt = 0; attempt < SNAPSHOT_POLL_ATTEMPTS; attempt += 1) {
    if (attempt > 0) await delay(SNAPSHOT_POLL_DELAY_MS);
    account = await getAccountMetadata(accountId);
    if (didSnapshotAdvance(beforeTimestamp, snapshotTimestamp(account))) return account;
  }
  throw serviceError(
    "sub2api_probe_stale",
    "Sub2API 未生成新的上游额度快照，请检查该账号的上游连接状态"
  );
}

async function fetchAccountQuota(account, { force = false } = {}) {
  let currentAccount = account;
  const beforeTimestamp = snapshotTimestamp(currentAccount);
  const suffix = force ? "?source=active&force=true" : "";
  const usage = await authenticatedRequest(`/api/v1/admin/accounts/${currentAccount.id}/usage${suffix}`);
  if (force) {
    currentAccount = await waitForNewSnapshot(currentAccount.id, beforeTimestamp);
  }
  return normalizeAccountQuota(currentAccount, usage);
}

async function listAccountQuotas({ force = false } = {}) {
  const accounts = await listOpenAIAccounts();
  const results = new Array(accounts.length);
  let cursor = 0;

  async function worker() {
    while (cursor < accounts.length) {
      const index = cursor++;
      const account = accounts[index];
      try {
        results[index] = await fetchAccountQuota(account, { force });
      } catch (error) {
        const previous = quotaCache.find((item) => item.id === String(account.id));
        results[index] = {
          ...(previous || normalizeAccountQuota(account, null)),
          label: account.name || previous?.label || `账号 ${account.id}`,
          stale: Boolean(previous),
          errorCode: error?.code || "sub2api_service"
        };
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(USAGE_CONCURRENCY, Math.max(1, accounts.length)) }, () => worker())
  );
  quotaCache = results;
  return results;
}

async function getAccountQuota(accountId, { force = false } = {}) {
  const id = String(accountId);
  let account = accountMetadataCache.find((item) => String(item.id) === id) || null;
  if (!account) {
    const accounts = await listOpenAIAccounts();
    account = accounts.find((item) => String(item.id) === id) || null;
  }
  if (!account) {
    throw serviceError("sub2api_service", `Sub2API 账号 ${id} 不存在`);
  }
  const quota = await fetchAccountQuota(account, { force });
  const index = quotaCache.findIndex((item) => item.id === id);
  if (index >= 0) quotaCache[index] = quota;
  else quotaCache.push(quota);
  return quota;
}

function normalizeAccountQuota(account, usage) {
  const fiveHour = normalizeUsageWindow(usage?.five_hour);
  const sevenDay = normalizeUsageWindow(usage?.seven_day);
  const weekly = sevenDay;
  const serverReadAt = new Date().toISOString();
  const upstreamSampledAt = account?.extra?.codex_usage_updated_at || null;
  return {
    id: String(account.id),
    sub2apiAccountId: Number(account.id),
    label: account.name || `账号 ${account.id}`,
    accountHint: `${account.platform || "openai"} · ${account.type || "oauth"}`,
    planType: "chatgpt",
    fiveHour,
    sevenDay,
    remainingPercent: weekly?.remainingPercent ?? null,
    usedPercent: weekly?.usedPercent ?? null,
    resetsAt: weekly?.resetsAt || null,
    fetchedAt: serverReadAt,
    serverReadAt,
    upstreamSampledAt,
    lastRefreshedAt: upstreamSampledAt,
    source: usage?.source || "active",
    status: account.status || "unknown",
    errorMessage: usage?.error || account.error_message || null,
    stale: false
  };
}

function normalizeUsageWindow(window) {
  if (!window) return null;
  const usedPercent = window.utilization == null ? Number.NaN : Number(window.utilization);
  return {
    remainingPercent: Number.isFinite(usedPercent)
      ? Math.max(0, Math.min(100, Math.round(100 - usedPercent)))
      : null,
    usedPercent: Number.isFinite(usedPercent) ? usedPercent : null,
    resetsAt: window.resets_at || null
  };
}

function summarizeAccountQuotas(accounts, quotaWindow = "7d") {
  const list = Array.isArray(accounts) ? accounts : [];
  const windowKey = quotaWindow === "5h" ? "fiveHour" : "sevenDay";
  const readings = list.map((account) => ({
    account,
    window: account?.[windowKey] ||
      (quotaWindow === "7d" && typeof account?.remainingPercent === "number"
        ? { remainingPercent: account.remainingPercent, resetsAt: account.resetsAt || null }
        : null)
  }));
  const known = readings.filter(
    (reading) => typeof reading.window?.remainingPercent === "number" && Number.isFinite(reading.window.remainingPercent)
  );
  const remainingPercent = known.reduce(
    (total, reading) => total + Math.max(0, Math.min(100, Number(reading.window.remainingPercent))),
    0
  );
  const newestSample = known
    .map(({ account }) => account.upstreamSampledAt || account.serverReadAt || null)
    .filter(Boolean)
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0] || null;
  return {
    mode: "relay",
    quotaWindow,
    remainingPercent: known.length > 0 ? Math.round(remainingPercent) : null,
    capacityPercent: list.length * 100,
    accountCount: list.length,
    knownAccountCount: known.length,
    unknownAccountCount: list.length - known.length,
    planType: "relay",
    resetsAt: null,
    upstreamSampledAt: newestSample,
    account: { recognized: true, id: null, label: null, hint: null }
  };
}

module.exports = {
  connect,
  disconnect,
  getConnection,
  listAccountQuotas,
  getAccountQuota,
  normalizeBaseUrl,
  normalizeAccountQuota,
  normalizeUsageWindow,
  summarizeAccountQuotas,
  didSnapshotAdvance
};
