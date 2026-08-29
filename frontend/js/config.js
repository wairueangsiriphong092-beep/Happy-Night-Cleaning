/**
 * config.js
 * ค่าตั้งค่ากลางของระบบ Frontend
 * *** สำคัญ *** หลัง Deploy Google Apps Script เป็น Web App แล้ว
 * ให้นำ URL ที่ได้มาใส่แทนที่ค่า GAS_WEB_APP_URL ด้านล่างนี้
 */

const APP_CONFIG = {
  // วาง Web App URL ของ Google Apps Script ที่ Deploy แล้วตรงนี้ เช่น
  // 'https://script.google.com/macros/s/AKfycb.../exec'
  GAS_WEB_APP_URL: 'https://script.google.com/macros/s/AKfycbzJfwYyXZE4rZUohSqyxBBkR6eTg6zcq6efKNbrYbiEyX5i0vQ4Gdohf8jk9J8BPbpa/exec',

  BUILD_VERSION: '2026.08.13.3',
  APP_NAME: 'Grand Inspection',
  APP_NAME_TH: 'ระบบตรวจสอบมาตรฐานความสะอาด',
  TIMEZONE: 'Asia/Bangkok',
  SESSION_STORAGE_KEY: 'hci_session', // ใช้ sessionStorage เท่านั้น (ไม่ใช่ localStorage) และไม่เก็บรหัสผ่าน
  DRAFT_STORAGE_PREFIX: 'hci_draft_', // สำหรับ Auto-Save แบบร่าง (ไม่มีรหัสผ่านหรือข้อมูลสำคัญ)
  REQUEST_TIMEOUT_MS: 90000, // รองรับ GAS cold start โดยไม่ตัดคำขอเร็วเกินไป
  HOME_REQUEST_TIMEOUT_MS: 90000, // หน้า Home ใช้ API รวมและควรตอบกลับเร็วกว่าค่านี้มาก
  SAVE_REQUEST_TIMEOUT_MS: 120000, // การบันทึกแบบตรวจมีหลายรายการ ให้รอได้สูงสุด 2 นาที
  API_RETRY_DELAY_MS: 1200,

  ROLES: {
    ADMIN: 'ADMIN',
    INSPECTOR: 'INSPECTOR',
    HOUSEKEEPER: 'HOUSEKEEPER'
  },

  ROLE_LABELS: {
    ADMIN: 'ผู้ดูแลระบบ',
    INSPECTOR: 'ผู้ตรวจสอบ',
    HOUSEKEEPER: 'พนักงานแม่บ้าน'
  },

  CATEGORY_LABELS: {
    BEDROOM: 'โซนห้องนอน',
    BATHROOM: 'โซนห้องน้ำ',
    AMENITIES: 'สิ่งอำนวยความสะดวก',
    SAFETY: 'ภาพรวมความปลอดภัย',
    OVERALL: 'ภาพรวมและความพร้อมใช้งาน'
  },

  RESULT_OPTIONS: ['ผ่าน', 'ไม่ผ่าน'],
  SEVERITY_OPTIONS: ['ต่ำ', 'ปานกลาง', 'สูง', 'เร่งด่วน'],
  ISSUE_STATUS_OPTIONS: ['รอดำเนินการ', 'กำลังแก้ไข', 'แก้ไขแล้ว']
};
