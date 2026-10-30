/* CertiGuard v2 - Cross-validation, fraud-risk scoring and explanation engine.
   The score is a transparent additive model: every point of risk is traceable to one factor. */
(function (G) {
  "use strict";
  const { Store } = G.CG;
  const norm = s => String(s || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  function lev(a, b) {
    const m = a.length, n = b.length; if (!m) return n; if (!n) return m;
    let prev = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) { const cur = [i]; for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; }
    return prev[n];
  }
  const sim = (a, b) => {
    a = norm(a); b = norm(b); const L = Math.max(a.length, b.length); if (!L) return 1;
    const ta = a.split(" "), tb = b.split(" ");
    if (ta.length === tb.length) {
      // same number of words: short words (BSc, MSc, Jr ...) must match exactly, longer words may differ by an OCR slip
      for (let i = 0; i < ta.length; i++) { if (ta[i] === tb[i]) continue; if (Math.min(ta[i].length, tb[i].length) <= 4 || lev(ta[i], tb[i]) > 1) return 0; }
      return 1;
    }
    return 1 - lev(a, b) / L;
  };
  const W = { number: 45, name: 30, qualification: 20, institution: 20, date: 25, tamperMax: 0, ocrLow: 8 };
  const LABEL = { name: "Student name", number: "Certificate number", qualification: "Qualification", institution: "Institution", date: "Issue date" };

  const Scoring = {
    W, LABEL,
    crossValidate(f) {
      const rec = Store.findRecord(f.number);
      const out = {}; let found = !!rec && rec.status === "Active";
      if (!rec) { out.number = { status: "Not Found", expected: "-" }; }
      else if (rec.status !== "Active") { out.number = { status: "Mismatched", expected: rec.number + " (" + rec.status + ")" }; }
      else out.number = { status: "Matched", expected: rec.number };
      ["name", "qualification", "institution", "date"].forEach(k => {
        if (!rec) { out[k] = { status: "Not Found", expected: "-" }; return; }
        const ok = k === "date" ? f[k] === rec[k] : sim(f[k], rec[k]) >= 0.88; // tolerates 1-2 OCR character errors
        out[k] = { status: ok ? "Matched" : "Mismatched", expected: rec[k] };
      });
      return { record: rec || null, fields: out, found, missingNumber: !String(f.number || "").trim() };
    },
    score(xv, tamper, ocrConf) {
      const factors = []; let total = 0;
      for (const k of ["number", "name", "qualification", "institution", "date"]) {
        const st = xv.fields[k].status;
        if (k === "number" && xv.missingNumber) { total += W.number; factors.push({ key: k, points: W.number, text: "Certificate number not found or not reliably identified, so the record could not be located: authenticity not confirmed" }); continue; }
        if (st === "Matched") continue;
        // when the certificate number is unknown, the other fields cannot be compared; do not double count
        if (st === "Not Found" && k !== "number") continue;
        const pts = W[k]; total += pts;
        factors.push({ key: k, points: pts, text: LABEL[k] + (st === "Not Found" ? " not found in institution records" : " does not match the institution record") + (xv.fields[k].expected && xv.fields[k].expected !== "-" ? " (record: " + xv.fields[k].expected + ")" : "") });
      }
      if (tamper && tamper.available !== false) {
        // ELA is displayed but NOT scored (weight 0): the Assignment 4 evaluation showed it does not separate edited from genuine scans.
        const pts = Math.round(W.tamperMax * tamper.score / 100); total += pts;
        factors.push({ key: "tamper", points: pts, text: "Experimental ELA heuristic flagged " + tamper.anomalyBlocks + " clustered region(s): informational only, not scored (see System Info)" });
      } else factors.push({ key: "tamper", points: 0, text: "Integrity (ELA) analysis not available for this file type; tamper evidence not assessed" });
      if (ocrConf < 60) { total += W.ocrLow; factors.push({ key: "ocr", points: W.ocrLow, text: "Low OCR confidence (" + ocrConf + "%): extracted text may be unreliable" }); }
      total = Math.max(0, Math.min(100, total));
      let cls = total >= 70 ? "Forged" : total >= 30 ? "Suspicious" : "Genuine";
      // Safety rule: a result is Genuine only if all five fields match the institution record.
      if (cls === "Genuine" && Object.values(xv.fields).some(f => f.status !== "Matched")) cls = "Suspicious";
      const noNum = xv.missingNumber && cls !== "Genuine";
      const text = cls === "Genuine"
        ? "All checked fields match the institution record and no clustered edit evidence was found."
        : (noNum ? "Manual review required, authenticity not confirmed. " : "") + "Classified " + cls + " mainly because: " + factors.filter(f => f.points > 0).sort((a, b) => b.points - a.points).slice(0, 2).map(f => f.text.charAt(0).toLowerCase() + f.text.slice(1)).join("; ") + ".";
      return { score: total, classification: cls, factors, explanation: text };
    }
  };
  G.CG.Scoring = Scoring;
})(window);
