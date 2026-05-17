# JCExcellente QR Attendance System — Setup Guide

---

## Overview

| Component | Where it runs | What it does |
|---|---|---|
| GitHub Pages (HTML/JS) | Internet (free) | Login, scanner, teacher, registrar, principal views |
| Firebase Firestore | Google Cloud (free tier) | Database |
| Firebase Auth | Google Cloud (free tier) | User login |
| `watcher.php` | School PC (XAMPP) | Sends SMS + email notifications |
| Android SMS Gateway app | Android phone on school WiFi | Delivers SMS |

---

## Part 1 — Firebase Console Setup

### 1.1 Create the Firebase project

1. Go to [https://console.firebase.google.com](https://console.firebase.google.com)
2. Click **Add project** → name it `jca-attendance`
3. Disable Google Analytics (not needed) → **Create project**

### 1.2 Enable Authentication

1. Left sidebar → **Build → Authentication** → **Get started**
2. **Sign-in method** tab → **Email/Password** → Enable → **Save**

### 1.3 Create user accounts

1. **Authentication → Users** tab → **Add user**
2. Create one account per staff member:
   - principal@jca.edu.ph → strong password
   - teacher@jca.edu.ph   → strong password
   - registrar@jca.edu.ph → strong password
   - scanner@jca.edu.ph   → strong password
3. Note each user's **UID** (shown in the Users table)

### 1.4 Create Firestore database

1. Left sidebar → **Build → Firestore Database** → **Create database**
2. Choose **Start in production mode** → select a region (e.g. `asia-southeast1`) → **Enable**

### 1.5 Create user profile documents

For each user you created in step 1.3:

1. **Firestore → Data** tab → **+ Start collection** → Collection ID: `users`
2. Document ID: paste the user's **UID** from Authentication
3. Add fields:
   ```
   name   (string)  → e.g. "Principal Santos"
   email  (string)  → principal@jca.edu.ph
   role   (string)  → "principal"   (or "teacher" / "registrar" / "scanner")
   ```
4. Repeat for each user.

### 1.6 Create sections collection

1. **Firestore → Data** → **+ Start collection** → `sections`
2. Add one document per section (Document ID: auto-generated):
   ```
   name (string) → "Grade 1 - Mabini"
   ```

### 1.7 Get your Firebase web config

1. **Project Settings** (gear icon) → **General** tab → scroll to **Your apps**
2. Click **</>** (Web) → Register app → nickname: `attendance-web` → **Register app**
3. Copy the `firebaseConfig` object values
4. Open `firebase-config.js` and replace every `← REPLACE WITH YOUR VALUE` placeholder

### 1.8 Firestore Security Rules

1. **Firestore → Rules** tab → Replace everything with:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // Helper: check caller's role
    function role() {
      return get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role;
    }
    function isAnyRole(roles) {
      return request.auth != null && role() in roles;
    }

    // Users can read their own profile; principal can read all
    match /users/{uid} {
      allow read: if request.auth.uid == uid || isAnyRole(['principal']);
      allow write: if false; // managed via Firebase Console only
    }

    // Sections: authenticated users can read; principal can write
    match /sections/{id} {
      allow read:  if request.auth != null;
      allow write: if isAnyRole(['principal', 'registrar']);
    }

    // Students: registrar + principal can read/write; others read-only
    match /students/{id} {
      allow read:  if request.auth != null;
      allow create, update: if isAnyRole(['registrar', 'principal']);
      allow delete: if false; // use is_active = false instead
    }

    // Attendance logs: scanner/all roles can create; teacher+ can read;
    // watcher (service account) updates notified field via Admin SDK
    match /attendance_logs/{id} {
      allow read:   if isAnyRole(['teacher', 'principal', 'registrar', 'scanner']);
      allow create: if isAnyRole(['scanner', 'teacher', 'registrar', 'principal']);
      allow update: if isAnyRole(['principal']); // watcher uses Admin SDK (bypasses rules)
      allow delete: if false;
    }
  }
}
```

2. Click **Publish**

---

## Part 2 — GitHub Pages Deployment

### 2.1 Create the GitHub repository

1. Go to [https://github.com](https://github.com) → **New repository**
2. Name it `jca-attendance` → **Public** → **Create repository**

### 2.2 Push the web files

From the project root (the folder containing `index.html`, `scanner/`, etc.):

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/jca-attendance.git
git push -u origin main
```

### 2.3 Enable GitHub Pages

1. Repository → **Settings** → **Pages** (left sidebar)
2. Source: **Deploy from a branch** → Branch: `main` → Folder: `/ (root)` → **Save**
3. Your site will be live at:
   `https://YOUR_USERNAME.github.io/jca-attendance/`

