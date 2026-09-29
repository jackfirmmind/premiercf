/* Premier Corporate Finance - site script */
// Guilloche band drawing (reused after any re-render)
const BAND_CACHE = {};
function drawBands(root){
  root.querySelectorAll("[data-band]").forEach(svg => {
    if (svg.firstChild) return;
    const vb = svg.viewBox.baseVal, w = vb.width, h = vb.height, n = +svg.dataset.band || 8;
    const key = w + "x" + h + "x" + n;
    if (!BAND_CACHE[key]) {
      let d = "";
      for (let k = 0; k < n; k++) {
        const ph = k * 2 * Math.PI / n;
        for (let x = 0; x <= w; x += 2) {
          const t = 2 * Math.PI * x / 60;
          const y = h / 2 + h * .3 * Math.sin(t + ph) + h * .14 * Math.sin(3 * t - 2 * ph);
          d += (x === 0 ? "M" : "L") + x + "," + y.toFixed(2);
        }
      }
      BAND_CACHE[key] = d;
    }
    const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p.setAttribute("d", BAND_CACHE[key]); svg.appendChild(p);
  });
}

// Seal rosette drawing (reused after re-render)
function drawRosettes(root){
  root.querySelectorAll("[data-rosette]").forEach(ros => {
    if (ros.getAttribute("d")) return;
    let d = "";
    for (let k = 0; k < 6; k++) {
      const ph = k * Math.PI / 54;
      for (let i = 0; i <= 720; i++) {
        const t = 2 * Math.PI * i / 720;
        const r = 30 + 5.5 * Math.sin(18 * t + ph * 18) + 2 * Math.sin(54 * t);
        d += (i === 0 ? "M" : "L") + (60 + r * Math.cos(t)).toFixed(2) + "," + (60 + r * Math.sin(t)).toFixed(2);
      }
      d += "Z";
    }
    ros.setAttribute("d", d);
  });
}

