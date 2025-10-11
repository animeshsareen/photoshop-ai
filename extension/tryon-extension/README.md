TryMyClothes – Chrome Extension (Virtual Try‑On)

Overview
- Injects a small panel on pages under /app of your site to upload a person photo and a garment photo.
- Submits a POST to /api/edit-image with fields you_image and clothing_image, using the existing virtual try‑on server logic.
- Runs as a content script so your session cookies and credits are respected by the server.

Install (Developer Mode)
1. Open Chrome → go to chrome://extensions.
2. Enable Developer mode (top right).
3. Click "Load unpacked" and select this folder: extension/tryon-extension.
4. Navigate to your site (e.g., http://localhost:3000/app) and click the floating 👕 button.

Notes
- Must be signed in on the site and have credits; the server enforces both.
- The request is same-origin ("/api/edit-image"), so it works without CORS changes.
- Scope is limited: the UI appears only on /app or pages containing "TryMyClothes" in the body.

Files
- manifest.json: Chrome MV3 manifest.
- content.js: Injected panel, image upload handling, POST to /api/edit-image.
- styles.css: Minimal styling isolated under #tmc-tryon-root.

