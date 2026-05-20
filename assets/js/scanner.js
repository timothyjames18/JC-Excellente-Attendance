// assets/js/scanner.js
import { requireRole } from "./auth.js";
import { logAttendance, getStudents, getStudentLogsToday, manilaDateTime, manilaDate }
    from "./firestore.js";

// jsQR is loaded via CDN as a global (window.jsQR)

const COOLDOWN_MS = 3000;
const CACHE_TTL_MS = 60 * 60 * 1000; // refresh student cache every 1 hour

let scanning = true;
let lastScan = 0;
let stream = null;
let animFrame = null;

// RFID keyboard-wedge state
let rfidBuffer = "";
let rfidTimer = null;
const RFID_TIMEOUT_MS = 100;

// DOM refs
let videoEl, canvasEl, ctx, statusEl, resultEl, errorBannerEl, rfidInputEl, rfidModeEl;

// ─────────────────────────────────────────────────────────────
// Cache 1: Student lookup — keyed by qr_code and rfid_code
// Loaded once on startup, refreshed every hour.
// Eliminates getStudent / getStudentByRFID Firestore reads.
// ─────────────────────────────────────────────────────────────
let studentByQR = new Map(); // qr_code   → student object
let studentByRFID = new Map(); // rfid_code → student object
let cacheLoadedAt = 0;

async function loadStudentCache() {
    try {
        const students = await getStudents(); // one read fetches all active students
        studentByQR.clear();
        studentByRFID.clear();
        for (const s of students) {
            if (s.qr_code) studentByQR.set(s.qr_code, s);
            if (s.rfid_code) studentByRFID.set(s.rfid_code, s);
        }
        cacheLoadedAt = Date.now();
        console.log(`[scanner] Student cache loaded: ${students.length} students`);
    } catch (err) {
        console.error("[scanner] Failed to load student cache:", err);
    }
}

async function refreshCacheIfNeeded() {
    if (Date.now() - cacheLoadedAt >= CACHE_TTL_MS) {
        console.log("[scanner] Refreshing student cache…");
        await loadStudentCache();
    }
}

function getStudentFromCache(qrCode) {
    return studentByQR.get(qrCode) ?? null;
}

function getStudentByRFIDFromCache(rfidCode) {
    return studentByRFID.get(rfidCode) ?? null;
}

// ─────────────────────────────────────────────────────────────
// Cache 2: Today's scan type tracker — keyed by student.id
// Tracks the last scan type locally so we never need to query
// getStudentLogsToday from Firestore again after page load.
// ─────────────────────────────────────────────────────────────
// Map: studentId → last scan type ("time_in" | "time_out")
let lastScanType = new Map();
let scanDateStr = "";  // tracks which date the cache is valid for

async function initScanTypeCache() {
    // Load today's existing logs once on startup so we know
    // which students already timed in before the page opened.
    // This is the only time getStudentLogsToday is called — on init.
    scanDateStr = manilaDate();
    // We don't preload per-student here — too many reads.
    // Instead we load on first scan per student, then track locally.
}

function getTodayNextType(studentId) {
    // If we have a local record, derive next type from it — 0 reads
    if (lastScanType.has(studentId)) {
        return lastScanType.get(studentId) === "time_in" ? "time_out" : "time_in";
    }
    // Unknown — need to ask Firestore once for this student today
    return null; // signals caller to fetch
}

function recordScan(studentId, type) {
    // Reset cache if date has changed (past midnight)
    const today = manilaDate();
    if (today !== scanDateStr) {
        lastScanType.clear();
        scanDateStr = today;
    }
    lastScanType.set(studentId, type);
}

// ─────────────────────────────────────────────────────────────
// Determine next scan type for a student
// Costs 0 reads if already seen today, 1 read on first scan
// ─────────────────────────────────────────────────────────────
async function resolveNextType(studentId) {
    const cached = getTodayNextType(studentId);
    if (cached !== null) return cached; // 0 reads

    // First time this student scans today — ask Firestore once
    const logs = await getStudentLogsToday(studentId); // 1 read
    if (logs.length === 0) return "time_in";
    return logs[0].type === "time_in" ? "time_out" : "time_in";
}

// ─────────────────────────────────────────────────────────────
// init() — entry point
// ─────────────────────────────────────────────────────────────
async function init() {
    videoEl = document.getElementById("camera-video");
    canvasEl = document.getElementById("camera-canvas");
    ctx = canvasEl.getContext("2d", { willReadFrequently: true });
    statusEl = document.getElementById("scan-status");
    resultEl = document.getElementById("scan-result");
    errorBannerEl = document.getElementById("error-banner");
    rfidInputEl = document.getElementById("rfid-input");
    rfidModeEl = document.getElementById("rfid-mode-indicator");

    try {
        await requireRole("scanner", "principal", "teacher", "registrar");
    } catch {
        return;
    }

    // Load student cache before allowing scans
    statusEl.textContent = "Loading student data…";
    await loadStudentCache();
    await initScanTypeCache();

    setupRFIDListener();
    document.getElementById("tab-qr-btn").addEventListener("click", () => switchTab("qr"));
    document.getElementById("tab-rfid-btn").addEventListener("click", () => switchTab("rfid"));

    await startCamera();
}

