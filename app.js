import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.102.0/+esm";

const SUPABASE_URL = "https://eqxnfwjarpdkmretsrah.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_e06iFLCaZvzC-WXtR9bmqA_h88pRtR3";

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

const app = document.querySelector("#app");
const logoutButton = document.querySelector("#logoutButton");

const state = {
  session: null,
  profile: null,
  clients: [],
  recordsByClient: new Map(),
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function todayJst() {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function prettyDate(dateString) {
  if (!dateString) return "";
  const [y, m, d] = dateString.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(date);
}

function numberOrNull(value) {
  const trimmed = String(value ?? "").trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

function setBusy(button, busy, busyText = "保存中…") {
  if (!button) return;
  if (busy) {
    button.dataset.originalText = button.textContent;
    button.textContent = busyText;
    button.disabled = true;
  } else {
    button.textContent = button.dataset.originalText || button.textContent;
    button.disabled = false;
  }
}

function renderAuth(message = "") {
  logoutButton.classList.add("hidden");
  app.innerHTML = `
    <section class="panel auth-panel">
      <h2>ログイン</h2>
      <p class="help">職員・ご家族共通の入口です。V0.1ではテストアカウントのみ利用します。</p>
      ${message ? `<div class="notice">${escapeHtml(message)}</div>` : ""}
      <div class="auth-tabs" role="tablist">
        <button class="auth-tab active" type="button" data-auth-tab="login">ログイン</button>
        <button class="auth-tab" type="button" data-auth-tab="signup">テスト利用登録</button>
      </div>
      <form id="authForm" class="stack">
        <input type="hidden" id="authMode" value="login" />
        <label>メールアドレス
          <input id="email" type="email" autocomplete="email" required />
        </label>
        <label>パスワード
          <input id="password" type="password" autocomplete="current-password" minlength="8" required />
        </label>
        <button id="authSubmit" class="button" type="submit">ログイン</button>
        <div id="authError" class="error-box hidden"></div>
      </form>
      <p id="authHelp" class="help">登録済みのテストアカウントでログインしてください。</p>
    </section>
  `;

  document.querySelectorAll("[data-auth-tab]").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll("[data-auth-tab]").forEach((x) => x.classList.remove("active"));
      tab.classList.add("active");
      const mode = tab.dataset.authTab;
      document.querySelector("#authMode").value = mode;
      document.querySelector("#authSubmit").textContent = mode === "login" ? "ログイン" : "テスト利用登録";
      document.querySelector("#authHelp").textContent = mode === "login"
        ? "登録済みのテストアカウントでログインしてください。"
        : "登録後、管理側で職員または家族として紐づけるまでデータは表示されません。";
    });
  });

  document.querySelector("#authForm").addEventListener("submit", handleAuthSubmit);
}

async function handleAuthSubmit(event) {
  event.preventDefault();
  const button = document.querySelector("#authSubmit");
  const errorBox = document.querySelector("#authError");
  errorBox.classList.add("hidden");
  errorBox.textContent = "";

  const mode = document.querySelector("#authMode").value;
  const email = document.querySelector("#email").value.trim();
  const password = document.querySelector("#password").value;

  try {
    setBusy(button, true, mode === "login" ? "ログイン中…" : "登録中…");
    if (mode === "signup") {
      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) throw error;
      if (!data.session) {
        renderAuth("登録を受け付けました。確認メールが届いた場合は認証後、この画面に戻ってログインしてください。");
        return;
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
    }
    await bootstrap();
  } catch (error) {
    errorBox.textContent = error?.message || "認証に失敗しました。";
    errorBox.classList.remove("hidden");
  } finally {
    setBusy(button, false);
  }
}

function renderPending(user) {
  logoutButton.classList.remove("hidden");
  app.innerHTML = `
    <section class="panel auth-panel">
      <h2>登録待ち</h2>
      <p>ログインはできていますが、まだ職員・家族の権限が割り当てられていません。</p>
      <p class="help">テストでは、下のユーザーIDを管理側で紐づけます。</p>
      <div class="pending-id">${escapeHtml(user.id)}</div>
      <p class="help">メール: ${escapeHtml(user.email || "-")}</p>
    </section>
  `;
}

