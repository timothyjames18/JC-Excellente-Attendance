// assets/js/auth.js
import { auth, db, app as primaryApp } from "../../firebase-config.js";
import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged as _onAuthChanged
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

// ─────────────────────────────────────────────────────────────
// Role → dashboard path map
// ─────────────────────────────────────────────────────────────
const ROLE_PATHS = {
  principal:  "/principal/index.html",
  teacher:    "/teacher/index.html",
  registrar:  "/registrar/index.html",
  admin:  "/admin/index.html",
  scanner:    "/scanner/index.html",
};

function basePath() {
  const seg = window.location.pathname.split("/");
  if (seg.length >= 2 && seg[1] !== "" && !seg[1].includes(".html")) {
    return "/" + seg[1];
  }
  return "";
}

// ─────────────────────────────────────────────────────────────
// login(email, password) → Promise<{ok, error}>
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
// createTeacherAccount(name, email, password) → Promise<{ok, uid, error}>
// Called by registrar to provision a new teacher Firebase Auth account
// and write their Firestore user document.
// ─────────────────────────────────────────────────────────────
async function createTeacherAccount(name, email, password) {
  // Use the Firebase Auth REST API so the registrar's SDK auth session is
  // NEVER touched. The SDK's createUserWithEmailAndPassword immediately signs
  // in as the new user and fires onAuthStateChanged, redirecting the registrar
  // page to login before the operation finishes.
  const API_KEY = primaryApp.options.apiKey;
  try {
    // 1. Create the Auth account via REST — does not affect current session
    const signUpRes = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, returnSecureToken: false }),
      }
    );
    const signUpData = await signUpRes.json();
    if (!signUpRes.ok) {
      const code = signUpData?.error?.message || "";
      if (code.includes("EMAIL_EXISTS"))        return { ok: false, error: "That email address is already registered." };
      if (code.includes("INVALID_EMAIL"))       return { ok: false, error: "Invalid email address." };
      if (code.includes("WEAK_PASSWORD"))       return { ok: false, error: "Password must be at least 6 characters." };
      return { ok: false, error: "Failed to create account. (" + code + ")" };
    }
    const uid = signUpData.localId;

    // 2. Write the Firestore user profile (registrar is still signed in — this works)
    await setDoc(doc(db, "users", uid), {
      name,
      email,
      role: "teacher",
      assigned_sections: [],
      created_at: new Date().toISOString(),
    });

    return { ok: true, uid };
  } catch (err) {
    console.error("createTeacherAccount error:", err);
    return { ok: false, error: "Failed to create account. Please try again." };
  }
}

// ─────────────────────────────────────────────────────────────
// logout()
// ─────────────────────────────────────────────────────────────
async function logout() {
  try { await signOut(auth); } catch (_) {}
  window.location.href = basePath() + "/index.html";
}

// ─────────────────────────────────────────────────────────────
// requireRole(...roles)
// ─────────────────────────────────────────────────────────────
function requireRole(...roles) {
  return new Promise((resolve, reject) => {
    const unsub = _onAuthChanged(auth, async (user) => {
      unsub();

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

function onAuthStateChanged(cb) {
  return _onAuthChanged(auth, cb);
}

export { login, logout, requireRole, onAuthStateChanged, basePath, createTeacherAccount };