// DEALS: renders every deal-driven part of the site.
// 1. Renders at once from the deals list embedded in the page (fast, works without the database).
// 2. Then loads the live list from the admin database (Supabase) and re-renders if it changed.
(() => {
  const SECTORS = {
    tic: "Testing, inspection and certification",
    ndt: "Non-destructive testing",
    env: "Environmental and compliance",
    construction: "Construction and infrastructure",
    fm: "Facilities management",
    life: "Life sciences and healthcare",
    mfg: "Manufacturing and wholesale",
    other: "Other sectors"
  };
  const SECTOR_LINKS = {
    tic: "/sectors/#testing-inspection-certification",
    ndt: "/sectors/#non-destructive-testing",
    env: "/sectors/#environmental-and-compliance",
    construction: "/sectors/#construction-and-infrastructure",
    fm: "/sectors/#facilities-management",
    life: "/sectors/#life-sciences-healthcare",
    mfg: "/sectors/#manufacturing-wholesale",
    other: "/deals/?sector=other"
  };
  const ROLE = {sale:"Adviser to the shareholders", acquisition:"Adviser to the buyer", mbo:"Adviser to the management team", fundraise:"Adviser on the funding round"};
  const TYPE = {sale:"Sale", acquisition:"Acquisition", mbo:"Buy-out", fundraise:"Funding"};
  const LEAD_BUYERS = ["SGS","Intertek","Applus+","SOCOTEC","Veolia","Mistras Group","Phenna Group","Celnor","Certek"];
  const SHOW = 12, PAGE = 12;
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const pad = n => String(n).padStart(3, "0");
  const bindAll = (key, fn) => document.querySelectorAll(`[data-bind="${key}"]`).forEach(fn);
  const verbFor = d => ({sale: d.counterparty ? "sold to" : "sold", acquisition:"acquired", mbo:"management buy-out", fundraise:"funded by"}[d.type]);
  const outcomeOf = d => d.type === "mbo" ? "Management buy-out"
    : d.type === "acquisition" ? "Acquired " + d.counterparty
    : d.type === "fundraise" ? "Funded by " + d.counterparty
    : d.counterparty ? "Sold to " + d.counterparty : "Sold";
  const sealSvg = () => `<div class="seal" aria-hidden="true"><svg viewBox="0 0 120 120"><defs><path id="seal-ring" d="M60,60 m-47,0 a47,47 0 1,1 94,0 a47,47 0 1,1 -94,0"/></defs><text><textPath href="#seal-ring">PREMIER CORPORATE FINANCE ✦ LATEST ✦</textPath></text><path class="ros" data-rosette d=""/><circle class="core" cx="60" cy="60" r="19"/><text class="core-text" x="60" y="64">P</text></svg></div>`;
  const card = (d, i) => `
    <article class="tomb${i === 0 ? " tomb--latest" : ""}" aria-label="Deal ${pad(d.no)}: ${esc(d.business)}">
      <div class="tomb-frame">
        <div class="tomb-top"><span>No. ${pad(d.no)}</span><span>${TYPE[d.type] || ""}${d.year ? ", " + esc(d.year) : ""}</span></div>
        <div class="tomb-parties">
          <p class="tomb-party">${esc(d.business)}</p>
          <p class="tomb-verb">${verbFor(d)}</p>
          ${d.counterparty && d.type !== "mbo" ? `<p class="tomb-party">${esc(d.counterparty)}</p>` : ""}
        </div>
        <p class="tomb-meta">${esc(SECTORS[d.sector] || "")}<span>${ROLE[d.type] || ""}</span></p>
      </div>
    </article>`;
  window.PremierCard = { card, SECTORS, TYPE, ROLE, pad, esc, outcomeOf };

  let deals = [];
  const setDeals = list => { deals = list.filter(d => d && d.business).slice().sort((a, b) => b.no - a.no); };
  try { setDeals(JSON.parse(document.getElementById("deals-data").textContent)); } catch (e) { return; }

  // ---- Elements and one-time setup ----
  const track = document.querySelector("[data-track]");
  const prev = document.querySelector("[data-prev]");
  const next = document.querySelector("[data-next]");
  const countEl = document.querySelector("[data-deals-count]");
  let updateCarousel = () => {};
  if (track && prev && next) {
    const items = () => [...track.children].filter(c => c.matches(".tomb,.tomb-all"));
    const step = () => { const it = items()[0]; return it ? it.getBoundingClientRect().width + 24 : 300; };
    updateCarousel = () => {
      const max = track.scrollWidth - track.clientWidth - 2;
      prev.disabled = track.scrollLeft <= 2;
      next.disabled = track.scrollLeft >= max;
      const first = Math.round(track.scrollLeft / step()) + 1;
      const visible = Math.max(1, Math.floor((track.clientWidth - 40) / step()));
      const total = Math.min(SHOW, deals.length);
      const last = Math.min(total, first + visible - 1);
      if (countEl) countEl.textContent = first > total ? `All ${deals.length}` : (first === last ? `${first} of ${deals.length}` : `${first}–${last} of ${deals.length}`);
    };
    let raf;
    track.addEventListener("scroll", () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(updateCarousel); }, {passive:true});
    window.addEventListener("resize", updateCarousel);
    const smooth = matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
    prev.addEventListener("click", () => track.scrollBy({left: -step(), behavior: smooth}));
    next.addEventListener("click", () => track.scrollBy({left: step(), behavior: smooth}));
  }

  // Deal browser (Deals page)
  const browser = document.querySelector("[data-deal-browser]");
  let renderBrowser = () => {};
  if (browser) {
    const form = browser.querySelector("[data-filters]");
    const out = browser.querySelector("[data-results]");
    const list = browser.querySelector("[data-results-list]");
    const status = browser.querySelector("[data-result-count]");
    const empty = browser.querySelector("[data-empty]");
    const more = browser.querySelector("[data-more]");
    const secWrap = form.querySelector("[data-sector-options]");
    let shown = PAGE, firstRun = true;
    const buildSectors = () => {
      const current = new FormData(form).get("sector") || "";
      const sc = {}; deals.forEach(d => sc[d.sector] = (sc[d.sector] || 0) + 1);
      secWrap.innerHTML = `<label><input type="radio" name="sector" value=""${current ? "" : " checked"}> All sectors</label>` +
        Object.keys(SECTORS).filter(k => sc[k]).map(k => `<label><input type="radio" name="sector" value="${k}"${current === k ? " checked" : ""}> ${esc(SECTORS[k])} <span class="n">${sc[k]}</span></label>`).join("");
    };
    const render = (reset = true) => {
      if (reset) shown = PAGE;
      const fd = new FormData(form);
      const sector = fd.get("sector") || "", type = fd.get("type") || "", view = fd.get("view") || "cards";
      const q = (fd.get("q") || "").trim().toLowerCase();
      const res = deals.filter(d => (!sector || d.sector === sector) && (!type || d.type === type) &&
        (!q || (d.business + " " + (d.counterparty || "")).toLowerCase().includes(q)));
      status.textContent = res.length === deals.length ? `Showing all ${deals.length} transactions` : `Showing ${res.length} of ${deals.length} transactions`;
      empty.hidden = res.length > 0;
      out.hidden = view !== "cards" || !res.length;
      list.hidden = view !== "list" || !res.length;
      more.hidden = view !== "cards" || res.length <= shown;
      more.textContent = `Show ${Math.min(PAGE, Math.max(0, res.length - shown))} more`;
      if (view === "cards") { out.innerHTML = res.slice(0, shown).map(d => card(d, 1)).join(""); drawBands(out); }
      else {
        list.querySelector("tbody").innerHTML = res.map(d => `<tr>
          <td class="no">${pad(d.no)}</td><td class="biz">${esc(d.business)}</td>
          <td>${esc(outcomeOf(d))}</td><td class="sec">${esc(SECTORS[d.sector] || "")}</td></tr>`).join("");
      }
      const p = new URLSearchParams();
      if (sector) p.set("sector", sector); if (type) p.set("type", type); if (view !== "cards") p.set("view", view); if (q) p.set("q", q);
      history.replaceState(null, "", location.pathname + (p.toString() ? "?" + p : "") + location.hash);
    };
    renderBrowser = () => {
      buildSectors();
      if (firstRun) {
        const params = new URLSearchParams(location.search);
        ["sector","type","view"].forEach(k => { const v = params.get(k); if (v) { const r = form.querySelector(`input[name="${k}"][value="${CSS.escape(v)}"]`); if (r) r.checked = true; } });
        if (params.get("q")) form.q.value = params.get("q");
        firstRun = false;
      }
      render(false);
    };
    form.addEventListener("change", () => render());
    form.addEventListener("input", e => { if (e.target.name === "q") render(); });
    form.addEventListener("submit", e => e.preventDefault());
    more.addEventListener("click", () => {
      const before = out.children.length; shown += PAGE; render(false);
      const nextCard = out.children[before]; if (nextCard) { nextCard.setAttribute("tabindex", "-1"); nextCard.focus(); }
    });
    browser.querySelectorAll("[data-clear]").forEach(b => b.addEventListener("click", () => {
      form.reset(); form.q.value = ""; buildSectors(); render(); form.querySelector('input[name="sector"]').focus();
    }));
  }

  // ---- Render everything from the current list ----
  function renderAll(){
    bindAll("deal-count", el => el.textContent = deals.length);

    if (track) {
      track.innerHTML = deals.slice(0, SHOW).map(card).join("") +
        `<a class="tomb-all" href="/deals/"><strong>All ${deals.length} transactions</strong><span>Filter by sector and deal type</span></a>`;
    }
    document.querySelectorAll("[data-deal-grid]").forEach(grid => {
      const types = (grid.dataset.type || "").split(",").filter(Boolean);
      const secs = (grid.dataset.sectors || "").split(",").filter(Boolean);
      const limit = +grid.dataset.limit || 3;
      grid.innerHTML = deals.filter(d => (!types.length || types.includes(d.type)) && (!secs.length || secs.includes(d.sector))).slice(0, limit).map(d => card(d, 1)).join("");
    });
    document.querySelectorAll("[data-sector-deals]").forEach(ul => {
      const keys = ul.dataset.sectorDeals.split(","), n = +ul.dataset.limit || 3;
      ul.innerHTML = deals.filter(d => keys.includes(d.sector)).slice(0, n).map(d =>
        `<li><span class="b">${esc(d.business)}</span><span class="o">${esc(outcomeOf(d))}</span></li>`).join("");
    });
    document.querySelectorAll("[data-sector-count]").forEach(el => {
      const keys = el.dataset.sectorCount.split(","); const n = deals.filter(d => keys.includes(d.sector)).length;
      el.textContent = n + (n === 1 ? " transaction" : " transactions");
    });
    document.querySelectorAll("[data-sector-buyers]").forEach(ul => {
      const keys = ul.dataset.sectorBuyers.split(",");
      const names = [...new Set(deals.filter(d => keys.includes(d.sector) && d.type === "sale" && d.counterparty).map(d => d.counterparty))];
      names.sort((x, y) => (LEAD_BUYERS.includes(y) - LEAD_BUYERS.includes(x)) || (LEAD_BUYERS.indexOf(x) - LEAD_BUYERS.indexOf(y)));
      ul.innerHTML = names.map(b => `<li>${esc(b)}</li>`).join("");
    });
    const counts = {}; deals.forEach(d => counts[d.sector] = (counts[d.sector] || 0) + 1);
    bindAll("sectors", el => el.innerHTML = Object.keys(SECTORS).map(k => `
      <li class="${k === "tic" ? "lead" : ""}"><a href="${SECTOR_LINKS[k]}">
        <span class="name">${esc(SECTORS[k])}</span>
        <span class="count">${counts[k] || 0} ${counts[k] === 1 ? "deal" : "deals"}</span>
      </a></li>`).join(""));
    const tc = {}; deals.forEach(d => tc[d.type] = (tc[d.type] || 0) + 1);
    bindAll("count-sale", el => el.textContent = tc.sale || 0);
    bindAll("count-mbo", el => el.textContent = tc.mbo || 0);
    bindAll("count-acq", el => el.textContent = (tc.acquisition || 0) + (tc.fundraise || 0));

    renderBrowser();
    drawBands(document);
    drawRosettes(document);
    updateCarousel();
  }

  renderAll();
  bindAll("year", el => el.textContent = new Date().getFullYear());

  // ---- Live list saved by the admin page (a file on this web server) ----
  const cfg = window.PREMIER_CONFIG || {};
  if (cfg.dealsUrl && location.protocol.startsWith("http")) {
    fetch(cfg.dealsUrl, { cache: "no-cache" })
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(live => {
        if (!Array.isArray(live) || !live.length) return;
        const key = list => JSON.stringify(list.map(d => [d.no, d.business, d.counterparty ?? null, d.type, d.sector, d.year ?? null]));
        const sorted = live.slice().sort((a, b) => b.no - a.no);
        if (key(sorted) === key(deals)) return;
        setDeals(live); renderAll();
      })
      .catch(() => { /* Keep the list built into the page. */ });
  }
})();

