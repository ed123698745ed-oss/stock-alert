const SUPABASE_URL = "https://cvjjzboacbileqikwgcy.supabase.co";
const GITHUB_ACTION_URL =
  "https://github.com/ed123698745ed-oss/stock-alert/actions/workflows/fetch.yml";

const $ = id => document.getElementById(id);
let SUPABASE_KEY = "";
try { SUPABASE_KEY = localStorage.getItem("sb_key") || ""; } catch (e) {}
const sb = SUPABASE_KEY ? supabase.createClient(SUPABASE_URL, SUPABASE_KEY) : null;

const W = ["日", "一", "二", "三", "四", "五", "六"];
let CAL = [], STG = [];

const iso = d => d.toISOString().slice(0, 10);
function fmt(d) {
  if (!d) return "—";
  const t = new Date(d + "T00:00:00");
  return `${t.getMonth() + 1}/${t.getDate()}(${W[t.getDay()]})`;
}
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g,
    c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
let toastTimer;
function toast(msg) {
  const t = $("toast");
  t.textContent = msg; t.classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("on"), 2200);
}

$("btnKey").onclick = () => {
  const v = $("key").value.trim();
  if (!v) return;
  try { localStorage.setItem("sb_key", v); } catch (e) {}
  location.reload();
};

async function boot() {
  if (!sb) { $("setup").hidden = false; return; }
  const { data: { session } } = await sb.auth.getSession();
  if (session) { $("login").hidden = true; $("app").hidden = false; load(); }
  else { $("app").hidden = true; $("login").hidden = false; }
}
$("btnLogin").onclick = async () => {
  $("loginErr").textContent = "";
  const { error } = await sb.auth.signInWithPassword({
    email: $("email").value.trim(), password: $("pw").value });
  if (error) $("loginErr").textContent = "登入失敗：" + error.message;
  else boot();
};
$("pw").addEventListener("keydown", e => { if (e.key === "Enter") $("btnLogin").click(); });
$("btnLogout").onclick = async () => { await sb.auth.signOut(); boot(); };
$("btnRefresh").onclick = () => load();
$("btnRun").onclick = () => window.open(GITHUB_ACTION_URL, "_blank");

async function load() {
  const today = iso(new Date());
  const until = iso(new Date(Date.now() + 120 * 864e5));
  const [act, hold, run, stg, cal] = await Promise.all([
    sb.from("v_next_actions").select("*"),
    sb.from("v_holding").select("*"),
    sb.from("runs").select("*").order("started_at", { ascending: false }).limit(1),
    sb.from("strategies").select("*").order("name"),
    sb.from("calendar").select("*").gte("event_date", today)
      .lte("event_date", until).order("event_date"),
  ]);
  const err = act.error || hold.error || run.error || stg.error || cal.error;
  if (err) {
    $("actions").innerHTML = `<div class="card">讀取失敗：${esc(err.message)}</div>`;
    return;
  }
  CAL = cal.data || [];
  STG = stg.data || [];
  renderStatus(run.data?.[0]);
  renderActions(act.data || []);
  renderCalendar(CAL);
  renderHolding(hold.data || []);
  renderStrategies(STG);
  fillForm();
}

function renderStatus(r) {
  const el = $("status");
  if (!r) { el.innerHTML = `<span class="dot warn"></span>尚無執行紀錄`; return; }
  const t = new Date(r.finished_at || r.started_at);
  const hrs = (Date.now() - t) / 36e5;
  const label = { success: "正常", partial: "部分失敗", failed: "失敗", running: "執行中" }[r.status] || r.status;
  let cls = r.status === "success" ? "" : (r.status === "running" ? "warn" : "bad");
  let stale = "";
  if (hrs > 48 && r.status === "success") { cls = "warn"; stale = "（資料可能過期）"; }
  const ts = `${t.getMonth() + 1}/${t.getDate()} ` +
    `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`;
  el.innerHTML = `<span class="dot ${cls}"></span>最後更新 ${ts}・${label}${stale}`;
}

