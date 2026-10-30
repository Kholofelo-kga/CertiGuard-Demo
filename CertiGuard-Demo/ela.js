/* CertiGuard v2 - Computer-vision integrity service (emerging-technology component 2).
   Error Level Analysis (ELA): the image is re-compressed as JPEG (quality 0.90) and the per-pixel
   difference is measured. Regions edited after the original compression usually show a different
   error level. This is a classical image-forensics heuristic, NOT the ResNet-50 CNN of the
   Assignment 2 design, and it is only meaningful for JPEG/PNG scans (not PDF). */
(function (G) {
  "use strict";
  const MAXDIM = 1200, GRID = 24, Q = 0.90;

  function toCanvas(bmp) {
    const s = Math.min(1, MAXDIM / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas"); c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
    const x = c.getContext("2d", { willReadFrequently: true }); x.drawImage(bmp, 0, 0, c.width, c.height); return c;
  }
  const blobOf = (c, type, q) => new Promise(r => c.toBlob(r, type, q));

  const ELA = {
    // thresholds were fixed before evaluation; their discrimination is measured and reported (Assignment 4, Section 4.2)
    CFG: { zCut: 3.5, minAbs: 2.0, scoreK: 400 },
    async analyse(blob) {
      const t0 = performance.now();
      const bmp = await createImageBitmap(blob);
      const c1 = toCanvas(bmp); const W = c1.width, H = c1.height;
      const orig = c1.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, W, H).data;
      const jb = await blobOf(c1, "image/jpeg", Q);
      const c2 = toCanvas(await createImageBitmap(jb));
      const rec = c2.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, W, H).data;
      const cw = Math.ceil(W / GRID), cols = GRID, rows = Math.ceil(H / cw);
      const err = new Float32Array(cols * rows), ink = new Uint8Array(cols * rows);
      for (let by = 0; by < rows; by++) for (let bx = 0; bx < cols; bx++) {
        let sum = 0, n = 0, lo = 255, hi = 0;
        for (let y = by * cw; y < Math.min(H, (by + 1) * cw); y++) for (let x = bx * cw; x < Math.min(W, (bx + 1) * cw); x++) {
          const i = (y * W + x) * 4;
          sum += (Math.abs(orig[i] - rec[i]) + Math.abs(orig[i + 1] - rec[i + 1]) + Math.abs(orig[i + 2] - rec[i + 2])) / 3; n++;
          const l = (orig[i] + orig[i + 1] + orig[i + 2]) / 3; if (l < lo) lo = l; if (l > hi) hi = l;
        }
        err[by * cols + bx] = sum / n; ink[by * cols + bx] = (hi - lo) > 60 ? 1 : 0; // block contains printed content
      }
      const content = []; err.forEach((e, i) => { if (ink[i]) content.push(e); });
      let anomalies = [], score = 0, med = 0, mad = 0;
      if (content.length >= 8) {
        const s = content.slice().sort((a, b) => a - b); med = s[s.length >> 1];
        const dev = s.map(v => Math.abs(v - med)).sort((a, b) => a - b); mad = Math.max(dev[dev.length >> 1] * 1.4826, 0.25);
        err.forEach((e, i) => { if (ink[i] && e > ELA.CFG.minAbs && (e - med) / mad > ELA.CFG.zCut) anomalies.push({ bx: i % cols, by: (i / cols) | 0, z: +((e - med) / mad).toFixed(1) }); });
        // Isolated blocks are noise; clustered blocks are evidence. Keep blocks with a neighbouring anomaly.
        const set = new Set(anomalies.map(a => a.bx + "," + a.by));
        const clustered = anomalies.filter(a => { for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) if ((dx || dy) && set.has((a.bx + dx) + "," + (a.by + dy))) return true; return false; });
        anomalies = clustered;
        score = Math.min(100, Math.round(ELA.CFG.scoreK * anomalies.length / content.length));
      }
      // heat-map overlay for the explanation panel
      const hm = document.createElement("canvas"); hm.width = W; hm.height = H; const hx = hm.getContext("2d");
      hx.drawImage(c1, 0, 0); hx.fillStyle = "rgba(255,255,255,.35)"; hx.fillRect(0, 0, W, H);
      const zmax = Math.max(6, ...anomalies.map(a => a.z));
      err.forEach((e, i) => {
        if (!ink[i]) return; const z = (e - med) / mad; if (z <= 1.5) return;
        const a = Math.min(.75, .15 + z / zmax * .6);
        hx.fillStyle = z > ELA.CFG.zCut ? "rgba(220,38,38," + a + ")" : "rgba(245,158,11," + (a * .6) + ")";
        hx.fillRect((i % cols) * cw, ((i / cols) | 0) * cw, cw, cw);
      });
      anomalies.forEach(a => { hx.strokeStyle = "#b91c1c"; hx.lineWidth = 2; hx.strokeRect(a.bx * cw, a.by * cw, cw, cw); });
      return { score, anomalyBlocks: anomalies.length, contentBlocks: content.length, median: +med.toFixed(2), mad: +mad.toFixed(2), anomalies, heatmap: hm, width: W, height: H, ms: Math.round(performance.now() - t0) };
    }
  };
  G.CG.ELA = ELA;
})(window);