async function bootstrap() {
  app.innerHTML = `
    <section class="panel loading-panel">
      <div class="spinner" aria-hidden="true"></div>
      <p>読み込み中です…</p>
    </section>
  `;

  const { data: { session } } = await supabase.auth.getSession();
  state.session = session;
  state.profile = null;
  state.clients = [];
  state.recordsByClient = new Map();

  if (!session?.user) {
    renderAuth();
    return;
  }

  logoutButton.classList.remove("hidden");
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("id, role, display_name, store_id, is_active")
    .eq("id", session.user.id)
    .maybeSingle();

  if (error) {
    renderFatal("プロフィールの確認に失敗しました。", error.message);
    return;
  }

  if (!profile || !profile.is_active) {
    renderPending(session.user);
    return;
  }

  state.profile = profile;
  if (profile.role === "staff") {
    await loadStaffDashboard();
  } else if (profile.role === "family") {
    await loadFamilyDashboard();
  } else {
    renderFatal("権限設定が不正です。", "管理側でアカウント設定を確認してください。");
  }
}

function renderFatal(title, detail) {
  app.innerHTML = `
    <section class="panel auth-panel">
      <h2>${escapeHtml(title)}</h2>
      <div class="error-box">${escapeHtml(detail)}</div>
    </section>
  `;
}

async function loadStaffDashboard() {
  const date = todayJst();
  const [{ data: clients, error: clientsError }, { data: records, error: recordsError }] = await Promise.all([
    supabase.from("clients").select("id, client_code, display_name, store_id").eq("is_active", true).order("display_name"),
    supabase.from("daily_records").select("id, client_id, record_date, attendance, absence_reason, bp_systolic, bp_diastolic, pulse, temperature, message, status, confirmed_at").eq("record_date", date),
  ]);

  if (clientsError || recordsError) {
    renderFatal("本日の一覧を読み込めませんでした。", clientsError?.message || recordsError?.message || "不明なエラー");
    return;
  }

  state.clients = clients || [];
  state.recordsByClient = new Map((records || []).map((r) => [r.client_id, r]));
  renderStaffDashboard(date);
}

function renderStaffDashboard(date) {
  const cards = state.clients.map((client) => renderStaffClientCard(client, state.recordsByClient.get(client.id))).join("");
  app.innerHTML = `
    <section>
      <div class="dashboard-head">
        <div>
          <h2>職員画面</h2>
          <p>${escapeHtml(state.profile.display_name)} / 本日の連絡帳を入力します。</p>
        </div>
        <div class="date-chip">${escapeHtml(prettyDate(date))}</div>
      </div>
      <div class="client-list">
        ${cards || `<div class="panel empty">対象利用者がいません。</div>`}
      </div>
    </section>
  `;

  document.querySelectorAll(".attendance-select").forEach((select) => {
    syncAttendanceFields(select.closest(".client-card"));
    select.addEventListener("change", () => syncAttendanceFields(select.closest(".client-card")));
  });

  document.querySelectorAll("[data-save]").forEach((button) => {
    button.addEventListener("click", async () => {
      const card = button.closest(".client-card");
      await saveClientRecord(card, button.dataset.save === "confirm", button);
    });
  });
}

