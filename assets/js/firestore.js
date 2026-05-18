// assets/js/firestore.js
import { auth, db } from "../../firebase-config.js";
import {
  collection, doc,
  getDoc, getDocs, addDoc, updateDoc, setDoc, deleteDoc,
  query, where, orderBy, onSnapshot,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

// ─────────────────────────────────────────────────────────────
// Manila time helpers
// ─────────────────────────────────────────────────────────────
function manilaDate() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" }); // YYYY-MM-DD
}
function manilaDateTime() {
  const d = new Date();
  return d.toLocaleString("sv-SE", { timeZone: "Asia/Manila" }).replace("T", " "); // YYYY-MM-DD HH:mm:ss
}

// ─────────────────────────────────────────────────────────────
// Students
// ─────────────────────────────────────────────────────────────

/** Query one student by QR code. Returns the student object (with .id) or null. */
async function getStudent(qrCode) {
  try {
    const q    = query(collection(db, "students"), where("qr_code", "==", qrCode));
    const snap = await getDocs(q);
    if (snap.empty) return null;
    const d = snap.docs[0];
    return { id: d.id, ...d.data() };
  } catch (err) {
    console.error("getStudent error:", err);
    return null;
  }
}

/** Query one student by RFID code. Returns the student object (with .id) or null. */
async function getStudentByRFID(rfidCode) {
  try {
    const q    = query(collection(db, "students"), where("rfid_code", "==", rfidCode));
    const snap = await getDocs(q);
    if (snap.empty) return null;
    const d = snap.docs[0];
    return { id: d.id, ...d.data() };
  } catch (err) {
    console.error("getStudentByRFID error:", err);
    return null;
  }
}

/** Fetch all active students. Returns array sorted by last name. */
async function getStudents() {
  try {
    const q    = query(collection(db, "students"), where("is_active", "==", true));
    const snap = await getDocs(q);
    const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    docs.sort((a, b) => (a.last_name || "").localeCompare(b.last_name || ""));
    return docs;
  } catch (err) {
    console.error("getStudents error:", err);
    return [];
  }
}

/** Fetch ALL students (including inactive) for registrar list. */
async function getAllStudents() {
  try {
    const q    = query(collection(db, "students"), orderBy("last_name"));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.error("getAllStudents error:", err);
    return [];
  }
}

/** Add a new student. Returns the new document ID or null. */
async function addStudent(data) {
  try {
    const ref = await addDoc(collection(db, "students"), {
      ...data,
      is_active: true,
      created_at: serverTimestamp()
    });
    return ref.id;
  } catch (err) {
    console.error("addStudent error:", err);
    return null;
  }
}

/** Update student fields by Firestore doc ID. Returns true/false. */
async function updateStudent(id, data) {
  try {
    await updateDoc(doc(db, "students", id), {
      ...data,
      updated_at: serverTimestamp()
    });
    return true;
  } catch (err) {
    console.error("updateStudent error:", err);
    return false;
  }
}

/** Soft-delete: set is_active = false. */
async function deactivateStudent(id) {
  return updateStudent(id, { is_active: false });
}

// ─────────────────────────────────────────────────────────────
// Sections
// ─────────────────────────────────────────────────────────────

/** Fetch all sections. Returns array sorted by name. */
async function getSections() {
  try {
    const q    = query(collection(db, "sections"), orderBy("name"));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.error("getSections error:", err);
    return [];
  }
}

/** Add a new section. Returns the new document ID or null. */
async function addSection(data) {
  try {
    const ref = await addDoc(collection(db, "sections"), {
      ...data,
      is_active: true,
      created_at: serverTimestamp()
    });
    return ref.id;
  } catch (err) {
    console.error("addSection error:", err);
    return null;
  }
}

/** Update section fields. Returns true/false. */
async function updateSection(id, data) {
  try {
    await updateDoc(doc(db, "sections", id), {
      ...data,
      updated_at: serverTimestamp()
    });
    return true;
  } catch (err) {
    console.error("updateSection error:", err);
    return false;
  }
}

/** Deactivate a section (soft delete). Returns true/false. */
async function deactivateSection(id) {
  return updateSection(id, { is_active: false });
}

// ─────────────────────────────────────────────────────────────
// Users / Teachers
// ─────────────────────────────────────────────────────────────

/** Fetch all users with role=teacher. Returns array sorted by name. */
async function getTeachers() {
  try {
    const q    = query(collection(db, "users"), where("role", "==", "teacher"));
    const snap = await getDocs(q);
    const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    docs.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    return docs;
  } catch (err) {
    console.error("getTeachers error:", err);
    return [];
  }
}

/** Update user document (e.g. assigned_sections). Returns true/false. */
async function updateUser(id, data) {
  try {
    await updateDoc(doc(db, "users", id), {
      ...data,
      updated_at: serverTimestamp()
    });
    return true;
  } catch (err) {
    console.error("updateUser error:", err);
    return false;
  }
}