function renderActions(rows) {
  const box = $("actions");
  if (!rows.length) {
    box.innerHTML = `<div class="empty">下一個交易日沒有要進場或出場的標的。</div>`;
    $("actionTitle").textContent = "明日行動";
    return;
  }
  const d = rows[0].action === "entry" ? rows[0].entry_date : rows[0].exit_date;
  $("actionTitle").textContent = `明日行動　${fmt(d)}`;
  rows.sort((a, b) => (a.action === "exit" ? 0 : 1) - (b.action === "exit" ? 0 : 1));
  box.innerHTML = rows.map(r => {
    const isBuy = r.action === "entry";
    const when = isBuy
      ? `${fmt(r.entry_date)} ${r.entry_timing === "open" ? "開盤" : "收盤"}買進`
      : `${fmt(r.exit_date)} ${r.exit_timing === "open" ? "開盤" : "收盤"}賣出`;
    return `
    <div class="card ${isBuy ? "buy" : "sell"}">
      <span class="tag ${isBuy ? "buy" : "sell"}">${isBuy ? "買進" : "賣出"}</span>
      <span class="tag" style="color:var(--dim)">${esc(r.strategy_name)}</span>
      <div class="name">${esc(r.company_name)} <span class="code">${esc(r.company_code)}</span></div>
      <div class="meta">${when}</div>
      <div class="meta">事件日 ${fmt(r.event_date)}　
        ${isBuy ? "預計出場 " + fmt(r.exit_date) : "進場日 " + fmt(r.entry_date)}</div>
      ${noteBlock(r)}
    </div>`;
  }).join("");
  bindRows(box);
}

function renderCalendar(rows) {
  const box = $("calendar");
  const open = rows.filter(r => !r.done).slice(0, 6);
  if (!open.length) { box.innerHTML = `<div class="empty">近期沒有要注意的日子。</div>`; return; }
  const today = iso(new Date());
  box.innerHTML = open.map(r => {
    const days = Math.round((new Date(r.event_date) - new Date(today)) / 864e5);
    const soon = days <= 3;
    const when = days === 0 ? "就是今天" : (days === 1 ? "明天" : `還有 ${days} 天`);
    return `
    <div class="card ${soon ? "soon" : ""}">
      <span class="tag ${soon ? "warn" : ""}" style="${soon ? "" : "color:var(--dim)"}">${when}</span>
      <div class="name" style="font-size:16px">${esc(r.title)}</div>
      <div class="meta">${fmt(r.event_date)}</div>
      ${r.detail ? `<div class="meta">${esc(r.detail)}</div>` : ""}
      <div class="row">
        <label class="chk">
          <input type="checkbox" data-cal="${r.id}" ${r.done ? "checked" : ""}> 已處理
        </label>
      </div>
    </div>`;
  }).join("");
  box.querySelectorAll("input[data-cal]").forEach(el => {
    el.onchange = async () => {
      const { error } = await sb.from("calendar")
        .update({ done: el.checked }).eq("id", el.dataset.cal);
      toast(error ? "儲存失敗：" + error.message : "已同步");
      if (el.checked) load();
    };
  });
}

function renderHolding(rows) {
  const box = $("holding");
  if (!rows.length) { box.innerHTML = `<div class="empty">目前沒有進行中的部位。</div>`; return; }
  box.innerHTML = rows.map(r => `
    <div class="card">
      <span class="tag" style="color:var(--dim)">${esc(r.strategy_name)}</span>
      <div class="name">${esc(r.company_name)} <span class="code">${esc(r.company_code)}</span></div>
      <div class="meta">${fmt(r.entry_date)} 進場　→　出場 <span class="days">${fmt(r.exit_date)}</span>
        ${r.exit_timing === "open" ? "開盤" : "收盤"}</div>
      ${noteBlock(r)}
    </div>`).join("");
  bindRows(box);
}

function noteBlock(r) {
  return `
    <div class="row">
      <label class="chk">
        <input type="checkbox" data-id="${r.id}" data-f="checked" ${r.checked ? "checked" : ""}>
        已處理
      </label>
      <button class="small" data-ignore="${r.id}">忽略</button>
    </div>
    <div class="row">
      <input type="text" placeholder="備註" data-id="${r.id}" data-f="note" value="${esc(r.note || "")}">
    </div>`;
}

