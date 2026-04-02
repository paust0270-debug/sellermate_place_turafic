const DELAY_ROWS = [
  { label: "브라우저 로드", key: "browserLoad", range: true, defMin: 2500, defMax: 4000 },
  { label: "프록시 설정", key: "proxySetup", range: false, defMin: 3000 },
  { label: "브라우저 실행", key: "browserLaunch", range: false, defMin: 2000 },
  { label: "1차 검색 후", key: "afterFirstSearchLoad", range: true, defMin: 2000, defMax: 3000 },
  { label: "2차 검색 후", key: "afterSecondSearchLoad", range: true, defMin: 2000, defMax: 3000 },
  { label: "탐색 간격", key: "explorationBetweenScrolls", range: true, defMin: 300, defMax: 500 },
  { label: "체류(상품)", key: "stayOnProduct", range: true, defMin: 3000, defMax: 6000 },
  { label: "작업 간 휴식", key: "taskGapRest", range: true, defMin: 2000, defMax: 3000 },
];

/** 체크된 행 기준 러너 작업 순서 → taskRows 인덱스 매핑 */
let lastRunRowIndexByTaskIndex = [];

function logLine(msg) {
  const area = document.getElementById("logArea");
  const ts = new Date().toLocaleTimeString("ko-KR");
  area.value += `[${ts}] ${msg}\n`;
  area.scrollTop = area.scrollHeight;
}

function byId(primary, fallback) {
  return document.getElementById(primary) || (fallback ? document.getElementById(fallback) : null);
}

function normalizeTaskRow(r) {
  return {
    checked: r?.checked !== false && r?.checked !== "false",
    keyword: String(r?.keyword ?? "").trim(),
    linkUrl: String(r?.linkUrl ?? "").trim(),
    keywordName: String(r?.keywordName ?? "").trim(),
    storeName: String(r?.storeName ?? r?.productTitle ?? "").trim(),
    targetCount: r?.targetCount ?? "",
    ok: Math.max(0, Math.floor(Number(r?.ok ?? r?.trafficOk) || 0)),
    fail: Math.max(0, Math.floor(Number(r?.fail ?? r?.trafficFail) || 0)),
    rank: r?.rank != null && r?.rank !== "" ? String(r.rank) : r?.currentRank != null ? String(r.currentRank) : "",
    review: r?.review != null && r?.review !== "" ? String(r.review) : r?.reviewCount != null ? String(r.reviewCount) : "",
    star: r?.star != null && r?.star !== "" ? String(r.star) : r?.starRating != null ? String(r.starRating) : "",
  };
}

let taskRows = [
  normalizeTaskRow({
    checked: true,
    keyword: "",
    linkUrl: "",
    keywordName: "",
    storeName: "",
    targetCount: "",
    ok: 0,
    fail: 0,
    rank: "",
    review: "",
    star: "",
  }),
];

