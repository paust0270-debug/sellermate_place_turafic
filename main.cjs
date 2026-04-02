const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const { spawn, exec } = require("child_process");
const { promisify } = require("util");

const SOURCE_ROOT = "C:\\Users\\{C\\Desktop\\sellermate_naver_place_all";
const RUNNER_SCRIPT = path.join(SOURCE_ROOT, "place-check", "batch", "check-place-batch.ts");
const DATA_ROOT = app.isPackaged
  ? path.join(process.env.PORTABLE_EXECUTABLE_DIR || app.getPath("userData"), "sellermate-place-gui-data")
  : path.join(__dirname, "data");
const CONFIG_PATH = path.join(DATA_ROOT, "gui-config.json");

let mainWindow = null;
let runnerChild = null;
const execAsync = promisify(exec);
let queueRunning = false;
let stopRequested = false;

const ADB_DATA_OFF_DELAY = 5000;
const ADB_DATA_ON_DELAY = 5000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function checkAdbDeviceStatus() {
  try {
    const { stdout } = await execAsync("adb devices", {
      encoding: "utf8",
      timeout: 10000,
      windowsHide: true,
    });
    const lines = stdout.trim().split("\n").slice(1);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const parts = trimmed.split(/\s+/);
      if (parts.length < 2) continue;
      if (parts[1] === "device") return "device";
      if (parts[1] === "unauthorized") return "unauthorized";
    }
    return null;
  } catch {
    return null;
  }
}

async function setMobileData(enable) {
  const cmd = enable ? "adb shell svc data enable" : "adb shell svc data disable";
  try {
    await execAsync(cmd, {
      encoding: "utf8",
      timeout: 10000,
      windowsHide: true,
    });
    return true;
  } catch {
    return false;
  }
}

async function toggleAdbMobileDataOffOn(sendLog, reason, cycles = 1) {
  const status = await checkAdbDeviceStatus();
  if (status !== "device") {
    if (status === "unauthorized") {
      sendLog(`[IPRotation] [ADB] ${reason}: 미인증 기기(USB 디버깅 허용 필요)`, "stderr");
    } else {
      sendLog(`[IPRotation] [ADB] ${reason}: ADB 기기 없음`, "stderr");
    }
    return false;
  }

  const n = Math.max(1, Math.floor(Number(cycles) || 1));
  for (let c = 0; c < n; c++) {
    sendLog(`[IPRotation] [ADB] ${reason}: 모바일 데이터 OFF -> ON (${c + 1}/${n})`, "stdout");
    if (!(await setMobileData(false))) {
      sendLog("[IPRotation] [ADB] 데이터 OFF 실패", "stderr");
      return false;
    }
    await sleep(ADB_DATA_OFF_DELAY);
    if (!(await setMobileData(true))) {
      sendLog("[IPRotation] [ADB] 데이터 ON 실패", "stderr");
      return false;
    }
    await sleep(ADB_DATA_ON_DELAY);
  }
  sendLog("[IPRotation] [ADB] 데이터 OFF -> ON 완료", "stdout");
  return true;
}

function resolveRunnerCommand() {
  const localTsxCmd = path.join(SOURCE_ROOT, "node_modules", ".bin", "tsx.cmd");
  if (fs.existsSync(localTsxCmd)) {
    return { cmd: localTsxCmd, baseArgs: [] };
  }
  return { cmd: "npx.cmd", baseArgs: ["tsx"] };
}

function safeReadJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return fallback;
  }
}

