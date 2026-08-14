/**
 * firebase-rooms.js
 * สร้างข้อมูลหน่วยตรวจจริงใน Firestore
 *
 * ห้องพัก 1-20
 * VIP 1-4
 * รวม 24 หน่วย
 *
 * ไม่แก้ Firebase Core
 * ไม่เขียนทับห้องที่มีอยู่แล้ว
 */

(function () {

  // =====================================================
  // รอ Firebase Core
  // =====================================================

  async function waitForFirebase(timeoutMs = 20000) {

    const start = Date.now();

    while (Date.now() - start < timeoutMs) {

      if (
        window.HappyNightFirebase &&
        window.HappyNightFirebase.db &&
        window.HappyNightFirebase.auth
      ) {
        return window.HappyNightFirebase;
      }

      await new Promise(resolve =>
        setTimeout(resolve, 100)
      );
    }

    throw new Error(
      "Firebase Core ยังไม่พร้อมใช้งาน"
    );
  }


  // =====================================================
  // สร้างห้องจริง 1-20 + VIP1-4
  // =====================================================

  async function createActualRooms() {

    const firebase =
      await waitForFirebase();


    // ต้อง Login Firebase เป็น Admin ก่อน
    if (!firebase.auth.currentUser) {

      throw new Error(
        "กรุณาเข้าสู่ระบบด้วยบัญชี Admin ก่อน"
      );

    }


    console.log(
      "🔄 กำลังตรวจสอบข้อมูลห้อง..."
    );


    // ===================================================
    // อ่านข้อมูลที่มีอยู่แล้ว
    // ===================================================

    const snapshot =
      await firebase.getDocs(
        firebase.collection(
          firebase.db,
          "rooms"
        )
      );


    const existingIds =
      new Set();


    snapshot.forEach(doc => {
      existingIds.add(doc.id);
    });


    // ===================================================
    // รายการหน่วยจริง
    // ===================================================

    const units = [];


    // ห้อง 1-20
    for (
      let roomNumber = 1;
      roomNumber <= 20;
      roomNumber++
    ) {

      units.push({

        id:
          String(roomNumber),

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
      let vip = 1;
      vip <= 4;
      vip++
    ) {

      units.push({

        id:
          `VIP${vip}`,

        RoomID:
          `VIP${vip}`,

        RoomNumber:
          null,

        RoomName:
          `VIP ${vip}`,

        RoomType:
          "VIP",

        DisplayOrder:
          20 + vip

      });

    }


    // ===================================================
    // Batch
    // ===================================================

    const batch =
      firebase.writeBatch(
        firebase.db
      );


    let created = 0;
    let skipped = 0;


    for (const unit of units) {

      // มีอยู่แล้ว = ไม่เขียนทับ
      if (existingIds.has(unit.id)) {

        skipped++;

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


    // ===================================================
    // Commit
    // ===================================================

    if (created > 0) {

      await batch.commit();

    }


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
      "ทั้งหมด: 24 หน่วย"
    );


    return {

      success: true,

      total: 24,

      guestRooms: 20,

      vipRooms: 4,

      created,

      skipped

    };

  }


  // =====================================================
  // เปิดให้เรียกจาก Console
  // =====================================================

  window.HappyNightRooms = {

    createActualRooms

  };


  console.log(
    "✅ Happy Night Rooms module ready"
  );

})();
