/**
 * auth.js
 * จัดการ Session ฝั่ง Frontend: เข้าสู่ระบบ ออกจากระบบ ตรวจสอบ Session ก่อนเข้าหน้าใด ๆ
 * ใช้ sessionStorage เท่านั้น (หายเมื่อปิดแท็บ) และไม่มีการเก็บรหัสผ่านที่ฝั่ง Client เด็ดขาด
 */

const Auth = {
  getSession() {
    try {
      const raw = sessionStorage.getItem(APP_CONFIG.SESSION_STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  },

  setSession(sessionToken, user) {
    sessionStorage.setItem(APP_CONFIG.SESSION_STORAGE_KEY, JSON.stringify({ sessionToken, user }));
  },

  clearSession() {
    sessionStorage.removeItem(APP_CONFIG.SESSION_STORAGE_KEY);
  },

  getCurrentUser() {
    const s = this.getSession();
    return s ? s.user : null;
  },

  hasRole(...roles) {
    const u = this.getCurrentUser();
    return u && roles.indexOf(u.Role) !== -1;
  },

  /** เรียกตอนเริ่มโหลดแอป เพื่อยืนยันว่า Session ที่มีอยู่ยังใช้งานได้จริงกับ Server */
  async verify() {
    const session = this.getSession();
    if (!session) return false;
    try {
      const data = await Api.call('verifySession', {}, { silent: true });
      this.setSession(session.sessionToken, data.user); // อัปเดตข้อมูลผู้ใช้ล่าสุด
      return true;
    } catch (e) {
      this.clearSession();
      return false;
    }
  },

  async login(username, password) {
    const data = await Api.call('login', {
      username, password, userAgent: navigator.userAgent
    });
    this.setSession(data.sessionToken, data.user);
    return data;
  },

  async logout() {
    try { await Api.call('logout', {}, { silent: true }); } catch (e) { /* เพิกเฉย */ }
    this.clearSession();
    window.location.hash = '#/login';
  },

  /** ป้องกันการเปิดหน้าหลักด้วย URL โดยไม่ได้เข้าสู่ระบบ — เรียกจาก Router ทุกครั้งที่เปลี่ยนหน้า */
  guardRoute(requiredRoles) {
    const user = this.getCurrentUser();
    if (!user) {
      window.location.hash = '#/login';
      return false;
    }
    if (requiredRoles && requiredRoles.length && requiredRoles.indexOf(user.Role) === -1) {
      window.location.hash = '#/access-denied';
      return false;
    }
    return true;
  }
};
