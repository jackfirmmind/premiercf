// Premier website admin: add, edit, hide and delete deals.
(async () => {
  const $ = s => document.querySelector(s);
  const { card, SECTORS, pad, esc, outcomeOf } = window.PremierCard;
  let DEMO = false, deals = [], editingId = null;

  const LABELS = {
    sale:        { business: "Business we advised", counter: "Buyer", hint: "The company that bought the business.", required: false },
    acquisition: { business: "Our client (the buyer)", counter: "Business acquired", hint: "The company our client bought.", required: true },
    mbo:         { business: "Business bought by its management", counter: null },
    fundraise:   { business: "Business that raised funding", counter: "Investor", hint: "The investor that provided the funding.", required: true }
  };

  // ---------- Toast ----------
  let toastTimer;
  const toast = (msg, state = "ok") => {
    const t = $("[data-toast]"); t.textContent = msg; t.dataset.state = state; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.hidden = true, 3500);
  };

  // ---------- Data layer (files on the web server, through api.php) ----------
  let csrf = null;
  const call = async (action, payload) => {
    const opts = payload === undefined
      ? { credentials: "same-origin" }
      : { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf || "" }, body: JSON.stringify(payload) };
    const res = await fetch(`api.php?action=${action}`, opts);
    let data; try { data = await res.json(); } catch { throw new Error("NOT_JSON"); }
    if (!data.ok) { const err = new Error(data.error || "Error"); err.status = res.status; throw err; }
    return data;
  };
  const api = {
    async list() {
      if (DEMO) return deals;
      return (await call("list")).deals;
    },
    async save(row) {
      if (DEMO) {
        if (row.id) deals = deals.map(d => d.id === row.id ? { ...d, ...row } : d);
        else deals = [...deals, { ...row, id: "demo-" + Date.now() }];
        return;
      }
      await call("save", { deal: row });
    },
    async remove(id) {
      if (DEMO) { deals = deals.filter(d => d.id !== id); return; }
      await call("delete", { id });
    }
  };
  const friendly = e => {
    if (e && e.status === 401) { setTimeout(showLogin, 1200); return "You have been signed out. Please sign in again."; }
    if (e && e.status && e.message) return e.message;
    if (e && /Failed to fetch|NetworkError|NOT_JSON/i.test(e.message || "")) return "The website server could not be reached. Check your internet connection and try again.";
    return "The change was not saved. Try again. If it keeps failing, contact the website manager.";
  };

  // ---------- Form ----------
  const form = $("[data-deal-form]");
  const sectorSel = form.sector;
  sectorSel.innerHTML = Object.entries(SECTORS).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join("");
  const nextNo = () => (deals.reduce((m, d) => Math.max(m, d.no), 0) + 1);

  const applyType = () => {
    const type = new FormData(form).get("type");
    const L = LABELS[type];
    $("[data-business-label]").textContent = L.business;
    const cf = $("[data-counter-field]");
    cf.hidden = !L.counter;
    if (L.counter) {
      $("[data-counter-label]").innerHTML = L.counter + (L.required ? "" : ' <span class="opt">(optional)</span>');
      $("[data-counter-hint]").textContent = L.hint;
      form.counterparty.required = !!L.required;
    } else { form.counterparty.required = false; }
    renderPreview();
  };

  const readForm = () => {
    const fd = new FormData(form);
    const type = fd.get("type");
    return {
      id: fd.get("deal_id") || undefined,
      type,
      business: (fd.get("business") || "").trim(),
      counterparty: type === "mbo" ? null : ((fd.get("counterparty") || "").trim() || null),
      sector: fd.get("sector"),
      year: fd.get("year") ? parseInt(fd.get("year"), 10) : null,
      no: parseInt(fd.get("no"), 10) || nextNo(),
      published: !!fd.get("published")
    };
  };

  const renderPreview = () => {
    const d = readForm();
    const shown = { ...d, business: d.business || "Business name", counterparty: d.type === "mbo" ? null : (d.counterparty || (LABELS[d.type].required ? LABELS[d.type].counter : null)) };
    const box = $("[data-preview]");
    box.innerHTML = card(shown, 1);
    drawBands(box);
  };

  const resetForm = () => {
    editingId = null;
    form.reset();
    form.elements.deal_id.value = "";
    form.no.value = nextNo();
    $("[data-form-title]").textContent = "Add a new deal";
    $("[data-save]").textContent = "Save deal";
    $("[data-cancel]").hidden = true;
    form.querySelectorAll("[aria-invalid]").forEach(i => i.removeAttribute("aria-invalid"));
    $("[data-form-status]").textContent = "";
    applyType(); renderRows();
  };

  const startEdit = id => {
    const d = deals.find(x => x.id === id); if (!d) return;
    editingId = id;
    form.elements.deal_id.value = d.id;
    form.querySelector(`input[name="type"][value="${d.type}"]`).checked = true;
    form.business.value = d.business;
    form.counterparty.value = d.counterparty || "";
    form.sector.value = d.sector;
    form.year.value = d.year || "";
    form.no.value = d.no;
    form.published.checked = d.published !== false;
    $("[data-form-title]").textContent = `Edit deal No. ${pad(d.no)}`;
    $("[data-save]").textContent = "Save changes";
    $("[data-cancel]").hidden = false;
    applyType(); renderRows();
    form.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    form.business.focus({ preventScroll: true });
  };

  form.addEventListener("change", e => { if (e.target.name === "type") applyType(); else renderPreview(); });
  form.addEventListener("input", renderPreview);
  form.querySelectorAll("input[required], input[pattern]").forEach(i => {
    i.addEventListener("blur", () => i.setAttribute("aria-invalid", !i.checkValidity()));
  });
  $("[data-cancel]").addEventListener("click", resetForm);

  form.addEventListener("submit", async e => {
    e.preventDefault();
    const status = $("[data-form-status]");
    const inputs = [...form.querySelectorAll("input[required], input[pattern]")].filter(i => !i.closest("[hidden]"));
    inputs.forEach(i => i.setAttribute("aria-invalid", !i.checkValidity()));
    const bad = inputs.find(i => !i.checkValidity());
    if (bad) { status.dataset.state = "error"; status.textContent = "Check the highlighted fields."; bad.focus(); return; }
    const row = readForm();
    if (deals.some(d => d.no === row.no && d.id !== row.id)) {
      status.dataset.state = "error"; status.textContent = `Deal number ${row.no} is already used. Choose another number.`;
      form.no.setAttribute("aria-invalid", "true"); form.no.focus(); return;
    }
    const btn = $("[data-save]"); btn.disabled = true; btn.textContent = "Saving…";
    try {
      await api.save(row);
      deals = await api.list();
      toast(row.id ? "Changes saved." : "Deal saved. It is now on the website.");
      resetForm();
    } catch (err) {
      status.dataset.state = "error"; status.textContent = friendly(err);
    } finally { btn.disabled = false; if (btn.textContent === "Saving…") btn.textContent = editingId ? "Save changes" : "Save deal"; }
  });

  // ---------- List ----------
  const renderRows = () => {
    const q = ($("[data-search]").value || "").trim().toLowerCase();
    const list = deals.slice().sort((a, b) => b.no - a.no)
      .filter(d => !q || (d.business + " " + (d.counterparty || "")).toLowerCase().includes(q));
    $("[data-total]").textContent = `(${deals.length})`;
    $("[data-rows]").innerHTML = list.map(d => `
      <tr class="${d.id === editingId ? "is-editing" : ""}">
        <td class="no">${pad(d.no)}</td>
        <td class="biz">${esc(d.business)}</td>
        <td>${esc(outcomeOf(d))}</td>
        <td>${d.published === false ? '<span class="pill pill--hidden">Hidden</span>' : '<span class="pill pill--live">On website</span>'}</td>
        <td><div class="row-actions">
          <button type="button" data-act="edit" data-id="${d.id}">Edit<span class="visually-hidden"> ${esc(d.business)}</span></button>
          <button type="button" data-act="toggle" data-id="${d.id}">${d.published === false ? "Show" : "Hide"}<span class="visually-hidden"> ${esc(d.business)}</span></button>
          <button type="button" class="danger" data-act="delete" data-id="${d.id}">Delete<span class="visually-hidden"> ${esc(d.business)}</span></button>
        </div></td>
      </tr>`).join("") || `<tr><td colspan="5">No deals match your search.</td></tr>`;
  };
  $("[data-search]").addEventListener("input", renderRows);

  const dlg = $("[data-confirm]");
  let pendingDelete = null;
  $("[data-rows]").addEventListener("click", async e => {
    const b = e.target.closest("button[data-act]"); if (!b) return;
    const d = deals.find(x => x.id === b.dataset.id); if (!d) return;
    if (b.dataset.act === "edit") startEdit(d.id);
    if (b.dataset.act === "toggle") {
      try { await api.save({ ...d, published: d.published === false }); deals = await api.list(); renderRows();
        toast(d.published === false ? "Deal is now on the website." : "Deal hidden from the website."); }
      catch (err) { toast(friendly(err), "error"); }
    }
    if (b.dataset.act === "delete") {
      pendingDelete = { id: d.id, trigger: b };
      $("[data-confirm-text]").textContent = `${d.business} (No. ${pad(d.no)}) will be removed from the website and the database. To keep it but hide it, choose Hide instead.`;
      dlg.showModal();
      $("[data-confirm-no]").focus();
    }
  });
  $("[data-confirm-no]").addEventListener("click", () => dlg.close());
  dlg.addEventListener("close", () => { if (pendingDelete && pendingDelete.trigger.isConnected) pendingDelete.trigger.focus(); });
  $("[data-confirm-yes]").addEventListener("click", async () => {
    const id = pendingDelete && pendingDelete.id; dlg.close(); if (!id) return;
    try { await api.remove(id); deals = await api.list(); if (editingId === id) resetForm(); else renderRows(); toast("Deal deleted."); }
    catch (err) { toast(friendly(err), "error"); }
    pendingDelete = null;
  });

  // ---------- Sign in and start ----------
  const showApp = async () => {
    $("[data-login]").hidden = true;
    $("[data-app]").hidden = false;
    $("[data-signed-in]").hidden = false;
    try { deals = await api.list(); } catch (err) { toast(friendly(err), "error"); }
    resetForm();
  };
  const showLogin = () => {
    $("[data-app]").hidden = true; $("[data-signed-in]").hidden = true; $("[data-login]").hidden = false;
    $("#l-pass").value = ""; $("#l-pass").focus();
  };

  // Change password dialog
  const pwDlg = $("[data-pw-dialog]"), pwForm = $("[data-pw-form]");
  $("[data-change-pw]").addEventListener("click", () => { pwForm.reset(); $("[data-pw-status]").textContent = ""; pwDlg.showModal(); $("#p-cur").focus(); });
  $("[data-pw-cancel]").addEventListener("click", () => pwDlg.close());
  pwDlg.addEventListener("close", () => $("[data-change-pw]").focus());
  pwForm.addEventListener("submit", async e => {
    e.preventDefault();
    const st = $("[data-pw-status]");
    if (!pwForm.checkValidity()) { st.dataset.state = "error"; st.textContent = "Fill in both boxes. The new password needs at least 10 characters."; return; }
    if (DEMO) { st.dataset.state = "error"; st.textContent = "Passwords can only be changed on the live website."; return; }
    try { await call("password", { current: pwForm.current.value, new: pwForm.new.value }); pwDlg.close(); toast("Password changed."); }
    catch (err) { st.dataset.state = "error"; st.textContent = friendly(err); }
  });

  $("[data-login-form]").addEventListener("submit", async e => {
    e.preventDefault();
    const f = e.target, st = $("[data-login-status]");
    if (DEMO) { showApp(); return; }
    if (!f.checkValidity()) { st.dataset.state = "error"; st.textContent = "Enter the password."; return; }
    st.dataset.state = ""; st.textContent = "Signing in…";
    try { const r = await call("login", { password: f.password.value }); csrf = r.csrf; st.textContent = ""; showApp(); }
    catch (err) { st.dataset.state = "error"; st.textContent = err.status ? err.message : friendly(err); }
  });
  $("[data-signout]").addEventListener("click", async () => {
    if (!DEMO) { try { await call("logout", {}); } catch {} csrf = null; }
    showLogin();
  });

  // Decide: live server, or preview mode (opened as a file, or no PHP)
  let session = null;
  try { session = await call("session"); } catch { session = null; }
  if (!session) {
    DEMO = true;
    $("[data-demo]").hidden = false;
    try { deals = JSON.parse(document.getElementById("deals-data").textContent).map(d => ({ ...d, id: "demo-" + d.no, published: true })); } catch { deals = []; }
    showApp();
    return;
  }
  if (!session.setup) { $("[data-login-form]").hidden = true; $("[data-setup-needed]").hidden = false; $("[data-login]").hidden = false; return; }
  if (session.signedIn) { csrf = session.csrf; showApp(); } else showLogin();
})();