function renderStaffClientCard(client, record) {
  const attendance = record?.attendance || "present";
  const status = record?.status || "none";
  const statusLabel = status === "confirmed" ? "確定済み" : status === "draft" ? "下書き" : "未入力";
  return `
    <article class="client-card" data-card-client="${escapeHtml(client.id)}">
      <div class="client-card-head">
        <div>
          <h3>${escapeHtml(client.display_name)}</h3>
          <div class="client-code">${escapeHtml(client.client_code)}</div>
        </div>
        <span class="status-badge ${escapeHtml(status)}">${statusLabel}</span>
      </div>

      <div class="grid-2">
        <label>利用状況
          <select class="attendance-select">
            <option value="present" ${attendance === "present" ? "selected" : ""}>来所</option>
            <option value="absent" ${attendance === "absent" ? "selected" : ""}>欠席</option>
          </select>
        </label>
        <label>欠席理由
          <input class="absence-reason" value="${escapeHtml(record?.absence_reason || "")}" placeholder="欠席時のみ入力" />
        </label>
      </div>

      <div class="grid-3" style="margin-top:14px">
        <label>血圧（上）
          <input class="bp-systolic vital-input" type="number" inputmode="numeric" min="40" max="300" value="${escapeHtml(record?.bp_systolic ?? "")}" placeholder="例 128" />
        </label>
        <label>血圧（下）
          <input class="bp-diastolic vital-input" type="number" inputmode="numeric" min="20" max="200" value="${escapeHtml(record?.bp_diastolic ?? "")}" placeholder="例 74" />
        </label>
        <label>脈拍
          <input class="pulse vital-input" type="number" inputmode="numeric" min="20" max="250" value="${escapeHtml(record?.pulse ?? "")}" placeholder="例 72" />
        </label>
      </div>

      <div class="grid-2" style="margin-top:14px">
        <label>体温（℃）
          <input class="temperature vital-input" type="number" inputmode="decimal" step="0.1" min="30" max="45" value="${escapeHtml(record?.temperature ?? "")}" placeholder="例 36.5" />
        </label>
        <div></div>
      </div>

      <label style="margin-top:14px">ご連絡
        <textarea class="message" placeholder="ご家族・ご本人へ伝える内容（任意）">${escapeHtml(record?.message || "")}</textarea>
      </label>

      <div class="save-status hidden" role="status"></div>
      <div class="card-actions">
        <button class="button secondary" type="button" data-save="draft">下書き保存</button>
        <button class="button" type="button" data-save="confirm">確定して家族へ公開</button>
      </div>
    </article>
  `;
}

function syncAttendanceFields(card) {
  if (!card) return;
  const absent = card.querySelector(".attendance-select").value === "absent";
  card.querySelector(".absence-reason").disabled = !absent;
  card.querySelectorAll(".vital-input").forEach((input) => { input.disabled = absent; });
}

async function saveClientRecord(card, shouldConfirm, button) {
  if (!card || !state.session?.user) {
    alert("保存対象を取得できませんでした。画面を再読み込みしてください。");
    return;
  }

  const clientId = card.dataset.cardClient;
  const statusBox = card.querySelector(".save-status");
  if (statusBox) {
    statusBox.className = "save-status notice";
    statusBox.textContent = shouldConfirm ? "確定処理中です…" : "下書き保存中です…";
  }

  const attendance = card.querySelector(".attendance-select").value;
  const absenceReason = card.querySelector(".absence-reason").value.trim();
  if (attendance === "absent" && !absenceReason) {
    alert("欠席理由を入力してください。");
    card.querySelector(".absence-reason").focus();
    return;
  }

  const payload = {
    attendance,
    absence_reason: attendance === "absent" ? absenceReason : null,
    bp_systolic: attendance === "present" ? numberOrNull(card.querySelector(".bp-systolic").value) : null,
    bp_diastolic: attendance === "present" ? numberOrNull(card.querySelector(".bp-diastolic").value) : null,
    pulse: attendance === "present" ? numberOrNull(card.querySelector(".pulse").value) : null,
    temperature: attendance === "present" ? numberOrNull(card.querySelector(".temperature").value) : null,
    message: card.querySelector(".message").value.trim() || null,
    status: shouldConfirm ? "confirmed" : "draft",
    confirmed_at: shouldConfirm ? new Date().toISOString() : null,
    updated_by: state.session.user.id,
  };

  const existing = state.recordsByClient.get(clientId);
  try {
    setBusy(button, true, shouldConfirm ? "確定中…" : "保存中…");
    let result;
    if (existing?.id) {
      result = await supabase
        .from("daily_records")
        .update(payload)
        .eq("id", existing.id)
        .select("id, client_id, record_date, attendance, absence_reason, bp_systolic, bp_diastolic, pulse, temperature, message, status, confirmed_at")
        .single();
    } else {
      result = await supabase
        .from("daily_records")
        .insert({
          ...payload,
          client_id: clientId,
          record_date: todayJst(),
          created_by: state.session.user.id,
        })
        .select("id, client_id, record_date, attendance, absence_reason, bp_systolic, bp_diastolic, pulse, temperature, message, status, confirmed_at")
        .single();
    }

    if (result.error) throw result.error;
    state.recordsByClient.set(clientId, result.data);
    if (statusBox) {
      statusBox.className = "save-status success-box";
      statusBox.textContent = shouldConfirm ? "確定しました。家族画面へ公開済みです。" : "下書きを保存しました。";
    }
    setTimeout(() => renderStaffDashboard(todayJst()), 700);
  } catch (error) {
    const message = error?.message || "不明なエラー";
    if (statusBox) {
      statusBox.className = "save-status error-box";
      statusBox.textContent = `保存できませんでした: ${message}`;
    }
    console.error("daily_records save failed", error);
  } finally {
    setBusy(button, false);
  }
}

