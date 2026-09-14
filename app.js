const SUPABASE_URL = "https://cvjjzboacbileqikwgcy.supabase.co";
const GH = "https://github.com/ed123698745ed-oss/stock-alert/actions";

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

function ensureSections() {
  if ($("split")) return;
  document.head.insertAdjacentHTML("beforeend", `<style>
    .kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:14px 0 4px}
    .kpi{background:var(--card);border:1px solid var(--line);border-radius:12px;
      padding:10px 8px;text-align:center}
    .kpi b{display:block;font-size:21px;font-variant-numeric:tabular-nums;line-height:1.2}
    .kpi span{font-size:11px;color:var(--dim)}
    .kpi.hot b{color:var(--buy)}
    .mini{font-size:13px;padding:10px 12px;margin-bottom:8px}
    .mini .name{font-size:15px;margin:4px 0 2px}
    .nodes{display:grid;grid-template-columns:repeat(auto-fit,minmax(88px,1fr));
      gap:6px;margin-top:10px;font-size:12px}
    .node{background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:6px}
    .node i{display:block;color:var(--dim);font-style:normal;font-size:11px}
    .node b{font-variant-numeric:tabular-nums;font-weight:600}
    .node.on{border-color:var(--accent)}
    details.grp{margin-bottom:10px}
    details.grp>summary{font-size:14px}
    .subj{font-size:13px;line-height:1.45;margin-top:6px}
    .edit{display:grid;grid-template-columns:1fr 1fr auto;gap:8px;margin-top:10px;
      align-items:end}
    .edit label{font-size:12px;color:var(--dim);display:block;margin-bottom:3px}
    .edit input{padding:8px 10px;font-size:15px}
  </style>`);

  // 摘要數字放內容區最上面，不要塞進 sticky header
  $("actionTitle").insertAdjacentHTML("beforebegin", `<div class="kpis" id="kpis"></div>`);
  $("holding").insertAdjacentHTML("afterend", `
    <h2>分割追蹤</h2><div id="split"></div>
    <h2>處置股</h2><div id="disposals"></div>
    <h2 id="detTitle">新偵測公告</h2><div id="detections"></div>`);
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
  if (session) {
    $("login").hidden = true; $("app").hidden = false;
    ensureSections(); load();
  } else { $("app").hidden = true; $("login").hidden = false; }
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
$("btnRun").onclick = () => window.open(GH, "_blank");

async function load() {
  const today = iso(new Date());
  const until = iso(new Date(Date.now() + 400 * 864e5));
  const [act, hold, run, stg, cal, dsp, spl, det] = await Promise.all([
    sb.from("v_next_actions").select("*"),
    sb.from("v_holding").select("*"),
    sb.from("runs").select("*").order("started_at", { ascending: false }).limit(1),
    sb.from("strategies").select("*").order("name"),
    sb.from("calendar").select("*").gte("event_date", today)
      .lte("event_date", until).order("event_date"),
    sb.from("v_disposals").select("*"),
    sb.from("v_split").select("*"),
    sb.from("detections").select("*").eq("handled", false)
      .order("detected_date", { ascending: false }).limit(30),
  ]);
  const err = [act, hold, run, stg, cal, dsp, spl, det].map(r => r.error).find(Boolean);
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
  renderSplit(spl.data || []);
  renderDisposals(dsp.data || []);
  renderDetections(det.data || []);
  renderStrategies(STG);
  renderKpis(act.data || [], hold.data || [], dsp.data || [], det.data || []);
  fillForm();
}

function renderKpis(act, hold, dsp, det) {
  const inDisp = dsp.filter(d => d.grp === "處置中").length;
  const focus = dsp.filter(d => d.is_focus).length;
  $("kpis").innerHTML = `
    <div class="kpi ${act.length ? "hot" : ""}"><b>${act.length}</b><span>明日行動</span></div>
    <div class="kpi"><b>${hold.length}</b><span>進行中部位</span></div>
    <div class="kpi"><b>${inDisp}</b><span>處置中${focus ? `・${focus}★` : ""}</span></div>
    <div class="kpi ${det.length ? "hot" : ""}"><b>${det.length}</b><span>待看公告</span></div>`;
}

function renderStatus(r) {
  const el = $("status");
  if (!r) { el.innerHTML = `<span class="dot warn"></span>尚無執行紀錄`; return; }
  const t = new Date(r.finished_at || r.started_at);
  const hrs = (Date.now() - t) / 36e5;
  const label = { success: "正常", partial: "部分失敗", failed: "失敗", running: "執行中" }[r.status] || r.status;
  let cls = r.status === "success" ? "" : (r.status === "running" ? "warn" : "bad");
  let stale = "";
  if (hrs > 30 && r.status === "success") { cls = "warn"; stale = "（資料可能過期）"; }
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
      ${noteBlock("signals", r)}
    </div>`;
  }).join("");
  bindRows(box);
}

function renderCalendar(rows) {
  const box = $("calendar");
  const today = iso(new Date());
  const open = rows.filter(r => !r.done);
  const near = open.filter(r =>
    (new Date(r.event_date) - new Date(today)) / 864e5 <= 45).slice(0, 4);
  const show = near.length ? near : open.slice(0, 1);
  if (!show.length) { box.innerHTML = `<div class="empty">近期沒有要注意的日子。</div>`; return; }
  box.innerHTML = show.map(r => {
    const days = Math.round((new Date(r.event_date) - new Date(today)) / 864e5);
    const soon = days <= 7;
    const when = days === 0 ? "就是今天" : (days === 1 ? "明天" : `還有 ${days} 天`);
    return `
    <div class="card ${soon ? "soon" : ""}">
      <span class="tag ${soon ? "warn" : ""}" style="${soon ? "" : "color:var(--dim)"}">${when}</span>
      <div class="name" style="font-size:16px">${esc(r.title)}</div>
      <div class="meta">${fmt(r.event_date)}</div>
      ${r.detail ? `<div class="meta">${esc(r.detail)}</div>` : ""}
      <div class="row">
        <label class="chk"><input type="checkbox" data-t="calendar" data-f="done"
          data-id="${r.id}" ${r.done ? "checked" : ""}> 已處理</label>
      </div>
    </div>`;
  }).join("");
  bindRows(box);
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
      ${noteBlock("signals", r)}
    </div>`).join("");
  bindRows(box);
}

