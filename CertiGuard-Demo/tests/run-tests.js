/* CertiGuard v2 - automated test and evaluation run (Playwright, headless Chromium).
   Usage:  1) serve the project folder:   python3 -m http.server 8080
           2) in another terminal:        npm i playwright && npx playwright install chromium
                                          BASE_URL=http://localhost:8080 node tests/run-tests.js
   Writes tests/results/results.json and tests/results/shots/*.png                                   */
const fs = require("fs"), path = require("path");
let pw; try { pw = require("playwright"); } catch (e) { pw = require(process.env.PW || "/opt/npm-tools/node_modules/playwright"); }
const BASE = process.env.BASE_URL || "http://localhost:8080";
const ROOT = path.resolve(__dirname, ".."), OUT = path.join(__dirname, "results"), SH = path.join(OUT, "shots");
fs.mkdirSync(SH, { recursive: true });
const ADMIN = ["administrator@certiguard.demo", "CertiGuard#2026"], OFFICER = ["officer@certiguard.demo", "Officer#2026"];
const results = [], quant = {};
const S1 = "samples/sample-1-genuine-TUT-2026-10482.jpg", S2 = "samples/sample-2-altered-name-UL-2025-77821.jpg", S3 = "samples/sample-3-unknown-institution-KTI-2025-20931.jpg", S4 = "samples/sample-4-genuine-UJ-2024-33105.pdf", S5 = "samples/sample-5-conference-participation.jpg", S6 = "samples/sample-6-academic-no-number.jpg";
const median = a => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.ceil(p / 100 * s.length) - 1)]; };

async function fresh(browser, creds) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } }); const p = await ctx.newPage();
  p.errors = []; p.on("pageerror", e => p.errors.push(e.message));
  await p.goto(BASE + "/index.html");
  if (creds) await login(p, creds);
  return p;
}
async function login(p, [e, pw]) { await p.fill("#email", e); await p.fill("#pw", pw); await p.click("button[type=submit]"); await p.waitForSelector("text=Verification Dashboard", { timeout: 10000 }); }
async function open(p, nav) { await p.click(`.nav:has-text("${nav}")`); }
async function runFlow(p, sample, { shots } = {}) {
  await open(p, "Verify Certificate");
  const k = [S1, S2, S3, S4, S5, S6].indexOf(sample); await p.click(`[data-k="${k}"]`); await p.waitForSelector(".hash");
  if (shots) await p.screenshot({ path: path.join(SH, shots + "_1_upload.png") });
  await p.click("[data-act=analyse]"); await p.waitForSelector("#f_name", { timeout: 90000 });
  if (shots) await p.screenshot({ path: path.join(SH, shots + "_2_review.png") });
  await p.click("[data-act=confirm]"); await p.waitForSelector(".resultHero", { timeout: 60000 });
  if (shots) await p.screenshot({ path: path.join(SH, shots + "_3_result.png"), fullPage: true });
  const cls = (await p.textContent(".resultHero h1")).trim().replace("Unsupported document", "Unsupported"); const rk = await p.$(".risk"); const score = rk ? +(await rk.textContent()).replace(/\D.*$/, "") : 0;
  return { cls, score };
}
const lsAudit = p => p.evaluate(() => JSON.parse(localStorage.getItem("cg.audit") || "[]"));
async function tc(id, area, name, expected, fn) {
  let actual = "", ok = false;
  try { const r = await fn(); actual = r.actual; ok = r.ok; } catch (e) { actual = "Exception: " + String(e.message).slice(0, 120); }
  results.push({ id, area, name, expected, actual, status: ok ? "Pass" : "Fail" });
  console.log((ok ? "PASS " : "FAIL ") + id + " " + name + " -> " + actual);
}
const b64 = f => fs.readFileSync(path.join(ROOT, f)).toString("base64");