// ─────────────────────────────────────────────────────────────
// RFID keyboard-wedge listener
// ─────────────────────────────────────────────────────────────
function setupRFIDListener() {
    document.addEventListener("keydown", (e) => {
        const rfidPanel = document.getElementById("rfid-panel");
        if (!rfidPanel || rfidPanel.classList.contains("hidden")) return;
        if (e.key.length > 1 && e.key !== "Enter") return;

        if (e.key === "Enter") {
            const uid = rfidBuffer.trim();
            rfidBuffer = "";
            clearTimeout(rfidTimer);
            if (uid) handleRFIDScan(uid);
            return;
        }

        rfidBuffer += e.key;
        clearTimeout(rfidTimer);
        rfidTimer = setTimeout(() => {
            const uid = rfidBuffer.trim();
            rfidBuffer = "";
            if (uid) handleRFIDScan(uid);
        }, RFID_TIMEOUT_MS);
    });

    rfidInputEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            e.preventDefault();
            const uid = rfidInputEl.value.trim();
            rfidInputEl.value = "";
            if (uid) handleRFIDScan(uid);
        }
    });
}

// ─────────────────────────────────────────────────────────────
// Tab switcher
// ─────────────────────────────────────────────────────────────
function switchTab(tab) {
    const qrPanel = document.getElementById("qr-panel");
    const rfidPanel = document.getElementById("rfid-panel");
    const qrBtn = document.getElementById("tab-qr-btn");
    const rfidBtn = document.getElementById("tab-rfid-btn");

    if (tab === "qr") {
        qrPanel.classList.remove("hidden");
        rfidPanel.classList.add("hidden");
        qrBtn.classList.add("tab-active");
        rfidBtn.classList.remove("tab-active");
        statusEl.textContent = "Point camera at a QR code…";
        scanning = true;
        animFrame = requestAnimationFrame(tick);
    } else {
        qrPanel.classList.add("hidden");
        rfidPanel.classList.remove("hidden");
        rfidBtn.classList.add("tab-active");
        qrBtn.classList.remove("tab-active");
        scanning = false;
        cancelAnimationFrame(animFrame);
        statusEl.textContent = "Ready — tap or swipe an RFID card…";
        rfidInputEl.focus();
    }
}

// ─────────────────────────────────────────────────────────────
// RFID scan handler — 0 Firestore reads after first scan/student
// ─────────────────────────────────────────────────────────────
async function handleRFIDScan(rfidCode) {
    const now = Date.now();
    if (now - lastScan < COOLDOWN_MS) return;
    lastScan = now;

    statusEl.textContent = "Processing…";
    hideError();
    hideResult();

    if (rfidModeEl) {
        rfidModeEl.textContent = `Card: ${rfidCode}`;
        rfidModeEl.classList.remove("hidden");
        setTimeout(() => rfidModeEl.classList.add("hidden"), 3000);
    }

    try {
        await refreshCacheIfNeeded();

        // 0 reads — served from cache
        const student = getStudentByRFIDFromCache(rfidCode);

        if (!student) {
            showError("RFID card not recognized. Please register this card in the Registrar.");
            setTimeout(() => {
                hideError();
                statusEl.textContent = "Ready — tap or swipe an RFID card…";
            }, COOLDOWN_MS);
            return;
        }
        if (!student.is_active) {
            showError(`${student.first_name} ${student.last_name} — account is inactive.`);
            setTimeout(() => {
                hideError();
                statusEl.textContent = "Ready — tap or swipe an RFID card…";
            }, COOLDOWN_MS);
            return;
        }

        // 0 reads if scanned before today, 1 read on very first scan of the day
        const type = await resolveNextType(student.id);

        const logId = await logAttendance(student, type);
        if (!logId) {
            showError("Failed to record attendance. Please try again.");
            setTimeout(() => {
                hideError();
                statusEl.textContent = "Ready — tap or swipe an RFID card…";
            }, COOLDOWN_MS);
            return;
        }

        // Record locally so next scan costs 0 reads
        recordScan(student.id, type);

        showResult(student, type);
        statusEl.textContent = "Scan recorded! Next scan in 3 seconds…";

        setTimeout(() => {
            hideResult();
            statusEl.textContent = "Ready — tap or swipe an RFID card…";
            rfidInputEl.focus();
        }, COOLDOWN_MS);

    } catch (err) {
        console.error("handleRFIDScan error:", err);
        showError("An error occurred. Please try again.");
        setTimeout(() => {
            hideError();
            statusEl.textContent = "Ready — tap or swipe an RFID card…";
        }, COOLDOWN_MS);
    }
}

// ─────────────────────────────────────────────────────────────
// Camera
// ─────────────────────────────────────────────────────────────
async function startCamera() {
    try {
        stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }
        });
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
        canvasEl.width = videoEl.videoWidth;
        ctx.drawImage(videoEl, 0, 0, canvasEl.width, canvasEl.height);

        const imageData = ctx.getImageData(0, 0, canvasEl.width, canvasEl.height);
        const code = window.jsQR(imageData.data, imageData.width, imageData.height, {
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
// QR scan handler — 0 Firestore reads after first scan/student
// ─────────────────────────────────────────────────────────────
async function handleScan(qrCode) {
    scanning = false;
    statusEl.textContent = "Processing…";
    hideError();
    hideResult();

    try {
        await refreshCacheIfNeeded();

        // 0 reads — served from cache
        const student = getStudentFromCache(qrCode);

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

        // 0 reads if scanned before today, 1 read on very first scan of the day
        const type = await resolveNextType(student.id);

        const logId = await logAttendance(student, type);
        if (!logId) {
            showError("Failed to record attendance. Please try again.");
            resumeAfterDelay();
            return;
        }

        // Record locally so next scan costs 0 reads
        recordScan(student.id, type);

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
    const isIn = type === "time_in";
    const emoji = isIn ? "✅" : "👋";
    const label = isIn ? "Time In" : "Time Out";
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