function renderSplit(rows) {
  const box = $("split");
  if (!rows.length) { box.innerHTML = `<div class="empty">沒有追蹤中的分割標的。</div>`; return; }
  const rank = { buy: 0, sell: 0, hold: 1, watch: 2, other: 3 };
  rows.sort((a, b) => (rank[a.grp] ?? 9) - (rank[b.grp] ?? 9));
  box.innerHTML = rows.map(r => {
    const hot = r.status.startsWith("★");
    const node = (label, val, on) =>
      `<div class="node ${on ? "on" : ""}"><i>${label}</i><b>${val ? fmt(val) : "—"}</b></div>`;
    return `
    <div class="card ${hot ? "soon" : ""}">
      <span class="tag ${hot ? "warn" : ""}" style="${hot ? "" : "color:var(--dim)"}">${esc(r.status)}</span>
      ${r.ratio ? `<span class="tag" style="color:var(--dim)">一拆${r.ratio}</span>` : ""}
      <div class="name">${esc(r.company_name || "")} <span class="code">${esc(r.company_code)}</span></div>
      <div class="nodes">
        ${node("宣告拆股", r.declare_date)}
        ${node("股東會", r.meeting_date)}
        ${node("公告換股", r.swap_date, !!r.swap_date)}
        ${node("新股上市", r.listing_date, !!r.listing_date)}
        ${node("賣出日", r.sell_date, !!r.sell_date)}
      </div>
      <div class="edit">
        <div><label>補公告換股日</label>
          <input type="date" data-split="${esc(r.company_code)}" data-k="swap"
                 value="${r.swap_date || ""}"></div>
        <div><label>補新股上市日</label>
          <input type="date" data-split="${esc(r.company_code)}" data-k="listing"
                 value="${r.listing_date || ""}"></div>
        <button class="small" data-splitsave="${esc(r.company_code)}">存</button>
      </div>
      ${noteBlock("split_watch", r)}
    </div>`;
  }).join("");
  bindRows(box);
  box.querySelectorAll("[data-splitsave]").forEach(btn => {
    btn.onclick = async () => {
      const code = btn.dataset.splitsave;
      const get = k => box.querySelector(`[data-split="${code}"][data-k="${k}"]`).value || null;
      const { error } = await sb.rpc("upsert_split_watch", {
        p_code: code, p_swap: get("swap"), p_listing: get("listing") });
      toast(error ? "儲存失敗：" + error.message : "已更新節點");
      if (!error) load();
    };
  });
}

function renderDisposals(rows) {
  const box = $("disposals");
  if (!rows.length) { box.innerHTML = `<div class="empty">目前沒有追蹤中的處置股。</div>`; return; }
  const order = ["即將處置", "處置中", "出關觀察", "已再處置", "已結束"];
  const groups = {};
  rows.forEach(r => (groups[r.grp] = groups[r.grp] || []).push(r));

  const card = r => `
    <div class="card mini ${r.is_focus ? "soon" : ""}">
      <span class="tag ${r.is_focus ? "warn" : ""}" style="${r.is_focus ? "" : "color:var(--dim)"}">${esc(r.phase || "")}</span>
      <span class="tag" style="color:var(--dim)">${esc(r.match_mode || "")}</span>
      ${r.is_fresh ? `<span class="tag buy">新公告</span>` : ""}
      <div class="name">${esc(r.company_name)} <span class="code">${esc(r.company_code)}</span>
        <span class="code" style="font-size:12px">${esc(r.market)}</span></div>
      <div class="meta">處置 ${fmt(r.start_date)} ～ ${fmt(r.end_date)}　
        ${r.next_focus ? `下個觀察 <b>${esc(r.next_focus)}</b>` : ""}</div>
      ${noteBlock("disposals", r)}
    </div>`;

  box.innerHTML = order.filter(g => groups[g]).map(g => {
    const list = groups[g];
    const open = g === "即將處置" || g === "處置中";
    return `<details class="grp" ${open ? "open" : ""}>
      <summary>${g}　${list.length} 檔${
        list.some(x => x.is_focus) ? `　★${list.filter(x => x.is_focus).length}` : ""}</summary>
      ${list.map(card).join("")}
    </details>`;
  }).join("");
  bindRows(box);
}