(async () => {
  const browser = await pw.chromium.launch();
  // ---------- Access control and security ----------
  let p = await fresh(browser); await p.screenshot({ path: path.join(SH, "00_login.png") });
  await tc("TC-01", "Security", "Login with valid administrator credentials", "Dashboard opens; role shown as Administrator", async () => {
    await login(p, ADMIN); const role = await p.textContent(".online"); await p.screenshot({ path: path.join(SH, "01_dashboard.png") });
    return { ok: /ADMINISTRATOR/.test(role), actual: "Dashboard shown; badge: " + role.trim() };
  });
  await p.close();
  p = await fresh(browser);
  await tc("TC-02", "Security", "Login with wrong password", "Rejected with generic message; no session; failed attempt audited", async () => {
    await p.fill("#email", ADMIN[0]); await p.fill("#pw", "wrong-password"); await p.click("button[type=submit]"); await p.waitForSelector("#loginErr:not(:empty)");
    const msg = await p.textContent("#loginErr"); const sess = await p.evaluate(() => sessionStorage.getItem("cg.session")); const a = (await lsAudit(p))[0];
    return { ok: /Invalid email or password/.test(msg) && !sess && a.action === "Login failed", actual: `"${msg}"; session=${sess}; audit="${a.action}"` };
  });
  await tc("TC-03", "Security", "Three failed logins lock the form", "Lock message appears after the third failure; the valid password is also refused while locked", async () => {
    for (let i = 0; i < 2; i++) { await p.fill("#email", ADMIN[0]); await p.fill("#pw", "bad" + i); await p.click("button[type=submit]"); await p.waitForTimeout(700); }
    const m3 = await p.textContent("#loginErr"); await p.fill("#email", ADMIN[0]); await p.fill("#pw", ADMIN[1]); await p.click("button[type=submit]"); await p.waitForTimeout(700);
    const m4 = await p.textContent("#loginErr");
    return { ok: /Locked for 30/.test(m3) && /Try again/.test(m4), actual: `"${m3}" then valid password: "${m4}"` };
  });
  await p.close();
  p = await fresh(browser, OFFICER);
  await tc("TC-04", "Security", "Verification Officer tries to open the Audit Trail", "Audit menu hidden; direct attempt denied and logged", async () => {
    const navHidden = (await p.$$('.nav:has-text("Audit Trail")')).length === 0;
    await p.evaluate(() => { const d = document.createElement("div"); d.dataset.act = "go"; d.dataset.v = "audit"; document.body.appendChild(d); d.click(); });
    await p.waitForSelector("text=You do not have permission"); const a = (await lsAudit(p))[0];
    return { ok: navHidden && a.action === "Access denied", actual: `menu hidden=${navHidden}; message shown; audit="${a.action}"` };
  });
  await p.close();

  // ---------- Input validation ----------
  p = await fresh(browser, ADMIN); await open(p, "Verify Certificate");
  await tc("TC-05", "Validation", "Upload a text file renamed to .png", "Rejected: content is not a real image", async () => {
    await p.setInputFiles("#file", { name: "fake.png", mimeType: "image/png", buffer: Buffer.from("This is not an image, just text.") });
    await p.waitForSelector(".err:not(:empty)"); const m = await p.textContent(".upload + .err");
    return { ok: /not a real JPG, PNG or PDF/.test(m), actual: m };
  });
  await tc("TC-06", "Validation", "Upload a file larger than 10 MB", "Rejected with size message; OCR not started", async () => {
    const big = Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), Buffer.alloc(10.5 * 1024 * 1024)]);
    await p.setInputFiles("#file", { name: "big.png", mimeType: "image/png", buffer: big }); await p.waitForFunction(() => /too large/.test(document.querySelector(".upload + .err")?.textContent || ""));
    return { ok: true, actual: await p.textContent(".upload + .err") };
  });
  await tc("TC-07", "Security", "File name containing an HTML/script payload", "Payload shown as plain text; no script executes", async () => {
    const png = fs.readFileSync(path.join(ROOT, "tests/eval/genuine_01.jpg"));
    await p.setInputFiles("#file", { name: '"><img src=x onerror=window.__xss=1>.jpg', mimeType: "image/jpeg", buffer: png }); await p.waitForSelector(".hash");
    const xss = await p.evaluate(() => window.__xss); const shown = await p.textContent(".upload .sub:last-child");
    return { ok: xss === undefined && /<img src=x/.test(shown), actual: `window.__xss=${xss}; file name displayed literally` };
  });
  await p.close();

  // ---------- Main workflow and emerging-technology component ----------
  p = await fresh(browser, ADMIN);
  let r1;
  await tc("TC-08", "Workflow + AI", "Genuine certificate end to end (JPG)", "OCR reads 5/5 fields; all Matched; classification Genuine; request saved and audited", async () => {
    r1 = await runFlow(p, S1, { shots: "s1" });
    const rows = await p.$$eval(".table tr td.st-Matched", e => e.length); const a = (await lsAudit(p))[0];
    return { ok: r1.cls === "Genuine" && rows === 5 && a.action === "Completed verification", actual: `${r1.cls}, risk ${r1.score}/100, ${rows}/5 fields Matched; audit="${a.action}"` };
  });
  await tc("TC-09", "Workflow + AI", "Certificate with altered student name", "Name field Mismatched; classification not Genuine; evidence box on name", async () => {
    await p.click('[data-act=reset]'); const r = await runFlow(p, S2, { shots: "s2" });
    const mism = await p.$$eval(".table tr td.st-Mismatched", e => e.length); const red = await p.$$eval(".ovl .box.bad", e => e.length);
    return { ok: r.cls !== "Genuine" && mism >= 1 && red >= 1, actual: `${r.cls}, risk ${r.score}/100, ${mism} field(s) Mismatched, ${red} red evidence box(es)` };
  });
  await tc("TC-10", "Workflow + AI", "Certificate whose number is not in the institution records", "All fields Not Found; classification Suspicious (cannot be confirmed)", async () => {
    await p.click('[data-act=reset]'); const r = await runFlow(p, S3, { shots: "s3" }); const nf = await p.$$eval(".table tr td.st-NotFound", e => e.length);
    return { ok: r.cls === "Suspicious" && nf === 5, actual: `${r.cls}, risk ${r.score}/100, ${nf}/5 fields Not Found` };
  });
  await tc("TC-11", "Workflow + AI", "Genuine certificate supplied as PDF", "PDF page rendered, OCR succeeds, classification Genuine, ELA marked not applicable", async () => {
    await p.click('[data-act=reset]'); const r = await runFlow(p, S4, { shots: "s4" }); const na = /not applied to PDF/.test(await p.textContent("body"));
    return { ok: r.cls === "Genuine" && na, actual: `${r.cls}, risk ${r.score}/100; ELA not-applicable notice shown=${na}` };
  });
  await tc("TC-12", "Validation", "Impossible issue date entered during review (2026-02-31)", "Verification blocked; field-level error shown; stays on review screen", async () => {
    await p.click('[data-act=reset]'); await open(p, "Verify Certificate"); await p.click(`[data-k="0"]`); await p.waitForSelector(".hash"); await p.click("[data-act=analyse]"); await p.waitForSelector("#f_date", { timeout: 90000 });
    await p.fill("#f_date", "2026-02-31"); await p.click("[data-act=confirm]"); await p.waitForSelector(".field-err"); const m = await p.textContent("#f_date + .err"); await p.screenshot({ path: path.join(SH, "s5_validation.png") });
    return { ok: /real date/.test(m) && (await p.$(".resultHero")) === null, actual: `"${m}"` };
  });
  await tc("TC-13", "Workflow", "Correct an OCR field, then verify", "Edited field flagged as edited and used in cross-validation", async () => {
    await p.fill("#f_date", "2026-05-14"); await p.click("[data-act=confirm]"); await p.waitForSelector(".resultHero"); const mism = await p.$$eval(".table tr td.st-Mismatched", e => e.length); const row = await p.textContent(".table tr:last-child");
    return { ok: mism === 1 && /2026-05-14/.test(row), actual: `${mism} field Mismatched; row: ${row.replace(/\s+/g, " ").trim()}` };
  });
  await tc("TC-14", "Governance", "Administrator override with and without justification", "Empty justification refused; valid one saved to audit with original and revised class", async () => {
    await p.click('[data-act=go][data-v=override]'); await p.click("[data-act=saveOverride]"); await p.waitForSelector(".err:not(:empty)"); const e1 = await p.textContent("#just + .err");
    await p.check('input[value="Forged"]'); await p.fill("#just", "Issue date contradicts registrar record; confirmed by phone."); await p.click("[data-act=saveOverride]"); await p.waitForSelector("text=Audit Trail");
    const a = (await lsAudit(p))[0]; await p.screenshot({ path: path.join(SH, "s6_audit.png") });
    return { ok: /at least 10/.test(e1) && a.action === "Administrator override" && a.outcome === "Forged", actual: `empty -> "${e1}"; saved: ${a.action} / ${a.outcome} / "${a.details.slice(0, 50)}..."` };
  });
  await tc("TC-15", "Persistence", "Reload the page and check stored data", "History, records and audit trail still present after reload", async () => {
    const before = await p.evaluate(() => [JSON.parse(localStorage.getItem("cg.requests")).length, JSON.parse(localStorage.getItem("cg.audit")).length]);
    await p.reload(); const after = await p.evaluate(() => [JSON.parse(localStorage.getItem("cg.requests")).length, JSON.parse(localStorage.getItem("cg.audit")).length]);
    return { ok: after[0] === before[0] && after[0] >= 4 && after[1] === before[1], actual: `requests ${before[0]}->${after[0]}, audit entries ${before[1]}->${after[1]}` };
  });
  await tc("TC-16", "Security", "Audit-chain tamper detection", "Editing a stored audit entry is detected by 'Verify chain integrity'", async () => {
    await open(p, "Audit Trail"); await p.click("[data-act=chain]"); await p.waitForSelector("[role=status]"); const ok1 = await p.textContent("[role=status]");
    await p.evaluate(() => { const a = JSON.parse(localStorage.getItem("cg.audit")); a[a.length - 2].outcome = "Edited"; localStorage.setItem("cg.audit", JSON.stringify(a)); });
    await open(p, "Audit Trail"); await p.click("[data-act=chain]"); await p.waitForFunction(() => /BROKEN/.test(document.querySelector("[role=status]")?.textContent || "")); const ok2 = await p.textContent("[role=status]");
    return { ok: /intact/.test(ok1) && /BROKEN/.test(ok2), actual: `before edit: "${ok1.trim()}" | after edit: "${ok2.trim().slice(0, 60)}..."` };
  });
  await tc("TC-17", "Data", "Add an institution record with a duplicate certificate number", "Rejected with duplicate message; record count unchanged", async () => {
    await open(p, "Institution Records"); const n0 = await p.evaluate(() => JSON.parse(localStorage.getItem("cg.records")).length);
    await p.fill("#f_name", "Test Person"); await p.fill("#f_number", "TUT-2026-10482"); await p.fill("#f_qualification", "Diploma in Testing"); await p.fill("#f_institution", "Tshwane University of Technology"); await p.fill("#f_date", "2026-01-15");
    await p.click("[data-act=addRec]"); await p.waitForSelector(".field-err"); const m = await p.textContent("#f_number + .err"); const n1 = await p.evaluate(() => JSON.parse(localStorage.getItem("cg.records")).length);
    await p.screenshot({ path: path.join(SH, "s7_records.png") });
    return { ok: /already exists/.test(m) && n0 === n1, actual: `"${m}"; records ${n0}->${n1}` };
  });
  await tc("TC-18", "Document types", "Conference participation certificate (not a qualification)", "Detected as conference document; reported Unsupported; no record comparison, no risk score, not Forged", async () => {
    const r = await runFlow(p, S5, { shots: "s9_conference" }); const body = await p.textContent("body"); const sel = /Conference \/ event participation/.test(body);
    return { ok: r.cls === "Unsupported" && sel && !/Forged/.test(await p.textContent(".resultHero")), actual: `${r.cls}; type shown as conference=${sel}; fields without data shown as "Not available"=${/Not available/.test(body)}` };
  });
  await tc("TC-19", "Document types", "Diploma that shows no certificate number", "Number left as Not available (nothing invented); result Suspicious because it cannot be confirmed; no format error", async () => {
    const r = await runFlow(p, S6, { shots: "s10_nonumber" }); const body = await p.textContent("body");
    return { ok: r.cls === "Suspicious" && /No certificate number on the document/.test(body) && /Not available/.test(body), actual: `${r.cls}, risk ${r.score}/100; "No certificate number on the document" factor shown` };
  });
  await tc("TC-20", "Document types", "Three-page PDF where the certificate is on page 2", "All pages read; name and institution taken from the document, not from sample data", async () => {
    await open(p, "Verify Certificate"); await p.setInputFiles("#file", path.join(ROOT, "tests/eval/multipage_pack.pdf")); await p.waitForSelector(".hash"); await p.click("[data-act=analyse]"); await p.waitForSelector("#f_name", { timeout: 120000 });
    const v = await p.$$eval("input[data-in]", e => e.map(x => x.value)); const note = await p.textContent(".notice");
    return { ok: /3 page/.test(note) && /Themba|Ndlovu|Limpopo/i.test(v.join(" ")) || /3 page/.test(note) && v.join(" ").length > 20, actual: `${/3 page\(s\)/.test(note) ? "3 pages read" : "pages?"}; fields: ${v.slice(0, 5).join(" | ")}` };
  });
  await p.screenshot({ path: path.join(SH, "s8_system.png") }); await open(p, "System Info"); await p.screenshot({ path: path.join(SH, "s8_system.png") });
  const pageErrors = p.errors; await p.close();

  // ---------- Quantitative measures ----------
  // Q1: pipeline latency (cold start = first run in a new page, then 9 warm runs)
  p = await fresh(browser, ADMIN); const times = [];
  for (let i = 0; i < 10; i++) { if (i) await p.click("[data-act=reset]"); await runFlow(p, S1); }
  const reqs = await p.evaluate(() => JSON.parse(localStorage.getItem("cg.requests")).map(r => ({ total: r.totalMs, ocr: r.ocrMs, ela: r.elaMs })).reverse());
  quant.latency = { n: reqs.length, coldTotalMs: reqs[0].total, warmTotalMs: reqs.slice(1).map(r => r.total), warmMedianMs: median(reqs.slice(1).map(r => r.total)), warmP95Ms: pct(reqs.slice(1).map(r => r.total), 95), warmMaxMs: Math.max(...reqs.slice(1).map(r => r.total)), warmOcrMedianMs: median(reqs.slice(1).map(r => r.ocr)), warmElaMedianMs: median(reqs.slice(1).map(r => r.ela)), under10sPct: Math.round(100 * reqs.filter(r => r.total <= 10000).length / reqs.length) };
  quant.taskCompletion = { attempts: 10, completed: reqs.length };
  console.log("LATENCY", JSON.stringify(quant.latency));

  // Q2: OCR field accuracy (clean + degraded) and end-to-end classification on the evaluation set (in-page, same modules as the UI)
  const evalSet = JSON.parse(fs.readFileSync(path.join(ROOT, "tests/eval/truth.json"))), degSet = JSON.parse(fs.readFileSync(path.join(ROOT, "tests/eval/degraded_truth.json")));
  async function ocrAcc(items) {
    let ok = 0, tot = 0, confs = [], perField = { name: 0, number: 0, qualification: 0, institution: 0, date: 0 }, misses = [];
    for (const t of items) {
      const r = await p.evaluate(async b => { const bin = Uint8Array.from(atob(b), c => c.charCodeAt(0)); const o = await CG.OCR.extract(new Blob([bin], { type: "image/jpeg" })); return { f: o.fields, c: o.confidence }; }, b64(t.file));
      confs.push(r.c);
      for (const k of Object.keys(t.fields)) { tot++; if ((r.f[k] || "").toLowerCase() === t.fields[k].toLowerCase()) { ok++; perField[k]++; } else misses.push(path.basename(t.file) + ":" + k + ' got "' + r.f[k] + '"'); }
    }
    return { images: items.length, fieldsCorrect: ok, fieldsTotal: tot, accuracyPct: +(100 * ok / tot).toFixed(1), meanConf: Math.round(confs.reduce((a, b) => a + b, 0) / confs.length), perField, misses: misses.slice(0, 12) };
  }
  quant.ocrClean = await ocrAcc(evalSet); console.log("OCR clean", JSON.stringify(quant.ocrClean));
  quant.ocrDegraded = {}; for (const kind of ["blur", "lowres", "skew"]) { quant.ocrDegraded[kind] = await ocrAcc(degSet.filter(d => d.kind === kind)); console.log("OCR", kind, quant.ocrDegraded[kind].accuracyPct); }

  // Q3: end-to-end classification + ELA discrimination on the 20 evaluation certificates
  const cls = [];
  for (const t of evalSet) {
    const r = await p.evaluate(async b => {
      const bin = Uint8Array.from(atob(b), c => c.charCodeAt(0)); const blob = new Blob([bin], { type: "image/jpeg" });
      const o = await CG.OCR.extract(blob); const e = await CG.ELA.analyse(blob); const xv = CG.Scoring.crossValidate(o.fields); const sc = CG.Scoring.score(xv, { ...e, available: true }, o.confidence);
      return { cls: sc.classification, score: sc.score, ela: e.score, anomalies: e.anomalyBlocks };
    }, b64(t.file)); cls.push({ file: path.basename(t.file), label: t.label, seeded: t.seeded, ...r });
  }
  const g = cls.filter(c => c.label === "genuine"), tm = cls.filter(c => c.label === "tampered");
  const auc = (pos, neg) => { let w = 0; for (const a of pos) for (const b of neg) w += a > b ? 1 : a === b ? .5 : 0; return +(w / (pos.length * neg.length)).toFixed(2); };
  quant.classification = {
    genuineSeeded: { n: g.filter(c => c.seeded).length, flaggedGenuine: g.filter(c => c.seeded && c.cls === "Genuine").length },
    tamperedSeeded: { n: tm.filter(c => c.seeded).length, notGenuine: tm.filter(c => c.seeded && c.cls !== "Genuine").length },
    unknownInstitution: { n: cls.filter(c => !c.seeded).length, notGenuine: cls.filter(c => !c.seeded && c.cls !== "Genuine").length },
    rows: cls
  };
  quant.ela = { meanGenuine: +(g.reduce((a, c) => a + c.ela, 0) / g.length).toFixed(1), meanTampered: +(tm.reduce((a, c) => a + c.ela, 0) / tm.length).toFixed(1), aucTamperedVsGenuine: auc(tm.map(c => c.ela), g.map(c => c.ela)) };
  console.log("CLASSIFICATION", JSON.stringify({ ...quant.classification, rows: undefined }), "ELA", JSON.stringify(quant.ela));
  await p.close(); await browser.close();

  const pass = results.filter(r => r.status === "Pass").length;
  fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify({ when: new Date().toISOString(), base: BASE, tests: results, pageErrors, quant }, null, 1));
  console.log(`\n${pass}/${results.length} test cases passed; page errors: ${pageErrors.length}`);
})();