function bindRows(box) {
  box.querySelectorAll('input[type=checkbox][data-f]').forEach(el => {
    el.onchange = () => save(el.dataset.id, { checked: el.checked });
  });
  box.querySelectorAll('input[type=text][data-f=note]').forEach(el => {
    el.onchange = () => save(el.dataset.id, { note: el.value });
  });
  box.querySelectorAll('button[data-ignore]').forEach(el => {
    el.onclick = async () => { await save(el.dataset.ignore, { ignored: true }, "已忽略"); load(); };
  });
}

async function save(id, patch, msg) {
  const { error } = await sb.from("signals").update(patch).eq("id", id);
  toast(error ? "儲存失敗：" + error.message : (msg || "已同步"));
}

function fillForm() {
  const sel = $("fStrategy");
  if (sel.options.length !== STG.length) {
    sel.innerHTML = STG.map(s =>
      `<option value="${esc(s.code)}">${esc(s.name)}</option>`).join("");
    const cal = STG.find(s => s.code === "tw50");
    if (cal) sel.value = "tw50";
  }
  if (!$("fEvent").value) $("fEvent").value = iso(new Date());
  syncDates();
}

function syncDates() {
  const code = $("fStrategy").value;
  const ev = $("fEvent").value;
  if (!ev || !code) return;
  const s = STG.find(x => x.code === code);
  if (!s) return;

  const eff = CAL.find(c => c.strategy_code === code && c.kind === "effective"
                            && c.event_date >= ev);
  if (eff) {
    $("fExit").value = eff.event_date;
    $("fHint").textContent =
      `出場日已帶入行事曆上的生效日 ${fmt(eff.event_date)}。進場日留空會用策略參數推算。`;
  } else {
    $("fExit").value = "";
    $("fHint").textContent = "兩個日期都留空的話，會用策略參數（進場後持有 N 個交易日）推算。";
  }
  $("fEntry").value = "";
}
$("fStrategy").onchange = syncDates;
$("fEvent").onchange = syncDates;

$("btnAdd").onclick = async () => {
  const code = $("fCode").value.trim();
  const name = $("fName").value.trim();
  const ev = $("fEvent").value;
  if (!code || !ev) { toast("代號和事件日必填"); return; }

  const { data, error } = await sb.rpc("add_manual_signal", {
    p_strategy: $("fStrategy").value,
    p_code: code,
    p_name: name || code,
    p_event_date: ev,
    p_entry_date: $("fEntry").value || null,
    p_exit_date: $("fExit").value || null,
    p_market: "sii",
    p_summary: "手動新增",
  });
  if (error) { toast("新增失敗：" + error.message); return; }
  toast("已新增（訊號 #" + data + "）");
  $("fCode").value = ""; $("fName").value = "";
  load();
};

function renderStrategies(rows) {
  $("strategies").innerHTML = rows.map(s => `
    <div class="card">
      <div class="name" style="font-size:16px">${esc(s.name)}
        <span class="code">${esc(s.code)}</span></div>
      <div class="grid" style="margin-top:12px">
        <div><label>事件後第幾個交易日進場</label>
          <input type="number" min="0" max="60" data-s="${esc(s.code)}"
                 data-f="entry_offset" value="${s.entry_offset}"></div>
        <div><label>持有幾個交易日（含進場日）</label>
          <input type="number" min="1" max="250" data-s="${esc(s.code)}"
                 data-f="holding_days" value="${s.holding_days}"></div>
      </div>
      <div class="row">
        <label class="chk">
          <input type="checkbox" data-s="${esc(s.code)}" data-f="enabled"
                 ${s.enabled ? "checked" : ""}> 啟用
        </label>
        <span class="meta">進場 ${s.entry_timing === "open" ? "開盤" : "收盤"}
          ・出場 ${s.exit_timing === "open" ? "開盤" : "收盤"}</span>
      </div>
    </div>`).join("");

  $("strategies").querySelectorAll("[data-s]").forEach(el => {
    el.onchange = async () => {
      const v = el.type === "checkbox" ? el.checked : Number(el.value);
      const { error } = await sb.from("strategies")
        .update({ [el.dataset.f]: v, updated_at: new Date().toISOString() })
        .eq("code", el.dataset.s);
      toast(error ? "儲存失敗：" + error.message : "已更新策略參數");
    };
  });
}

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && !$("app").hidden) load();
});

boot();
