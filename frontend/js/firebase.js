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
// สร้างห้อง 1 - 24 อัตโนมัติ
//
// หมายเหตุ:
// - ต้อง Login Firebase ด้วย Admin ก่อน
// - ห้องที่มีอยู่แล้วจะไม่ถูกเขียนทับ
// - สร้างเฉพาะห้องที่ยังไม่มี
// ======================================================

async function createRooms1To24() {

  // ----------------------------------------------------
  // ตรวจสอบว่า Firebase Authentication Login แล้วหรือยัง
  // ----------------------------------------------------

  const currentUser = auth.currentUser;

  if (!currentUser) {

    throw new Error(
      "กรุณา Login ด้วยบัญชี Admin ก่อนสร้างข้อมูลห้อง"
    );

  }


  console.log(
    "กำลังตรวจสอบข้อมูลห้องใน Firestore..."
  );


  // ----------------------------------------------------
  // อ่าน rooms ที่มีอยู่แล้ว
  // ----------------------------------------------------

  const roomsRef =
    collection(db, "rooms");

  const roomsSnapshot =
    await getDocs(roomsRef);


  const existingRoomIds =
    new Set();


  roomsSnapshot.forEach((roomDoc) => {

    existingRoomIds.add(
      roomDoc.id
    );

  });


  console.log(
    "ห้องที่มีอยู่แล้ว:",
    Array.from(existingRoomIds)
  );


  // ----------------------------------------------------
  // เตรียม Batch
  // ----------------------------------------------------

  const batch =
    writeBatch(db);


  let created = 0;
  let skipped = 0;


  // ----------------------------------------------------
  // สร้างห้อง 1 - 24
  // ----------------------------------------------------

  for (
    let roomNumber = 1;
    roomNumber <= 24;
    roomNumber++
  ) {

    const roomId =
      String(roomNumber);


    // --------------------------------------------------
    // ถ้ามีห้องอยู่แล้ว
    // จะข้ามทันที เพื่อไม่เขียนทับข้อมูลเดิม
    // --------------------------------------------------

    if (
      existingRoomIds.has(roomId)
    ) {

      skipped++;

      console.log(
        `ข้ามห้อง ${roomId} เพราะมีอยู่แล้ว`
      );

      continue;

    }


    // --------------------------------------------------
    // Document Reference
    // rooms/1
    // rooms/2
    // ...
    // rooms/24
    // --------------------------------------------------

    const roomRef =
      doc(
        db,
        "rooms",
        roomId
      );


    // --------------------------------------------------
    // ข้อมูลห้อง
    // --------------------------------------------------

    batch.set(
      roomRef,
      {

        RoomID:
          roomId,

        RoomNumber:
          roomNumber,

        RoomName:
          `ห้อง ${roomNumber}`,

        RoomType:
          "GUEST_ROOM",

        Status:
          "ยังไม่ได้ทำความสะอาด",

        AssignedHousekeeper:
          "",

        Active:
          true,

        CreatedAt:
          serverTimestamp(),

        UpdatedAt:
          serverTimestamp()

      }
    );


    created++;

  }


  // ----------------------------------------------------
  // ถ้ามีห้องใหม่จึง Commit
  // ----------------------------------------------------

  if (created > 0) {

    console.log(
      `กำลังสร้าง ${created} ห้อง...`
    );


    await batch.commit();

  }


  // ----------------------------------------------------
  // แสดงผล
  // ----------------------------------------------------

  console.log(
    "======================================"
  );

  console.log(
    "✅ สร้างข้อมูลห้องสำเร็จ"
  );

  console.log(
    `สร้างใหม่: ${created} ห้อง`
  );

  console.log(
    `มีอยู่แล้ว: ${skipped} ห้อง`
  );

  console.log(
    "จำนวนห้องทั้งหมดที่ระบบต้องมี: 24 ห้อง"
  );

  console.log(
    "======================================"
  );


  return {

    success: true,

    created:
      created,

    skipped:
      skipped,

    total:
      24

  };

}


// ======================================================
// เปิดให้ JavaScript เดิมของเว็บไซต์เรียก Firebase ได้
// ======================================================

window.HappyNightFirebase = {

  // Firebase
  app:
    firebaseApp,

  auth:
    auth,

  db:
    db,


  // Authentication
  onAuthStateChanged:
    onAuthStateChanged,

  signInWithEmailAndPassword:
    signInWithEmailAndPassword,

  signOut:
    signOut,


  // Firestore
  doc:
    doc,

  getDoc:
    getDoc,

  setDoc:
    setDoc,

  collection:
    collection,

  getDocs:
    getDocs,

  onSnapshot:
    onSnapshot,

  serverTimestamp:
    serverTimestamp,

  writeBatch:
    writeBatch,


  // ====================================================
  // Happy Night Cleaning Functions
  // ====================================================

  createRooms1To24:
    createRooms1To24

};


// ======================================================
// แจ้ง JavaScript อื่นว่า Firebase พร้อมใช้งานแล้ว
// ======================================================

window.dispatchEvent(
  new CustomEvent(
    "firebase-ready"
  )
);


// ======================================================
// Console
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
  "✅ Happy Night Firebase functions ready"
);
