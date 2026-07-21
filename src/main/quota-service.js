const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_TIMEOUT_MS = 12000;

function resolveCodexPath() {
  const localAppData = process.env.LOCALAPPDATA || "";
  // ChatGPT 桌面版（由 Codex 升级而来）所用的 CLI 二进制位于 C 盘此路径；
  // 配额读取复用它，并通过同一 OpenAI 账号拿到真实额度。
  const candidates = [
    process.env.CHATGPT_CODEX_PATH,
    process.env.CODEX_CLI_PATH,
    path.join(localAppData, "OpenAI", "Codex", "bin", "codex.exe")
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  return "codex";
}

async function getQuota() {
  const response = await requestRateLimits();
  const snapshot =
    response.rateLimitsByLimitId?.codex ||
    response.rateLimits ||
    firstSnapshot(response.rateLimitsByLimitId);

  if (!snapshot) {
    throw new Error("ChatGPT did not return a rate-limit snapshot.");
  }

  return normalizeSnapshot(snapshot);
}

function firstSnapshot(map) {
  if (!map || typeof map !== "object") return null;
  const firstKey = Object.keys(map)[0];
  return firstKey ? map[firstKey] : null;
}

function normalizeSnapshot(snapshot) {
  // ChatGPT 桌面版（原 Codex）升级后只施加「一周（7 天）」额度限制，
  // 旧 5 小时窗口已移除。API 把该窗口放在 snapshot.primary
  // （windowDurationMins = 10080），snapshot.secondary 为 null。
  const activeWindow =
    normalizeWindow(snapshot.primary) || normalizeWindow(snapshot.secondary);

  return {
    limitId: snapshot.limitId || "codex",
    limitName: snapshot.limitName || "ChatGPT",
    planType: snapshot.planType || "unknown",
    reachedType: snapshot.rateLimitReachedType || null,
    credits: snapshot.credits || null,
    primary: null,
    secondary: null,
    remainingPercent: activeWindow ? activeWindow.remainingPercent : null,
    usedPercent: activeWindow ? activeWindow.usedPercent : null,
    resetsAt: activeWindow ? activeWindow.resetsAt : null,
    windowKind:
      activeWindow && (activeWindow.windowDurationMins ?? 0) >= 10080
        ? "weekly"
        : "primary",
    fetchedAt: new Date().toISOString()
  };
}

function normalizeWindow(window) {
  if (!window) return null;
  const usedPercent = clampPercent(Number(window.usedPercent || 0));
  return {
    usedPercent,
    remainingPercent: clampPercent(100 - usedPercent),
    windowDurationMins: window.windowDurationMins ?? null,
    resetsAt: window.resetsAt ? new Date(window.resetsAt * 1000).toISOString() : null
  };
}

function clampPercent(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function requestRateLimits() {
  const codexPath = resolveCodexPath();
  const child = spawn(codexPath, ["app-server", "--listen", "stdio://"], {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true
  });

  let buffer = "";
  let stderr = "";
  let nextId = 1;
  const pending = new Map();

  const cleanup = () => {
    for (const request of pending.values()) {
      clearTimeout(request.timer);
    }
    pending.clear();
    if (!child.killed) child.kill();
  };

  const send = (method, params) => {
    const id = nextId++;
    const payload = params === undefined ? { id, method } : { id, method, params };
    child.stdin.write(`${JSON.stringify(payload)}\n`);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`ChatGPT request timed out: ${method}`));
      }, DEFAULT_TIMEOUT_MS);
      pending.set(id, { resolve, reject, timer });
    });
  };

  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    let newlineIndex;
    while ((newlineIndex = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (!line) continue;
      handleMessage(line, pending);
    }
  });

  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });

  return new Promise((resolve, reject) => {
    child.once("error", (error) => {
      cleanup();
      reject(error);
    });

    child.once("exit", (code) => {
      if (pending.size > 0) {
        cleanup();
        reject(new Error(stderr || `ChatGPT app-server exited with code ${code}`));
      }
    });

    (async () => {
      try {
        await send("initialize", {
          clientInfo: {
            name: "chatgpt-led-widget",
            title: "ChatGPT LED Widget",
            version: "0.1.0"
          },
          capabilities: null
        });
        const result = await send("account/rateLimits/read");
        cleanup();
        resolve(result);
      } catch (error) {
        cleanup();
        reject(new Error(stderr || error.message));
      }
    })();
  });
}

function handleMessage(line, pending) {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }

  if (!Object.prototype.hasOwnProperty.call(message, "id")) return;
  const request = pending.get(message.id);
  if (!request) return;

  clearTimeout(request.timer);
  pending.delete(message.id);

  if (message.error) {
    request.reject(new Error(message.error.message || JSON.stringify(message.error)));
  } else {
    request.resolve(message.result);
  }
}

module.exports = { getQuota, normalizeSnapshot };