// Engraving: guilloche bands, seal rosette, hero rosette
(() => {
  const NS = "http://www.w3.org/2000/svg";
  drawBands(document);
  drawRosettes(document);

  const art = document.querySelector("[data-hero-art]");
  if (!art) return;
  const svg = art.querySelector("svg");
  const C = 400;
  const families = [
    {cls:"f1", copies:12, base:360, a:22, fa:40, b:6, fb:120, steps:2400},
    {cls:"f2", copies:10, base:285, a:30, fa:28, b:8, fb:84,  steps:2000},
    {cls:"f3", copies:9,  base:200, a:34, fa:20, b:7, fb:60,  steps:1600},
    {cls:"f4", copies:8,  base:118, a:24, fa:14, b:5, fb:42,  steps:1200}
  ];
  families.forEach((f, fi) => {
    for (let k = 0; k < f.copies; k++) {
      const ph = k * 2 * Math.PI / (f.copies * f.fa);
      let d = "";
      for (let i = 0; i <= f.steps; i++) {
        const t = 2 * Math.PI * i / f.steps;
        const r = f.base + f.a * Math.sin(f.fa * (t + ph)) + f.b * Math.sin(f.fb * (t - ph));
        d += (i === 0 ? "M" : "L") + (C + r * Math.cos(t)).toFixed(1) + "," + (C + r * Math.sin(t)).toFixed(1);
      }
      const p = document.createElementNS(NS, "path");
      p.setAttribute("d", d + "Z");
      p.setAttribute("class", f.cls);
      p.style.setProperty("--delay", (fi * .28 + k * .04).toFixed(2) + "s");
      svg.appendChild(p);
    }
  });
  if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
    svg.querySelectorAll("path").forEach(p => p.style.setProperty("--len", Math.ceil(p.getTotalLength())));
    art.classList.add("is-drawing");
  }
})();

