// firebase-config.js
// ─────────────────────────────────────────────────────────────
// Firebase v9 modular SDK — loaded via CDN in each HTML page.
// Replace every  ← REPLACE  value with your actual Firebase
// project settings from:
//   Firebase Console → Project Settings → Your apps → Web app
// ─────────────────────────────────────────────────────────────

import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import { getFirestore }  from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";
import { getAuth }       from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";

const firebaseConfig = {
  apiKey:            "AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",  // ← REPLACE WITH YOUR VALUE
  authDomain:        "your-project-id.firebaseapp.com",            // ← REPLACE WITH YOUR VALUE
  projectId:         "your-project-id",                            // ← REPLACE WITH YOUR VALUE
  storageBucket:     "your-project-id.appspot.com",                // ← REPLACE WITH YOUR VALUE
  messagingSenderId: "000000000000",                               // ← REPLACE WITH YOUR VALUE
  appId:             "1:000000000000:web:xxxxxxxxxxxxxxxxxxxxxxxx"  // ← REPLACE WITH YOUR VALUE
};

const app  = initializeApp(firebaseConfig);
const db   = getFirestore(app);
const auth = getAuth(app);

export { app, db, auth };
