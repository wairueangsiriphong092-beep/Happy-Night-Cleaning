// =====================================================
// รอ Firebase SDK แบบ Polling
// ป้องกัน Race Condition ระหว่าง firebase.js และ auth.js
// =====================================================

async waitForFirebase(timeoutMs = 20000) {

  const startTime = Date.now();

  while (
    Date.now() - startTime < timeoutMs
  ) {

    if (
      window.HappyNightFirebase &&
      window.HappyNightFirebase.auth &&
      window.HappyNightFirebase.db
    ) {

      console.log(
        "✅ Firebase พร้อมใช้งานจาก auth.js"
      );

      return window.HappyNightFirebase;

    }

    // รอ 100ms แล้วตรวจใหม่
    await new Promise((resolve) => {
      setTimeout(resolve, 100);
    });

  }

  console.error(
    "❌ Firebase timeout:",
    {
      HappyNightFirebase:
        window.HappyNightFirebase || null
    }
  );

  throw new Error(
    "Firebase ยังไม่พร้อมใช้งาน กรุณาลองใหม่อีกครั้ง"
  );

},