/** AppData 경로에 두면 모듈 해석이 Roaming만 올라가서 puppeteer-real-browser 를 못 찾음 → 소스 루트 안에 둠 */
function ensureRowRunnerScript() {
  const dir = path.join(SOURCE_ROOT, "place-check");
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, ".place-gui-row-runner.generated.ts");
  const src = `import { connect } from "puppeteer-real-browser";
import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";

type Task = { linkUrl: string; searchKeyword: string; rankOnly: boolean };

function parseArg(name: string): string {
  const hit = process.argv.find((a) => a.startsWith(name + "="));
  return hit ? hit.slice(name.length + 1) : "";
}

async function run() {
  const sourceRoot = process.env.PLACE_SOURCE_ROOT || "";
  const tasksFile = parseArg("--tasksFile");
  if (!sourceRoot) throw new Error("PLACE_SOURCE_ROOT 누락");
  if (!tasksFile || !fs.existsSync(tasksFile)) throw new Error("tasks 파일 없음: " + tasksFile);

  const corePath = path.join(sourceRoot, "place-check", "check-place-rank-core.ts");
  const core = await import(pathToFileURL(corePath).href);
  const checkPlaceRankRankOnly = core.checkPlaceRankRankOnly;
  const checkPlaceRank = core.checkPlaceRank;
  const resetPlaceGuiDelaysCache = core.resetPlaceGuiDelaysCache;
  const delayFromGuiConfig = core.delayFromGuiConfig;
  if (typeof checkPlaceRankRankOnly !== "function") {
    throw new Error("checkPlaceRankRankOnly 함수 로드 실패");
  }
  if (typeof checkPlaceRank !== "function") {
    throw new Error("checkPlaceRank 함수 로드 실패");
  }
  if (typeof resetPlaceGuiDelaysCache === "function") resetPlaceGuiDelaysCache();

  const tasks = JSON.parse(fs.readFileSync(tasksFile, "utf-8")) as Task[];
  const { page, browser } = await connect({ headless: false, turnstile: true });
  try {
    await page.setViewport({ width: 1280, height: 900 });
    for (let i = 0; i < tasks.length; i++) {
      const t = tasks[i];
      const kw = t.searchKeyword;
      const modeLabel = t.rankOnly ? "순위만" : "상세포함";
      console.log("[ROW] 시작 " + (i + 1) + "/" + tasks.length + " | " + modeLabel + " | " + kw);
      const result = t.rankOnly
        ? await checkPlaceRankRankOnly(page, t.linkUrl, kw)
        : await checkPlaceRank(page, t.linkUrl, kw);
      const rank = result?.rank ?? null;
      const placeName = result?.placeName ?? null;
      const visitorReviewCount = result?.visitorReviewCount ?? null;
      const blogReviewCount = result?.blogReviewCount ?? null;
      const starRating = result?.starRating ?? null;
      console.log("[ROW_RESULT] " + JSON.stringify({ index: i, searchKeyword: kw, linkUrl: t.linkUrl, rankOnly: t.rankOnly, rank, placeName, visitorReviewCount, blogReviewCount, starRating }));
      if (i < tasks.length - 1 && typeof delayFromGuiConfig === "function") {
        await delayFromGuiConfig("taskGapRest", 2000, 3000);
      }
    }
  } finally {
    await browser.close();
  }
}

run().catch((e) => {
  console.error("[ROW_ERROR] " + (e?.message || String(e)));
  process.exit(1);
});
`;
  fs.writeFileSync(p, src, "utf-8");
  return p;
}

function createWindow() {
  fs.mkdirSync(DATA_ROOT, { recursive: true });
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 780,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: "#1e1e1e",
    title: "셀러메이트 플레이스 GUI",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "index.html"));
}

app.whenReady().then(createWindow);
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

ipcMain.handle("load-config", () =>
  safeReadJson(CONFIG_PATH, {
    mode: "all",
    searchFlowVersion: "main",
    maxScroll: "4",
    workMode: "mobile",
    forceTop20: false,
    once: false,
    limit: "",
    toggleUsbDataBeforeTask: false,
  })
);

ipcMain.handle("save-config", (_e, data) => {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(data || {}, null, 2), "utf-8");
  return { ok: true, path: CONFIG_PATH };
});

ipcMain.handle("get-path-info", () => ({
  sourceRoot: SOURCE_ROOT,
  runnerScript: RUNNER_SCRIPT,
  configPath: CONFIG_PATH,
}));

ipcMain.handle("health-check", () => {
  const localTsxCmd = path.join(SOURCE_ROOT, "node_modules", ".bin", "tsx.cmd");
  const prb = path.join(SOURCE_ROOT, "node_modules", "puppeteer-real-browser");
  return {
    sourceRootExists: fs.existsSync(SOURCE_ROOT),
    runnerScriptExists: fs.existsSync(RUNNER_SCRIPT),
    localTsxExists: fs.existsSync(localTsxCmd),
    localTsxPath: localTsxCmd,
    puppeteerRealBrowserExists: fs.existsSync(prb),
  };
});

ipcMain.handle("runner-status", () => ({ running: !!runnerChild }));

