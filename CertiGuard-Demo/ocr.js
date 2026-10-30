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
  function parseNumber(t) {
    const m = t.match(/\b([A-Z]{2,5})\s?[-–—]\s?((?:19|20)\d{2})\s?[-–—]\s?(\d{4,5})\b/);
    return m ? m[1] + "-" + m[2] + "-" + m[3] : "";
  }
  // Field parser: heuristics over the OCR lines (labels such as "certify that" / "awarded the").
  function parseFields(text) {
    const lines = text.split(/\r?\n/).map(clean).filter(l => l.length > 2);
    const f = { name: "", number: parseNumber(text), qualification: "", institution: "", date: parseDate(text) };
    const inst = lines.find(l => /\b(university|college|institute)\b/i.test(l) && !/^this is to certify/i.test(l));
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
      return { text: data.text || "", confidence: Math.round(data.confidence || 0), fields, lines, ms: Math.round(performance.now() - t0) };
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
    parseFields, parseDate, parseNumber
  };
  G.CG.OCR = OCR;
})(window);
