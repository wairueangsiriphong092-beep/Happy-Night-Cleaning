/**
 * auth.js
 * Hybrid Authentication
 *
 * - Google Apps Script = Login/Session หลักของระบบเดิม
 * - Firebase Authentication = ใช้เพิ่มเฉพาะ ADMIN สำหรับ Firestore Dashboard
 * - HOUSEKEEPER / INSPECTOR ใช้ Username/Password เดิมต่อไป
 * - ไม่มีการเก็บ Password ใน Browser
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

      return raw
        ? JSON.parse(raw)
        : null;

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
  // รอ Firebase SDK
  // =====================================================

  async waitForFirebase(timeoutMs = 10000) {

    if (window.HappyNightFirebase) {
      return window.HappyNightFirebase;
    }

    return new Promise((resolve, reject) => {

      let finished = false;

      const timer = setTimeout(() => {

        if (finished) return;

        finished = true;

        reject(
          new Error(
            'Firebase ยังไม่พร้อมใช้งาน กรุณาลองใหม่อีกครั้ง'
          )
        );

      }, timeoutMs);


      const onReady = () => {

        if (finished) return;

        finished = true;

        clearTimeout(timer);

        window.removeEventListener(
          'firebase-ready',
          onReady
        );

        if (window.HappyNightFirebase) {

          resolve(
            window.HappyNightFirebase
          );

        } else {

          reject(
            new Error(
              'ไม่พบการเชื่อมต่อ Firebase'
            )
          );

        }

      };


      window.addEventListener(
        'firebase-ready',
        onReady
      );

    });

  },


  // =====================================================
  // Firebase Login สำหรับ ADMIN เท่านั้น
  // =====================================================

  async loginFirebaseAdmin(user, password, enteredUsername) {

    const firebase =
      await this.waitForFirebase();


    // ใช้ Email ที่ Google Apps Script ส่งกลับมาก่อน
    // ถ้าไม่มี จึงใช้ค่าที่ผู้ใช้กรอก
    const email = String(
      user.Email ||
      enteredUsername ||
      ''
    ).trim();


    if (!email || !email.includes('@')) {

      throw new Error(
        'บัญชี Admin ยังไม่มี Email ที่ถูกต้องใน Google Sheet'
      );

    }


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
        'Firebase Admin Login Error:',
        error
      );

      throw new Error(
        'บัญชี Admin ผ่านระบบเดิมแล้ว แต่เข้าสู่ Firebase ไม่สำเร็จ กรุณาตรวจสอบ Email และรหัสผ่านของ Admin ใน Firebase Authentication'
      );

    }


    // ===================================================
    // ตรวจสอบ Firestore users/<UID>
    // ===================================================

    try {

      const uid =
        credential.user.uid;


      const userRef =
        firebase.doc(
          firebase.db,
          'users',
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
          'ไม่พบข้อมูลสิทธิ์ Admin ใน Firestore'
        );

      }


      const firebaseProfile =
        userSnapshot.data();


      if (firebaseProfile.active !== true) {

        await firebase.signOut(
          firebase.auth
        );

        throw new Error(
          'บัญชี Firebase นี้ถูกปิดใช้งาน'
        );

      }


      if (
        String(
          firebaseProfile.role || ''
        ).toLowerCase() !== 'admin'
      ) {

        await firebase.signOut(
          firebase.auth
        );

        throw new Error(
          'บัญชี Firebase นี้ไม่มีสิทธิ์ Admin'
        );

      }


      console.log(
        '✅ Firebase Admin authenticated:',
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
  // Logout Firebase ถ้าบัญชีปัจจุบันไม่ใช่ Admin
  // ป้องกัน Admin Firebase session ค้างใน Browser
  // =====================================================

  async clearFirebaseSession() {

    try {

      const firebase =
        await this.waitForFirebase(3000);


      if (firebase.auth.currentUser) {

        await firebase.signOut(
          firebase.auth
        );

      }

    } catch (e) {

      // ไม่ให้ Firebase กระทบ Login ของพนักงาน
      console.warn(
        'Firebase sign-out skipped:',
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
          'verifySession',
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

  async login(username, password) {

    // ---------------------------------------------------
    // STEP 1
    // Login ผ่าน Google Apps Script เดิมก่อนเสมอ
    // ---------------------------------------------------

    const data =
      await Api.call(
        'login',
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
        'ไม่พบข้อมูลผู้ใช้งาน'
      );

    }


    // ---------------------------------------------------
    // STEP 2
    // ADMIN ต้องผ่าน Firebase เพิ่ม
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

        /*
         * GAS Login สำเร็จไปแล้ว
         * เก็บ Session ชั่วคราวเพื่อส่ง logout
         * แล้วล้างออก เพื่อไม่ให้เกิด Session ค้าง
         */

        this.setSession(
          data.sessionToken,
          user
        );


        try {

          await Api.call(
            'logout',
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
      //
      // ใช้ระบบเดิมทั้งหมด
      // และไม่ให้มี Firebase Admin session ค้าง
      // -------------------------------------------------

      await this.clearFirebaseSession();

    }


    // ---------------------------------------------------
    // STEP 3
    // Login ทุกระบบผ่านแล้วจึงบันทึก GAS Session
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
        'logout',
        {},
        {
          silent: true
        }
      );

    } catch (e) {

      // เพิกเฉย
    }


    // Logout Firebase ถ้ามี
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
        'Firebase logout warning:',
        e
      );

    }


    this.clearSession();


    window.location.hash =
      '#/login';

  },


  // =====================================================
  // Route Guard
  //
  // แม่บ้าน/ผู้ตรวจสอบเปิด Dashboard ด้วย URL ตรง ๆ ไม่ได้
  // =====================================================

  guardRoute(requiredRoles) {

    const user =
      this.getCurrentUser();


    if (!user) {

      window.location.hash =
        '#/login';

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
        '#/access-denied';

      return false;

    }


    return true;

  }

};