async function loadFamilyDashboard() {
  const [{ data: clients, error: clientsError }, { data: records, error: recordsError }] = await Promise.all([
    supabase.from("clients").select("id, client_code, display_name").eq("is_active", true).order("display_name"),
    supabase.from("daily_records").select("id, client_id, record_date, attendance, absence_reason, bp_systolic, bp_diastolic, pulse, temperature, message, status, confirmed_at").eq("status", "confirmed").order("record_date", { ascending: false }).limit(60),
  ]);

  if (clientsError || recordsError) {
    renderFatal("連絡帳を読み込めませんでした。", clientsError?.message || recordsError?.message || "不明なエラー");
    return;
  }

  state.clients = clients || [];
  renderFamilyDashboard(records || []);
}

function renderFamilyDashboard(records) {
  const clientMap = new Map(state.clients.map((c) => [c.id, c]));
  const blocks = records.map((record) => {
    const client = clientMap.get(record.client_id);
    if (!client) return "";
    return renderFamilyRecord(client, record);
  }).join("");

  app.innerHTML = `
    <section>
      <div class="dashboard-head">
        <div>
          <h2>ご家族・ご本人画面</h2>
          <p>${escapeHtml(state.profile.display_name)} / 確定済みの連絡帳だけが表示されます。</p>
        </div>
      </div>
      <div class="panel">
        ${blocks || `<div class="empty">公開済みの連絡帳はまだありません。</div>`}
      </div>
    </section>
  `;
}

function renderFamilyRecord(client, record) {
  const attendanceLabel = record.attendance === "absent" ? "欠席" : "来所";
  const vitals = record.attendance === "absent" ? "" : `
    <dl class="vitals">
      <div class="vital"><dt>血圧</dt><dd>${escapeHtml(record.bp_systolic ?? "-")} / ${escapeHtml(record.bp_diastolic ?? "-")}</dd></div>
      <div class="vital"><dt>脈拍</dt><dd>${escapeHtml(record.pulse ?? "-")}</dd></div>
      <div class="vital"><dt>体温</dt><dd>${escapeHtml(record.temperature ?? "-")} ℃</dd></div>
    </dl>`;

  const absence = record.attendance === "absent" && record.absence_reason
    ? `<div class="notice" style="margin-top:12px">欠席理由：${escapeHtml(record.absence_reason)}</div>`
    : "";

  return `
    <article class="family-record">
      <p class="record-date">${escapeHtml(prettyDate(record.record_date))}</p>
      <p><strong>${escapeHtml(client.display_name)}</strong>　${attendanceLabel}</p>
      ${vitals}
      ${absence}
      ${record.message ? `<div class="message-box">${escapeHtml(record.message)}</div>` : ""}
    </article>
  `;
}

logoutButton.addEventListener("click", async () => {
  await supabase.auth.signOut();
  state.session = null;
  state.profile = null;
  renderAuth("ログアウトしました。");
});

supabase.auth.onAuthStateChange((event) => {
  if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "USER_UPDATED") {
    bootstrap();
  }
  if (event === "SIGNED_OUT") {
    renderAuth("ログアウトしました。");
  }
});

bootstrap();
