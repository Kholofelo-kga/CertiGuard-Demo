# CertiGuard: functional prototype (ISJ107V Assignment 4)

Browser-based academic certificate verification prototype. Fictional data only.

## What is real
- OCR: Tesseract.js 5 (LSTM neural network, WebAssembly) in a Web Worker; first three PDF pages rendered with pdf.js; images enhanced before OCR; per-field OCR evidence and uncertain-field review
- Document-type detection (academic / conference / professional / unsupported); missing fields stay "Not available"; any certificate-number format
- Field parsing and validation, per-field cross-validation against institution records
- Transparent additive fraud-risk score and explanation; evidence boxes from OCR line positions
- Login (PBKDF2-SHA256 hashes), roles, lock-out, hash-chained audit trail, CSP, escaped output
- Tamper-region CNN: ONNX model run in the browser with onnxruntime-web (see section below)
- Persistence in localStorage (users, records, requests, audit)

## What is simplified or not built
- Client-side login and storage (no server); ELA heat-map is display-only (weight 0, AUC 0.16 in evaluation)
- The tamper CNN is small (116k parameters) and trained on synthetic data only; the ResNet-50 and Grad-CAM/SHAP of the original design are future work (a frozen-backbone ResNet-50 trained in Colab stayed at chance, accuracy about 45-52%)

## Accounts
- administrator@certiguard.demo / CertiGuard#2026
- officer@certiguard.demo / Officer#2026

## Run locally
`python3 -m http.server 8080` then open http://localhost:8080

## Deploy
Upload the whole folder to the ROOT of the GitHub repository; Vercel serves it as a static site (vercel.json included).

## Tests
`npm i playwright && npx playwright install chromium` then `BASE_URL=http://localhost:8080 node tests/run-tests.js`
Regenerate sample certificates: `python3 tests/gen_samples.py`


## Tamper-region CNN
`tamper.js` runs `model/tamper_cnn.onnx` in the browser with onnxruntime-web (vendored in `vendor/ort/`). The model (116k parameters) was trained from scratch by `ml/train.py` on synthetic tiles produced by `ml/gen_ml.py` (fictional data, split by institution). Held-out results are in `ml/results.json`. It has not been tested on real certificates and gives false alarms on resized or rotated scans: treat a flag as a reason for manual review. To regenerate: `pip install torch onnx onnxscript onnxruntime scikit-learn`, then `python3 ml/gen_ml.py 600 && python3 ml/train.py`.
