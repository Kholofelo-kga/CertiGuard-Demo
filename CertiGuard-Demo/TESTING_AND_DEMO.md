# CertiGuard — testing and demonstration (Assignment 5)

This replaces the Assignment 3 checklist, which described simulated results. The final system runs real OCR (Tesseract.js) and a real tamper-region CNN (ONNX) in the browser.

## Run
- Online: https://certi-guard-demo.vercel.app/
- Offline fallback: `python3 -m http.server 8080` in this folder, open http://localhost:8080

Accounts: administrator@certiguard.demo / CertiGuard#2026 · officer@certiguard.demo / Officer#2026 (public demonstration accounts, stored only as salted PBKDF2 hashes).

## Demonstration order
1. Wrong password → generic error; then log in as administrator.
2. Sample 1 (genuine TUT-2026-10482): OCR review → enter 2026-02-31 → field error → fix → Genuine, 0/100.
3. Sample 2 (altered name UL-2025-77821): Suspicious, 60/100; red box on name, CNN tiles, heat-map; download PDF report.
4. Override with an empty justification (refused), then with a reason; Audit Trail → Verify chain integrity.
5. Institution Records → Edit UL-2025-77821 (try a duplicate number first: refused), save; the change is audit-logged.
6. Reload the page: data persists. Optional: officer account cannot open the Audit Trail; sample 3 → Suspicious 45/100.

## Automated tests
`python3 tests/serve.py 8080` then `BASE_URL=http://localhost:8080 node tests/run-tests.js` (Playwright, headless Chromium) runs TC-01 to TC-30 and the measurements, and writes `tests/results/results.json` and `tests/results/shots/`.

Run of 21 Nov 2026: 30/30 passed, 0 page errors. New in Assignment 5: TC-25 to TC-27 (record edit, deactivate, required fields), TC-28 (browser restart), TC-29 (20 concurrent users), TC-30 (encryption at rest).

| Measure | Result | Target |
|---|---|---|
| Upload-to-result time (10 runs, sample 1) | cold 8.5 s; warm median 7.3 s; p95 7.4 s | ≤ 10 s |
| 20 concurrent users loading the app (20 files, 18.9 MB each) | median 2.0 s; p95 2.1 s; 0 failed requests | ≤ 10 s |
| OCR field accuracy, 20 clean synthetic scans | 100/100 | ≥ 95% |
| OCR on degraded scans | blur 100%, low-res 100%, skew 96% | ≥ 95% |
| CNN on 20 evaluation files | 7/10 altered flagged, 0/10 genuine; AUC 0.98 | indicative |
| CNN held-out synthetic test (600 images, ml/results.json) | accuracy 90.3%, precision 86.6%, recall 83.1%, F1 0.85 | ≥ 95% / 94% (not met) |
| Explanation + heat-map after CNN | 34 ms | ≤ 2,000 ms |
| CNN retraining experiment (ml/a5_experiment) | accuracy 90.6%, precision 92.9%, recall 77.7%; 4/10 false alarms on eval files; not adopted | ≥ 95% / 94% (not met) |
| ELA altered vs genuine | AUC 0.16 → not scored | — |

All test data is synthetic; these numbers do not show performance on real certificates.
