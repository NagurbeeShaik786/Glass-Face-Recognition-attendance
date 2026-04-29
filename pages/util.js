// Shared helpers used across pages.

export async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* non-json */
  }
  if (!res.ok) {
    const msg = (data && data.error) || `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return data;
}

export function toast(message, kind = "info", ttl = 3200) {
  const stack = document.getElementById("toast-stack");
  if (!stack) return;
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.innerHTML = `
    <span class="dot ${kind === "success" ? "ok" : kind === "error" ? "err" : ""}"></span>
    <span>${escapeHtml(message)}</span>
  `;
  stack.appendChild(el);
  setTimeout(() => {
    el.style.transition = "opacity .25s ease, transform .25s ease";
    el.style.opacity = "0";
    el.style.transform = "translateY(8px)";
    setTimeout(() => el.remove(), 260);
  }, ttl);
}

export function escapeHtml(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function initials(name) {
  if (!name) return "?";
  const parts = name
    .trim()
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean);
  return (parts[0] || "") + (parts[1] || "");
}

export function avatar(person, sizeClass = "") {
  if (person && person.thumbnail) {
    return `<img class="avatar ${sizeClass}" src="${person.thumbnail}" alt="${escapeHtml(person.name)}" />`;
  }
  const name = (person && person.name) || "?";
  return `<div class="avatar avatar-fallback ${sizeClass}">${escapeHtml(initials(name).toUpperCase())}</div>`;
}

export function timeAgo(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 5) return "just now";
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return d.toLocaleDateString();
}

export function formatDate(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function formatTime(time) {
  if (!time) return "";
  // time is "HH:MM:SS"
  const [h, m] = time.split(":");
  const hour = parseInt(h, 10);
  const period = hour >= 12 ? "PM" : "AM";
  const h12 = ((hour + 11) % 12) + 1;
  return `${h12}:${m} ${period}`;
}

export function pageHead({ title, subtitle, actions = "" }) {
  return `
    <header class="page-head">
      <div>
        <h1 class="page-title">${escapeHtml(title)}</h1>
        ${subtitle ? `<p class="page-subtitle">${escapeHtml(subtitle)}</p>` : ""}
      </div>
      <div style="display:flex; gap:10px; align-items:center;">${actions}</div>
    </header>
  `;
}

// Webcam helper: requests the user's camera and binds to a <video> element.
// Returns an object with `stop()`.
export async function startWebcam(videoEl, constraints = {}) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      width: { ideal: 960 },
      height: { ideal: 720 },
      facingMode: "user",
      ...constraints,
    },
  });
  videoEl.srcObject = stream;
  await videoEl.play();
  return {
    stream,
    stop() {
      try {
        for (const t of stream.getTracks()) t.stop();
      } catch {
        /* ignore */
      }
      try {
        videoEl.srcObject = null;
      } catch {
        /* ignore */
      }
    },
  };
}

// Capture a still frame from a video as a JPEG data URL.
export function captureFrame(videoEl, maxWidth = 640) {
  const w = videoEl.videoWidth;
  const h = videoEl.videoHeight;
  if (!w || !h) return null;
  const scale = Math.min(1, maxWidth / w);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.85);
}

export function confidenceClass(conf) {
  if (conf >= 60) return "conf-high";
  if (conf >= 40) return "conf-med";
  return "conf-low";
}
