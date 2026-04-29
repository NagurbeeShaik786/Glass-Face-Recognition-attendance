import {
  api,
  pageHead,
  startWebcam,
  captureFrame,
  toast,
  escapeHtml,
} from "./util.js";

const REQUIRED_SAMPLES = 5;

export function renderEnroll() {
  return `
    ${pageHead({
      title: "Enroll Person",
      subtitle: `Capture ${REQUIRED_SAMPLES} clear face samples — vary your angle slightly between shots.`,
    })}

    <section class="split">
      <div class="panel glass-panel">
        <h3>Live Camera</h3>
        <div class="cam-wrap">
          <video id="enroll-video" autoplay playsinline muted></video>
          <canvas id="enroll-overlay"></canvas>
          <div class="cam-status">
            <span class="dot" id="enroll-dot"></span>
            <span id="enroll-status">Starting camera...</span>
          </div>
          <div class="cam-placeholder" id="enroll-placeholder" style="display:none;"></div>
        </div>

        <div style="display:flex; gap:10px; margin-top:14px;">
          <button class="btn btn-primary" id="capture-btn" disabled>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="4"/><path d="M5 7h2l1.5-2h7L17 7h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z"/></svg>
            Capture sample
          </button>
          <button class="btn btn-ghost" id="reset-btn" type="button">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>
            Reset
          </button>
        </div>
      </div>

      <div class="panel glass-panel">
        <h3>Person Details</h3>
        <form id="enroll-form" style="display:flex; flex-direction:column; gap:14px;">
          <div class="field">
            <label class="field-label" for="name">Full Name</label>
            <input class="input" id="name" name="name" placeholder="e.g. Aria Patel" autocomplete="off" required />
          </div>
          <div class="field">
            <label class="field-label" for="role">Role</label>
            <input class="input" id="role" name="role" placeholder="Student, Engineer, Faculty..." autocomplete="off" />
          </div>
          <div class="field">
            <label class="field-label" for="department">Department</label>
            <input class="input" id="department" name="department" placeholder="Computer Science, Operations..." autocomplete="off" />
          </div>

          <div>
            <div class="field-label" style="margin-bottom:6px;">Face samples (<span id="sample-count">0</span>/${REQUIRED_SAMPLES})</div>
            <div class="sample-grid" id="sample-grid"></div>
          </div>

          <button class="btn btn-primary" id="save-btn" type="submit" disabled style="margin-top:6px;">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
            <span id="save-label">Save & Train</span>
          </button>
        </form>
      </div>
    </section>
  `;
}

