/* CertiGuard v2 - OCR service (emerging-technology component 1).
   Tesseract.js 5 (LSTM neural-network OCR compiled to WebAssembly) runs fully in the browser;
   the certificate never leaves the user's device. */
(function (G) {
  "use strict";
  let worker = null, onProg = () => { };
  const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  const pad = n => String(n).padStart(2, "0");
  const title = s => s.toLowerCase().replace(/\b([a-z])/g, m => m.toUpperCase()).replace(/\b(Of|The|And|In)\b/g, m => m.toLowerCase());
  const clean = s => s.replace(/[|_~=]+/g, " ").replace(/\s+/g, " ").trim();

  async function getWorker() {
    if (worker) return worker;
    worker = await Tesseract.createWorker("eng", 1, {
      workerPath: "vendor/tess/worker.min.js",
      corePath: "vendor/tess/core",
      langPath: "vendor/tess/lang",
      workerBlobURL: false,
      logger: m => { if (m.status === "recognizing text") onProg(m.progress); }
    });
    return worker;
  }

  function validIso(y, m, d) {
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d && y >= 1950 && y <= 2100;
  }
  function parseDate(t) {
    let m = t.match(/\b(19|20)\d{2}[-\/.](0?[1-9]|1[0-2])[-\/.](0?[1-9]|[12]\d|3[01])\b/);
    if (m) { const [y, mo, d] = m[0].split(/[-\/.]/).map(Number); if (validIso(y, mo, d)) return y + "-" + pad(mo) + "-" + pad(d); }
    m = t.match(/\b(0?[1-9]|[12]\d|3[01])\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?,?\s+((?:19|20)\d{2})\b/i);
    if (m) { const mo = MONTHS[m[2].slice(0, 3).toLowerCase()], d = +m[1], y = +m[3]; if (validIso(y, mo, d)) return y + "-" + pad(mo) + "-" + pad(d); }
    m = t.match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(0?[1-9]|[12]\d|3[01]),?\s+((?:19|20)\d{2})\b/i);
    if (m) { const mo = MONTHS[m[1].slice(0, 3).toLowerCase()], d = +m[2], y = +m[3]; if (validIso(y, mo, d)) return y + "-" + pad(mo) + "-" + pad(d); }
    return "";
  }
  // Certificate number: formats differ between institutions, so a labelled value is preferred
  // ("Certificate No: X", "Reference: X", "Serial: X"); the PREFIX-YEAR-NUMBER pattern is only a fallback.
  // Returns "" when the document shows no certificate number (the field is then "Not available").
  function parseNumber(t) {
    const lab = t.match(/\b(?:certificate|cert\.?|reference|ref\.?|serial|diploma|document|award)\s*(?:no\.?|number|nr\.?|#)\s*[:\-]?\s*([A-Z0-9][A-Z0-9\-\/\.]{3,29})/i);
    if (lab) return lab[1].toUpperCase().replace(/[.\-\/]+$/, "");
    const m = t.match(/\b([A-Z]{2,5})\s?[-–—]\s?((?:19|20)\d{2})\s?[-–—]\s?(\d{4,5})\b/);
    return m ? m[1] + "-" + m[2] + "-" + m[3] : "";
  }
  // Document type from the visible text: academic qualification, conference participation,
  // professional certification, or unsupported. CertiGuard verifies academic qualifications only.
  const TYPES = { academic: "Academic qualification", conference: "Conference / event participation", professional: "Professional certification", unsupported: "Unsupported document" };
  function detectType(t) {
    const academic = (t.match(/\b(diploma|bachelor|b\.?sc|b\.?com|honours|master|doctor|degree|higher certificate|national certificate|advanced certificate)\b/gi) || []).length;
    const body = /\b(university|college|institute|academy|school of)\b/i.test(t);
    const conf = (t.match(/\b(conference|symposium|workshop|proceedings|participation|participated|attendance|attended|presenter|presented|keynote|summit|seminar|webinar)\b/gi) || []).length;
    const prof = (t.match(/\b(certified|certification|credential|exam|microsoft|aws|cisco|comptia|pmi|oracle|issued by)\b/gi) || []).length;
    if (academic >= 1 && body && academic >= conf) return "academic";
    if (conf >= 1) return "conference";
    if (prof >= 1 && !academic) return "professional";
    return academic >= 1 ? "academic" : "unsupported";
  }
  // Field parser: heuristics over the OCR lines (labels such as "certify that" / "awarded the").
  function parseFields(text) {
    const lines = text.split(/\r?\n/).map(clean).filter(l => l.length > 2);
    const f = { name: "", number: parseNumber(text), qualification: "", institution: "", date: "" };
    const dl = lines.find(l => /(issue|issued|awarded|conferred|date)/i.test(l) && !/(birth|born|dob)/i.test(l) && parseDate(l));
    f.date = dl ? parseDate(dl) : parseDate(lines.filter(l => !/(birth|born|dob)/i.test(l)).join("\n"));
    // issuing organisation: first matching line near the top of the document (not a footer line)
    const inst = lines.slice(0, Math.max(6, Math.ceil(lines.length * 0.5))).find(l => /\b(university|college|institute|academy)\b/i.test(l) && !/^this is to certify/i.test(l));
    if (inst) f.institution = title(inst.replace(/[^A-Za-z&'\- ]/g, "").trim());
    for (let i = 0; i < lines.length; i++) {
      if (/(certify that|awarded to|presented to|conferred (up)?on)/i.test(lines[i]) && !f.name) {
        const same = lines[i].replace(/.*?(certify that|awarded to|presented to|conferred (up)?on)/i, "").trim();
        f.name = clean((same.length > 3 ? same : lines[i + 1] || "").replace(/[^A-Za-z'\- ]/g, ""));
      }
      if (/(has been awarded|has completed the requirements for|awarded the)/i.test(lines[i]) && !f.qualification) {
        const same = lines[i].replace(/.*?(has been awarded( the)?|has completed the requirements for( the)?|awarded the)/i, "").trim();
        f.qualification = clean((same.length > 3 ? same : lines[i + 1] || "").replace(/[^A-Za-z&'\-() ]/g, ""));
      }
    }
    if (!f.qualification) { const q = lines.find(l => /\b(diploma|bachelor|bsc|bcom|honours|master|degree|certificate in)\b/i.test(l)); if (q) f.qualification = clean(q.replace(/[^A-Za-z&'\-() ]/g, "")); }
    return f;
  }

  const OCR = {
    onProgress(fn) { onProg = fn || (() => { }); },
    // input: canvas or image blob. Returns text, mean confidence (0-100), parsed fields, elapsed ms.
    async extract(src) {
      const t0 = performance.now();
      const w = await getWorker();
      const { data } = await w.recognize(src, {}, { text: true, blocks: true });
      const fields = parseFields(data.text || "");
      const lines = [];
      (data.blocks || []).forEach(b => (b.paragraphs || []).forEach(p => (p.lines || []).forEach(l => lines.push({ text: clean(l.text || ""), bbox: l.bbox }))));
      return { text: data.text || "", confidence: Math.round(data.confidence || 0), fields, lines, docType: detectType(data.text || ""), ms: Math.round(performance.now() - t0) };
    },
    // Finds the OCR line that contains a field value, so the interface can highlight the evidence on the document.
    locate(lines, value) {
      const v = String(value || "").toLowerCase().replace(/[^a-z0-9]/g, ""); if (!v) return null;
      let best = null, bs = 0;
      for (const l of lines) {
        const t = l.text.toLowerCase().replace(/[^a-z0-9]/g, "");
        let s = t.includes(v) ? 1 : 0;
        if (!s) { const toks = String(value).toLowerCase().split(/[^a-z0-9]+/).filter(x => x.length > 1); s = toks.length ? toks.filter(x => t.includes(x)).length / toks.length * 0.9 : 0; }
        if (s > bs) { bs = s; best = l; }
      }
      return bs >= 0.5 ? best : null;
    },
    // OCR for several images (pages of a PDF): text is merged for field parsing, line boxes come from page 1.
    async extractMany(blobs) {
      const t0 = performance.now(); const parts = []; let conf = 0;
      for (let i = 0; i < blobs.length; i++) { onProg(0); parts.push(await OCR.extract(blobs[i])); conf += parts[i].confidence; }
      const text = parts.map(p => p.text).join("\n");
      return { text, confidence: Math.round(conf / parts.length), fields: parseFields(text), lines: parts[0].lines, pages: parts.length, docType: detectType(text), ms: Math.round(performance.now() - t0) };
    },
    TYPES, detectType, parseFields, parseDate, parseNumber
  };
  G.CG.OCR = OCR;
})(window);