ipcMain.handle("runner-start", async (_e, opts = {}) => {
  if (runnerChild || queueRunning) return { ok: false, error: "이미 실행 중입니다." };
  if (!fs.existsSync(SOURCE_ROOT)) {
    return { ok: false, error: `원본 폴더를 찾을 수 없습니다: ${SOURCE_ROOT}` };
  }
  const delaysPath = path.join(DATA_ROOT, "place-gui-delays.json");
  try {
    fs.mkdirSync(DATA_ROOT, { recursive: true });
    fs.writeFileSync(delaysPath, JSON.stringify(opts.delays && typeof opts.delays === "object" ? opts.delays : {}, null, 2), "utf-8");
  } catch {
    // noop
  }
  const safeRows = Array.isArray(opts.rows) ? opts.rows : [];
  const rows = safeRows
    .map((r) => ({
      linkUrl: String(r?.linkUrl || "").trim(),
      searchKeyword: String(r?.searchKeyword ?? r?.keyword ?? "").trim(),
      rankOnly: r?.rankOnly === true,
    }))
    .filter((r) => r.searchKeyword && r.linkUrl);
  if (!rows.length) {
    return { ok: false, error: "작업할 행(검색어·URL)을 입력 후 체크하세요." };
  }

  const prb = path.join(SOURCE_ROOT, "node_modules", "puppeteer-real-browser");
  if (!fs.existsSync(prb)) {
    return {
      ok: false,
      error:
        `puppeteer-real-browser 없음: ${prb}\n` +
        `sellermate_naver_place_all 폴더에서 npm install 을 실행하세요.`,
    };
  }

  const { cmd, baseArgs } = resolveRunnerCommand();
  const sendLog = (line, stream) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send("runner-log", { line, stream });
  };

  const scriptPath = ensureRowRunnerScript();
  const tasksFile = path.join(DATA_ROOT, "row-tasks.json");
  fs.writeFileSync(tasksFile, JSON.stringify(rows, null, 2), "utf-8");

  if (opts.toggleUsbDataBeforeTask === true) {
    sendLog("[GUI] IP 로테이션 체크됨: 작업 전 USB 데이터 토글 시작", "stdout");
    await toggleAdbMobileDataOffOn(sendLog, "작업 시작 전", 1);
  }

  const args = [...baseArgs, scriptPath, `--tasksFile=${tasksFile}`];
  stopRequested = false;
  queueRunning = true;
  const sourceMods = path.join(SOURCE_ROOT, "node_modules");
  const nodePath = [sourceMods, process.env.NODE_PATH].filter(Boolean).join(path.delimiter);
  runnerChild = spawn(cmd, args, {
    cwd: SOURCE_ROOT,
    shell: true,
    windowsHide: true,
    env: {
      ...process.env,
      FORCE_COLOR: "0",
      PLACE_SOURCE_ROOT: SOURCE_ROOT,
      PLACE_GUI_DELAYS_PATH: delaysPath,
      NODE_PATH: nodePath,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const current = runnerChild;

  current.stdout?.on("data", (buf) => {
    buf
      .toString("utf-8")
      .split(/\r?\n/)
      .filter(Boolean)
      .forEach((line) => sendLog(line, "stdout"));
  });
  current.stderr?.on("data", (buf) => {
    buf
      .toString("utf-8")
      .split(/\r?\n/)
      .filter(Boolean)
      .forEach((line) => sendLog(line, "stderr"));
  });

  current.on("close", (code) => {
    if (runnerChild === current) runnerChild = null;
    queueRunning = false;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("runner-exit", { code });
    }
  });

  current.on("error", (err) => {
    if (runnerChild === current) runnerChild = null;
    queueRunning = false;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("runner-exit", { code: -1, error: err.message });
    }
  });

  sendLog(`[GUI] 실행: ${cmd} ${args.join(" ")}`, "stdout");
  return { ok: true };
});

ipcMain.handle("runner-stop", () => {
  stopRequested = true;
  if (!runnerChild) return { ok: true };
  const pid = runnerChild.pid;
  try {
    runnerChild.kill("SIGTERM");
  } catch {
    // noop
  }
  runnerChild = null;

  if (process.platform === "win32" && pid) {
    try {
      require("child_process").execSync(`taskkill /pid ${pid} /T /F`, {
        stdio: "ignore",
        timeout: 5000,
        windowsHide: true,
      });
    } catch {
      // noop
    }
  }
  return { ok: true };
});