/** Fetch a single user document by UID. Returns object or null. */
async function getUser(uid) {
  try {
    const snap = await getDoc(doc(db, "users", uid));
    if (!snap.exists()) return null;
    return { id: snap.id, ...snap.data() };
  } catch (err) {
    console.error("getUser error:", err);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// Audit Logs
// ─────────────────────────────────────────────────────────────

/**
 * Write an audit log entry.
 * actorUid: UID of the person performing the action
 * actorName: display name
 * action: short verb, e.g. "add_student", "edit_student", "deactivate_student", "add_section"
 * target: human-readable subject, e.g. "Juan dela Cruz (2024-0001)"
 * details: object with changed fields (before/after if available)
 */
async function writeAuditLog(actorUid, actorName, action, target, details = {}) {
  try {
    await addDoc(collection(db, "audit_logs"), {
      actor_uid:   actorUid,
      actor_name:  actorName,
      action,
      target,
      details,
      timestamp:   serverTimestamp(),
      date:        manilaDate(),
      datetime:    manilaDateTime(),
    });
  } catch (err) {
    console.error("writeAuditLog error:", err);
  }
}

// ─────────────────────────────────────────────────────────────
// Attendance
// ─────────────────────────────────────────────────────────────

/**
 * Write a new attendance log. studentData must include:
 *   id, first_name, last_name, section (string), parent_email, parent_phone
 * type: "time_in" | "time_out"
 * Returns the new log ID or null.
 */
async function logAttendance(studentData, type) {
  try {
    const scanTime = manilaDateTime();
    const date     = manilaDate();
    const ref = await addDoc(collection(db, "attendance_logs"), {
      student_id:   studentData.id,
      student_name: `${studentData.first_name} ${studentData.last_name}`,
      section:      studentData.section_name || studentData.section || "No section",
      section_id:   studentData.section_id || null,
      type,
      scan_time:    scanTime,
      date,
      parent_email: studentData.parent_email || "",
      parent_phone: studentData.parent_phone || "",
      notified:     false,
    });
    return ref.id;
  } catch (err) {
    console.error("logAttendance error:", err);
    return null;
  }
}

/**
 * Fetch today's logs for this student to determine time_in / time_out.
 * Returns array of logs sorted by scan_time desc.
 */
async function getStudentLogsToday(studentId) {
  try {
    const today = manilaDate();
    const q = query(
      collection(db, "attendance_logs"),
      where("student_id", "==", studentId),
      where("date", "==", today)
    );
    const snap = await getDocs(q);
    const logs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    logs.sort((a, b) => b.scan_time.localeCompare(a.scan_time));
    return logs;
  } catch (err) {
    console.error("getStudentLogsToday error:", err);
    return [];
  }
}

/**
 * Fetch all attendance logs for a date.
 * Returns array sorted by scan_time asc.
 */
async function getAttendanceByDate(date) {
  try {
    const q = query(
      collection(db, "attendance_logs"),
      where("date", "==", date)
    );
    const snap = await getDocs(q);
    const logs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    logs.sort((a, b) => a.scan_time.localeCompare(b.scan_time));
    return logs;
  } catch (err) {
    console.error("getAttendanceByDate error:", err);
    return [];
  }
}

/**
 * Fetch attendance logs for a date range, optionally filtered by section.
 * dateFrom, dateTo: "YYYY-MM-DD" strings (inclusive).
 */
async function getAttendanceByRange(dateFrom, dateTo, sectionFilter) {
  try {
    const q = query(
      collection(db, "attendance_logs"),
      where("date", ">=", dateFrom),
      where("date", "<=", dateTo)
    );
    const snap = await getDocs(q);
    let logs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (sectionFilter) {
      logs = logs.filter(l => l.section === sectionFilter);
    }
    logs.sort((a, b) => a.date.localeCompare(b.date) || a.scan_time.localeCompare(b.scan_time));
    return logs;
  } catch (err) {
    console.error("getAttendanceByRange error:", err);
    return [];
  }
}

/**
 * Real-time listener for attendance on a specific date, optionally filtered by section_id.
 * Calls callback(logs) every time data changes.
 * Returns the unsubscribe function.
 */
function watchAttendanceByDate(date, callback, sectionId = null) {
  let q;
  if (sectionId) {
    q = query(
      collection(db, "attendance_logs"),
      where("date", "==", date),
      where("section_id", "==", sectionId)
    );
  } else {
    q = query(
      collection(db, "attendance_logs"),
      where("date", "==", date)
    );
  }
  return onSnapshot(q, (snap) => {
    const logs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    logs.sort((a, b) => a.scan_time.localeCompare(b.scan_time));
    callback(logs);
  }, (err) => {
    console.error("watchAttendanceByDate error:", err);
  });
}

export {
  // students
  getStudent, getStudentByRFID, getStudents, getAllStudents,
  addStudent, updateStudent, deactivateStudent,
  // sections
  getSections, addSection, updateSection, deactivateSection,
  // users/teachers
  getTeachers, updateUser, getUser,
  // audit logs
  writeAuditLog,
  // attendance
  logAttendance, getStudentLogsToday,
  getAttendanceByDate, getAttendanceByRange, watchAttendanceByDate,
  // helpers
  manilaDate, manilaDateTime,
};
