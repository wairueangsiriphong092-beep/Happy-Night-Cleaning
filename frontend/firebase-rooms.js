/**
 * firebase-rooms.js
 * Happy Night Cleaning
 *
 * หน่วยตรวจจริง:
 * - ห้อง 1-20
 * - VIP 1-4
 * รวม 24 หน่วย
 */

(function () {

  console.log("🔄 Loading Happy Night Rooms module...");


  // ======================================================
  // รอ Firebase Core
  // ======================================================

  async function waitForFirebase(timeoutMs = 20000) {

    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {

      if (
        window.HappyNightFirebase &&
        window.HappyNightFirebase.auth &&
        window.HappyNightFirebase.db
      ) {

        return window.HappyNightFirebase;

      }

      await new Promise((resolve) => {
        setTimeout(resolve, 100);
      });

    }

    throw new Error(
      "Firebase Core ยังไม่พร้อมใช้งาน"
    );
  }


  // ======================================================
  // สร้างห้อง 1-20 + VIP 1-4
  // ======================================================

  async function createActualRooms() {

    const firebase =
      await waitForFirebase();


    // ต้องเป็น Firebase Admin ที่ Login แล้ว
    if (!firebase.auth.currentUser) {

      throw new Error(
        "กรุณาเข้าสู่ระบบด้วยบัญชี Admin ก่อน"
      );

    }


    console.log(
      "🔄 กำลังตรวจสอบข้อมูล rooms ใน Firestore..."
    );


    // ====================================================
    // อ่านข้อมูลห้องเดิม
    // ====================================================

    const roomsCollection =
      firebase.collection(
        firebase.db,
        "rooms"
      );


    const roomsSnapshot =
      await firebase.getDocs(
        roomsCollection
      );


    const existingIds =
      new Set();


    roomsSnapshot.forEach((roomDoc) => {

      existingIds.add(
        roomDoc.id
      );

    });


    console.log(
      "Rooms ที่มีอยู่:",
      Array.from(existingIds)
    );


    // ====================================================
    // สร้างรายการ 24 หน่วย
    // ====================================================

    const units = [];


    // ห้องพัก 1-20
    for (
      let roomNumber = 1;
      roomNumber <= 20;
      roomNumber++
    ) {

      units.push({

        id: String(roomNumber),

        RoomID:
          String(roomNumber),

        RoomNumber:
          roomNumber,

        RoomName:
          `ห้อง ${roomNumber}`,

        RoomType:
          "GUEST_ROOM",

        DisplayOrder:
          roomNumber

      });

    }


    // VIP 1-4
    for (
      let vipNumber = 1;
      vipNumber <= 4;
      vipNumber++
    ) {

      units.push({

        id:
          `VIP${vipNumber}`,

        RoomID:
          `VIP${vipNumber}`,

        RoomNumber:
          null,

        RoomName:
          `VIP ${vipNumber}`,

        RoomType:
          "VIP",

        DisplayOrder:
          20 + vipNumber

      });

    }


    // ====================================================
    // Firestore Batch
    // ====================================================

    const batch =
      firebase.writeBatch(
        firebase.db
      );


    let created = 0;
    let skipped = 0;


    for (const unit of units) {

      // มีอยู่แล้ว = ไม่เขียนทับ
      if (
        existingIds.has(unit.id)
      ) {

        skipped++;

        console.log(
          `⏭ ข้าม ${unit.RoomName} เพราะมีอยู่แล้ว`
        );

        continue;

      }


      const roomRef =
        firebase.doc(
          firebase.db,
          "rooms",
          unit.id
        );


      batch.set(
        roomRef,
        {

          RoomID:
            unit.RoomID,

          RoomNumber:
            unit.RoomNumber,

          RoomName:
            unit.RoomName,

          RoomType:
            unit.RoomType,

          DisplayOrder:
            unit.DisplayOrder,

          Status:
            "รอตรวจ",

          AssignedHousekeeper:
            "",

          Active:
            true,

          CreatedAt:
            firebase.serverTimestamp(),

          UpdatedAt:
            firebase.serverTimestamp()

        }
      );


      created++;

    }


    // ====================================================
    // Commit
    // ====================================================

    if (created > 0) {

      await batch.commit();

    }


    console.log(
      "========================================"
    );

    console.log(
      "✅ สร้างข้อมูลหน่วยตรวจเรียบร้อย"
    );

    console.log(
      `สร้างใหม่: ${created}`
    );

    console.log(
      `มีอยู่แล้ว: ${skipped}`
    );

    console.log(
      "ห้องพัก: 20"
    );

    console.log(
      "VIP: 4"
    );

    console.log(
      "รวม: 24 หน่วย"
    );

    console.log(
      "========================================"
    );


    return {

      success: true,

      created,

      skipped,

      total: 24,

      guestRooms: 20,

      vipRooms: 4

    };

  }


  // ======================================================
  // เปิดฟังก์ชันให้ Console / ระบบอื่นเรียกได้
  // ======================================================

  window.HappyNightRooms = {

    createActualRooms:
      createActualRooms

  };


  console.log(
    "✅ Happy Night Rooms module ready"
  );

})();
