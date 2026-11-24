/* CertiGuard - Web interface / application controller.
   All user-supplied or OCR-derived text is escaped (esc) before it is placed in the page. */
(function () {
  "use strict";
  const { Store, Auth, OCR, ELA, Tamper, Scoring } = CG;
  const $ = s => document.querySelector(s);
  const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const MAX = 10 * 1024 * 1024;
  const SAMPLES = [
    ["samples/sample-1-genuine-TUT-2026-10482.jpg", "Sample 1: genuine certificate (record exists)"],
    ["samples/sample-2-altered-name-UL-2025-77821.jpg", "Sample 2: altered name (edited after scanning)"],
    ["samples/sample-3-unknown-institution-KTI-2025-20931.jpg", "Sample 3: institution not in records"],
    ["samples/sample-4-genuine-UJ-2024-33105.pdf", "Sample 4: genuine certificate as PDF"],
    ["samples/sample-5-conference-participation.jpg", "Sample 5: conference certificate (not a qualification)"],
    ["samples/sample-6-academic-no-number.jpg", "Sample 6: diploma with no certificate number"]
  ];
  let S = fresh("login");
  function fresh(view) { return { view, file: null, info: null, prep: null, ocr: null, fields: null, corrected: [], errs: {}, msg: "", prog: 0, stage: 0, res: null, showEla: false, auditCheck: null }; }
  if (Auth.session()) S.view = "dashboard";

  // ---------- helpers ----------
  const hexOf = buf => [...new Uint8Array(buf)].map(x => x.toString(16).padStart(2, "0")).join("");
  async function sniff(file) {
    const b = new Uint8Array(await file.slice(0, 8).arrayBuffer());
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return "png";
    if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return "jpg";
    if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return "pdf";
    return null;
  }
  async function validateFile(file) {
    if (!file) return "Choose a certificate file first.";
    if (!/\.(jpe?g|png|pdf)$/i.test(file.name)) return "Unsupported file type. Use JPG, PNG or PDF.";
    if (file.size === 0) return "The file is empty.";
    if (file.size > MAX) return "File too large (" + (file.size / 1048576).toFixed(1) + " MB). The limit is 10 MB.";
    const kind = await sniff(file);
    if (!kind) return "The file content is not a real JPG, PNG or PDF (the extension does not match its content).";
    return { kind };
  }
  async function prepare(file, kind) {
    if (kind === "pdf") {
      pdfjsLib.GlobalWorkerOptions.workerSrc = "vendor/pdf/pdf.worker.min.js";
      const doc = await pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
      const blobs = []; let first = null; const n = Math.min(doc.numPages, 3); // first three pages are read
      for (let i = 1; i <= n; i++) {
        const page = await doc.getPage(i); const vp = page.getViewport({ scale: 3 });
        const c = document.createElement("canvas"); c.width = vp.width; c.height = vp.height;
        await page.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
        const blob = await new Promise(r => c.toBlob(r, "image/png")); blobs.push(blob); if (!first) first = { w: c.width, h: c.height };
      }
      return { blob: blobs[0], blobs, pages: doc.numPages, w: first.w, h: first.h, pdf: true };
    }
    const bmp = await createImageBitmap(file); const s = Math.min(1, 2600 / Math.max(bmp.width, bmp.height));
    if (s === 1) return { blob: file, w: bmp.width, h: bmp.height, pdf: false };
    const c = document.createElement("canvas"); c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    return { blob: await new Promise(r => c.toBlob(r, "image/png")), w: c.width, h: c.height, pdf: false };
  }
  function validateFields(f) {
    const e = {}; const has = k => f[k].trim() !== ""; // a field may be empty ("Not available"); a value that is present must be valid
    if (has("name") && !/^[A-Za-z][A-Za-z' .\-]{1,79}$/.test(f.name.trim())) e.name = "Enter the student name (letters, spaces, - ' only; 2-80 characters).";
    if (has("number") && !/^[A-Za-z0-9][A-Za-z0-9\-\/. ]{2,29}$/.test(f.number.trim())) e.number = "Use letters, digits, - / . only (3-30 characters), or leave empty if the document shows no number.";
    if (has("qualification") && !/^[A-Za-z][A-Za-z&'(). \-]{2,99}$/.test(f.qualification.trim())) e.qualification = "Enter the qualification (3-100 letters).";
    if (has("institution") && !/^[A-Za-z][A-Za-z&'. \-]{2,99}$/.test(f.institution.trim())) e.institution = "Enter the institution (3-100 letters).";
    if (has("date")) {
      const d = OCR.parseDate(f.date.trim());
      if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date.trim()) || !d) e.date = "Use a real date in YYYY-MM-DD format.";
      else if (new Date(f.date) > new Date()) e.date = "The issue date cannot be in the future.";
    }
    return e;
  }
  const badge = c => `<span class="badge ${esc(c.toLowerCase())}">${esc(c)}</span>`;
  const user = () => Auth.session();
  function need(p) { if (!Auth.can(p)) { S.view = Auth.session() ? "dashboard" : "login"; S.msg = Auth.session() ? "You do not have permission to open that page." : ""; render(); return false; } return true; }

  // ---------- views ----------
  function brand() { return `<div class="brand"><svg class="logo" viewBox="0 0 32 36" aria-hidden="true"><path d="M16 1l14 5v10c0 9-6 15.5-14 19C8 31.5 2 25 2 16V6z" fill="#1765e8"/><path d="M10 18l4 4 8-9" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg><div>CertiGuard<div class="tag">Certificate Verification Platform</div></div></div>`; }
  function loginView() {
    return `<div class="login"><section class="hero">${brand()}<h1>Trusted Certificate Verification with Explainable Evidence</h1><p>Prototype that reads a certificate with neural-network OCR, cross-validates it against institution records, scores the fraud risk and shows exactly which evidence drove the decision.</p><div class="checks">✓ Real OCR running in your browser<br>✓ Field-by-field record cross-validation<br>✓ Explainable, additive risk score<br>✓ Role-based access and tamper-evident audit trail</div></section><section class="login-side"><form class="login-card" data-form="login" autocomplete="off"><div class="eyebrow">SECURE ACCESS</div><h2>Welcome back</h2><p class="sub">Sign in to the CertiGuard prototype.</p><label for="email">Email address</label><input id="email" type="email" maxlength="80" required><label for="pw">Password</label><input id="pw" type="password" maxlength="64" required autocomplete="off"><div class="err" id="loginErr" role="alert">${esc(S.msg)}</div><button class="primary wide" type="submit" style="margin-top:16px">Sign in →</button></form></section></div>`;
  }
  // ---------- shared UI pieces (A5 professional interface) ----------
  const ICON = {
    dashboard: '<path d="M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z"/>',
    verify: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>',
    history: '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/><path d="M12 7v5l3 2"/>',
    records: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
    audit: '<path d="M9 4h10v16H5V8z"/><path d="M9 4v4H5M9 13h6M9 17h6"/>',
    system: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
    check: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.7 2.7L16 10"/>',
    alert: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.5"/>',
    x: '<circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/>',
    total: '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 13h7M9 17h5"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    out: '<path d="M10 4H5v16h5M15 8l4 4-4 4M19 12H9"/>'
  };
  const icon = (k, cls = "") => `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICON[k] || ""}</svg>`;
  const outcome = r => r.finalClass || r.classification;
  const initials = n => String(n || "?").split(/\s+/).map(w => w[0]).join("").slice(0, 2).toUpperCase();
  const fmtDate = ts => new Date(ts).toLocaleDateString("en-ZA", { day: "2-digit", month: "short", year: "numeric" });
  const fmtTime = ts => new Date(ts).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" });

  function layout(content, active) {
    const u = user();
    const nav = (v, ic, t, p) => (!p || Auth.can(p)) ? `<div class="nav ${active === v ? "active" : ""}" role="button" tabindex="0" data-act="go" data-v="${v}">${icon(ic)}<span>${t}</span></div>` : "";
    const group = (title, items) => { const h = items.join(""); return h ? `<div class="navgroup">${title}</div>${h}` : ""; };
    return `<header class="top">${brand()}<form class="gsearch" data-form="gsearch" role="search">${icon("search")}<input id="gq" type="search" maxlength="80" placeholder="Search verifications by certificate number, student, institution or reference" aria-label="Search verifications"></form><div class="topright"><span class="online">● ${esc(u.role.toUpperCase())}</span><div class="avatar" title="${esc(u.name)}">${esc(initials(u.name))}</div></div></header>
    <div class="shell"><aside>
      ${group("OVERVIEW", [nav("dashboard", "dashboard", "Dashboard")])}
      ${group("VERIFICATION", [nav("verify", "verify", "Verify Certificate", "verify"), nav("history", "history", "Verification History", "history")])}
      ${group("GOVERNANCE", [nav("records", "records", "Institution Records", "records.read"), nav("audit", "audit", "Audit Trail", "audit")])}
      ${group("SYSTEM", [nav("system", "system", "System Info")])}
      <div class="who"><div class="avatar">${esc(initials(u.name))}</div><div><b>${esc(u.name)}</b><div class="sub sm">${esc(u.email)}</div><button class="link" data-act="logout">Sign out</button></div></div>
    </aside><main class="main">${S.msg ? `<div class="notice" role="alert">${esc(S.msg)}</div>` : ""}${content}</main></div>`;
  }

  // Stacked bars: verifications per day for the last `days` days, split by outcome
  function activityChart(rq, days) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const keys = ["Genuine", "Suspicious", "Forged", "Unsupported"], col = { Genuine: "#12a150", Suspicious: "#e89b00", Forged: "#dc2626", Unsupported: "#94a3b8" };
    const bins = Array.from({ length: days }, (_, i) => { const d = new Date(today); d.setDate(d.getDate() - (days - 1 - i)); return { d, c: { Genuine: 0, Suspicious: 0, Forged: 0, Unsupported: 0 } }; });
    rq.forEach(r => { const d = new Date(r.ts); d.setHours(0, 0, 0, 0); const k = Math.round((d - bins[0].d) / 864e5); if (k >= 0 && k < days) bins[k].c[outcome(r)] = (bins[k].c[outcome(r)] || 0) + 1; });
    const max = Math.max(4, ...bins.map(b => keys.reduce((a, k) => a + b.c[k], 0))), W = 640, H = 220, pl = 30, pb = 26, bw = (W - pl) / days;
    const ticks = [0, Math.ceil(max / 2), max];
    let svg = ticks.map(t => { const y = H - pb - (H - pb - 10) * t / max; return `<line x1="${pl}" x2="${W}" y1="${y}" y2="${y}" stroke="#e6ebf2"/><text x="${pl - 8}" y="${y + 4}" text-anchor="end" class="ax">${t}</text>`; }).join("");
    bins.forEach((b, i) => {
      let y = H - pb; const x = pl + i * bw + bw * 0.22, w = bw * 0.56;
      keys.forEach(k => { if (!b.c[k]) return; const h = (H - pb - 10) * b.c[k] / max; y -= h; svg += `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3" fill="${col[k]}"><title>${b.d.toLocaleDateString()} · ${k}: ${b.c[k]}</title></rect>`; });
      if (i % 2 === (days - 1) % 2) svg += `<text x="${x + w / 2}" y="${H - 8}" text-anchor="middle" class="ax">${b.d.toLocaleDateString(undefined, { day: "2-digit", month: "short" })}</text>`;
    });
    const legend = keys.map(k => `<span><i style="background:${col[k]}"></i>${k}</span>`).join("");
    return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Verifications per day, last ${days} days, by outcome">${svg}</svg><div class="legend">${legend}</div>`;
  }
  function donut(parts, total) {
    let a = -Math.PI / 2, svg = ""; const R = 70, r0 = 48, cx = 90, cy = 90;
    if (!total) svg = `<circle cx="${cx}" cy="${cy}" r="${(R + r0) / 2}" fill="none" stroke="#e6ebf2" stroke-width="${R - r0}"/>`;
    parts.filter(p => p.v).forEach(p => {
      const f = p.v / total, b = a + f * Math.PI * 2 - (f === 1 ? 1e-4 : 0), L = f > 0.5 ? 1 : 0;
      const P = (ang, rad) => `${cx + rad * Math.cos(ang)} ${cy + rad * Math.sin(ang)}`;
      svg += `<path d="M ${P(a, R)} A ${R} ${R} 0 ${L} 1 ${P(b, R)} L ${P(b, r0)} A ${r0} ${r0} 0 ${L} 0 ${P(a, r0)} Z" fill="${p.c}"><title>${p.k}: ${p.v}</title></path>`; a = b;
    });
    return `<svg viewBox="0 0 180 180" class="donut" role="img" aria-label="Outcome mix">${svg}<text x="90" y="88" text-anchor="middle" class="dn">${total}</text><text x="90" y="108" text-anchor="middle" class="ax">checks</text></svg>`;
  }

  function dashboardView() {
    const rq = Store.requests(), n = c => rq.filter(r => outcome(r) === c).length, tot = rq.length, pct = v => tot ? Math.round(100 * v / tot) + "% of checks" : "No checks yet";
    const scored = rq.filter(r => r.classification !== "Unsupported");
    const avg = scored.length ? Math.round(scored.reduce((a, r) => a + r.score, 0) / scored.length) : 0;
    const med = rq.length ? rq.map(r => r.totalMs).sort((a, b) => a - b)[rq.length >> 1] : 0;
    const conf = rq.length ? Math.round(rq.reduce((a, r) => a + (r.ocrConf || 0), 0) / rq.length) : 0;
    const overrides = rq.filter(r => r.finalClass).length, active = Store.records().filter(r => r.status === "Active").length;
    const kpi = (ic, cls, label, v, sub) => `<div class="kpi"><div><span class="kl">${label}</span><div class="metric">${v}</div><span class="ks">${sub}</span></div><div class="kicon ${cls}">${icon(ic)}</div></div>`;
    const facts = {}; rq.forEach(r => (r.factors || []).filter(f => f.points > 0).forEach(f => { const k = { number: "Certificate number not confirmed", name: "Student name mismatch", qualification: "Qualification mismatch", institution: "Institution mismatch", date: "Issue date mismatch", cnn: "CNN flagged an edited region", ocr: "Low OCR confidence", tamper: "ELA anomaly" }[f.key] || f.key; facts[k] = (facts[k] || 0) + 1; }));
    const fl = Object.entries(facts).sort((a, b) => b[1] - a[1]).slice(0, 5), fmax = fl.length ? fl[0][1] : 1;
    const parts = [{ k: "Genuine", v: n("Genuine"), c: "#12a150" }, { k: "Suspicious", v: n("Suspicious"), c: "#e89b00" }, { k: "Forged", v: n("Forged"), c: "#dc2626" }, { k: "Unsupported", v: n("Unsupported"), c: "#94a3b8" }];
    return layout(`<div class="heading"><div><div class="eyebrow">OVERVIEW · ${esc(new Date().toLocaleDateString("en-ZA", { weekday: "long", day: "numeric", month: "long", year: "numeric" }))}</div><h1>Verification Dashboard</h1><p class="sub">Certificate verification activity, outcomes and the evidence behind them.</p></div><button class="primary iconbtn" data-act="go" data-v="verify">${icon("plus")}New Verification</button></div>
    <div class="cards">${kpi("total", "blue", "Total verifications", tot, `${overrides} administrator override${overrides === 1 ? "" : "s"}`)}${kpi("check", "green", "Genuine", n("Genuine"), pct(n("Genuine")))}${kpi("alert", "amber", "Suspicious", n("Suspicious"), pct(n("Suspicious")))}${kpi("x", "red", "Forged", n("Forged"), pct(n("Forged")))}</div>
    <div class="grid2">
      <div class="panel"><div class="ph"><div><h2>Verification activity</h2><p class="sub sm">Checks per day over the last 14 days, by outcome</p></div><button class="link" data-act="go" data-v="history">View history</button></div>${activityChart(rq, 14)}</div>
      <div class="panel"><div class="ph"><div><h2>Outcome mix</h2><p class="sub sm">Final outcome, after any administrator override</p></div></div><div class="mix">${donut(parts, tot)}<div class="mixl">${parts.map(p => `<div><span><i style="background:${p.c}"></i>${p.k}</span><b>${p.v}</b></div>`).join("")}</div></div></div>
    </div>
    <div class="grid2 wide">
      <div class="panel"><div class="ph"><div><h2>Recent verifications</h2><p class="sub sm">Latest checks with their outcome and risk score</p></div><button class="link" data-act="go" data-v="history">View all</button></div>
      ${rq.length ? `<table class="table dt"><tr><th>Certificate</th><th>Institution</th><th>Outcome</th><th>Risk</th><th>Checked</th><th></th></tr>${rq.slice(0, 6).map(r => `<tr><td><b>${esc(r.fields.number || "No number")}</b><div class="sub sm">${esc(r.fields.name || "Name not available")}</div></td><td>${esc(r.fields.institution || "—")}</td><td>${badge(outcome(r))}</td><td>${r.classification === "Unsupported" ? "—" : `<div class="riskbar"><i style="width:${Math.min(100, r.score)}%;background:${r.score >= 70 ? "#dc2626" : r.score >= 30 ? "#e89b00" : "#12a150"}"></i></div><span class="sm">${esc(r.score)}/100</span>`}</td><td class="sm">${esc(fmtDate(r.ts))}<div class="sub">${esc(fmtTime(r.ts))}</div></td><td><button class="link" data-act="openrec" data-id="${esc(r.id)}">Open</button></td></tr>`).join("")}</table>` : `<div class="empty">${icon("total")}<b>No verifications yet</b><p class="sub">Run the first certificate check to populate the dashboard.</p><button class="primary" data-act="go" data-v="verify">Start a verification</button></div>`}</div>
      <div class="side2">
        <div class="panel"><h2>Top risk factors</h2><p class="sub sm">How often each reason added risk</p>${fl.length ? fl.map(([k, v]) => `<div class="fbar"><div><span>${esc(k)}</span><b>${v}</b></div><i><u style="width:${Math.round(100 * v / fmax)}%"></u></i></div>`).join("") : `<p class="sub">No risk factors recorded yet.</p>`}</div>
        <div class="panel"><h2>System health</h2><div class="health"><div><span class="sub sm">Median time to result</span><b>${rq.length ? (med / 1000).toFixed(1) + " s" : "—"}</b></div><div><span class="sub sm">Mean risk score</span><b>${scored.length ? avg + "/100" : "—"}</b></div><div><span class="sub sm">Mean OCR confidence</span><b>${rq.length ? conf + "%" : "—"}</b></div><div><span class="sub sm">Active institution records</span><b>${active}</b></div></div><p class="sub sm" style="margin:12px 0 0">Records are fictional samples; a Genuine result means the certificate matches a stored record.</p></div>
      </div>
    </div>`, "dashboard");
  }

  function filteredHistory() {
    const q = (S.hq || "").trim().toLowerCase(), o = S.ho || "All", from = S.hfrom ? new Date(S.hfrom + "T00:00:00") : null, to = S.hto ? new Date(S.hto + "T23:59:59") : null;
    return Store.requests().filter(r => {
      if (o !== "All" && outcome(r) !== o) return false;
      const t = new Date(r.ts); if (from && t < from) return false; if (to && t > to) return false;
      if (!q) return true;
      return [r.id, r.fields.number, r.fields.name, r.fields.institution, r.fields.qualification, r.user, r.file].some(v => String(v || "").toLowerCase().includes(q));
    });
  }
  function historyView() {
    const all = Store.requests(), rows = filteredHistory(), per = 10, pages = Math.max(1, Math.ceil(rows.length / per)); S.hpage = Math.min(S.hpage || 1, pages);
    const pg = rows.slice((S.hpage - 1) * per, S.hpage * per), cnt = c => all.filter(r => outcome(r) === c).length;
    const chip = (o, label, n) => `<button class="chip ${(S.ho || "All") === o ? "on" : ""}" data-act="hfilter" data-o="${o}">${label}<b>${n}</b></button>`;
    return layout(`<div class="heading"><div><div class="eyebrow">VERIFICATION</div><h1>Verification History</h1><p class="sub">Search, filter and reopen every certificate check.</p></div><button class="secondary" data-act="hexport">Export CSV</button></div>
    <div class="panel"><form class="filters" data-form="hsearch">
      <div class="fsearch">${icon("search")}<input id="hq" type="search" maxlength="80" value="${esc(S.hq || "")}" placeholder="Certificate number, student, institution, reference or officer" aria-label="Search history"></div>
      <div><label for="hfrom">From</label><input id="hfrom" type="date" value="${esc(S.hfrom || "")}"></div>
      <div><label for="hto">To</label><input id="hto" type="date" value="${esc(S.hto || "")}"></div>
      <div class="fbtns"><button class="primary" type="submit">Apply</button><button class="secondary" type="button" data-act="hclear">Clear</button></div>
    </form>
    <div class="chips">${chip("All", "All", all.length)}${chip("Genuine", "Genuine", cnt("Genuine"))}${chip("Suspicious", "Suspicious", cnt("Suspicious"))}${chip("Forged", "Forged", cnt("Forged"))}${chip("Unsupported", "Unsupported", cnt("Unsupported"))}</div>
    ${rows.length ? `<table class="table dt"><tr><th>Reference</th><th>Certificate</th><th>Institution</th><th>Outcome</th><th>Risk</th><th>Officer</th><th>Checked</th><th></th></tr>${pg.map(r => `<tr><td class="mono">${esc(r.id)}</td><td><b>${esc(r.fields.number || "No number")}</b><div class="sub sm">${esc(r.fields.name || "Name not available")}</div></td><td>${esc(r.fields.institution || "—")}</td><td>${badge(outcome(r))}${r.finalClass ? `<div class="sub sm">overridden</div>` : ""}</td><td>${r.classification === "Unsupported" ? "—" : esc(r.score) + "/100"}</td><td class="sm">${esc(r.user)}</td><td class="sm">${esc(fmtDate(r.ts))}<div class="sub">${esc(fmtTime(r.ts))}</div></td><td><button class="link" data-act="openrec" data-id="${esc(r.id)}">Open</button></td></tr>`).join("")}</table>
    <div class="pager"><span class="sub sm">Showing ${(S.hpage - 1) * per + 1}–${Math.min(rows.length, S.hpage * per)} of ${rows.length}</span><div><button class="secondary" data-act="hpage" data-p="${S.hpage - 1}" ${S.hpage <= 1 ? "disabled" : ""}>Previous</button><button class="secondary" data-act="hpage" data-p="${S.hpage + 1}" ${S.hpage >= pages ? "disabled" : ""}>Next</button></div></div>`
    : `<div class="empty">${icon("search")}<b>${all.length ? "No verifications match these filters" : "No verifications yet"}</b><p class="sub">${all.length ? "Change the search text, outcome or dates." : "Completed checks will appear here."}</p></div>`}</div>`, "history");
  }
  function recordView() {
    const r = Store.requests().find(x => x.id === S.hid);
    if (!r) return layout(`<div class="notice">That verification could not be found.</div><button class="secondary" data-act="go" data-v="history">Back to history</button>`, "history");
    const cls = outcome(r), xv = (r.xv && r.xv.fields) || {};
    return layout(`<div class="heading"><div><div class="eyebrow">VERIFICATION RECORD</div><h1 class="mono" style="font-size:26px">${esc(r.id)}</h1><p class="sub">${esc(fmtDate(r.ts))} ${esc(fmtTime(r.ts))} · ${esc(r.user)} · ${esc(r.file)}</p></div><button class="secondary" data-act="go" data-v="history">Back to history</button></div>
    <div class="recsum"><div>${badge(cls)}${r.finalClass ? `<span class="sub sm"> overridden from ${esc(r.classification)} by ${esc(r.overrideBy)}</span>` : ""}</div>${r.classification === "Unsupported" ? "" : `<div class="recscore"><span class="sub sm">Risk priority score</span><b>${esc(r.score)}/100</b><span class="sub sm">not a fraud probability</span></div>`}</div>
    <div class="grid2"><div class="panel"><h2>Field-by-field evidence</h2><table class="table"><tr><th>Field</th><th>Extracted</th><th>Institution record</th><th>Status</th></tr>${Object.keys(Scoring.LABEL).map(k => { const x = xv[k]; return `<tr><td>${esc(Scoring.LABEL[k])}${(r.corrected || []).includes(k) ? ` <span class="badge suspicious">edited</span>` : ""}</td><td>${esc(r.fields[k] || "Not available")}</td><td>${esc(x ? x.expected : "—")}</td><td class="st-${esc(x ? x.status.replace(" ", "") : "")}">${esc(x ? x.status : "—")}</td></tr>`; }).join("")}</table>
      <h3>Why this result?</h3><p>${esc(r.explanation)}</p>${r.overrideWhy ? `<h3>Administrator justification</h3><p>${esc(r.overrideWhy)}</p>` : ""}</div>
      <div class="panel"><h2>Risk factors</h2>${(r.factors || []).map(f => `<div class="bar"><span>${esc(f.text)}</span><b>+${esc(f.points)}</b></div>`).join("") || `<p class="sub">No factors (document not scored).</p>`}
      <h3>Evidence summary</h3><div class="health"><div><span class="sub sm">OCR confidence</span><b>${esc(r.ocrConf)}%</b></div><div><span class="sub sm">Tamper CNN</span><b>${r.cnn && r.cnn.available ? (r.cnn.flagged ? "Flagged" : "No region") : "Not applied"}</b></div><div><span class="sub sm">Time to result</span><b>${(r.totalMs / 1000).toFixed(1)} s</b></div><div><span class="sub sm">File fingerprint</span><b class="mono" title="${esc(r.hash)}">${esc(r.hash.slice(0, 12))}…</b></div></div>
      <p class="sub sm" style="margin-top:14px">The certificate image is never stored, so the visual evidence (boxes and heat-map) is shown only when a check is run. The full PDF report can be downloaded from the result screen at that time.</p></div></div>`, "history");
  }

  function verifyView() {
    const i = S.info;
    return layout(`<div class="eyebrow">CERTIFICATE ANALYSIS</div><div class="heading"><div><h1>Verify Certificate</h1><p class="sub">Upload a certificate and follow the evidence through the CertiGuard pipeline.</p></div><button class="secondary" data-act="reset">↻ Reset</button></div>${steps(1)}
    <div class="grid2"><div class="panel"><div class="eyebrow">STEP 01</div><h2>Upload certificate</h2><p class="sub">JPG, PNG or PDF, maximum 10 MB. The file is processed in your browser and is never uploaded.</p>
    <div class="upload" data-drop><div><div style="font-size:35px;color:#1765e8">⇧</div><b>Drop or choose certificate</b><br><label class="sub" for="file" style="font-weight:500">Choose file</label><input id="file" type="file" accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf"><div class="sub">${i ? esc(i.name) + " · " + (i.size / 1048576).toFixed(2) + " MB" : "No file selected"}</div></div></div>
    <div class="err" role="alert">${esc(S.errs.file || "")}</div>
    ${i ? `<label>SHA-256 fingerprint</label><div class="hash">${esc(i.hash)}</div>` : ""}
    <button class="primary wide" data-act="analyse" style="margin-top:14px">Extract fields with OCR →</button></div>
    <div class="panel"><div class="eyebrow">SAMPLE DATA</div><h3>Load a prepared sample certificate</h3><p class="sub">Fictional certificates for demonstration and testing. Samples 1, 2 and 4 correspond to records in the institution database.</p>${SAMPLES.map((s, k) => `<div class="scenario" role="button" tabindex="0" data-act="sample" data-k="${k}"><b>${esc(s[1])}</b><br><span class="sub mono">${esc(s[0].split("/")[1])}</span></div>`).join("")}</div></div>`, "verify");
  }
  function steps(n) { return `<div class="steps">${["1 Upload", "2 Extract & Review", "3 Analyse", "4 Result"].map((x, i) => `<span class="step ${i < n ? "on" : ""}">${x}</span>`).join("")}</div>`; }
  function ocringView() {
    return layout(`<h1>Verify Certificate</h1>${steps(1)}<div class="panel"><div class="eyebrow">STEP 01</div><h2>Reading the certificate…</h2><div class="progress"><div style="width:${Math.round(S.prog * 100)}%"></div></div><b>${Math.round(S.prog * 100)}%</b></div>`, "verify");
  }
  function field(l, k, v, plain) {
    if (plain) return `<label for="f_${k}">${l}</label><input id="f_${k}" data-in="${k}" maxlength="100" value="${esc(v)}" placeholder="Required" class="${S.errs[k] ? "field-err" : ""}"><div class="err" role="alert">${esc(S.errs[k] || "")}</div>`;   // record form: no OCR evidence
    const c = S.corrected.includes(k) ? ` <span class="badge suspicious">edited</span>` : "";
    const e = S.ev && S.ev[k], chk = e && e.why.length ? ` <span class="badge suspicious">check</span>` : "";
    const src = !v ? `<div class="evid ${k === "name" && S.ocr && S.ocr.meta.nameUnread ? "warn" : ""}">${k === "name" && S.ocr && S.ocr.meta.nameUnread ? "The name was found but could not be read reliably (stylised or low-contrast text). <b>Type it from the document.</b>" : "Not found on the document."}</div>` : e ? `<div class="evid ${e.why.length ? "warn" : ""}">${e.text ? "Read from: “" + esc(e.text) + "”" + (e.conf != null ? " (OCR " + esc(e.conf) + "%)" : "") : "Read from the document text"}${e.why.length ? " — <b>check:</b> " + esc(e.why.join("; ")) : ""}</div>` : "";
    return `<label for="f_${k}">${l}${c}${chk}</label>${src}<input id="f_${k}" data-in="${k}" maxlength="100" value="${esc(v)}" placeholder="Not available" class="${S.errs[k] ? "field-err" : ""}"><div class="err" role="alert">${esc(S.errs[k] || "")}</div>`;
  }
  function uncertain() { return Object.keys(S.ev || {}).filter(k => S.ev[k] && S.ev[k].why.length && !S.corrected.includes(k)); }
  function reviewView() {
    const f = S.fields, o = S.ocr, url = S.prep.url;
    return layout(`<h1>Verify Certificate</h1>${steps(2)}<div class="grid2"><div class="panel"><h2>Document preview</h2><div class="preview"><img src="${esc(url)}" alt="Uploaded certificate preview"></div><div class="fields"><div><label>File name</label>${esc(S.info.name)}</div><div><label>File size</label>${(S.info.size / 1048576).toFixed(2)} MB</div></div><label>SHA-256</label><div class="hash">${esc(S.info.hash)}</div></div>
    <div class="panel"><div class="eyebrow">STEP 02</div><h2>Extracted certificate fields</h2><div class="notice">OCR confidence <b>${esc(o.confidence)}%</b> · read in ${esc(o.ms)} ms${o.pages ? " · " + esc(Math.min(o.pages, 3)) + " page(s) read" : ""}. Only text found on the document is filled in; anything not found is left empty ("Not available"). Check every field and correct OCR errors before verification (FR-04).</div>
    <label for="docType">Document type (detected from the text)</label><select id="docType" data-in="docType">${Object.keys(OCR.TYPES).map(k => `<option value="${k}" ${S.docType === k ? "selected" : ""}>${esc(OCR.TYPES[k])}</option>`).join("")}</select>
    ${S.docType !== "academic" ? `<div class="notice">CertiGuard verifies <b>academic qualification</b> certificates only. This document will be reported as <b>Unsupported</b>, not as genuine or forged.</div>` : ""}${field("Student name", "name", f.name)}${field("Certificate number", "number", f.number)}${field("Qualification", "qualification", f.qualification)}${field("Institution", "institution", f.institution)}${field("Issue date (YYYY-MM-DD)", "date", f.date)}${S.errs._chk ? `<div class="err" role="alert">${esc(S.errs._chk)}</div>` : ""}${uncertain().length ? `<label class="chkrow"><input type="checkbox" id="chk" data-in="chk"> I have checked the fields marked “check” against the document.</label>` : ""}<details class="rawocr"><summary>Original OCR text (what the system actually read)</summary><pre>${esc(o.text)}</pre>${o.meta.identifiers.length ? `<p class="sub">Other identifiers found but <b>not</b> assigned to any field: ${esc(o.meta.identifiers.join(", "))}</p>` : ""}</details><button class="primary wide" data-act="confirm" style="margin-top:16px">Confirm Fields & Run Verification →</button></div></div>`, "verify");
  }
  function analysingView() {
    const st = ["Cross-validation", "Integrity (ELA + CNN)", "Risk scoring", "Explanation & audit"];
    return layout(`<h1>Verification analysis</h1>${steps(3)}<div class="panel"><h2>Running evidence pipeline…</h2><div class="pipeline">${st.map((x, i) => `<div class="stage ${i < S.stage ? "done" : i === S.stage ? "run" : "wait"}">${esc(x)}${i < S.stage ? " ✓" : ""}</div>`).join("→")}</div></div>`, "verify");
  }
  function prov(r) {
    const rec = r.xv.found ? Store.findRecord(r.fields.number) : null;
    return rec ? "Record source: " + (rec.source || "Fictional sample record (not an authoritative institution source)") + ". A Genuine result therefore means the document matches this stored record, not that the institution has confirmed it." : "No matching institution record was found, so nothing could be confirmed.";
  }
  function unsupportedView() {
    const r = S.res, img = S.prep;
    return layout(`<h1>Verify Certificate</h1>${steps(4)}<div class="resultHero unsupported"><div><div class="eyebrow" style="color:white">VERIFICATION OUTCOME</div><h1>Unsupported document</h1><div>${esc(OCR.TYPES[r.docType])}</div></div></div><div class="grid2"><div class="panel"><h2>What was read from the document</h2><table class="table">${Object.keys(Scoring.LABEL).map(k => `<tr><td>${esc(Scoring.LABEL[k])}</td><td>${esc(r.fields[k] || "Not available")}</td></tr>`).join("")}</table><p>${esc(r.explanation)}</p><div class="actions"><button class="primary" data-act="print">▧ Print / Save Report</button><button class="secondary" data-act="reset">Verify Another</button></div></div><div class="panel"><h2>Document</h2><div class="ovl"><img src="${esc(img.url)}" alt="Uploaded document"></div><p class="sub mono">Reference ${esc(r.id)}<br>SHA-256: ${esc(r.hash)}<br>OCR ${esc(r.ocrMs)} ms · total ${esc(r.totalMs)} ms</p></div></div>`, "verify");
  }
  // FR-09: real downloadable PDF verification report (jsPDF, generated in the browser)
  async function makePdf() {
    const r = S.res, cls = r.finalClass || r.classification, J = window.jspdf.jsPDF, doc = new J({ unit: "mm", format: "a4" });
    const A = s => String(s == null ? "" : s).replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/[^\x20-\x7E]/g, "?");
    let y = 16; const L = 15, Wd = 180, line = (t, size = 10, bold = false, gap = 5) => { doc.setFont("helvetica", bold ? "bold" : "normal"); doc.setFontSize(size); for (const l of doc.splitTextToSize(A(t), Wd)) { if (y > 280) { doc.addPage(); y = 16; } doc.text(l, L, y); y += gap; } };
    line("CertiGuard - Verification Report", 17, true, 8); line("Reference " + r.id + "  |  " + new Date(r.ts).toLocaleString() + "  |  Officer: " + r.user, 9, false, 6);
    line("Outcome: " + cls + (r.classification === "Unsupported" ? "" : "   (risk score " + r.score + "/100, a rule-based review priority)"), 14, true, 8);
    if (r.finalClass) line("Administrator decision recorded. Original automated outcome: " + r.classification, 9, false, 6);
    line("File: " + r.file + "\nSHA-256: " + r.hash, 8, false, 4); y += 3;
    line("Certificate details and validation findings", 12, true, 7);
    Object.keys(Scoring.LABEL).forEach(k => { const x = r.xv && r.xv.fields[k]; line(Scoring.LABEL[k] + ": " + (r.fields[k] || "Not available") + (x ? "   | record: " + x.expected + "   | " + x.status : ""), 9, false, 5); });
    y += 2; line("Explanation", 12, true, 7); line(r.explanation, 10, false, 5);
    if (r.factors) { y += 2; line("Score factors", 12, true, 7); r.factors.forEach(f => line("+" + f.points + "  " + f.text, 9, false, 5)); }
    y += 2; line("Explainable-AI evidence", 12, true, 7);
    line(r.cnn && r.cnn.available ? "Tamper-region CNN score " + r.cnn.score.toFixed(2) + " (threshold " + Tamper.CFG.thr.toFixed(2) + "): " + (r.cnn.flagged ? r.cnn.regions.length + " tile(s) flagged as possibly edited (purple). " : "no region flagged. ") + "Trained on synthetic data only; decision support, not proof." : "Tamper-region CNN not applied to this file type.", 9, false, 5);
    line(r.tamper && r.tamper.available ? "ELA (experimental, not scored): " + r.tamper.anomalyBlocks + " clustered anomalous block(s)." : "ELA not applied.", 9, false, 5);
    line(prov(r), 8, false, 4);
    try {   // evidence image: document with OCR boxes (green/red/amber) and CNN tiles (purple)
      const bmp = await createImageBitmap(S.prep.blob), w = 900, h = Math.round(bmp.height * w / bmp.width), sc = w / S.prep.w, c = document.createElement("canvas"); c.width = w; c.height = h;
      const g = c.getContext("2d"); g.drawImage(bmp, 0, 0, w, h); g.lineWidth = 3;
      if (r.xv && r.lines) Object.keys(r.xv.fields).forEach(k => { const l = OCR.locate(r.lines, r.fields[k]); if (!l) return; const st = r.xv.fields[k].status; g.strokeStyle = st === "Matched" ? "#16a34a" : st === "Mismatched" ? "#dc2626" : "#d97706"; g.strokeRect((l.bbox.x0 - 8) * sc, (l.bbox.y0 - 8) * sc, (l.bbox.x1 - l.bbox.x0 + 16) * sc, (l.bbox.y1 - l.bbox.y0 + 16) * sc); });
      if (r.cnn && r.cnn.available && r.cnn.flagged) { g.fillStyle = "rgba(124,58,237,0.30)"; r.cnn.regions.forEach(q => g.fillRect(q.x * w, q.y * h, q.w * w, q.h * h)); }
      const mh = Math.min(120, Wd * h / w); if (y + mh > 285) { doc.addPage(); y = 16; } doc.addImage(c.toDataURL("image/jpeg", 0.85), "JPEG", L, y, Wd * (mh / (Wd * h / w)), mh); y += mh + 4;
      line("Green = field matches record, red = differs, amber = could not be compared, purple = CNN edit region.", 8, false, 4);
    } catch (e) { line("(Evidence image could not be added.)", 8); }
    doc.save("CertiGuard_Report_" + r.id + ".pdf");
    await Store.appendAudit(user().email, "Report downloaded", r.fields.number || "-", cls, r.id);
  }
  function cnnPanel(r) {
    const c = r.cnn; if (!c || !c.available) return `<p class="sub">Tamper-region CNN: ${c && c.error ? "could not run in this browser; no CNN evidence." : "not applied to PDF files."}</p>`;
    const xai = r.xaiMs != null ? ` Explanation and heat-map were ready ${esc(r.xaiMs)} ms after the CNN finished (target 2000 ms).` : "";
    return `<div class="toggle"><label><input type="checkbox" data-act="cnnmap" ${S.showCnn ? "checked" : ""}>Show CNN heat-map (tile probability of an edit)</label></div><p class="sub"><b>Tamper-region CNN:</b> score ${esc(c.score.toFixed(2))} (flag threshold ${esc(Tamper.CFG.thr.toFixed(2))}) in ${esc(c.ms)} ms. ${c.flagged ? "<b>" + esc(c.regions.length) + " tile(s) look edited</b> (purple boxes). This is a trained model for synthetic edits; it is decision support and not proof." : "No region was flagged. This does not prove the document is unedited."}${xai}</p>`;
  }
  function resultView() {
    if (S.res.classification === "Unsupported") return unsupportedView();
    const r = S.res, cls = r.finalClass || r.classification;
    const flagged = [], img = S.prep;
    const boxes = Object.keys(r.xv.fields).map(k => {
      const l = r.lines && OCR.locate(r.lines, r.fields[k]); if (!l) return "";
      const st = r.xv.fields[k].status, cl = st === "Matched" ? "good" : st === "Mismatched" ? "bad" : "warn", b = { x0: l.bbox.x0 - 8, y0: l.bbox.y0 - 8, x1: l.bbox.x1 + 8, y1: l.bbox.y1 + 8 };
      return `<div class="box ${cl}" title="${esc(Scoring.LABEL[k])}: ${esc(r.xv.fields[k].status)}" style="left:${b.x0 / img.w * 100}%;top:${b.y0 / img.h * 100}%;width:${(b.x1 - b.x0) / img.w * 100}%;height:${(b.y1 - b.y0) / img.h * 100}%"></div>`;
    }).join("");
    const cnnBoxes = r.cnn && r.cnn.available && r.cnn.flagged ? r.cnn.regions.map(g => `<div class="box edit" title="Suspected edit region (CNN ${esc(g.p.toFixed(2))})" style="left:${g.x * 100}%;top:${g.y * 100}%;width:${g.w * 100}%;height:${g.h * 100}%"></div>`).join("") : "";
    const max = Math.max(1, ...r.factors.map(f => f.points));
    return layout(`<h1>Verify Certificate</h1>${steps(4)}<div class="resultHero ${esc(cls.toLowerCase())}"><div><div class="eyebrow" style="color:white">VERIFICATION OUTCOME${r.finalClass ? " (ADMINISTRATOR DECISION)" : ""}</div><h1>${esc(cls)}</h1><div>${esc(r.fields.number)} · ${esc(r.fields.name)}</div></div><div class="risk">${esc(r.score)}<small style="font-size:9px">RISK / 100</small></div></div>
    <div class="notice" role="note"><b>How to read this.</b> ${esc(prov(r))} The score is a rule-based <b>review priority</b>, not a probability of fraud; Suspicious and Forged results need human review.</div>
    <div class="grid2"><div class="panel"><div class="eyebrow">CROSS-VALIDATION</div><h2>Field-by-field evidence</h2><table class="table"><tr><th>Field</th><th>Extracted</th><th>Institution record</th><th>Status</th></tr>${Object.keys(r.xv.fields).map(k => `<tr><td>${esc(Scoring.LABEL[k])}</td><td>${esc(r.fields[k] || "Not available")}</td><td>${esc(r.xv.fields[k].expected)}</td><td class="st-${esc(r.xv.fields[k].status.replace(" ", ""))}">${esc(r.xv.fields[k].status)}</td></tr>`).join("")}</table>
    <h3>Why this result?</h3><p>${esc(r.explanation)}</p>${r.factors.map(f => `<div class="bar"><div>${esc(f.text)}<i style="width:${f.points / max * 100}%;margin-top:4px;${f.points ? "" : "background:#9aa7bb"}"></i></div><b>+${esc(f.points)}</b></div>`).join("")}
    <div class="actions"><button class="primary" data-act="pdf">⇩ Download PDF Report</button><button class="secondary" data-act="print">Print</button>${Auth.can("override") && cls !== "Genuine" && !r.finalClass ? `<button class="secondary" data-act="go" data-v="override">Administrator Override</button>` : ""}<button class="secondary" data-act="reset">Verify Another</button></div></div>
    <div class="panel"><div class="eyebrow">EXPLAINABLE EVIDENCE</div><h2>Where the evidence is</h2><p class="sub">Green = matches the record; red = differs from the record; amber = could not be compared (no record, or value missing). Boxes mark where OCR read each value, they are <b>not</b> proof of tampering. Purple = region the CNN considers possibly edited.</p><div class="ovl"><img src="${esc(img.url)}" alt="Certificate with evidence boxes">${S.showCnn && r.cnnHeat ? `<img class="heatov" src="${esc(r.cnnHeat)}" alt="CNN heat-map">` : ""}${boxes}${cnnBoxes}</div>
    ${cnnPanel(r)}
    ${r.tamper.available ? `<div class="toggle"><label><input type="checkbox" data-act="ela" ${S.showEla ? "checked" : ""}>Show experimental ELA heat-map (advisory only)</label></div>${S.showEla ? `<div class="ovl"><img src="${esc(r.heatUrl)}" alt="Error level analysis heat-map"></div><p class="sub">ELA found ${esc(r.tamper.anomalyBlocks)} clustered anomalous block(s) of ${esc(r.tamper.contentBlocks)} content blocks. This heuristic is not a trained model and has low weight in the score.</p>` : ""}` : `<p class="sub">Integrity (ELA) analysis is not applied to PDF files.</p>`}
    <hr><h3>Verification reference</h3><b class="mono">${esc(r.id)}</b><p class="sub mono">File: ${esc(r.file)}<br>SHA-256: ${esc(r.hash)}<br>OCR ${esc(r.ocrMs)} ms · ELA ${esc(r.elaMs)} ms · total ${esc(r.totalMs)} ms<br>Checked: ${esc(new Date(r.ts).toLocaleString())} by ${esc(r.user)}</p></div></div>`, "verify");
  }
  function overrideView() {
    const r = S.res;
    return layout(`<div class="eyebrow">ADMINISTRATOR CONTROL</div><h1>Administrator Review</h1><p class="sub">Review the automated outcome and record a traceable human decision.</p><div class="grid2"><div class="panel"><h3>Original classification</h3><p>${badge(r.classification)} &nbsp; Risk ${esc(r.score)}/100 · ${esc(r.fields.number)} · ${esc(r.fields.name)}</p><h3>Administrator decision</h3>${["Genuine", "Suspicious", "Forged"].map(x => `<label><input style="width:auto" type="radio" name="decision" value="${x}" ${x === r.classification ? "checked" : ""}> Confirm as ${x}</label>`).join("")}</div><div class="panel"><h3>Justification (required, min. 10 characters)</h3><textarea id="just" rows="8" maxlength="500" placeholder="Document the reason for the administrator decision..."></textarea><div class="err" role="alert">${esc(S.errs.just || "")}</div><button class="primary wide" data-act="saveOverride" style="margin-top:12px">Save Decision to Audit Trail</button></div></div>`, "verify");
  }
  function auditView() {
    const rows = Store.audit(), c = S.auditCheck;
    return layout(`<div class="heading"><div><div class="eyebrow">TRACEABILITY</div><h1>Audit Trail</h1><p class="sub">Each entry stores a SHA-256 hash of the previous entry, so editing or deleting history is detectable.</p></div><div><button class="secondary" data-act="chain">Verify chain integrity</button> <button class="secondary" data-act="export">⇩ Export CSV</button></div></div>${c ? `<div class="notice" role="status">${c.ok ? "✓ Audit chain intact: " + esc(c.total) + " entries verified." : "✗ Audit chain BROKEN at entry " + esc(c.badIndex + 1) + " of " + esc(c.total) + ": the stored history has been altered."}</div>` : ""}<div class="panel"><table class="table"><thead><tr><th>Date / time</th><th>User</th><th>Action</th><th>Certificate ID</th><th>Outcome</th><th>Details</th></tr></thead><tbody>${rows.slice(0, 60).map(x => `<tr><td class="mono">${esc(new Date(x.ts).toLocaleString())}</td><td>${esc(x.user)}</td><td>${esc(x.action)}</td><td>${esc(x.certId)}</td><td>${["Genuine", "Suspicious", "Forged"].includes(x.outcome) ? badge(x.outcome) : esc(x.outcome)}</td><td>${esc(x.details)}</td></tr>`).join("")}</tbody></table><p class="sub">Showing the latest ${Math.min(60, rows.length)} of ${rows.length} entries.</p></div>`, "audit");
  }
  function recordsView() {
    const adm = Auth.can("records.write"), e = S.errs;
    return layout(`<div class="eyebrow">REFERENCE DATA</div><h1>Institution Records</h1><div class="panel"><table class="table"><tr><th>Certificate ID</th><th>Student</th><th>Qualification</th><th>Institution</th><th>Issued</th><th>Status</th>${adm ? "<th></th>" : ""}</tr>${Store.records().map(r => `<tr><td>${esc(r.number)}</td><td>${esc(r.name)}</td><td>${esc(r.qualification)}</td><td>${esc(r.institution)}</td><td>${esc(r.date)}</td><td>${badge(r.status === "Active" ? "Genuine" : "Suspicious").replace(/>[^<]*</, ">" + esc(r.status) + "<")}</td>${adm ? `<td><button class="link" data-act="editRec" data-n="${esc(r.number)}">Edit</button> · <button class="link" data-act="toggleRec" data-n="${esc(r.number)}">${r.status === "Active" ? "Deactivate" : "Activate"}</button></td>` : ""}</tr>`).join("")}</table></div>
    ${adm ? `<div class="panel" style="margin-top:18px"><h3>${S.editRec ? "Edit institution record " + esc(S.editRec) + " (administrator)" : "Add institution record (administrator)"}</h3><div class="row2"><div>${field("Student name", "name", S.fields?.name || "", true)}${field("Certificate number", "number", S.fields?.number || "", true)}${field("Qualification", "qualification", S.fields?.qualification || "", true)}</div><div>${field("Institution", "institution", S.fields?.institution || "", true)}${field("Issue date (YYYY-MM-DD)", "date", S.fields?.date || "", true)}<button class="primary wide" data-act="${S.editRec ? "saveRec" : "addRec"}" style="margin-top:20px">${S.editRec ? "Save changes" : "Add record"}</button>${S.editRec ? `<button class="secondary wide" data-act="cancelRec" style="margin-top:10px">Cancel</button>` : ""}</div></div></div>` : ""}`, "records");
  }
  function systemView() {
    const rows = [
      ["OCR text extraction", "REAL", "Tesseract.js 5 (LSTM neural network, WebAssembly) runs in the browser on the uploaded image or PDF page."],
      ["Field parsing and validation", "REAL", "Rule-based parser plus input validation; fields are editable before verification."],
      ["Institution cross-validation", "REAL, SAMPLE DATA", "Per-field comparison with stored records. The seeded records are fictional, so a match is not authoritative institutional verification."],
      ["Fraud-risk score and explanation", "REAL", "Transparent additive rule model; a rule-based review priority, not a calibrated probability of fraud. Weights are not statistically validated."],
      ["Integrity analysis (ELA)", "REAL, EXPERIMENTAL, NOT SCORED", "Classical error-level analysis with a heat-map. Evaluation showed it does not separate edited from genuine scans, so its weight is 0."],
      ["Tamper-region CNN", "REAL, TRAINED ON SYNTHETIC DATA ONLY", "A 116k-parameter convolutional network trained from scratch (not the planned ResNet-50), exported to ONNX and run in the browser with onnxruntime-web. It scores 64x64 tiles for small edits (text replacement, copy-paste, blur). Held-out synthetic test: see ml/results.json. It has not been tested on real certificates and gives false alarms after resizing or rotating a scan, so a flag means review, not proof."],
      ["Persistence and audit log", "SIMPLIFIED", "Browser storage, not PostgreSQL. Every store is encrypted at rest with AES-GCM-256 using a non-extractable key kept in IndexedDB on this device. The hash chain detects edits to single entries, but anyone who controls the browser storage could rewrite and re-hash the whole history; a server-side append-only log is needed."],
      ["Authentication / roles", "SIMPLIFIED", "Client-side PBKDF2 check and role permissions. A determined user can bypass client-side checks; production needs a server (FastAPI + JWT)."],
      ["XAI", "SIMPLIFIED", "Evidence boxes from OCR positions, the factor breakdown and the CNN tile-probability heat-map. Grad-CAM/SHAP explanations are future work."]
    ];
    return layout(`<div class="eyebrow">SYSTEM TRANSPARENCY</div><h1>System Information</h1><div class="panel"><table class="table"><tr><th>Component</th><th>Status</th><th>What it does in this prototype</th></tr>${rows.map(r => `<tr><td>${esc(r[0])}</td><td><b>${esc(r[1])}</b></td><td>${esc(r[2])}</td></tr>`).join("")}</table><p class="notice">Fictional sample data only. The prototype has not been validated on real certificates and must not be used for real hiring or admission decisions.</p>${Auth.can("audit") ? `<button class="secondary" data-act="resetAll">Reset demo data</button>` : ""}</div>`, "system");
  }
  const VIEWS = { login: loginView, dashboard: dashboardView, history: historyView, record: recordView, verify: verifyView, ocring: ocringView, review: reviewView, analysing: analysingView, result: resultView, override: overrideView, audit: auditView, records: recordsView, system: systemView };
  function render() {
    if (S.view !== "login" && !Auth.session()) { S = fresh("login"); S.msg = "Your session has expired. Please sign in again."; }
    $("#app").innerHTML = VIEWS[S.view]();
    S.msg = ""; // one-shot messages
  }

  // ---------- actions ----------
  async function setFile(file) {
    S.errs = {}; S.info = null; S.file = null;
    const v = await validateFile(file);
    if (typeof v === "string") { S.errs.file = v; await Store.appendAudit(user().email, "Upload rejected", "-", "Rejected", v.slice(0, 120)); render(); return; }
    S.file = file; S.kind = v.kind;
    S.info = { name: file.name, size: file.size, hash: hexOf(await crypto.subtle.digest("SHA-256", await file.arrayBuffer())) };
    render();
  }
  // Field-level evidence: which OCR line each value came from, how confident OCR was, and whether it needs a manual check.
  function evidence(o) {
    const ev = {};
    for (const k of ["name", "number", "qualification", "institution", "date"]) {
      const v = o.fields[k]; if (!v) { ev[k] = null; continue; }
      const line = k === "date" ? null : OCR.locate(o.lines, v);
      const why = [];
      if (k !== "date" && !line) why.push("could not be matched to a single line of OCR text");
      if (line && line.conf < 70) why.push("low OCR confidence (" + line.conf + "%)");
      if (k === "date" && o.meta.dateUncertain) why.push("no 'issued / awarded' label found beside this date");
      if (k === "name" && !/\s/.test(v)) why.push("only one word found");
      ev[k] = { text: line ? line.text : "", conf: line ? line.conf : null, why };
    }
    return ev;
  }
  async function analyse() {
    if (!S.file) { S.errs.file = "Choose a JPG, PNG or PDF first."; render(); return; }
    try {
      S.view = "ocring"; S.prog = 0; render(); S.t0 = performance.now();
      OCR.onProgress(p => { S.prog = p; const b = document.querySelector(".progress>div"); if (b) { b.style.width = Math.round(p * 100) + "%"; b.parentElement.nextElementSibling.textContent = Math.round(p * 100) + "%"; } });
      S.prep = await prepare(S.file, S.kind); S.prep.url = URL.createObjectURL(S.prep.blob);
      if (S.prep.pdf) S.ocr = await OCR.extractMany(S.prep.blobs);
      else {
        // OCR runs on an enhanced copy (upscaled, grey, contrast-stretched); boxes are mapped back to the displayed image
        const en = await OCR.enhance(S.prep.blob); S.ocr = await OCR.extract(en.blob);
        S.ocr.lines = S.ocr.lines.map(l => ({ ...l, bbox: { x0: l.bbox.x0 / en.scale, y0: l.bbox.y0 / en.scale, x1: l.bbox.x1 / en.scale, y1: l.bbox.y1 / en.scale } }));
      }
      S.ev = evidence(S.ocr);
      S.fields = { ...S.ocr.fields }; S.orig = { ...S.ocr.fields }; S.corrected = []; S.errs = {}; S.docType = S.ocr.docType;
      S.view = "review"; render();
    } catch (e) {
      console.error(e); await Store.appendAudit(user().email, "Processing error", "-", "Failed", "OCR stage");
      S.view = "verify"; S.errs.file = "The file could not be read. Check that it is a clear, undamaged certificate scan and try again."; render();
    }
  }
  async function confirm() {
    const f = {}; ["name", "number", "qualification", "institution", "date"].forEach(k => f[k] = ($("#f_" + k)?.value || "").trim());
    f.number = f.number.toUpperCase(); S.fields = f; S.errs = validateFields(f); S.docType = $("#docType")?.value || S.docType;
    S.corrected = Object.keys(f).filter(k => f[k] !== S.orig[k]);
    if (S.docType === "academic" && uncertain().length && !$("#chk")?.checked) S.errs._chk = "Some fields are marked “check”. Confirm them against the document (or correct them) before verification.";
    if (Object.keys(S.errs).length) { render(); return; }
    if (S.docType !== "academic") return await finishUnsupported(f);
    try {
      S.view = "analysing"; S.stage = 0; render();
      const xv = Scoring.crossValidate(f); S.stage = 1; render(); await new Promise(r => setTimeout(r, 30));
      let tamper = { available: false, score: 0 }, heatUrl = "", elaMs = 0;
      if (!S.prep.pdf) { const t = await ELA.analyse(S.prep.blob); elaMs = t.ms; tamper = { ...t, available: true }; heatUrl = await new Promise(r => t.heatmap.toBlob(b => r(URL.createObjectURL(b)), "image/png")); }
      let cnn = { available: false }, cnnHeat = "";
      if (!S.prep.pdf) { try { const c = await Tamper.analyse(S.prep.blob); cnn = { available: true, score: c.score, flagged: c.flagged, ms: c.ms, regions: c.regions.slice(0, 80) }; cnnHeat = await new Promise(r => Tamper.heatmap(c).toBlob(b => r(URL.createObjectURL(b)), "image/png")); S.tCnn = performance.now(); } catch (e) { console.error(e); cnn = { available: false, error: true }; } }
      S.stage = 2; render(); await new Promise(r => setTimeout(r, 30));
      const sc = Scoring.score(xv, tamper, S.ocr.confidence, cnn); S.stage = 3; render();
      const id = "CG-" + new Date().getFullYear() + "-" + S.info.hash.slice(0, 8).toUpperCase();
      const rec = { id, ts: new Date().toISOString(), user: user().email, file: S.info.name, hash: S.info.hash, fields: f, corrected: S.corrected, xv: { found: xv.found, fields: xv.fields }, tamper: { available: tamper.available, score: tamper.score, anomalyBlocks: tamper.anomalyBlocks || 0, contentBlocks: tamper.contentBlocks || 0 }, cnn, ocrConf: S.ocr.confidence, ocrMs: S.ocr.ms, elaMs, totalMs: Math.round(performance.now() - S.t0), score: sc.score, classification: sc.classification, factors: sc.factors, explanation: sc.explanation };
      Store.saveRequest(rec);
      await Store.appendAudit(user().email, "Completed verification", f.number, sc.classification, "Risk: " + sc.score + "/100" + (S.corrected.length ? "; fields corrected: " + S.corrected.join(",") : ""));
      S.res = { ...rec, lines: S.ocr.lines, heatUrl, cnnHeat, tamper: { ...rec.tamper } }; S.showEla = false; S.showCnn = false; S.view = "result"; render();
      if (S.tCnn) { S.res.xaiMs = Math.round(performance.now() - S.tCnn); S.tCnn = 0; render(); }
    } catch (e) {
      console.error(e); await Store.appendAudit(user().email, "Processing error", S.fields?.number || "-", "Failed", "Analysis stage");
      S.view = "review"; S.msg = "The analysis could not be completed. Your entries are kept; please try again."; render();
    }
  }
  // Non-academic document: no authenticity verdict, no record comparison, no risk score.
  async function finishUnsupported(f) {
    const id = "CG-" + new Date().getFullYear() + "-" + S.info.hash.slice(0, 8).toUpperCase();
    const text = "This looks like a " + OCR.TYPES[S.docType].toLowerCase() + ". CertiGuard verifies academic qualification certificates only, so no authenticity verdict is given.";
    const rec = { id, ts: new Date().toISOString(), user: user().email, file: S.info.name, hash: S.info.hash, fields: f, docType: S.docType, corrected: S.corrected, xv: { found: false, fields: {} }, tamper: { available: false, score: 0, anomalyBlocks: 0, contentBlocks: 0 }, ocrConf: S.ocr.confidence, ocrMs: S.ocr.ms, elaMs: 0, totalMs: Math.round(performance.now() - S.t0), score: 0, classification: "Unsupported", factors: [], explanation: text };
    Store.saveRequest(rec);
    await Store.appendAudit(user().email, "Completed verification", f.number || "-", "Unsupported", OCR.TYPES[S.docType]);
    S.res = { ...rec, lines: S.ocr.lines, heatUrl: "" }; S.view = "result"; render();
  }
  async function loadSample(k) {
    try {
      const [path] = SAMPLES[k]; const resp = await fetch(path); if (!resp.ok) throw new Error("HTTP " + resp.status);
      const blob = await resp.blob(); await setFile(new File([blob], path.split("/").pop(), { type: blob.type }));
    } catch (e) { S.errs.file = "Sample could not be loaded. Choose a file manually (fallback plan)."; render(); }
  }
  async function saveOverride() {
    const j = ($("#just")?.value || "").trim();
    if (!Auth.can("override")) { S.view = "dashboard"; S.msg = "Only administrators can override a classification."; render(); return; }
    if (j.length < 10) { S.errs = { just: "Enter a justification of at least 10 characters." }; render(); return; }
    const dec = document.querySelector("input[name=decision]:checked").value;
    Store.updateRequest(S.res.id, { finalClass: dec, overrideBy: user().email, overrideWhy: j });
    await Store.appendAudit(user().email, "Administrator override", S.res.fields.number, dec, "Original: " + S.res.classification + "; reason: " + j);
    S.res.finalClass = dec; S.errs = {}; S.view = "audit"; render();
  }
  async function addRecord() {
    const f = {}; ["name", "number", "qualification", "institution", "date"].forEach(k => f[k] = ($("#f_" + k)?.value || "").trim()); f.number = f.number.toUpperCase();
    if (!Auth.can("records.write")) return;
    S.fields = f; S.errs = validateFields(f);
    ["name", "number", "qualification", "institution", "date"].forEach(k => { if (!f[k] && !S.errs[k]) S.errs[k] = "This field is required for an institution record."; });
    if (!Object.keys(S.errs).length) {
      try { Store.addRecord({ ...f, status: "Active", source: "Added by administrator " + user().email + " on " + new Date().toISOString().slice(0, 10) + " (unverified by the institution)" }); await Store.appendAudit(user().email, "Record added", f.number, "Success", f.institution); S.fields = null; }
      catch (e) { S.errs.number = "A record with this certificate number already exists."; }
    }
    render();
  }
  async function saveRecord() {
    if (!Auth.can("records.write")) return;
    const f = {}; ["name", "number", "qualification", "institution", "date"].forEach(k => f[k] = ($("#f_" + k)?.value || "").trim()); f.number = f.number.toUpperCase();
    S.fields = f; S.errs = validateFields(f);
    ["name", "number", "qualification", "institution", "date"].forEach(k => { if (!f[k] && !S.errs[k]) S.errs[k] = "This field is required for an institution record."; });
    if (!Object.keys(S.errs).length) {
      const old = Store.findRecord(S.editRec);
      try {
        const changed = ["name", "number", "qualification", "institution", "date"].filter(k => old && old[k] !== f[k]);
        Store.updateRecord(S.editRec, { ...f, source: (old && old.source ? old.source.replace(/; edited by .*$/, "") : "") + "; edited by " + user().email + " on " + new Date().toISOString().slice(0, 10) });
        await Store.appendAudit(user().email, "Record updated", f.number, "Success", changed.length ? "Changed: " + changed.join(", ") + (S.editRec !== f.number ? " (was " + S.editRec + ")" : "") : "No changes");
        S.editRec = null; S.fields = null;
      } catch (e) { S.errs.number = e.message === "DUPLICATE" ? "A record with this certificate number already exists." : "The record could not be found; reload the page."; }
    }
    render();
  }
  function exportHistoryCsv() {
    const safe = x => { x = String(x ?? ""); if (/^[=+\-@\t\r]/.test(x)) x = "'" + x; return '"' + x.replace(/"/g, '""') + '"'; };
    const csv = "Reference,Checked,Officer,Certificate number,Student,Institution,Qualification,Outcome,Automated outcome,Risk score\n" + filteredHistory().map(r => [r.id, r.ts, r.user, r.fields.number, r.fields.name, r.fields.institution, r.fields.qualification, outcome(r), r.classification, r.score].map(safe).join(",")).join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = "certiguard-verification-history.csv"; a.click();
  }
  function exportCsv() {
    const safe = x => { x = String(x); if (/^[=+\-@\t\r]/.test(x)) x = "'" + x; return '"' + x.replace(/"/g, '""') + '"'; };
    const csv = "Date,User,Action,Certificate ID,Outcome,Details,Hash\n" + Store.audit().map(r => [r.ts, r.user, r.action, r.certId, r.outcome, r.details, r.hash].map(safe).join(",")).join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = "certiguard-audit-log.csv"; a.click();
  }

  // ---------- event delegation (no inline handlers: compatible with the CSP) ----------
  document.addEventListener("click", async e => {
    const t = e.target.closest("[data-act]"); if (!t) return; const a = t.dataset.act;
    if (!Auth.session()) { S = fresh("login"); S.msg = "Your session has expired. Please sign in again."; render(); return; }
    if (t.tagName !== "INPUT") e.preventDefault();
    if (a === "go") { const v = t.dataset.v, p = { verify: "verify", audit: "audit", records: "records.read", history: "history" }[v]; S.errs = {}; if (v === "verify" && S.view !== "verify") { S = Object.assign(fresh("verify")); } else S.view = v; if (p && !Auth.can(p)) { await Store.appendAudit(user().email, "Access denied", "-", "Rejected", "Page: " + v); S.view = "dashboard"; S.msg = "You do not have permission to open that page."; } render(); }
    else if (a === "openrec") { if (!Auth.can("history")) return; S.hid = t.dataset.id; S.view = "record"; render(); }
    else if (a === "hfilter") { S.ho = t.dataset.o; S.hpage = 1; render(); }
    else if (a === "hpage") { S.hpage = Math.max(1, +t.dataset.p); render(); }
    else if (a === "hclear") { S.hq = ""; S.hfrom = ""; S.hto = ""; S.ho = "All"; S.hpage = 1; render(); }
    else if (a === "hexport") { exportHistoryCsv(); await Store.appendAudit(user().email, "History export", "-", "Success", "CSV"); }
    else if (a === "logout") { await Auth.logout(); S = fresh("login"); render(); }
    else if (a === "reset") { S = fresh("verify"); render(); }
    else if (a === "sample") await loadSample(+t.dataset.k);
    else if (a === "analyse") await analyse();
    else if (a === "confirm") await confirm();
    else if (a === "print") window.print();
    else if (a === "cnnmap") { S.showCnn = t.checked; render(); }
    else if (a === "pdf") await makePdf();
    else if (a === "ela") { S.showEla = t.checked; render(); }
    else if (a === "saveOverride") await saveOverride();
    else if (a === "chain") { S.auditCheck = await Store.verifyAuditChain(); render(); }
    else if (a === "export") { await Store.appendAudit(user().email, "Audit export", "-", "Success", "CSV"); exportCsv(); }
    else if (a === "addRec") await addRecord();
    else if (a === "editRec") { if (!Auth.can("records.write")) return; const r = Store.findRecord(t.dataset.n); if (r) { S.editRec = r.number; S.errs = {}; S.fields = { name: r.name, number: r.number, qualification: r.qualification, institution: r.institution, date: r.date }; render(); } }
    else if (a === "saveRec") await saveRecord();
    else if (a === "cancelRec") { S.editRec = null; S.fields = null; S.errs = {}; render(); }
    else if (a === "toggleRec") { if (!Auth.can("records.write")) return; const r = Store.findRecord(t.dataset.n); Store.setRecordStatus(r.number, r.status === "Active" ? "Revoked" : "Active"); await Store.appendAudit(user().email, "Record status changed", r.number, r.status === "Active" ? "Revoked" : "Active", "-"); render(); }
    else if (a === "resetAll") { if (Auth.can("audit")) { Store.resetAll(); await Auth.logout(); S = fresh("login"); render(); } }
  });
  document.addEventListener("keydown", e => { if ((e.key === "Enter" || e.key === " ") && e.target.matches("[data-act][role=button]")) { e.preventDefault(); e.target.click(); } });
  document.addEventListener("change", e => { if (e.target.id === "docType") { ["name", "number", "qualification", "institution", "date"].forEach(k => { if ($("#f_" + k)) S.fields[k] = $("#f_" + k).value; }); S.docType = e.target.value; render(); return; } if (e.target.id === "file") setFile(e.target.files[0]); if (e.target.matches("[data-act=ela]")) { S.showEla = e.target.checked; render(); } });
  document.addEventListener("submit", async e => {
    if (e.target.dataset.form === "gsearch" || e.target.dataset.form === "hsearch") {
      e.preventDefault(); if (!Auth.can("history")) return;
      if (e.target.dataset.form === "gsearch") { S = Object.assign(S, { hq: $("#gq").value.trim(), ho: "All", hfrom: "", hto: "", hpage: 1, view: "history" }); }
      else { S.hq = $("#hq").value.trim(); S.hfrom = $("#hfrom").value; S.hto = $("#hto").value; S.hpage = 1; }
      render(); return;
    }
    if (e.target.dataset.form !== "login") return; e.preventDefault();
    const r = await Auth.login($("#email").value, $("#pw").value);
    if (r.ok) { S = fresh("dashboard"); render(); } else { S.msg = r.msg; render(); }
  });
  ["dragover", "drop"].forEach(ev => document.addEventListener(ev, e => { if (!e.target.closest("[data-drop]")) return; e.preventDefault(); if (ev === "drop") setFile(e.dataTransfer.files[0]); }));

  Store.init().then(async () => {
    if (Store.loadErrors.length) { S.msg = "Stored data could not be decrypted or read (" + Store.loadErrors.join(", ") + "); it may have been altered outside CertiGuard. The affected store was set aside and reset."; await Store.appendAudit("system", "Storage integrity failure", "-", "Failed", Store.loadErrors.join(",")); }
    render();
  });
  window.__CG = { get state() { return S; } }; // read-only handle used by the automated tests
})();