export async function mountEnroll(node) {
  const video = node.querySelector("#enroll-video");
  const overlay = node.querySelector("#enroll-overlay");
  const placeholder = node.querySelector("#enroll-placeholder");
  const captureBtn = node.querySelector("#capture-btn");
  const resetBtn = node.querySelector("#reset-btn");
  const sampleGrid = node.querySelector("#sample-grid");
  const sampleCount = node.querySelector("#sample-count");
  const form = node.querySelector("#enroll-form");
  const saveBtn = node.querySelector("#save-btn");
  const saveLabel = node.querySelector("#save-label");
  const statusText = node.querySelector("#enroll-status");
  const statusDot = node.querySelector("#enroll-dot");

  let cam = null;
  let detectTimer = null;
  let lastBoxes = [];
  let samples = [];

  function renderSamples() {
    const slots = [];
    for (let i = 0; i < REQUIRED_SAMPLES; i++) {
      if (samples[i]) {
        slots.push(`<div class="sample-thumb"><img src="${samples[i]}" alt="" /></div>`);
      } else {
        slots.push(`<div class="sample-thumb placeholder">${i + 1}</div>`);
      }
    }
    sampleGrid.innerHTML = slots.join("");
    sampleCount.textContent = samples.length;
    saveBtn.disabled = samples.length < 3;
  }
  renderSamples();

  async function detectLoop() {
    if (!video.videoWidth) return;
    const data = captureFrame(video, 320);
    if (!data) return;
    try {
      const res = await api("/srv/detect", {
        method: "POST",
        body: JSON.stringify({ image: data }),
      });
      lastBoxes = res.faces;
      drawBoxes(res.faces, res.width, res.height);
      const ok = res.faces.length === 1;
      captureBtn.disabled = !ok || samples.length >= REQUIRED_SAMPLES;
      if (samples.length >= REQUIRED_SAMPLES) {
        statusText.textContent = "All samples captured";
        statusDot.classList.add("ok");
        statusDot.classList.remove("err");
      } else if (res.faces.length === 0) {
        statusText.textContent = "Looking for a face...";
        statusDot.classList.remove("ok", "err");
      } else if (res.faces.length > 1) {
        statusText.textContent = "Multiple faces — only one at a time";
        statusDot.classList.add("err");
        statusDot.classList.remove("ok");
      } else {
        statusText.textContent = "Face detected · ready to capture";
        statusDot.classList.add("ok");
        statusDot.classList.remove("err");
      }
    } catch (e) {
      // soft-fail; loop continues
    }
  }

  function drawBoxes(boxes, srcW, srcH) {
    const rect = video.getBoundingClientRect();
    overlay.width = rect.width * devicePixelRatio;
    overlay.height = rect.height * devicePixelRatio;
    overlay.style.width = rect.width + "px";
    overlay.style.height = rect.height + "px";
    const ctx = overlay.getContext("2d");
    ctx.scale(devicePixelRatio, devicePixelRatio);
    ctx.clearRect(0, 0, rect.width, rect.height);
    if (!boxes || !srcW) return;
    const sx = rect.width / srcW;
    const sy = rect.height / srcH;
    for (const b of boxes) {
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = boxes.length === 1 ? "rgba(52,211,153,.95)" : "rgba(251,191,36,.95)";
      ctx.shadowColor = ctx.strokeStyle;
      ctx.shadowBlur = 10;
      const x = b.x * sx;
      const y = b.y * sy;
      const w = b.w * sx;
      const h = b.h * sy;
      const r = 12;
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
      ctx.stroke();
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  try {
    cam = await startWebcam(video);
    statusText.textContent = "Camera ready";
    detectTimer = setInterval(detectLoop, 400);
  } catch (e) {
    placeholder.style.display = "grid";
    placeholder.innerHTML = `
      <div>
        <div class="empty-icon" style="margin-bottom:12px;">
          <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M1 1l22 22"/><path d="M14 11.5V14l-3-3h2.5"/><path d="M21 12c0 .55-.04 1.09-.12 1.62"/><path d="M5 7H3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h12"/><path d="M22 8l-5 5"/></svg>
        </div>
        <strong style="color:var(--text);">Camera blocked</strong><br/>
        Allow camera access in your browser to continue.
      </div>
    `;
    statusText.textContent = "Camera unavailable";
    statusDot.classList.add("err");
  }

  captureBtn.addEventListener("click", () => {
    if (samples.length >= REQUIRED_SAMPLES) return;
    const frame = captureFrame(video, 640);
    if (!frame) {
      toast("Could not capture frame", "error");
      return;
    }
    samples.push(frame);
    renderSamples();
    toast(`Sample ${samples.length} captured`, "success", 1400);
  });

  resetBtn.addEventListener("click", () => {
    samples = [];
    renderSamples();
  });

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (samples.length < 3) return;
    const fd = new FormData(form);
    const name = (fd.get("name") || "").trim();
    if (!name) {
      toast("Please enter a name", "error");
      return;
    }
    saveBtn.disabled = true;
    saveLabel.textContent = "Saving...";
    try {
      const res = await api("/srv/people", {
        method: "POST",
        body: JSON.stringify({
          name,
          role: fd.get("role") || "",
          department: fd.get("department") || "",
          images: samples,
        }),
      });
      toast(`Enrolled ${res.person.name} (${res.training.samples} samples)`, "success");
      samples = [];
      renderSamples();
      form.reset();
    } catch (e) {
      toast(e.message, "error", 5000);
    } finally {
      saveBtn.disabled = samples.length < 3;
      saveLabel.textContent = "Save & Train";
    }
  });

  return () => {
    if (detectTimer) clearInterval(detectTimer);
    if (cam) cam.stop();
  };
}
