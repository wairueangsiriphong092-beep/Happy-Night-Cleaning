// ======================================================
// สร้างหน่วยตรวจจริงของ Happy Night Cleaning
//
// ห้องพัก 1 - 20
// VIP 1 - 4
//
// รวมทั้งหมด 24 หน่วย
// ไม่เขียนทับ Document ที่มีอยู่แล้ว
// ======================================================

async function createActualRooms() {

  const currentUser = auth.currentUser;

  if (!currentUser) {
    throw new Error(
      "กรุณา Login ด้วยบัญชี Admin ก่อนสร้างข้อมูลห้อง"
    );
  }

  console.log(
    "กำลังตรวจสอบข้อมูลห้องใน Firestore..."
  );

  // ====================================================
  // อ่านข้อมูล rooms ที่มีอยู่
  // ====================================================

  const roomsRef = collection(
    db,
    "rooms"
  );

  const roomsSnapshot =
    await getDocs(roomsRef);

  const existingRoomIds =
    new Set();

  roomsSnapshot.forEach((roomDoc) => {
    existingRoomIds.add(
      roomDoc.id
    );
  });


  // ====================================================
  // กำหนดหน่วยตรวจจริง
  // ====================================================

  const units = [];


  // ----------------------------------------------------
  // ห้องพัก 1 - 20
  // ----------------------------------------------------

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


  // ----------------------------------------------------
  // VIP 1 - 4
  // ----------------------------------------------------

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
  // Batch
  // ====================================================

  const batch =
    writeBatch(db);

  let created = 0;
  let skipped = 0;


  for (const unit of units) {

    if (
      existingRoomIds.has(unit.id)
    ) {

      skipped++;

      console.log(
        `ข้าม ${unit.RoomName} เพราะมีอยู่แล้ว`
      );

      continue;

    }


    const roomRef =
      doc(
        db,
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


  // ====================================================
  // Commit
  // ====================================================

  if (created > 0) {
    await batch.commit();
  }


  console.log(
    "======================================"
  );

  console.log(
    "✅ สร้างข้อมูลหน่วยตรวจสำเร็จ"
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

  console.log(
    "ห้องพัก: 1 - 20"
  );

  console.log(
    "VIP: 1 - 4"
  );

  console.log(
    "======================================"
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