function renderDetections(rows) {
  const box = $("detections");
  $("detTitle").textContent = `新偵測公告${rows.length ? `　${rows.length}` : ""}`;
  if (!rows.length) { box.innerHTML = `<div class="empty">沒有待看的公告。</div>`; return; }
  box.innerHTML = rows.map(r => `
    <div class="card mini">
      <span class="tag buy">${esc(r.matched || "命中")}</span>
      <span class="tag" style="color:var(--dim)">${esc(r.strategy_code || "")}</span>
      <div class="name">${esc(r.company_name || "")} <span class="code">${esc(r.company_code)}</span>
        <span class="code" style="font-size:12px">${fmt(r.detected_date)}</span></div>
      <div class="subj">${esc(r.subject)}</div>
      <div class="row">
        <label class="chk"><input type="checkbox" data-t="detections" data-f="handled"
          data-id="${r.id}"> 已處理</label>
        ${r.strategy_code === "split"
          ? `<button class="small" data-addsplit="${esc(r.company_code)}"
               data-name="${esc(r.company_name || "")}">加入分割追蹤</button>` : ""}
      </div>
    </div>`).join("");
  bindRows(box);
  box.querySelectorAll("[data-addsplit]").forEach(btn => {
    btn.onclick = async () => {
      const { error } = await sb.rpc("upsert_split_watch", {
        p_code: btn.dataset.addsplit, p_name: btn.dataset.name });
      toast(error ? "失敗：" + error.message : "已加入分割追蹤");
      if (!error) load();
    };
  });
}

function noteBlock(table, r) {
  return `
    <div class="row">
      <label class="chk">
        <input type="checkbox" data-t="${table}" data-f="checked" data-id="${r.id}"
          ${r.checked ? "checked" : ""}> 已處理
      </label>
      ${table === "signals" || table === "disposals"
        ? `<button class="small" data-ignore="${table}:${r.id}">忽略</button>` : ""}
    </div>
    <div class="row">
      <input type="text" placeholder="備註" data-t="${table}" data-f="note" data-id="${r.id}"
             value="${esc(r.note || "")}">
    </div>`;
}

function bindRows(box) {
  box.querySelectorAll("input[type=checkbox][data-t]").forEach(el => {
    el.onchange = () => saveRow(el.dataset.t, el.dataset.id, { [el.dataset.f]: el.checked });
  });
  box.querySelectorAll("input[type=text][data-f=note]").forEach(el => {
    el.onchange = () => saveRow(el.dataset.t, el.dataset.id, { note: el.value });
  });
  box.querySelectorAll("button[data-ignore]").forEach(el => {
    el.onclick = async () => {
      const [t, id] = el.dataset.ignore.split(":");
      await saveRow(t, id, { ignored: true }, "已忽略");
      load();
    };
  });
}

async function saveRow(table, id, patch, msg) {
  const { error } = await sb.from(table).update(patch).eq("id", id);
  toast(error ? "儲存失敗：" + error.message : (msg || "已同步"));
  if (!error && (patch.handled || patch.done)) load();
}

function fillForm() {
  const sel = $("fStrategy");
  if (sel.options.length !== STG.length) {
    sel.innerHTML = STG.map(s => `<option value="${esc(s.code)}">${esc(s.name)}</option>`).join("");
    if (STG.some(s => s.code === "tw50")) sel.value = "tw50";
  }
  if (!$("fEvent").value) $("fEvent").value = iso(new Date());
  syncDates();
}

function syncDates() {
  const code = $("fStrategy").value, ev = $("fEvent").value;
  if (!ev || !code) return;
  const eff = CAL.find(c => c.strategy_code === code && c.kind === "effective" && c.event_date >= ev);
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
  const code = $("fCode").value.trim(), name = $("fName").value.trim(), ev = $("fEvent").value;
  if (!code || !ev) { toast("代號和事件日必填"); return; }
  const { data, error } = await sb.rpc("add_manual_signal", {
    p_strategy: $("fStrategy").value, p_code: code, p_name: name || code,
    p_event_date: ev, p_entry_date: $("fEntry").value || null,
    p_exit_date: $("fExit").value || null, p_market: "sii", p_summary: "手動新增",
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
        <label class="chk"><input type="checkbox" data-s="${esc(s.code)}" data-f="enabled"
          ${s.enabled ? "checked" : ""}> 啟用</label>
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