### 2.4 Important: Firebase authorized domain

1. Firebase Console → **Authentication → Settings → Authorized domains**
2. Click **Add domain** → paste `YOUR_USERNAME.github.io` → **Add**

---

## Part 3 — School PC Setup (watcher.php)

### 3.1 Requirements

- XAMPP installed (for PHP 8.1+)
- PHP accessible from the command line
- Internet access during school hours

Verify PHP version:
```bash
php --version
# Should output: PHP 8.1.x or newer
```

### 3.2 Get the Firebase service account key

1. Firebase Console → **Project Settings** → **Service accounts** tab
2. Click **Generate new private key** → **Generate key**
3. Save the downloaded `.json` file as `firebase-credentials.json`
4. Place it in the `school-pc/` folder (next to `watcher.php`)

⚠️ **Keep this file secret. Never push it to GitHub.**

### 3.3 Configure the school PC files

Edit `school-pc/includes/config.php`:

```php
define('MAIL_FROM',     'your-gmail@gmail.com');
define('MAIL_PASSWORD', 'xxxx xxxx xxxx xxxx');  // Gmail App Password
define('SMS_GATEWAY_URL',  'http://192.168.1.X:8080'); // Android phone IP
define('SMS_GATEWAY_USER', 'admin');
define('SMS_GATEWAY_PASS', 'your-app-password');
```

### 3.4 Install Composer dependencies

```bash
cd school-pc
composer install
```

This installs `kreait/firebase-php` and `phpmailer/phpmailer` into `vendor/`.

### 3.5 Run the watcher

```bash
cd school-pc
php watcher.php
```

You'll see live output like:
```
────────────────────────────────────────────────────────────
JCExcellente QR Attendance — Notification Watcher
PID: 1234 | Polling every 5 seconds
Press Ctrl+C to stop.
────────────────────────────────────────────────────────────
[08:12:35] No unnotified logs. Waiting…
[08:15:02] Processing log xK7mNpQ2 — Juan Dela Cruz (time_in)
  SMS → ✓ sent to +639171234567
  Email → ✓ sent to parent@email.com
  Firestore → notified = true
```

Keep the terminal window open during school hours. Stop with `Ctrl+C`.

---

## Part 4 — Android SMS Gateway Setup

1. On the school's Android phone, open Google Play → search **"SMS Gateway"** by capcom
2. Install and open the app
3. Note the **IP address and port** shown on the main screen (e.g. `192.168.1.105:8080`)
4. Tap **Settings** → set a username and password
5. Make sure the phone is connected to the same WiFi as the school PC
6. Update `SMS_GATEWAY_URL`, `SMS_GATEWAY_USER`, `SMS_GATEWAY_PASS` in `config.php`

---

## Part 5 — Gmail App Password (for PHPMailer)

1. Go to [https://myaccount.google.com](https://myaccount.google.com)
2. **Security** → Turn on **2-Step Verification** (if not already on)
3. **Security** → **App passwords** → Select app: **Mail** → Select device: **Windows Computer**
4. Click **Generate** → copy the 16-character password (format: `xxxx xxxx xxxx xxxx`)
5. Paste it into `MAIL_PASSWORD` in `config.php`

---

## File Structure Summary

```
GitHub repo (push these):
├── index.html
├── firebase-config.js       ← fill in your config values
├── assets/
│   ├── css/style.css
│   ├── images/logo.png
│   └── js/
│       ├── auth.js
│       ├── firestore.js
│       └── scanner.js
├── scanner/index.html
├── teacher/index.html
├── registrar/
│   ├── index.html
│   └── qr-print.html
└── principal/index.html

School PC only (NEVER push to GitHub):
school-pc/
├── watcher.php
├── composer.json
├── firebase-credentials.json   ← downloaded from Firebase Console
├── vendor/                     ← created by composer install
└── includes/
    ├── config.php
    ├── sms.php
    └── email.php
```

---

## Troubleshooting

| Problem | Solution |
|---|---|
| Login says "User profile not found" | Make sure the Firestore `users/{uid}` document exists with a `role` field |
| Scanner doesn't see camera | Allow camera in browser permissions; use HTTPS (GitHub Pages is HTTPS) |
| SMS not sending | Check phone is on same WiFi; verify IP/port in config.php; check app is running |
| Email not sending | Check Gmail App Password; make sure 2FA is enabled on the Gmail account |
| `watcher.php` crashes | Check PHP version (≥8.1); run `composer install`; verify credentials JSON path |
| Firestore permission denied | Check security rules are published; verify user role in Firestore |
