/* CertiGuard v2 - OCR service (emerging-technology component 1).
   Tesseract.js 5 (LSTM neural-network OCR compiled to WebAssembly) runs fully in the browser;
   the certificate never leaves the user's device.
   Field extraction is rule-based: a value is filled in only when the document text supports it,
   otherwise the field stays empty ("Not available") and is never guessed. */
(function (G) {
  "use strict";
  let worker = null, worker2 = null, onProg = () => { };
  const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  const pad = n => String(n).padStart(2, "0");
  const title = s => s.toLowerCase().replace(/\b([a-z])/g, m => m.toUpperCase()).replace(/\b(Of|The|And|In)\b/g, m => m.toLowerCase());
  const clean = s => s.replace(/[|_~=]+/g, " ").replace(/\s+/g, " ").trim();
  const allCaps = s => s === s.toUpperCase() && /[A-Z]/.test(s);
  const norm = s => allCaps(s) ? title(s) : s;
  const letters = s => s.replace(/[^A-Za-z'&\-() ]/g, "").replace(/^(?:[A-Za-z]\s+)+/, "");

  async function getWorker() {
    if (worker) return worker;
    worker = await Tesseract.createWorker("eng", 1, {
      workerPath: "vendor/tess/worker.min.js", corePath: "vendor/tess/core", langPath: "vendor/tess/lang", workerBlobURL: false,
      logger: m => { if (m.status === "recognizing text") onProg(m.progress); }
    });
    return worker;
  }
  async function getWorker2() {
    if (worker2) return worker2;
    worker2 = await Tesseract.createWorker("eng", 1, { workerPath: "vendor/tess/worker.min.js", corePath: "vendor/tess/core", langPath: "vendor/tess/lang", workerBlobURL: false });
    await worker2.setParameters({ tessedit_pageseg_mode: "7" });   // dedicated single-line worker: never changes the main worker's settings
    return worker2;
  }
  function validIso(y, m, d) {
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d && y >= 1930 && y <= 2100;
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
  // Certificate number: only a LABELLED value ("Certificate No", "Serial", "Ref") or the PREFIX-YEAR-NUMBER pattern.
  // Other numbers on the page are returned as unassigned identifier candidates, never guessed.
  function parseNumber(t) {
    const lab = t.match(/\b(?:(?:certificate|cert\.?|diploma|document|award)\s*(?:no\.?|number|nr\.?|#)|(?:reference|ref\.?|serial)\s*(?:no\.?|number|nr\.?|#)?)\s*[:\-]?\s*([A-Z0-9][A-Z0-9\-\/\.]{3,29})/i);
    if (lab) return lab[1].toUpperCase().replace(/[.\-\/]+$/, "");
    const m = t.match(/\b([A-Z]{2,5})\s?[-–—]\s?((?:19|20)\d{2})\s?[-–—]\s?(\d{4,5})\b/);
    return m ? m[1] + "-" + m[2] + "-" + m[3] : "";
  }
  const TYPES = { academic: "Academic qualification", conference: "Conference / event participation", professional: "Professional certification", unsupported: "Unsupported document" };
  function detectType(t) {
    const academic = (t.match(/\b(diploma|bachelor|b\.?sc|b\.?com|honours|master|doctor|degree|higher certificate|national certificate|advanced certificate)\b/gi) || []).length;
    const body = /\b(university|college|institute|academy|polytechnic|school of)\b/i.test(t);
    const conf = (t.match(/\b(conference|symposium|workshop|proceedings|participation|participated|attendance|attended|presenter|presented|keynote|summit|seminar|webinar|presentation|program chair|organi[sz]ing|poster|paper|certificate of appreciation)\b/gi) || []).length;
    const prof = (t.match(/\b(certified|certification|credential|exam|microsoft|aws|cisco|comptia|pmi|oracle|issued by)\b/gi) || []).length;
    if (academic >= 1 && body && academic >= conf) return "academic";
    if (conf >= 1) return "conference";
    if (prof >= 1 && !academic) return "professional";
    return academic >= 1 ? "academic" : "unsupported";
  }
  const PART = /^(van|von|der|den|de|du|le|la|di|da|bin|al|el|mc|mac|st|jr|sr|ii|iii)$/i;
  const plausibleName = s => { if (/\b(has|been|awarded|the|certify|this|that|diploma|degree|certificate|university|college|institute|date|number)\b/i.test(s)) return false; const t0 = s.trim().split(/\s+/); if (t0.some(w => w.length <= 2 && !PART.test(w))) return false; return plausibleName0(s); };
  const plausibleName0 = s => { const t = s.trim().split(/\s+/); return t.length >= 2 && t.length <= 6 && t.every(w => /^[A-Za-z'\-]{2,}$/.test(w)) && /[aeiouAEIOU]/.test(s); };
  const goodLine = s => s && s.length >= 3 && (s.replace(/[^A-Za-z]/g, "").length / s.length) > 0.6;
  // Joins a continuation line ("in Computer Science", "of Technology") to a title that wraps over two lines.
  function joinCont(lines, i, text, re) {
    let q = text;
    for (let k = 1; k <= 2; k++) {
      const n = lines[i + k];
      if (n && n.length < 60 && re.test(q + "|" + n) && !/(this is|awarded|date|certify|conferred|number|birth)/i.test(n) && goodLine(n) && /^(in|of|and|specialising|majoring)\b/i.test(n)) q = q + " " + n; else break;
    }
    return q;
  }
  // Returns the extracted fields plus metadata about how reliable they are.
  function analyse(text) {
    const lines = text.split(/\r?\n/).map(clean).filter(l => l.length > 2);
    const f = { name: "", number: parseNumber(text), qualification: "", institution: "", date: "" };
    const meta = { dateUncertain: false, identifiers: [], dateCandidates: [] };
    // ---- dates: separate labelled issue dates from birth dates and other dates ----
    const dated = lines.map(l => ({ l, d: parseDate(l) })).filter(x => x.d);
    const birth = x => /(birth|born|dob)/i.test(x.l);
    const issue = dated.find(x => /(issue|issued|awarded|conferred|graduat|date of)/i.test(x.l) && !birth(x));
    const others = dated.filter(x => !birth(x));
    meta.dateCandidates = dated.map(x => x.d);
    if (issue) f.date = issue.d;
    else if (others.length === 1) { f.date = others[0].d; meta.dateUncertain = true; }
    else if (others.length > 1) { f.date = others.map(x => x.d).sort().pop(); meta.dateUncertain = true; }  // latest non-birth date, flagged for review
    // ---- institution (top half of the page, joined across wrapped lines) ----
    const top = Math.max(6, Math.ceil(lines.length * 0.5));
    const ii = lines.slice(0, top).findIndex(l => /\b(university|college|institute|academy|polytechnic)\b/i.test(l) && !/^this is to certify/i.test(l));
    if (ii >= 0) f.institution = norm(clean(letters(joinCont(lines, ii, lines[ii], /university|college|institute/i)))); 
    // ---- name and qualification from the wording around them ----
    for (let i = 0; i < lines.length; i++) {
      if (!f.name && /(certify that|awarded to|presented to|conferred (up)?on|this certificate is awarded)/i.test(lines[i])) {
        const same = lines[i].replace(/.*?(certify that|awarded to|presented to|conferred (up)?on|this certificate is awarded)/i, "").trim();
        for (const c of [same, lines[i + 1], lines[i + 2]]) { const cand = clean(letters(c || "")); if (plausibleName(cand)) { f.name = norm(cand); break; } }
      }
      if (!f.qualification && /(has been awarded|has completed the requirements for|awarded the|qualification)/i.test(lines[i])) {
        const same = lines[i].replace(/.*?(has been awarded( the)?|has completed the requirements for( the)?|awarded the|qualification:?)/i, "").trim();
        const start = goodLine(same) ? same : lines[i + 1], at = goodLine(same) ? i : i + 1;
        if (goodLine(start)) f.qualification = norm(clean(letters(joinCont(lines, at, start, /diploma|degree|bachelor|certificate|honours|master/i))));
      }
    }
    if (!f.qualification) {
      const qi = lines.findIndex(l => /\b(diploma|bachelor|bsc|bcom|honours|master|degree|certificate in)\b/i.test(l) && !/^this is/i.test(l));
      if (qi >= 0) f.qualification = norm(clean(letters(joinCont(lines, qi, lines[qi], /diploma|degree|bachelor|certificate|honours|master/i))));
    }
    // ---- other identifiers: listed, not assigned ----
    const ids = new Set(); const noDates = text.replace(/\b\d{4}[-\/.]\d{1,2}[-\/.]\d{1,2}\b/g, " ");
    (noDates.match(/\b[A-Z]{1,4}\d{4,8}\b/g) || []).forEach(x => ids.add(x)); (noDates.match(/\b\d{8,13}\b/g) || []).forEach(x => ids.add(x));
    ids.delete(f.number); meta.identifiers = [...ids].slice(0, 6);
    return { fields: f, meta };
  }
  const parseFields = text => analyse(text).fields;

  const OCR = {
    onProgress(fn) { onProg = fn || (() => { }); },
    // image preparation: upscale small scans and stretch contrast, which helps small or faint text
    async enhance(blob) {
      const bmp = await createImageBitmap(blob); const s = Math.min(3, Math.max(1, 2400 / bmp.width));
      const c = document.createElement("canvas"); c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
      const x = c.getContext("2d", { willReadFrequently: true }); x.imageSmoothingQuality = "high"; x.drawImage(bmp, 0, 0, c.width, c.height);
      const im = x.getImageData(0, 0, c.width, c.height), d = im.data, hist = new Uint32Array(256);
      for (let i = 0; i < d.length; i += 4) { const g = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0; d[i] = d[i + 1] = d[i + 2] = g; hist[g]++; }
      const tot = d.length / 4; let acc = 0, lo = 0, hi = 255; for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc > tot * 0.01) { lo = v; break; } }
      acc = 0; for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc > tot * 0.01) { hi = v; break; } }
      const rng = Math.max(40, hi - lo); for (let i = 0; i < d.length; i += 4) { const g = Math.max(0, Math.min(255, ((d[i] - lo) * 255) / rng)); d[i] = d[i + 1] = d[i + 2] = g; }
      x.putImageData(im, 0, 0);
      return { blob: await new Promise(r => c.toBlob(r, "image/png")), scale: c.width / bmp.width };
    },
    // input: image blob. Returns text, mean confidence (0-100), parsed fields + reliability metadata, line boxes (own pixel space).
    async extract(src, opts) {
      const t0 = performance.now(); const w = await getWorker();
      const run = async () => { const { data } = await w.recognize(src, {}, { text: true, blocks: true }); const lines = [];
        (data.blocks || []).forEach(b => (b.paragraphs || []).forEach(p => (p.lines || []).forEach(l => lines.push({ text: clean(l.text || ""), bbox: l.bbox, conf: Math.round(l.confidence || 0) }))));
        return { text: data.text || "", conf: Math.round(data.confidence || 0), lines }; };
      let r = await run(), a = analyse(r.text);
      // second pass in sparse-text mode when a key field is missing (finds text scattered across the page)
      if (!(opts && opts.single) && (!a.fields.name || !a.fields.institution || !a.fields.qualification)) {
        try { await w.setParameters({ tessedit_pageseg_mode: "11" }); const r2 = await run(); await w.setParameters({ tessedit_pageseg_mode: "3" });
          const merged = r.text + "\n" + r2.text, a2 = analyse(merged);
          for (const k of ["name", "institution", "qualification"]) if (!a.fields[k] && a2.fields[k]) a.fields[k] = a2.fields[k];
          r.text = merged; r.lines = r.lines.concat(r2.lines.filter(l2 => !r.lines.some(l1 => l1.text === l2.text)));
        } catch (e) { /* second pass is optional */ }
      }
      // name safety: a low-confidence name is re-read from a cropped, binarised copy of its line; if still unreliable it is left empty
      const nm = a.fields.name; let nameUnread = false;
      if (nm) {
        const ln = OCR.locate(r.lines, nm);
        if (!ln || ln.conf < 75) {
          let got = "";
          try { if (ln) { const rr = await OCR.rereadLine(src, ln.bbox); const cand = clean(letters(rr.text.replace(/^.*?(awarded to|presented to|certify that|conferred on)\s*/i, ""))); if (rr.conf >= 70 && plausibleName(cand)) got = norm(cand); } } catch (e) { }
          if (got) a.fields.name = got; else { a.fields.name = ""; nameUnread = true; }
        }
      }
      a.meta.nameUnread = nameUnread;
      return { text: r.text, confidence: r.conf, fields: a.fields, meta: a.meta, lines: r.lines, docType: detectType(r.text), ms: Math.round(performance.now() - t0) };
    },
    // re-read one line: crop, upscale, binarise (Otsu), single-line mode
    async rereadLine(src, bbox) {
      const bmp = await createImageBitmap(src), pad = 10;
      const x0 = Math.max(0, bbox.x0 - pad), y0 = Math.max(0, bbox.y0 - pad), w0 = Math.min(bmp.width - x0, bbox.x1 - bbox.x0 + 2 * pad), h0 = Math.min(bmp.height - y0, bbox.y1 - bbox.y0 + 2 * pad);
      const k = Math.min(4, Math.max(2, 140 / Math.max(1, h0))), c = document.createElement("canvas"); c.width = Math.round(w0 * k); c.height = Math.round(h0 * k);
      const x = c.getContext("2d", { willReadFrequently: true }); x.imageSmoothingQuality = "high"; x.drawImage(bmp, x0, y0, w0, h0, 0, 0, c.width, c.height);
      const im = x.getImageData(0, 0, c.width, c.height), d = im.data, hist = new Array(256).fill(0);
      for (let i = 0; i < d.length; i += 4) { const g = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0; d[i] = g; hist[g]++; }
      const tot = d.length / 4; let sum = 0; for (let t = 0; t < 256; t++) sum += t * hist[t];
      let sB = 0, wB = 0, best = 0, th = 128; for (let t = 0; t < 256; t++) { wB += hist[t]; if (!wB) continue; const wF = tot - wB; if (!wF) break; sB += t * hist[t]; const mB = sB / wB, mF = (sum - sB) / wF, v = wB * wF * (mB - mF) * (mB - mF); if (v > best) { best = v; th = t; } }
      for (let i = 0; i < d.length; i += 4) { const v = d[i] > th ? 255 : 0; d[i] = d[i + 1] = d[i + 2] = v; } x.putImageData(im, 0, 0);
      const blob = await new Promise(r => c.toBlob(r, "image/png")), w = await getWorker2();
      const { data } = await w.recognize(blob); return { text: clean(data.text || ""), conf: Math.round(data.confidence || 0) };
    },
    async extractMany(blobs) {
      const t0 = performance.now(); const parts = []; let conf = 0;
      for (let i = 0; i < blobs.length; i++) { onProg(0); parts.push(await OCR.extract(blobs[i], { single: true })); conf += parts[i].confidence; }
      const text = parts.map(p => p.text).join("\n"), a = analyse(text);
      // names were already safety-checked per page; use the checked value, not a re-parse of the merged text
      const pn = parts.find(p => p.fields.name); a.fields.name = pn ? pn.fields.name : ""; a.meta.nameUnread = !a.fields.name && parts.some(p => p.meta.nameUnread);
      return { text, confidence: Math.round(conf / parts.length), fields: a.fields, meta: a.meta, lines: parts[0].lines, pages: parts.length, docType: detectType(text), ms: Math.round(performance.now() - t0) };
    },
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
    TYPES, detectType, analyse, parseFields, parseDate, parseNumber
  };
  G.CG.OCR = OCR;
})(window);
