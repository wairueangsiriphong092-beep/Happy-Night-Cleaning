// ======================================================
// Happy Night Cleaning - Firebase Core
// GitHub Pages + Firebase Authentication + Cloud Firestore
// ======================================================

import { initializeApp }
  from "https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js";

import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";

import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  collection,
  getDocs,
  onSnapshot,
  serverTimestamp,
  writeBatch
} from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";


// ======================================================
// Firebase Configuration
// ======================================================

const firebaseConfig = {
  apiKey: "AIzaSyBC9FHZENjOXX91Kcx_DTEXA1wjv8bys5E",
  authDomain: "happy-night-cleaning.firebaseapp.com",
  projectId: "happy-night-cleaning",
  storageBucket: "happy-night-cleaning.firebasestorage.app",
  messagingSenderId: "973289542982",
  appId: "1:973289542982:web:9ceffb5794f47b7b038147"
};


// ======================================================
// Initialize Firebase
// ======================================================

const firebaseApp = initializeApp(firebaseConfig);

const auth = getAuth(firebaseApp);

const db = getFirestore(firebaseApp);


// ======================================================
// เปิด Firebase API ให้ไฟล์ JavaScript เดิมเรียกใช้งาน
// ======================================================

window.HappyNightFirebase = {

  app: firebaseApp,
  auth: auth,
  db: db,

  // Authentication
  onAuthStateChanged: onAuthStateChanged,
  signInWithEmailAndPassword: signInWithEmailAndPassword,
  signOut: signOut,

  // Firestore
  doc: doc,
  getDoc: getDoc,
  setDoc: setDoc,
  collection: collection,
  getDocs: getDocs,
  onSnapshot: onSnapshot,
  serverTimestamp: serverTimestamp,
  writeBatch: writeBatch

};


// ======================================================
// แจ้งระบบว่า Firebase พร้อมแล้ว
// ======================================================

console.log(
  "✅ Firebase connected:",
  firebaseConfig.projectId
);

console.log(
  "✅ Firebase Authentication ready"
);

console.log(
  "✅ Cloud Firestore ready"
);

console.log(
  "✅ Happy Night Firebase core ready"
);


// ยิง Event หลังสร้าง window.HappyNightFirebase แล้ว
window.dispatchEvent(
  new CustomEvent("firebase-ready")
);