// Header state on scroll
(() => {
  const h = document.querySelector("[data-header]");
  if (!h) return;
  const set = () => h.dataset.scrolled = window.scrollY > 24;
  set(); window.addEventListener("scroll", set, {passive:true});
})();

// Mobile navigation
(() => {
  const btn = document.querySelector(".nav-toggle");
  const nav = document.getElementById("site-nav");
  if (!btn || !nav) return;
  const set = open => { btn.setAttribute("aria-expanded", open); nav.dataset.open = open; btn.textContent = open ? "Close" : "Menu"; };
  btn.addEventListener("click", () => set(btn.getAttribute("aria-expanded") !== "true"));
  nav.addEventListener("click", e => { if (e.target.closest("a")) set(false); });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && btn.getAttribute("aria-expanded") === "true") { set(false); btn.focus(); } });
})();

// Valuation form (Formspree)
(() => {
  const form = document.querySelector("[data-form]");
  const formEndpoint = (window.PREMIER_CONFIG || {}).formEndpoint;
  if (form && formEndpoint) form.action = formEndpoint;
  if (!form) return;
  const status = form.querySelector("[data-status]");
  const btn = form.querySelector('button[type="submit"]');
  form.querySelectorAll("input[required]").forEach(input => {
    const sync = () => input.setAttribute("aria-invalid", input.matches(":user-invalid"));
    input.addEventListener("blur", sync);
    input.addEventListener("input", () => { if (input.getAttribute("aria-invalid") === "true") sync(); });
  });
  form.addEventListener("submit", async e => {
    e.preventDefault();
    if (!form.checkValidity()) {
      form.querySelectorAll("input[required]").forEach(i => i.setAttribute("aria-invalid", !i.checkValidity()));
      status.dataset.state = "error";
      status.textContent = "Check the highlighted fields and try again.";
      const first = form.querySelector(":invalid"); first && first.focus();
      return;
    }
    if (form.action.includes("YOUR_FORM_ID")) {
      status.dataset.state = "error";
      status.textContent = "The form is not connected yet. Call 01727 851483 or email brendan@premiercf.co.uk.";
      return;
    }
    btn.disabled = true; btn.textContent = "Sending…";
    try {
      const res = await fetch(form.action, { method: "POST", body: new FormData(form), headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error();
      form.reset();
      status.dataset.state = "ok";
      status.textContent = "Request sent. A partner will call you within two working days.";
      btn.textContent = "Request sent";
    } catch {
      status.dataset.state = "error";
      status.textContent = "The request did not send. Call 01727 851483 or email brendan@premiercf.co.uk.";
      btn.disabled = false; btn.textContent = "Request a valuation call";
    }
  });
})();
// News filter (Insights page)
(() => {
  const form = document.querySelector("[data-post-filter]");
  const list = document.querySelector("[data-post-list]");
  if (!form || !list) return;
  form.addEventListener("change", () => {
    const cat = new FormData(form).get("cat") || "";
    list.querySelectorAll("li").forEach(li => li.hidden = !!cat && li.dataset.cat !== cat);
  });
})();

// Table of contents: mark the section in view (Article pages)
(() => {
  const links = [...document.querySelectorAll(".toc a")];
  if (!links.length || !("IntersectionObserver" in window)) return;
  const map = new Map(links.map(a => [document.querySelector(a.getAttribute("href")), a]));
  const io = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        links.forEach(l => l.removeAttribute("aria-current"));
        map.get(e.target)?.setAttribute("aria-current", "true");
      }
    });
  }, {rootMargin: "-20% 0px -70% 0px"});
  map.forEach((a, h) => h && io.observe(h));
})();
