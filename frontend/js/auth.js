/**
 * auth.js
 * Hybrid Authentication
 *
 * - Google Apps Script = Login/Session หลักของระบบเดิม
 * - Firebase Authentication = ใช้เพิ่มเฉพาะ ADMIN สำหรับ Firestore Dashboard
 * - HOUSEKEEPER / INSPECTOR ใช้ Username/Password เดิมต่อไป
 * - ไม่เก็บ Password ใน Browser
 */

const Auth = {

  // =====================================================
  // Google Apps Script Session เดิม
  // =====================================================

  getSession() {
    try {
      const raw = sessionStorage.getItem(
        APP_CONFIG.SESSION_STORAGE_KEY
      );

      return raw ? JSON.parse(raw) : null;

    } catch (e) {
      return null;
    }
  },


  setSession(sessionToken, user) {
    sessionStorage.setItem(
      APP_CONFIG.SESSION_STORAGE_KEY,
      JSON.stringify({
        sessionToken,
        user
      })
    );
  },


  clearSession() {
    sessionStorage.removeItem(
      APP_CONFIG.SESSION_STORAGE_KEY
    );
  },


  getCurrentUser() {
    const session = this.getSession();

    return session
      ? session.user
      : null;
  },


  hasRole(...roles) {
    const user = this.getCurrentUser();

    return !!(
      user &&
      roles.indexOf(user.Role) !== -1
    );
  },


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

      await new Promise((resolve) => {
        setTimeout(resolve, 100);
      });
    }

    console.error(
      "❌ Firebase timeout:",
      window.HappyNightFirebase || null
    );

    throw new Error(
      "Firebase ยังไม่พร้อมใช้งาน กรุณาลองใหม่อีกครั้ง"
    );
  },


  // =====================================================
  // Firebase Login สำหรับ ADMIN เท่านั้น
  // =====================================================

  async loginFirebaseAdmin(
    user,
    password,
    enteredUsername
  ) {

    const firebase =
      await this.waitForFirebase();


    // ใช้ Email จากข้อมูลผู้ใช้ก่อน
    // ถ้าไม่มี จึงใช้ค่าที่กรอกหน้า Login
    const email = String(
      user.Email ||
      enteredUsername ||
      ""
    ).trim();


    if (
      !email ||
      !email.includes("@")
    ) {
      throw new Error(
        "บัญชี Admin ยังไม่มี Email ที่ถูกต้องใน Google Sheet"
      );
    }


    console.log(
      "Firebase Admin email:",
      email
    );


    let credential;


    try {

      credential =
        await firebase.signInWithEmailAndPassword(
          firebase.auth,
          email,
          password
        );

    } catch (error) {

      console.error(
        "Firebase Admin Login Error:",
        error.code,
        error.message
      );

      throw new Error(
        "Firebase Login ไม่สำเร็จ: " +
        (error.code || "unknown-error")
      );
    }


    // ===================================================
    // ตรวจ users/<Firebase UID>
    // ===================================================

    try {

      const uid =
        credential.user.uid;


      const userRef =
        firebase.doc(
          firebase.db,
          "users",
          uid
        );


      const userSnapshot =
        await firebase.getDoc(
          userRef
        );


      if (!userSnapshot.exists()) {

        await firebase.signOut(
          firebase.auth
        );

        throw new Error(
          "ไม่พบข้อมูลสิทธิ์ Admin ใน Firestore"
        );
      }


      const firebaseProfile =
        userSnapshot.data();


      if (
        firebaseProfile.active !== true
      ) {

        await firebase.signOut(
          firebase.auth
        );

        throw new Error(
          "บัญชี Firebase นี้ถูกปิดใช้งาน"
        );
      }


      if (
        String(
          firebaseProfile.role || ""
        ).toLowerCase() !== "admin"
      ) {

        await firebase.signOut(
          firebase.auth
        );

        throw new Error(
          "บัญชี Firebase นี้ไม่มีสิทธิ์ Admin"
        );
      }


      console.log(
        "✅ Firebase Admin authenticated:",
        credential.user.email
      );


      return credential.user;

    } catch (error) {

      try {
        await firebase.signOut(
          firebase.auth
        );
      } catch (_) {}

      throw error;
    }
  },


  // =====================================================
  // ล้าง Firebase Session
  // สำหรับ HOUSEKEEPER / INSPECTOR
  // =====================================================

  async clearFirebaseSession() {

    try {

      const firebase =
        await this.waitForFirebase(3000);


      if (
        firebase.auth.currentUser
      ) {

        await firebase.signOut(
          firebase.auth
        );
      }

    } catch (e) {

      // Firebase ต้องไม่ทำให้ Login พนักงานเสีย
      console.warn(
        "Firebase sign-out skipped:",
        e
      );
    }
  },


  // =====================================================
  // Verify Google Apps Script Session เดิม
  // =====================================================

  async verify() {

    const session =
      this.getSession();


    if (!session) {
      return false;
    }


    try {

      const data =
        await Api.call(
          "verifySession",
          {},
          {
            silent: true
          }
        );


      this.setSession(
        session.sessionToken,
        data.user
      );


      return true;

    } catch (e) {

      this.clearSession();

      return false;
    }
  },


  // =====================================================
  // Hybrid Login
  // =====================================================

  async login(
    username,
    password
  ) {

    // ---------------------------------------------------
    // STEP 1
    // Login ผ่าน GAS เดิมก่อนทุก Role
    // ---------------------------------------------------

    const data =
      await Api.call(
        "login",
        {
          username,
          password,
          userAgent:
            navigator.userAgent
        }
      );


    const user =
      data.user;


    if (!user) {
      throw new Error(
        "ไม่พบข้อมูลผู้ใช้งาน"
      );
    }


    // ---------------------------------------------------
    // STEP 2
    // ADMIN ต้อง Login Firebase เพิ่ม
    // ---------------------------------------------------

    if (
      user.Role ===
      APP_CONFIG.ROLES.ADMIN
    ) {

      try {

        await this.loginFirebaseAdmin(
          user,
          password,
          username
        );

      } catch (firebaseError) {

        // GAS Login ผ่านแล้ว
        // จึงเก็บ Session ชั่วคราว
        // เพื่อให้คำสั่ง logout ระบบเดิมทำงานได้

        this.setSession(
          data.sessionToken,
          user
        );


        try {

          await Api.call(
            "logout",
            {},
            {
              silent: true
            }
          );

        } catch (_) {}


        this.clearSession();


        throw firebaseError;
      }

    } else {

      // -------------------------------------------------
      // HOUSEKEEPER / INSPECTOR
      // ใช้ Login ระบบเดิมเหมือนเดิม
      // -------------------------------------------------

      await this.clearFirebaseSession();
    }


    // ---------------------------------------------------
    // STEP 3
    // ทุกอย่างผ่านแล้วค่อยเก็บ GAS Session
    // ---------------------------------------------------

    this.setSession(
      data.sessionToken,
      user
    );


    return data;
  },


  // =====================================================
  // Logout
  // =====================================================

  async logout() {

    // Logout Google Apps Script
    try {

      await Api.call(
        "logout",
        {},
        {
          silent: true
        }
      );

    } catch (e) {}


    // Logout Firebase
    try {

      if (
        window.HappyNightFirebase &&
        window.HappyNightFirebase.auth
      ) {

        await window
          .HappyNightFirebase
          .signOut(
            window
              .HappyNightFirebase
              .auth
          );
      }

    } catch (e) {

      console.warn(
        "Firebase logout warning:",
        e
      );
    }


    this.clearSession();


    window.location.hash =
      "#/login";
  },


  // =====================================================
  // Route Guard
  //
  // ป้องกันแม่บ้าน / ผู้ตรวจสอบ
  // เปิดหน้า Admin ผ่าน URL โดยตรง
  // =====================================================

  guardRoute(requiredRoles) {

    const user =
      this.getCurrentUser();


    if (!user) {

      window.location.hash =
        "#/login";

      return false;
    }


    if (
      requiredRoles &&
      requiredRoles.length &&
      requiredRoles.indexOf(
        user.Role
      ) === -1
    ) {

      window.location.hash =
        "#/access-denied";

      return false;
    }


    return true;
  }

};