function escapeAttr(v) {
  return String(v || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** 예전 A/B/C/D 값 → main | second | rankOnly */
function normalizeSearchFlowVersion(raw) {
  const v = String(raw || "").trim();
  const legacy = { A: "main", B: "main", C: "second", D: "rankOnly" };
  if (legacy[v]) return legacy[v];
  if (v === "main" || v === "second" || v === "rankOnly") return v;
  return "main";
}

function getSearchFlowOptionLabel() {
  const el = document.getElementById("searchFlowVersion");
  if (!el) return "";
  const opt = el.options[el.selectedIndex];
  return opt ? opt.textContent.trim() : String(el.value || "");
}

function getWorkModeOptionLabel() {
  const el = document.getElementById("workMode");
  if (!el) return "";
  const opt = el.options[el.selectedIndex];
  return opt ? opt.textContent.trim() : String(el.value || "");
}

function getSpec(d, key) {
  const v = d?.[key];
  if (v == null) return { a: "", b: "" };
  if (typeof v === "number") return { a: String(v), b: String(v) };
  return { a: String(v.min ?? ""), b: String(v.max ?? "") };
}

function parseSpec(a, b, range) {
  const na = parseInt(String(a).trim(), 10);
  const nb = parseInt(String(b).trim(), 10);
  if (!Number.isFinite(na)) return null;
  if (!range || !Number.isFinite(nb) || na === nb) return na;
  return { min: Math.min(na, nb), max: Math.max(na, nb) };
}

function buildDelaySection() {
  const root = document.getElementById("delayGrid");
  if (!root) return;
  root.innerHTML = "";
  DELAY_ROWS.forEach(({ label, key, range, defMin, defMax }) => {
    const lab = document.createElement("label");
    lab.textContent = label;
    root.appendChild(lab);
    const i1 = document.createElement("input");
    i1.type = "number";
    i1.dataset.delayKey = key;
    i1.dataset.part = "a";
    i1.placeholder = range ? `${defMin}` : `${defMin}`;
    root.appendChild(i1);
    const i2 = document.createElement("input");
    i2.type = "number";
    i2.dataset.delayKey = key;
    i2.dataset.part = "b";
    i2.placeholder = range ? `${defMax}` : "";
    i2.disabled = !range;
    if (!range) {
      i2.style.opacity = "0.35";
      i2.title = "단일 값";
    }
    root.appendChild(i2);
  });
}

function applyDelaysToForm(delays) {
  DELAY_ROWS.forEach(({ key, range }) => {
    const { a, b } = getSpec(delays, key);
    const i1 = document.querySelector(`input[data-delay-key="${key}"][data-part="a"]`);
    const i2 = document.querySelector(`input[data-delay-key="${key}"][data-part="b"]`);
    if (i1) i1.value = a;
    if (i2) i2.value = range ? b : "";
  });
}

function readDelaysFromForm() {
  const delays = {};
  DELAY_ROWS.forEach(({ key, range }) => {
    const i1 = document.querySelector(`input[data-delay-key="${key}"][data-part="a"]`);
    const i2 = document.querySelector(`input[data-delay-key="${key}"][data-part="b"]`);
    const spec = parseSpec(i1?.value, range ? i2?.value : i1?.value, range);
    if (spec != null) delays[key] = spec;
  });
  return delays;
}

function renderTaskTable() {
  const tbody = document.getElementById("taskBody");
  tbody.innerHTML = "";
  taskRows.forEach((row, idx) => {
    const tr = document.createElement("tr");
    const target = Math.max(0, Math.floor(Number(row.targetCount) || 0));
    const ok = Math.max(0, Math.floor(Number(row.ok) || 0));
    const progressText = target > 0 ? `${ok}/${target}` : `${ok}`;
    const done = target > 0 && ok >= target;
    const store = row.storeName ? escapeHtml(row.storeName) : "—";
    const rankDisp = row.rank !== "" && row.rank != null ? escapeHtml(row.rank) : "—";
    const revDisp = row.review !== "" && row.review != null ? escapeHtml(row.review) : "—";
    const starDisp = row.star !== "" && row.star != null ? escapeHtml(row.star) : "—";
    tr.innerHTML = `
      <td class="center"><input data-f="checked" type="checkbox" ${row.checked ? "checked" : ""} /></td>
      <td class="center">${idx + 1}</td>
      <td><input data-f="keyword" type="text" value="${escapeAttr(row.keyword)}" placeholder="검색 키워드" /></td>
      <td><input data-f="linkUrl" type="text" value="${escapeAttr(row.linkUrl)}" placeholder="https://place.naver.com/..." /></td>
      <td><input data-f="keywordName" type="text" value="${escapeAttr(row.keywordName)}" placeholder="B모드일 때 필수" /></td>
      <td class="cell-center col-store-text" title="${escapeAttr(row.storeName || "")}">${store}</td>
      <td class="cell-center"><input data-f="targetCount" type="number" min="0" value="${escapeAttr(row.targetCount)}" class="delay-num-tight" style="max-width:52px" /></td>
      <td class="cell-center stat-cell ${done ? "target-done" : ""}">${progressText}</td>
      <td class="cell-center stat-cell">${row.fail || 0}</td>
      <td class="cell-center rank-display">${rankDisp}</td>
      <td class="cell-center rank-display">${revDisp}</td>
      <td class="cell-center rank-display">${starDisp}</td>
    `;
    tr.querySelectorAll("input[data-f], select[data-f]").forEach((el) => {
      el.addEventListener("input", () => {
        const key = el.dataset.f;
        if (!key) return;
        taskRows[idx][key] = el.type === "checkbox" ? el.checked : el.value;
      });
      el.addEventListener("change", () => {
        const key = el.dataset.f;
        if (!key) return;
        taskRows[idx][key] = el.type === "checkbox" ? el.checked : el.value;
      });
    });
    tbody.appendChild(tr);
  });
}

function readForm() {
  const modeEl = byId("mode");
  const limitEl = byId("limit");
  const forceTop20El = byId("forceTop20");
  const onceEl = byId("once");
  const toggleEl = byId("toggleUsbDataBeforeTask");
  const flowEl = document.getElementById("searchFlowVersion");
  const maxScrollEl = document.getElementById("maxScroll");
  const workModeEl = document.getElementById("workMode");
  return {
    mode: modeEl ? modeEl.value : "all",
    searchFlowVersion: normalizeSearchFlowVersion(flowEl ? flowEl.value : "main"),
    maxScroll: maxScrollEl ? String(maxScrollEl.value).trim() || "4" : "4",
    workMode: workModeEl ? workModeEl.value : "mobile",
    delays: readDelaysFromForm(),
    limit: limitEl ? limitEl.value.trim() : "",
    forceTop20: forceTop20El ? forceTop20El.checked : false,
    once: onceEl ? onceEl.checked : false,
    toggleUsbDataBeforeTask: toggleEl ? toggleEl.checked : false,
  };
}

function applyForm(cfg) {
  if (!cfg) return;
  const modeEl = byId("mode");
  const limitEl = byId("limit");
  const forceTop20El = byId("forceTop20");
  const onceEl = byId("once");
  const toggleEl = byId("toggleUsbDataBeforeTask");
  const flowEl = document.getElementById("searchFlowVersion");
  const maxScrollEl = document.getElementById("maxScroll");
  const workModeEl = document.getElementById("workMode");
  if (modeEl) modeEl.value = cfg.mode || "all";
  if (flowEl) flowEl.value = normalizeSearchFlowVersion(cfg.searchFlowVersion);
  if (maxScrollEl && cfg.maxScroll != null && String(cfg.maxScroll).trim() !== "")
    maxScrollEl.value = String(cfg.maxScroll);
  if (workModeEl && cfg.workMode) workModeEl.value = cfg.workMode;
  applyDelaysToForm(cfg.delays || {});
  if (limitEl) limitEl.value = cfg.limit || "";
  if (forceTop20El) forceTop20El.checked = cfg.forceTop20 === true;
  if (onceEl) onceEl.checked = cfg.once === true;
  if (toggleEl) toggleEl.checked = cfg.toggleUsbDataBeforeTask === true;
}

async function saveFullConfig() {
  const base = readForm();
  const payload = { ...base, taskRows };
  const res = await window.placeGui.saveConfig(payload);
  return res;
}

async function saveConfig() {
  const res = await saveFullConfig();
  if (res?.ok) logLine(`설정 저장 완료: ${res.path}`);
}

async function saveDelaysPanel() {
  const res = await saveFullConfig();
  if (!res?.ok) {
    logLine("작업 딜레이 패널 저장 실패");
    return;
  }
  const cfg = readForm();
  const flowLabel = getSearchFlowOptionLabel();
  const wmLabel = getWorkModeOptionLabel();
  logLine(
    `[작업 딜레이] 저장 완료 — 작업: ${flowLabel} | 최대 스크롤: ${cfg.maxScroll} | 워크 모드: ${wmLabel || cfg.workMode}`
  );
  logLine(`설정 파일: ${res.path}`);
}

function tryApplyRowResultFromLog(line) {
  const marker = "[ROW_RESULT]";
  const pos = line.indexOf(marker);
  if (pos < 0) return;
  const jsonStart = line.indexOf("{", pos);
  if (jsonStart < 0) return;
  let data;
  try {
    data = JSON.parse(line.slice(jsonStart));
  } catch {
    return;
  }
  const tIdx = data.index;
  if (typeof tIdx !== "number" || tIdx < 0) return;
  const rowIdx = lastRunRowIndexByTaskIndex[tIdx];
  if (rowIdx == null || !taskRows[rowIdx]) return;

  const row = taskRows[rowIdx];
  if (data.rank != null && data.rank !== "" && Number(data.rank) > 0) {
    row.ok = Math.max(0, Math.floor(Number(row.ok) || 0)) + 1;
    row.rank = String(data.rank);
  } else {
    row.fail = Math.max(0, Math.floor(Number(row.fail) || 0)) + 1;
    row.rank = data.rank != null && data.rank !== "" ? String(data.rank) : "-";
  }
  if (data.placeName) row.storeName = String(data.placeName).trim();
  if (data.visitorReviewCount != null && data.visitorReviewCount !== "")
    row.review = String(data.visitorReviewCount);
  else if (data.blogReviewCount != null && data.blogReviewCount !== "")
    row.review = String(data.blogReviewCount);
  if (data.starRating != null && data.starRating !== "") row.star = String(data.starRating);

  renderTaskTable();
}

async function startRunner() {
  const cfg = readForm();
  const flow = cfg.searchFlowVersion;

  lastRunRowIndexByTaskIndex = [];
  let runnableRows;
  if (flow === "second") {
    taskRows.forEach((r, idx) => {
      if (!r.checked) return;
      if (!String(r.keywordName || "").trim() || !String(r.linkUrl || "").trim()) return;
      lastRunRowIndexByTaskIndex.push(idx);
    });
    runnableRows = lastRunRowIndexByTaskIndex.map((idx) => {
      const r = taskRows[idx];
      return {
        linkUrl: String(r.linkUrl).trim(),
        searchKeyword: String(r.keywordName).trim(),
        rankOnly: false,
      };
    });
    if (!runnableRows.length) {
      logLine("시작 불가: B(2차만) — 체크된 행에 2차 키워드·플레이스 URL을 입력하세요.");
      return;
    }
  } else {
    const rankOnly = flow === "rankOnly";
    taskRows.forEach((r, idx) => {
      if (!r.checked) return;
      if (!String(r.keyword || "").trim() || !String(r.linkUrl || "").trim()) return;
      lastRunRowIndexByTaskIndex.push(idx);
    });
    runnableRows = lastRunRowIndexByTaskIndex.map((idx) => {
      const r = taskRows[idx];
      return {
        linkUrl: String(r.linkUrl).trim(),
        searchKeyword: String(r.keyword).trim(),
        rankOnly,
      };
    });
    if (!runnableRows.length) {
      logLine("시작 불가: 체크된 행에 검색 키워드·URL을 입력하세요.");
      return;
    }
  }

  cfg.rows = runnableRows;
  await saveFullConfig();

  const st = await window.placeGui.runnerStatus();
  if (st.running) {
    logLine("이미 실행 중입니다.");
    return;
  }

  const result = await window.placeGui.runnerStart(cfg);
  if (!result?.ok) {
    logLine(`시작 실패: ${result?.error || "알 수 없는 오류"}`);
    return;
  }

  const statusEl = byId("runnerStatus", "status");
  if (statusEl) statusEl.textContent = "실행 중";
  logLine("플레이스 배치 실행 시작");
}

async function stopRunner() {
  await window.placeGui.runnerStop();
  const statusEl = byId("runnerStatus", "status");
  if (statusEl) statusEl.textContent = "대기 중";
  logLine("중지 요청 완료");
}

async function init() {
  buildDelaySection();
  const cfg = await window.placeGui.loadConfig();
  applyForm(cfg);
  if (Array.isArray(cfg.taskRows) && cfg.taskRows.length) {
    taskRows = cfg.taskRows.map(normalizeTaskRow);
  }
  renderTaskTable();

  const checkAll = document.getElementById("checkAll");
  if (checkAll) {
    checkAll.addEventListener("change", () => {
      const on = checkAll.checked;
      taskRows.forEach((r) => {
        r.checked = on;
      });
      renderTaskTable();
    });
  }

  const info = await window.placeGui.getPathInfo();
  const pathInfoEl = byId("pathInfo");
  if (pathInfoEl) {
    pathInfoEl.textContent = `원본: ${info.sourceRoot}\n실행 스크립트: ${info.runnerScript}`;
  }
  const health = await window.placeGui.healthCheck();
  if (!health.sourceRootExists) {
    logLine(`[진단] 원본 폴더 없음: ${info.sourceRoot}`);
  }
  if (!health.runnerScriptExists) {
    logLine(`[진단] 배치 스크립트 없음: ${info.runnerScript}`);
  }
  if (!health.localTsxExists) {
    logLine("[진단] 로컬 tsx 없음: 원본 폴더에서 npm install 필요");
  }
  if (!health.puppeteerRealBrowserExists) {
    logLine("[진단] puppeteer-real-browser 없음: 원본 폴더에서 npm install 필요");
  }

  const st = await window.placeGui.runnerStatus();
  const statusEl = byId("runnerStatus", "status");
  if (statusEl) statusEl.textContent = st.running ? "실행 중" : "대기 중";

  const btnSave = byId("btnSaveConfig", "btnSave");
  if (btnSave) btnSave.onclick = saveConfig;
  const btnSaveProxyAirplane = document.getElementById("btnSaveProxyAirplane");
  if (btnSaveProxyAirplane) btnSaveProxyAirplane.onclick = saveConfig;
  const btnSaveDelays = document.getElementById("btnSaveDelays");
  if (btnSaveDelays) btnSaveDelays.onclick = saveDelaysPanel;
  const btnSaveResults = document.getElementById("btnSaveResults");
  if (btnSaveResults)
    btnSaveResults.onclick = async () => {
      const res = await saveFullConfig();
      if (res?.ok) logLine(`결과·설정 저장 완료: ${res.path}`);
      else logLine("저장 실패");
    };
  const btnResetStats = document.getElementById("btnResetStats");
  if (btnResetStats)
    btnResetStats.onclick = async () => {
      taskRows.forEach((r) => {
        r.ok = 0;
        r.fail = 0;
      });
      renderTaskTable();
      const res = await saveFullConfig();
      if (res?.ok) logLine(`성공/실패 카운터 초기화 후 저장: ${res.path}`);
    };

  const btnStart = byId("btnStart");
  const btnStop = byId("btnStop");
  if (btnStart) btnStart.onclick = startRunner;
  if (btnStop) btnStop.onclick = stopRunner;
  document.getElementById("btnAddRow").onclick = () => {
    taskRows.push(
      normalizeTaskRow({
        keyword: "",
        linkUrl: "",
        keywordName: "",
        storeName: "",
        targetCount: "",
        ok: 0,
        fail: 0,
        rank: "",
        review: "",
        star: "",
      })
    );
    renderTaskTable();
  };
  const deleteRow = () => {
    if (taskRows.length <= 1) return;
    const idx = taskRows.findIndex((r) => r.checked);
    if (idx >= 0) taskRows.splice(idx, 1);
    else taskRows.pop();
    renderTaskTable();
  };
  document.getElementById("btnDelRow").onclick = deleteRow;
  const btnDelRow2 = byId("btnDelRow2");
  const btnAddRow2 = byId("btnAddRow2");
  if (btnDelRow2) btnDelRow2.onclick = deleteRow;
  if (btnAddRow2) btnAddRow2.onclick = document.getElementById("btnAddRow").onclick;

  window.placeGui.onRunnerLog(({ line, stream }) => {
    const text = stream === "stderr" ? `[err] ${line}` : line;
    logLine(text);
    if (stream !== "stderr") tryApplyRowResultFromLog(line);
  });
  window.placeGui.onRunnerExit(({ code, error }) => {
    const statusEl2 = byId("runnerStatus", "status");
    if (statusEl2) statusEl2.textContent = "대기 중";
    if (error) logLine(`실행 오류: ${error}`);
    else logLine(`프로세스 종료 코드: ${code}`);
  });
}

init().catch((e) => {
  logLine("초기화 실패: " + (e?.message || String(e)));
});
