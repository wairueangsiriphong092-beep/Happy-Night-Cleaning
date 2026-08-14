// ======================================================
// Happy Night Cleaning - Firebase
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
// ให้นำ firebaseConfig จาก Firebase Console ของคุณมาใส่ตรงนี้
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
// เปิดให้ JavaScript เดิมของเว็บไซต์เรียกใช้งานภายหลัง
// ======================================================

window.HappyNightFirebase = {
  app: firebaseApp,
  auth,
  db,

  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,

  doc,
  getDoc,
  setDoc,
  collection,
  getDocs,
  onSnapshot,
  serverTimestamp,
  writeBatch
};


// แจ้งว่า Firebase พร้อมใช้งาน
window.dispatchEvent(
  new CustomEvent("firebase-ready")
);

console.log(
  "✅ Firebase connected:",
  firebaseConfig.projectId
);
