/* CertiGuard v3 - tamper-region CNN (emerging-technology component 2).
   A small convolutional network (116k parameters, trained from scratch on synthetic certificates, see ml/) is exported to ONNX and run in the
   browser with onnxruntime-web (WebAssembly). The page is resized to 1400 px width and cut into 64x64 grey tiles; every tile gets a "possibly edited" probability.
   The image score is the mean of the three highest tile probabilities. Tiles above the threshold are shown as suspected-edit regions.
   It was trained and tested ONLY on synthetic certificates: it is decision support, not proof of forgery. */
(function (G) {
  "use strict";
  const T = 64, WIDTH = 1400; let session = null;
  const CFG = { thr: 0.9811 };   // chosen on the validation split only (maximises validation F1)
  async function load() {
    if (session) return session;
    ort.env.wasm.wasmPaths = new URL("vendor/ort/", document.baseURI).href; ort.env.wasm.numThreads = 1; ort.env.wasm.proxy = false;
    session = await ort.InferenceSession.create("model/tamper_cnn.onnx", { executionProviders: ["wasm"] });
    return session;
  }
  const Tamper = {
    CFG,
    async analyse(blob) {
      const t0 = performance.now(), sess = await load(), bmp = await createImageBitmap(blob);
      const w = WIDTH, h = Math.max(T, Math.round(bmp.height * WIDTH / bmp.width));
      const c = document.createElement("canvas"); c.width = w; c.height = h; const x = c.getContext("2d", { willReadFrequently: true });
      x.imageSmoothingQuality = "medium"; x.drawImage(bmp, 0, 0, w, h);
      const px = x.getImageData(0, 0, w, h).data, g = new Float32Array(w * h);
      for (let i = 0; i < w * h; i++) g[i] = Math.round(0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2]) / 255;
      const cols = Math.floor(w / T), rows = Math.floor(h / T), n = cols * rows, inp = new Float32Array(n * T * T);
      for (let r = 0; r < rows; r++) for (let q = 0; q < cols; q++) { const o = (r * cols + q) * T * T; for (let yy = 0; yy < T; yy++) for (let xx = 0; xx < T; xx++) inp[o + yy * T + xx] = g[(r * T + yy) * w + q * T + xx]; }
      const out = await sess.run({ x: new ort.Tensor("float32", inp, [n, 1, T, T]) }), p = Array.from(out.p.data);
      const top = p.slice().sort((a, b) => b - a).slice(0, 3), score = top.reduce((a, b) => a + b, 0) / top.length;
      const regions = []; p.forEach((v, i) => { if (v >= CFG.thr) regions.push({ x: (i % cols) * T / w, y: Math.floor(i / cols) * T / h, w: T / w, h: T / h, p: v }); });
      return { score, flagged: score >= CFG.thr, regions, tiles: n, cols, rows, probs: p, ms: Math.round(performance.now() - t0) };
    }
  };
  // Model-based heat-map: every tile coloured by its tile probability (white = unlikely, purple to red = likely edited)
  Tamper.heatmap = function (c) {
    const cv = document.createElement("canvas"); cv.width = c.cols * 8; cv.height = c.rows * 8; const x = cv.getContext("2d");
    c.probs.forEach((p, i) => { const a = Math.max(0, (p - 0.5) / 0.5); if (a <= 0) return; x.fillStyle = `rgba(${Math.round(124 + 120 * a)},${Math.round(58 * (1 - a))},${Math.round(237 - 150 * a)},${(0.15 + 0.6 * a).toFixed(2)})`; x.fillRect((i % c.cols) * 8, Math.floor(i / c.cols) * 8, 8, 8); });
    return cv;
  };
  G.CG.Tamper = Tamper;
})(window);
