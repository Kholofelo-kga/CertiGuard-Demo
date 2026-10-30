# CertiGuard — Assignment 4 demonstration checklist

## Run
Open `index.html` in a modern browser. For SHA-256, serve over `http://localhost` or HTTPS (for example `python -m http.server 8000` and open `http://localhost:8000`).

Demo credentials: administrator@certiguard.demo / CertiGuard2026. These are public, client-side demonstration credentials, **not secure production authentication**.

## Ten-minute demonstration
1. Sign in and show the dashboard and simulation disclosure.
2. Select Genuine scenario and upload a non-sensitive JPG/PNG/PDF (up to 10 MB).
3. Show file metadata and live SHA-256 fingerprint; review/edit fields.
4. Confirm fields, show simulated classification, risk score and illustrative attention map.
5. Show administrator override with a required justification and persistent audit trail.
6. Reload the page, sign in, and confirm audit history persists in this browser.
7. Repeat with Suspicious and Forged demo scenarios.

## Test cases to run and record actual evidence
- TC01 Valid demo sign-in; incorrect credentials rejected.
- TC02 Valid PDF/JPG/PNG under 10 MB accepted, hash computed on HTTPS/localhost.
- TC03 Unsupported file extension, empty file, or file over 10 MB rejected.
- TC04 Empty certificate field and invalid issue date rejected.
- TC05 Genuine, Suspicious and Forged preset outputs displayed with **simulation** label.
- TC06 Empty override justification rejected; completed override saved.
- TC07 Audit log persists across page reload in same browser.

Record observed pass/fail, screenshots, browser/version and timing. Do not invent measured accuracy or latency. The system does not run OCR, CNN or Grad-CAM models.

## Limitations
- Demo authentication is only a UI gate and can be bypassed by a technically capable user; do not use real personal data.
- `localStorage` is device/browser-local, unencrypted, and not a server database.
- Simulated results are selected by scenario, not derived from document content.
- The illustrative XAI panel is not a computed heatmap.
