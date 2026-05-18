// assets/js/auth.js
import { auth, db } from "../../firebase-config.js";
import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged as _onAuthChanged
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { doc, getDoc }   from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

// ─────────────────────────────────────────────────────────────
// Role → dashboard path map
// ─────────────────────────────────────────────────────────────
const ROLE_PATHS = {
  principal:  "/principal/index.html",
  teacher:    "/teacher/index.html",
  registrar:  "/registrar/index.html",
  scanner:    "/scanner/index.html",
};

// Helper: figure out repo base path for GitHub Pages
// e.g. "https://user.github.io/repo-name" → "/repo-name"
function basePath() {
  const seg = window.location.pathname.split("/");
  // If deployed to GitHub Pages under a sub-path, first segment after /
  // will be the repo name. If served from root (custom domain), return "".
  if (seg.length >= 2 && seg[1] !== "" && !seg[1].includes(".html")) {
    return "/" + seg[1];
  }
  return "";
}

// ─────────────────────────────────────────────────────────────
// login(email, password) → Promise<{ok, error}>
// Signs in, reads role from Firestore, redirects to dashboard.
// ─────────────────────────────────────────────────────────────
async function login(email, password) {
  try {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    const uid  = cred.user.uid;

    const snap = await getDoc(doc(db, "users", uid));
    if (!snap.exists()) {
      await signOut(auth);
      return { ok: false, error: "User profile not found. Contact your administrator." };
    }

    const role = snap.data().role;
    const dest = ROLE_PATHS[role];
    if (!dest) {
      await signOut(auth);
      return { ok: false, error: `Unknown role: "${role}". Contact your administrator.` };
    }

    window.location.href = basePath() + dest;
    return { ok: true };

  } catch (err) {
    let msg = "Login failed. Please try again.";
    if (err.code === "auth/user-not-found" || err.code === "auth/wrong-password" ||
        err.code === "auth/invalid-credential") {
      msg = "Invalid email or password.";
    } else if (err.code === "auth/too-many-requests") {
      msg = "Too many attempts. Please wait and try again.";
    } else if (err.code === "auth/network-request-failed") {
      msg = "Network error. Check your internet connection.";
    }
    return { ok: false, error: msg };
  }
}

// ─────────────────────────────────────────────────────────────
// logout() → signs out, redirects to login page
// ─────────────────────────────────────────────────────────────
async function logout() {
  try { await signOut(auth); } catch (_) {}
  window.location.href = basePath() + "/index.html";
}

// ─────────────────────────────────────────────────────────────
// requireRole(...roles)
// Call at top of every protected page. Redirects to login if
// user is not authenticated or does not hold an allowed role.
// Returns a Promise that resolves to the current user + role.
// ─────────────────────────────────────────────────────────────
function requireRole(...roles) {
  return new Promise((resolve, reject) => {
    const unsub = _onAuthChanged(auth, async (user) => {
      unsub(); // only fire once

      if (!user) {
        window.location.href = basePath() + "/index.html";
        return reject(new Error("Not authenticated"));
      }

      try {
        const snap = await getDoc(doc(db, "users", user.uid));
        if (!snap.exists()) {
          window.location.href = basePath() + "/index.html";
          return reject(new Error("No user profile"));
        }

        const data = snap.data();
        const role = data.role;

        if (roles.length > 0 && !roles.includes(role)) {
          window.location.href = basePath() + "/index.html";
          return reject(new Error("Insufficient role"));
        }

        resolve({ uid: user.uid, email: user.email, name: data.name, role });
      } catch (err) {
        window.location.href = basePath() + "/index.html";
        reject(err);
      }
    });
  });
}

// ─────────────────────────────────────────────────────────────
// onAuthStateChanged wrapper (re-export for convenience)
// ─────────────────────────────────────────────────────────────
function onAuthStateChanged(cb) {
  return _onAuthChanged(auth, cb);
}

export { login, logout, requireRole, onAuthStateChanged, basePath };
