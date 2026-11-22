# CertiGuard — final system (ISJ107V Assignment 5)

Browser-based academic certificate verification with neural-network OCR, a tamper-region CNN and an explainable risk score. Fictional data only.

- Live: https://certi-guard-demo.vercel.app/
- Student: Ramodike MS (217597625), ISJ107V S2 2026

## What the system does
- **OCR:** Tesseract.js 5 (LSTM neural network, WebAssembly) in a Web Worker; first three PDF pages rendered with pdf.js; images enhanced before OCR; per-field OCR evidence and uncertain-field review
- **Document-type detection** (academic / conference / professional / unsupported); missing fields stay "Not available"; any labelled certificate-number format
- **Cross-validation** of five fields against institution records (Matched / Mismatched / Not Found)
- **Tamper-region CNN:** ONNX model (116,369 parameters) run in the browser with onnxruntime-web; tile heat-map and evidence boxes
- **Explainable additive risk score** (0–100) and classification; Forged only when a field contradicts a record
- **PDF verification report** (jsPDF)
- **Security:** PBKDF2-SHA256 password hashes, two roles, lock-out, idle expiry, hash-chained audit trail, CSP, escaped output, file-signature checks
- **Persistence:** localStorage (users, records, requests, audit), every store AES-GCM-256 encrypted at rest with a non-extractable key kept in IndexedDB; altered ciphertext is detected on load
- **Institution records:** add, edit and activate/deactivate (administrator), validated and audit-logged

## Known limits (stated in the presentation)
- Client-side login and enforcement, no server; a technical user could bypass the checks
- The CNN is trained and tested on synthetic certificates only (held-out accuracy 90.3%, target 95%); weak on logo and signature edits; false alarms after resizing or rotation. A retraining in Assignment 5 (ml/a5_experiment/) reached 90.6% but raised more false alarms on independent files and was not adopted
- ELA heat-map is display-only (weight 0, AUC 0.16 in evaluation)
- Institution records are fictional; a Genuine result means "matches the stored record"

## Accounts
- administrator@certiguard.demo / CertiGuard#2026
- officer@certiguard.demo / Officer#2026

## Run locally (also the offline fallback)
`python3 -m http.server 8080`, then open http://localhost:8080. No internet is needed: all libraries and models are in `vendor/` and `model/`.

## Tests
`python3 tests/serve.py 8080`, `npm i playwright && npx playwright install chromium`, then `BASE_URL=http://localhost:8080 node tests/run-tests.js`.
Latest run (21 Nov 2026): 30/30 passed, 0 page errors — `tests/results/results.json`, screenshots in `tests/results/shots/`.

## UML (editable)
`uml/*.puml` are the PlantUML sources; `.svg` and `.png` are renders. Names match the modules and functions in the code.

| File | View |
|---|---|
| 01_use_case | Use cases UC-01 to UC-12 |
| 02_class / 02b_class_key | Full class model / key classes for the slide |
| 03_sequence_verify / 03b_sequence_slide | Verify-certificate sequence, full / condensed |
| 04_activity_verify | Swimlane activity diagram with override |
| 05_component / 05b_component_slide | Component view, full / condensed |
| 06_deployment | GitHub → Vercel → browser, plus local fallback |

Render with any PlantUML tool (e.g. the VS Code PlantUML extension or plantuml.com).

## Tamper-region CNN
`tamper.js` runs `model/tamper_cnn.onnx`. Trained from scratch by `ml/train.py` on synthetic tiles from `ml/gen_ml.py` (split by institution). Held-out results: `ml/results.json`. To regenerate: `pip install torch onnx onnxscript onnxruntime scikit-learn`, then `python3 ml/gen_ml.py 600 && python3 ml/train.py`.

## Deploy
Push to the GitHub repository root; Vercel serves it as a static site (`vercel.json`).
