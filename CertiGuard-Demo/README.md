# CertiGuard Demo

Interactive static prototype of the CertiGuard Academic Certificate Verification System.

## What is live in the browser
- file selection and image/PDF preview
- file size/type/last-modified metadata
- SHA-256 fingerprint calculated from the uploaded file bytes
- editable extracted-field review workflow
- deterministic matching against demo institution records
- session audit trail and printable verification report

## What is demonstrated, not experimentally measured
The OCR extraction, CV tamper probability, ML fraud-risk score and XAI heatmap are interface simulations. They are deliberately labelled so the prototype does not present invented model performance as research evidence. A production implementation would connect the UI to the FastAPI/AI backend.

## Vercel
No build step is required. Set the project Root Directory to `CertiGuard-Demo` if this folder is nested in the GitHub repository, then deploy as a static site.
