(() => {
  if (document.getElementById("tmc-tryon-root")) return; // prevent duplicate injection

  const el = document.createElement("div");
  el.id = "tmc-tryon-root";
  el.innerHTML = `
    <div class="tmc-panel" role="dialog" aria-label="TryMyClothes extension">
      <div class="tmc-header">
        <span class="tmc-title">TryMyClothes – Virtual Try‑On</span>
        <button class="tmc-close" aria-label="Close">×</button>
      </div>
      <div class="tmc-body">
        <div class="tmc-row">
          <label class="tmc-label">Your Photo</label>
          <input type="file" accept="image/*" id="tmc-you" />
        </div>
        <div class="tmc-row">
          <label class="tmc-label">Garment Photo</label>
          <input type="file" accept="image/*" id="tmc-garment" />
        </div>
        <div class="tmc-actions">
          <button id="tmc-try" class="tmc-btn">Try On Outfit</button>
          <span id="tmc-status" class="tmc-status" aria-live="polite"></span>
        </div>
        <div id="tmc-result" class="tmc-result" hidden>
          <img id="tmc-result-img" alt="Virtual try-on result" />
          <div class="tmc-result-actions">
            <button id="tmc-download" class="tmc-btn-secondary">Download</button>
          </div>
        </div>
      </div>
      <div class="tmc-hint">Signed-in and credits are required. The request runs against <code>/api/edit-image</code> on this site using your session.</div>
    </div>
    <button class="tmc-fab" id="tmc-open" title="Open TryMyClothes">👕</button>
  `;
  document.documentElement.appendChild(el);

  const $ = (sel) => el.querySelector(sel);
  const openBtn = $("#tmc-open");
  const closeBtn = $(".tmc-close");
  const panel = $(".tmc-panel");
  const youInput = $("#tmc-you");
  const garmentInput = $("#tmc-garment");
  const tryBtn = $("#tmc-try");
  const statusEl = $("#tmc-status");
  const resultWrap = $("#tmc-result");
  const resultImg = $("#tmc-result-img");
  const downloadBtn = $("#tmc-download");

  const setStatus = (msg, isError = false) => {
    statusEl.textContent = msg || "";
    statusEl.classList.toggle("tmc-error", Boolean(isError));
  };

  const togglePanel = (show) => {
    panel.style.display = show ? "block" : "none";
  };

  togglePanel(false);

  openBtn.addEventListener("click", () => togglePanel(true));
  closeBtn.addEventListener("click", () => togglePanel(false));

  downloadBtn.addEventListener("click", () => {
    const src = resultImg.getAttribute("src");
    if (!src) return;
    const a = document.createElement("a");
    a.href = src;
    a.download = "tryon-result.png";
    document.body.appendChild(a);
    a.click();
    a.remove();
  });

  tryBtn.addEventListener("click", async () => {
    try {
      setStatus("");
      resultWrap.hidden = true;

      const youFile = youInput.files && youInput.files[0];
      const garmentFile = garmentInput.files && garmentInput.files[0];
      if (!youFile || !garmentFile) {
        setStatus("Upload your photo and a garment image.", true);
        return;
      }

      setStatus("Uploading images and generating…");
      tryBtn.disabled = true;

      const form = new FormData();
      form.append("you_image", youFile);
      form.append("clothing_image", garmentFile);
      form.append("prompt", ""); // server uses strict try-on prompt

      // Use same-origin endpoint; as a content script, this sends cookies by default.
      const res = await fetch("/api/edit-image", { method: "POST", body: form, credentials: "include" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        let msg = data?.error || `Failed (${res.status})`;
        if (res.status === 401) msg = "Not signed in. Sign in on this site, then retry.";
        if (res.status === 402) msg = "Insufficient credits. Purchase credits and retry.";
        setStatus(msg, true);
        return;
      }

      const url = data?.editedImageUrl;
      if (!url) {
        setStatus("No image returned.", true);
        return;
      }
      resultImg.src = url;
      resultWrap.hidden = false;
      setStatus("Done");
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Unexpected error", true);
    } finally {
      tryBtn.disabled = false;
    }
  });
})();
