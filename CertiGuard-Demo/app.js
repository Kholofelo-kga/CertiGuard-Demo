/* CertiGuard v2 - Web interface / application controller.
   All user-supplied or OCR-derived text is escaped (esc) before it is placed in the page. */
(function () {
  "use strict";
  const { Store, Auth, OCR, ELA, Scoring } = CG;
  const $ = s => document.querySelector(s);
  const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const MAX = 10 * 1024 * 1024;
  const SAMPLES = [
    ["samples/sample-1-genuine-TUT-2026-10482.jpg", "Sample 1: genuine certificate (record exists)"],
    ["samples/sample-2-altered-name-UL-2025-77821.jpg", "Sample 2: altered name (edited after scanning)"],
    ["samples/sample-3-unknown-institution-KTI-2025-20931.jpg", "Sample 3: institution not in records"],
    ["samples/sample-4-genuine-UJ-2024-33105.pdf", "Sample 4: genuine certificate as PDF"]
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
      const page = await doc.getPage(1); const vp = page.getViewport({ scale: 2 });
      const c = document.createElement("canvas"); c.width = vp.width; c.height = vp.height;
      await page.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
      const blob = await new Promise(r => c.toBlob(r, "image/png"));
      return { blob, w: c.width, h: c.height, pdf: true };
    }
    const bmp = await createImageBitmap(file); const s = Math.min(1, 2600 / Math.max(bmp.width, bmp.height));
    if (s === 1) return { blob: file, w: bmp.width, h: bmp.height, pdf: false };
    const c = document.createElement("canvas"); c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    return { blob: await new Promise(r => c.toBlob(r, "image/png")), w: c.width, h: c.height, pdf: false };
  }
  function validateFields(f) {
    const e = {};
    if (!/^[A-Za-z][A-Za-z' .\-]{1,79}$/.test(f.name.trim())) e.name = "Enter the student name (letters, spaces, - ' only; 2-80 characters).";
    if (!/^[A-Z]{2,5}-(19|20)\d{2}-\d{4,5}$/.test(f.number.trim().toUpperCase())) e.number = "Format must look like TUT-2026-10482 (PREFIX-YEAR-NUMBER).";
    if (!/^[A-Za-z][A-Za-z&'(). \-]{2,99}$/.test(f.qualification.trim())) e.qualification = "Enter the qualification (3-100 letters).";
    if (!/^[A-Za-z][A-Za-z&'. \-]{2,99}$/.test(f.institution.trim())) e.institution = "Enter the institution (3-100 letters).";
    const d = OCR.parseDate(f.date.trim());
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date.trim()) || !d) e.date = "Use a real date in YYYY-MM-DD format.";
    else if (new Date(f.date) > new Date()) e.date = "The issue date cannot be in the future.";
    return e;
  }
  const badge = c => `<span class="badge ${esc(c.toLowerCase())}">${esc(c)}</span>`;
  const user = () => Auth.session();
  function need(p) { if (!Auth.can(p)) { S.view = Auth.session() ? "dashboard" : "login"; S.msg = Auth.session() ? "You do not have permission to open that page." : ""; render(); return false; } return true; }

  // ---------- views ----------
  function brand() { return `<div class="brand"><div class="shield">◆</div><div>CertiGuard<div style="font-size:11px;font-weight:500;color:#66758f">Academic Certificate Verification System</div></div></div>`; }
  function loginView() {
    return `<div class="login"><section class="hero">${brand()}<h1>Trusted Certificate Verification with Explainable Evidence</h1><p>Prototype that reads a certificate with neural-network OCR, cross-validates it against institution records, scores the fraud risk and shows exactly which evidence drove the decision.</p><div class="checks">✓ Real OCR running in your browser<br>✓ Field-by-field record cross-validation<br>✓ Explainable, additive risk score<br>✓ Role-based access and tamper-evident audit trail</div></section><section class="login-side"><form class="login-card" data-form="login" autocomplete="off"><div class="eyebrow">SECURE ACCESS</div><h2>Welcome back</h2><p class="sub">Sign in to the CertiGuard prototype.</p><label for="email">Email address</label><input id="email" type="email" maxlength="80" required><label for="pw">Password</label><input id="pw" type="password" maxlength="64" required autocomplete="off"><div class="err" id="loginErr" role="alert">${esc(S.msg)}</div><button class="primary wide" type="submit" style="margin-top:16px">Sign in →</button><p class="sub" style="font-size:12px;text-align:center;margin-top:20px">Prototype accounts are listed in the README. Passwords are stored as salted PBKDF2 hashes.</p></form></section></div>`;
  }
  function layout(content, active) {
    const u = user(), nav = (v, t, p) => (!p || Auth.can(p)) ? `<div class="nav ${active === v ? "active" : ""}" role="button" tabindex="0" data-act="go" data-v="${v}">${t}</div>` : "";
    return `<header class="top">${brand()}<span class="online">● PROTOTYPE · ${esc(u.role.toUpperCase())}</span></header><div class="shell"><aside>${nav("dashboard", "▣ Dashboard")}${nav("verify", "✓ Verify Certificate", "verify")}${nav("records", "▤ Institution Records", "records.read")}${nav("audit", "☷ Audit Trail", "audit")}${nav("system", "ⓘ System Info")}<div class="who"><b>${esc(u.name)}</b><div class="sub sm">${esc(u.email)}</div><button class="link" data-act="logout">Sign out</button></div></aside><main class="main">${S.msg ? `<div class="notice" role="alert">${esc(S.msg)}</div>` : ""}${content}</main></div>`;
  }
  function dashboardView() {
    const rq = Store.requests(), n = c => rq.filter(r => (r.finalClass || r.classification) === c).length;
    const avg = rq.length ? Math.round(rq.reduce((a, r) => a + r.score, 0) / rq.length) : 0;
    const med = rq.length ? rq.map(r => r.totalMs).sort((a, b) => a - b)[rq.length >> 1] : 0;
    return layout(`<div class="heading"><div><div class="eyebrow">SECURITY OPERATIONS</div><h1>Verification Dashboard</h1><p class="sub">Figures are calculated from the verification history stored in this browser.</p></div><button class="primary" data-act="go" data-v="verify">+ New Verification</button></div>
    <div class="cards"><div class="card"><span class="sub">Verification requests</span><div class="metric">${rq.length}</div>Stored locally</div><div class="card green"><span class="sub">Genuine</span><div class="metric">${n("Genuine")}</div>Low risk</div><div class="card amber"><span class="sub">Suspicious</span><div class="metric">${n("Suspicious")}</div>Manual review</div><div class="card red"><span class="sub">Forged</span><div class="metric">${n("Forged")}</div>High risk</div></div>
    <div class="grid2"><div class="panel"><div class="eyebrow">PIPELINE</div><h2>Verification workflow</h2><div class="pipeline">${["Upload & validate", "OCR (neural)", "Review fields", "Cross-validate", "Integrity (ELA)", "Risk score", "Explain"].map((x, i) => `<div class="stage">${esc(x)}</div>${i < 6 ? "→" : ""}`).join("")}</div><p class="sub">Median processing time: <b>${rq.length ? (med / 1000).toFixed(1) + " s" : "n/a"}</b> · Mean risk score: <b>${avg}</b></p><button class="primary" data-act="go" data-v="verify">Start certificate check</button></div>
    <div class="panel"><div class="eyebrow">RECENT ACTIVITY</div><h2>Latest checks</h2>${rq.slice(0, 5).map(r => `<div class="activity"><div><b>${esc(r.fields.number)}</b><br><span class="sub">${esc(r.fields.name)} · risk ${esc(r.score)}/100</span></div>${badge(r.finalClass || r.classification)}</div>`).join("") || `<p class="sub">No verifications yet. Run the first check.</p>`}</div></div>`, "dashboard");
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
    return layout(`<h1>Verify Certificate</h1>${steps(1)}<div class="panel"><div class="eyebrow">STEP 01</div><h2>Reading the certificate…</h2><p class="sub">The OCR neural network is running locally in your browser (first run loads the language model).</p><div class="progress"><div style="width:${Math.round(S.prog * 100)}%"></div></div><b>${Math.round(S.prog * 100)}%</b></div>`, "verify");
  }
  function field(l, k, v) {
    const c = S.corrected.includes(k) ? ` <span class="badge suspicious">edited</span>` : "";
    return `<label for="f_${k}">${l}${c}</label><input id="f_${k}" data-in="${k}" maxlength="100" value="${esc(v)}" class="${S.errs[k] ? "field-err" : ""}"><div class="err" role="alert">${esc(S.errs[k] || "")}</div>`;
  }
  function reviewView() {
    const f = S.fields, o = S.ocr, url = S.prep.url;
    return layout(`<h1>Verify Certificate</h1>${steps(2)}<div class="grid2"><div class="panel"><h2>Document preview</h2><div class="preview"><img src="${esc(url)}" alt="Uploaded certificate preview"></div><div class="fields"><div><label>File name</label>${esc(S.info.name)}</div><div><label>File size</label>${(S.info.size / 1048576).toFixed(2)} MB</div></div><label>SHA-256</label><div class="hash">${esc(S.info.hash)}</div></div>
    <div class="panel"><div class="eyebrow">STEP 02</div><h2>Extracted certificate fields</h2><div class="notice">OCR confidence <b>${esc(o.confidence)}%</b> · read in ${esc(o.ms)} ms. Check every field and correct any OCR error before verification (FR-04).</div>${field("Student name", "name", f.name)}${field("Certificate number", "number", f.number)}${field("Qualification", "qualification", f.qualification)}${field("Institution", "institution", f.institution)}${field("Issue date (YYYY-MM-DD)", "date", f.date)}<button class="primary wide" data-act="confirm" style="margin-top:16px">Confirm Fields & Run Verification →</button></div></div>`, "verify");
  }
  function analysingView() {
    const st = ["Cross-validation", "Integrity (ELA)", "Risk scoring", "Explanation & audit"];
    return layout(`<h1>Verification analysis</h1>${steps(3)}<div class="panel"><h2>Running evidence pipeline…</h2><div class="pipeline">${st.map((x, i) => `<div class="stage ${i < S.stage ? "done" : i === S.stage ? "run" : "wait"}">${esc(x)}${i < S.stage ? " ✓" : ""}</div>`).join("→")}</div></div>`, "verify");
  }
  function resultView() {
    const r = S.res, cls = r.finalClass || r.classification;
    const flagged = [], img = S.prep;
    const boxes = Object.keys(r.xv.fields).map(k => {
      const l = r.lines && OCR.locate(r.lines, r.fields[k]); if (!l) return "";
      const bad = r.xv.fields[k].status !== "Matched", b = { x0: l.bbox.x0 - 8, y0: l.bbox.y0 - 8, x1: l.bbox.x1 + 8, y1: l.bbox.y1 + 8 };
      return `<div class="box ${bad ? "bad" : "good"}" title="${esc(Scoring.LABEL[k])}: ${esc(r.xv.fields[k].status)}" style="left:${b.x0 / img.w * 100}%;top:${b.y0 / img.h * 100}%;width:${(b.x1 - b.x0) / img.w * 100}%;height:${(b.y1 - b.y0) / img.h * 100}%"></div>`;
    }).join("");
    const max = Math.max(1, ...r.factors.map(f => f.points));
    return layout(`<h1>Verify Certificate</h1>${steps(4)}<div class="resultHero ${esc(cls.toLowerCase())}"><div><div class="eyebrow" style="color:white">VERIFICATION OUTCOME${r.finalClass ? " (ADMINISTRATOR DECISION)" : ""}</div><h1>${esc(cls)}</h1><div>${esc(r.fields.number)} · ${esc(r.fields.name)}</div></div><div class="risk">${esc(r.score)}<small style="font-size:9px">RISK / 100</small></div></div>
    <div class="grid2"><div class="panel"><div class="eyebrow">CROSS-VALIDATION</div><h2>Field-by-field evidence</h2><table class="table"><tr><th>Field</th><th>Extracted</th><th>Institution record</th><th>Status</th></tr>${Object.keys(r.xv.fields).map(k => `<tr><td>${esc(Scoring.LABEL[k])}</td><td>${esc(r.fields[k])}</td><td>${esc(r.xv.fields[k].expected)}</td><td class="st-${esc(r.xv.fields[k].status.replace(" ", ""))}">${esc(r.xv.fields[k].status)}</td></tr>`).join("")}</table>
    <h3>Why this result?</h3><p>${esc(r.explanation)}</p>${r.factors.map(f => `<div class="bar"><div>${esc(f.text)}<i style="width:${f.points / max * 100}%;margin-top:4px;${f.points ? "" : "background:#9aa7bb"}"></i></div><b>+${esc(f.points)}</b></div>`).join("")}
    <div class="actions"><button class="primary" data-act="print">▧ Print / Save Report</button>${Auth.can("override") && cls !== "Genuine" && !r.finalClass ? `<button class="secondary" data-act="go" data-v="override">Administrator Override</button>` : ""}<button class="secondary" data-act="reset">Verify Another</button></div></div>
    <div class="panel"><div class="eyebrow">EXPLAINABLE EVIDENCE</div><h2>Where the evidence is</h2><p class="sub">Red = field that failed record validation; green = field that matched. Boxes are the OCR word-line positions on your document.</p><div class="ovl"><img src="${esc(img.url)}" alt="Certificate with evidence boxes">${boxes}</div>
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
    return layout(`<div class="eyebrow">REFERENCE DATA</div><h1>Institution Records</h1><p class="sub">Local reference records used for cross-validation (stored in this browser).</p><div class="panel"><table class="table"><tr><th>Certificate ID</th><th>Student</th><th>Qualification</th><th>Institution</th><th>Issued</th><th>Status</th>${adm ? "<th></th>" : ""}</tr>${Store.records().map(r => `<tr><td>${esc(r.number)}</td><td>${esc(r.name)}</td><td>${esc(r.qualification)}</td><td>${esc(r.institution)}</td><td>${esc(r.date)}</td><td>${badge(r.status === "Active" ? "Genuine" : "Suspicious").replace(/>[^<]*</, ">" + esc(r.status) + "<")}</td>${adm ? `<td><button class="link" data-act="toggleRec" data-n="${esc(r.number)}">${r.status === "Active" ? "Deactivate" : "Activate"}</button></td>` : ""}</tr>`).join("")}</table></div>
    ${adm ? `<div class="panel" style="margin-top:18px"><h3>Add institution record (administrator)</h3><div class="row2"><div>${field("Student name", "name", S.fields?.name || "")}${field("Certificate number", "number", S.fields?.number || "")}${field("Qualification", "qualification", S.fields?.qualification || "")}</div><div>${field("Institution", "institution", S.fields?.institution || "")}${field("Issue date (YYYY-MM-DD)", "date", S.fields?.date || "")}<button class="primary wide" data-act="addRec" style="margin-top:20px">Add record</button></div></div></div>` : ""}`, "records");
  }
  function systemView() {
    const rows = [
      ["OCR text extraction", "REAL", "Tesseract.js 5 (LSTM neural network, WebAssembly) runs in the browser on the uploaded image or PDF page."],
      ["Field parsing and validation", "REAL", "Rule-based parser plus input validation; fields are editable before verification."],
      ["Institution cross-validation", "REAL", "Per-field Matched / Mismatched / Not Found against the stored records (fuzzy match tolerates small OCR errors)."],
      ["Fraud-risk score and explanation", "REAL", "Transparent additive model; every point is traceable to a factor shown on the result screen."],
      ["Integrity analysis (ELA)", "REAL, EXPERIMENTAL, NOT SCORED", "Classical error-level analysis with a heat-map. Evaluation showed it does not separate edited from genuine scans, so its weight is 0. The trained ResNet-50 CNN of the final design is future work."],
      ["Persistence", "SIMPLIFIED", "Browser localStorage, not PostgreSQL. Data stays on this device."],
      ["Authentication / roles", "SIMPLIFIED", "Client-side PBKDF2 check and role permissions. A determined user can bypass client-side checks; production needs a server (FastAPI + JWT)."],
      ["XAI", "SIMPLIFIED", "Evidence boxes from OCR positions and the factor breakdown. Grad-CAM/SHAP require the trained CNN (future work)."]
    ];
    return layout(`<div class="eyebrow">SYSTEM TRANSPARENCY</div><h1>System Information</h1><div class="panel"><table class="table"><tr><th>Component</th><th>Status</th><th>What it does in this prototype</th></tr>${rows.map(r => `<tr><td>${esc(r[0])}</td><td><b>${esc(r[1])}</b></td><td>${esc(r[2])}</td></tr>`).join("")}</table><p class="notice">Fictional sample data only. The prototype has not been validated on real certificates and must not be used for real hiring or admission decisions.</p>${Auth.can("audit") ? `<button class="secondary" data-act="resetAll">Reset demo data</button>` : ""}</div>`, "system");
  }
  const VIEWS = { login: loginView, dashboard: dashboardView, verify: verifyView, ocring: ocringView, review: reviewView, analysing: analysingView, result: resultView, override: overrideView, audit: auditView, records: recordsView, system: systemView };
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
  async function analyse() {
    if (!S.file) { S.errs.file = "Choose a JPG, PNG or PDF first."; render(); return; }
    try {
      S.view = "ocring"; S.prog = 0; render(); S.t0 = performance.now();
      OCR.onProgress(p => { S.prog = p; const b = document.querySelector(".progress>div"); if (b) { b.style.width = Math.round(p * 100) + "%"; b.parentElement.nextElementSibling.textContent = Math.round(p * 100) + "%"; } });
      S.prep = await prepare(S.file, S.kind); S.prep.url = URL.createObjectURL(S.prep.blob);
      S.ocr = await OCR.extract(S.prep.blob);
      S.fields = { ...S.ocr.fields }; S.orig = { ...S.ocr.fields }; S.corrected = []; S.errs = {};
      S.view = "review"; render();
    } catch (e) {
      console.error(e); await Store.appendAudit(user().email, "Processing error", "-", "Failed", "OCR stage");
      S.view = "verify"; S.errs.file = "The file could not be read. Check that it is a clear, undamaged certificate scan and try again."; render();
    }
  }
  async function confirm() {
    const f = {}; ["name", "number", "qualification", "institution", "date"].forEach(k => f[k] = ($("#f_" + k)?.value || "").trim());
    f.number = f.number.toUpperCase(); S.fields = f; S.errs = validateFields(f);
    S.corrected = Object.keys(f).filter(k => f[k] !== S.orig[k]);
    if (Object.keys(S.errs).length) { render(); return; }
    try {
      S.view = "analysing"; S.stage = 0; render();
      const xv = Scoring.crossValidate(f); S.stage = 1; render(); await new Promise(r => setTimeout(r, 30));
      let tamper = { available: false, score: 0 }, heatUrl = "", elaMs = 0;
      if (!S.prep.pdf) { const t = await ELA.analyse(S.prep.blob); elaMs = t.ms; tamper = { ...t, available: true }; heatUrl = await new Promise(r => t.heatmap.toBlob(b => r(URL.createObjectURL(b)), "image/png")); }
      S.stage = 2; render(); await new Promise(r => setTimeout(r, 30));
      const sc = Scoring.score(xv, tamper, S.ocr.confidence); S.stage = 3; render();
      const id = "CG-" + new Date().getFullYear() + "-" + S.info.hash.slice(0, 8).toUpperCase();
      const rec = { id, ts: new Date().toISOString(), user: user().email, file: S.info.name, hash: S.info.hash, fields: f, corrected: S.corrected, xv: { found: xv.found, fields: xv.fields }, tamper: { available: tamper.available, score: tamper.score, anomalyBlocks: tamper.anomalyBlocks || 0, contentBlocks: tamper.contentBlocks || 0 }, ocrConf: S.ocr.confidence, ocrMs: S.ocr.ms, elaMs, totalMs: Math.round(performance.now() - S.t0), score: sc.score, classification: sc.classification, factors: sc.factors, explanation: sc.explanation };
      Store.saveRequest(rec);
      await Store.appendAudit(user().email, "Completed verification", f.number, sc.classification, "Risk: " + sc.score + "/100" + (S.corrected.length ? "; fields corrected: " + S.corrected.join(",") : ""));
      S.res = { ...rec, lines: S.ocr.lines, heatUrl, tamper: { ...rec.tamper } }; S.showEla = false; S.view = "result"; render();
    } catch (e) {
      console.error(e); await Store.appendAudit(user().email, "Processing error", S.fields?.number || "-", "Failed", "Analysis stage");
      S.view = "review"; S.msg = "The analysis could not be completed. Your entries are kept; please try again."; render();
    }
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
    S.fields = f; S.errs = validateFields(f);
    if (!Object.keys(S.errs).length) {
      try { Store.addRecord({ ...f, status: "Active" }); await Store.appendAudit(user().email, "Record added", f.number, "Success", f.institution); S.fields = null; }
      catch (e) { S.errs.number = "A record with this certificate number already exists."; }
    }
    render();
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
    if (a === "go") { const v = t.dataset.v, p = { verify: "verify", audit: "audit", records: "records.read" }[v]; S.errs = {}; if (v === "verify" && S.view !== "verify") { S = Object.assign(fresh("verify")); } else S.view = v; if (p && !Auth.can(p)) { await Store.appendAudit(user().email, "Access denied", "-", "Rejected", "Page: " + v); S.view = "dashboard"; S.msg = "You do not have permission to open that page."; } render(); }
    else if (a === "logout") { await Auth.logout(); S = fresh("login"); render(); }
    else if (a === "reset") { S = fresh("verify"); render(); }
    else if (a === "sample") await loadSample(+t.dataset.k);
    else if (a === "analyse") await analyse();
    else if (a === "confirm") await confirm();
    else if (a === "print") window.print();
    else if (a === "ela") { S.showEla = t.checked; render(); }
    else if (a === "saveOverride") await saveOverride();
    else if (a === "chain") { S.auditCheck = await Store.verifyAuditChain(); render(); }
    else if (a === "export") { await Store.appendAudit(user().email, "Audit export", "-", "Success", "CSV"); exportCsv(); }
    else if (a === "addRec") await addRecord();
    else if (a === "toggleRec") { if (!Auth.can("records.write")) return; const r = Store.findRecord(t.dataset.n); Store.setRecordStatus(r.number, r.status === "Active" ? "Revoked" : "Active"); await Store.appendAudit(user().email, "Record status changed", r.number, r.status === "Active" ? "Revoked" : "Active", "-"); render(); }
    else if (a === "resetAll") { if (Auth.can("audit")) { Store.resetAll(); await Auth.logout(); S = fresh("login"); render(); } }
  });
  document.addEventListener("keydown", e => { if ((e.key === "Enter" || e.key === " ") && e.target.matches("[data-act][role=button]")) { e.preventDefault(); e.target.click(); } });
  document.addEventListener("change", e => { if (e.target.id === "file") setFile(e.target.files[0]); if (e.target.matches("[data-act=ela]")) { S.showEla = e.target.checked; render(); } });
  document.addEventListener("submit", async e => {
    if (e.target.dataset.form !== "login") return; e.preventDefault();
    const r = await Auth.login($("#email").value, $("#pw").value);
    if (r.ok) { S = fresh("dashboard"); render(); } else { S.msg = r.msg; render(); }
  });
  ["dragover", "drop"].forEach(ev => document.addEventListener(ev, e => { if (!e.target.closest("[data-drop]")) return; e.preventDefault(); if (ev === "drop") setFile(e.dataTransfer.files[0]); }));

  Store.init(); render();
  window.__CG = { get state() { return S; } }; // read-only handle used by the automated tests
})();
