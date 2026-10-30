# CertiGuard v2: functional prototype (ISJ107V Assignment 4)

Browser-based academic certificate verification prototype. Fictional data only.

## What is real
- OCR: Tesseract.js 5 (LSTM neural network, WebAssembly) in a Web Worker; PDF page 1 rendered with pdf.js
- Field parsing and validation, per-field cross-validation against institution records
- Transparent additive fraud-risk score and explanation; evidence boxes from OCR line positions
- Login (PBKDF2-SHA256 hashes), roles, lock-out, hash-chained audit trail, CSP, escaped output
- Persistence in localStorage (users, records, requests, audit)

## What is simplified or not built
- Client-side login and storage (no server); ELA heat-map is display-only (weight 0, AUC 0.16 in evaluation)
- No trained ResNet-50 tamper model and no Grad-CAM/SHAP (future work)

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
