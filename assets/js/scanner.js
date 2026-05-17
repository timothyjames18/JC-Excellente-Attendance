// assets/js/scanner.js
import { requireRole }           from "../assets/js/auth.js";
import { getStudent, logAttendance, getStudentLogsToday, manilaDateTime }
                                  from "../assets/js/firestore.js";

// jsQR is loaded via CDN as a global (window.jsQR)
// Make sure the scanner page loads jsQR before this module.

const COOLDOWN_MS = 3000; // ms before next scan is accepted
let   scanning    = true;
let   lastScan    = 0;
let   stream      = null;
let   animFrame   = null;

// DOM refs — set after DOMContentLoaded
let videoEl, canvasEl, ctx, statusEl, resultEl, errorBannerEl;

// ─────────────────────────────────────────────────────────────
// init() — entry point, called from scanner/index.html
// ─────────────────────────────────────────────────────────────
async function init() {
  videoEl      = document.getElementById("camera-video");
  canvasEl     = document.getElementById("camera-canvas");
  ctx          = canvasEl.getContext("2d", { willReadFrequently: true });
  statusEl     = document.getElementById("scan-status");
  resultEl     = document.getElementById("scan-result");
  errorBannerEl = document.getElementById("error-banner");

  // Auth guard — scanner role OR principal
  try {
    await requireRole("scanner", "principal", "teacher", "registrar");
  } catch {
    return; // requireRole will have already redirected
  }

  await startCamera();
}

// ─────────────────────────────────────────────────────────────
// Camera setup
// ─────────────────────────────────────────────────────────────
async function startCamera() {
  const constraints = {
    video: {
      facingMode: { ideal: "environment" }, // prefer rear camera on phones
      width:  { ideal: 1280 },
      height: { ideal: 720 }
    }
  };

  try {
    stream = await navigator.mediaDevices.getUserMedia(constraints);
    videoEl.srcObject = stream;
    videoEl.setAttribute("playsinline", true);
    await videoEl.play();
    statusEl.textContent = "Point camera at a QR code…";
    requestAnimationFrame(tick);
  } catch (err) {
    console.error("Camera error:", err);
    showCameraError(err);
  }
}

function showCameraError(err) {
  const wrap = document.getElementById("camera-wrap");
  let msg = "Could not access the camera.";
  if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
    msg = "Camera permission denied. Please allow camera access and reload the page.";
  } else if (err.name === "NotFoundError") {
    msg = "No camera found on this device.";
  } else if (err.name === "NotReadableError") {
    msg = "Camera is already in use by another app. Close it and try again.";
  }
  wrap.innerHTML = `
    <div class="camera-error">
      <div class="icon">📷</div>
      <p style="font-weight:700;margin-bottom:8px;">Camera Unavailable</p>
      <p style="font-size:.85rem;">${msg}</p>
      <button class="btn btn-primary mt-4" onclick="location.reload()">Try Again</button>
    </div>`;
}

// ─────────────────────────────────────────────────────────────
// Frame decode loop
// ─────────────────────────────────────────────────────────────
function tick() {
  if (!scanning) return;

  if (videoEl.readyState === videoEl.HAVE_ENOUGH_DATA) {
    canvasEl.height = videoEl.videoHeight;
    canvasEl.width  = videoEl.videoWidth;
    ctx.drawImage(videoEl, 0, 0, canvasEl.width, canvasEl.height);

    const imageData = ctx.getImageData(0, 0, canvasEl.width, canvasEl.height);
    const code      = window.jsQR(imageData.data, imageData.width, imageData.height, {
      inversionAttempts: "dontInvert"
    });

    if (code && code.data) {
      const now = Date.now();
      if (now - lastScan > COOLDOWN_MS) {
        lastScan = now;
        handleScan(code.data);
      }
    }
  }

  animFrame = requestAnimationFrame(tick);
}

// ─────────────────────────────────────────────────────────────
// Scan handler
// ─────────────────────────────────────────────────────────────
async function handleScan(qrCode) {
  scanning = false;
  statusEl.textContent = "Processing…";
  hideError();
  hideResult();

  try {
    const student = await getStudent(qrCode);

    if (!student) {
      showError("QR code not recognized.");
      resumeAfterDelay();
      return;
    }
    if (!student.is_active) {
      showError(`${student.first_name} ${student.last_name} — account is inactive.`);
      resumeAfterDelay();
      return;
    }

    // Determine time_in or time_out
    const todayLogs = await getStudentLogsToday(student.id);
    let   type      = "time_in";
    if (todayLogs.length > 0) {
      type = todayLogs[0].type === "time_in" ? "time_out" : "time_in";
    }

    const logId = await logAttendance(student, type);
    if (!logId) {
      showError("Failed to record attendance. Please try again.");
      resumeAfterDelay();
      return;
    }

    showResult(student, type);
    statusEl.textContent = "Scan recorded! Next scan in 3 seconds…";

    setTimeout(() => {
      hideResult();
      statusEl.textContent = "Point camera at a QR code…";
      scanning = true;
      animFrame = requestAnimationFrame(tick);
    }, COOLDOWN_MS);

  } catch (err) {
    console.error("handleScan error:", err);
    showError("An error occurred. Please try again.");
    resumeAfterDelay();
  }
}

function resumeAfterDelay() {
  setTimeout(() => {
    scanning = true;
    statusEl.textContent = "Point camera at a QR code…";
    animFrame = requestAnimationFrame(tick);
  }, COOLDOWN_MS);
}

// ─────────────────────────────────────────────────────────────
// UI helpers
// ─────────────────────────────────────────────────────────────
function showError(msg) {
  errorBannerEl.textContent = msg;
  errorBannerEl.classList.remove("hidden");
}
function hideError() {
  errorBannerEl.classList.add("hidden");
}

function showResult(student, type) {
  const isIn    = type === "time_in";
  const emoji   = isIn ? "✅" : "👋";
  const label   = isIn ? "Time In" : "Time Out";
  const bgClass = isIn ? "time-in" : "time-out";
  const section = student.section_name || student.section || "No section";
  const timeStr = new Date().toLocaleTimeString("en-PH", {
    timeZone: "Asia/Manila",
    hour: "2-digit", minute: "2-digit", hour12: true
  });

  resultEl.innerHTML = `
    <div class="result-inner">
      <div class="result-header ${bgClass}">
        <div class="result-emoji">${emoji}</div>
        <div class="result-type">${label}</div>
      </div>
      <div class="result-body">
        <div class="result-name">${student.first_name} ${student.last_name}</div>
        <div class="result-section">${section}</div>
        <div class="result-time ${bgClass}">${timeStr}</div>
      </div>
    </div>`;

  resultEl.classList.remove("hidden");
}
function hideResult() {
  resultEl.classList.add("hidden");
  resultEl.innerHTML = "";
}

export { init };
