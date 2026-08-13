/**
 * utils.js
 * ฟังก์ชันช่วยเหลือทั่วไปฝั่ง Frontend: การแสดง Toast, Loading, Format วันที่,
 * บีบอัดรูปภาพ, และการจัดการ Auto-Save แบบร่าง (Draft) ใน Browser
 */

const Utils = {
  /** แสดง Toast แจ้งเตือนด้วย SweetAlert2 */
  toast(icon, title) {
    if (typeof Swal !== 'undefined') {
      Swal.fire({
        toast: true, position: 'top-end', icon: icon, title: title,
        showConfirmButton: false, timer: 3000, timerProgressBar: true,
        customClass: { popup: 'hci-toast' }
      });
    } else {
      window.alert(title);
    }
  },

  /** แสดงผลสำเร็จแบบ Dialog พร้อม fallback หาก SweetAlert2 โหลดไม่ได้ */
  async success(title, html, fallbackText) {
    if (typeof Swal !== 'undefined') {
      await Swal.fire({
        icon: 'success', title: title, html: html || '',
        confirmButtonText: 'ตกลง', confirmButtonColor: '#0B1F3A',
        allowOutsideClick: false
      });
      return;
    }
    window.alert(fallbackText || title);
  },

  /** แสดง Dialog ยืนยันก่อนดำเนินการสำคัญ (ลบ/แก้ไข/อนุมัติ) */
  async confirm(title, text, confirmText = 'ยืนยัน', icon = 'warning') {
    if (typeof Swal === 'undefined') return window.confirm(title + (text ? '\n' + text : ''));
    const result = await Swal.fire({
      title, text, icon, showCancelButton: true,
      confirmButtonText: confirmText, cancelButtonText: 'ยกเลิก',
      confirmButtonColor: '#0B1F3A', cancelButtonColor: '#8a8a8a',
      reverseButtons: true
    });
    return result.isConfirmed;
  },

  /** แสดง/ซ่อน Loading Overlay เต็มหน้าจอ */
  showLoading(message = 'กำลังโหลดข้อมูล...') {
    let overlay = document.getElementById('globalLoadingOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'globalLoadingOverlay';
      overlay.className = 'hci-loading-overlay';
      overlay.innerHTML = `<div class="hci-loading-box"><div class="hci-spinner"></div><p id="globalLoadingText"></p></div>`;
      document.body.appendChild(overlay);
    }
    document.getElementById('globalLoadingText').textContent = message;
    overlay.classList.add('active');
  },
  hideLoading() {
    const overlay = document.getElementById('globalLoadingOverlay');
    if (overlay) overlay.classList.remove('active');
  },

  /** จัดรูปแบบวันที่/เวลาเป็นเวลาไทยเสมอ ไม่ขึ้นกับ Timezone ของเครื่องผู้ใช้ */
  formatDateTh(dateInput) {
    if (!dateInput) return '-';
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return String(dateInput);
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: APP_CONFIG.TIMEZONE || 'Asia/Bangkok',
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).formatToParts(d).reduce((out, part) => { out[part.type] = part.value; return out; }, {});
    return `${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute}`;
  },

  todayISO() {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: APP_CONFIG.TIMEZONE || 'Asia/Bangkok',
      year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(new Date()).reduce((out, part) => { out[part.type] = part.value; return out; }, {});
    return `${parts.year}-${parts.month}-${parts.day}`;
  },

  /** บีบอัดรูปภาพก่อนอัปโหลด (ลดขนาดไฟล์ + แปลงเป็น Base64) */
  compressImage(file, maxWidth = 1280, quality = 0.72) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const img = new Image();
        img.onload = () => {
          let { width, height } = img;
          if (width > maxWidth) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          }
          const canvas = document.createElement('canvas');
          canvas.width = width; canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          const dataUrl = canvas.toDataURL('image/jpeg', quality);
          resolve({
            base64: dataUrl.split(',')[1],
            mimeType: 'image/jpeg',
            previewUrl: dataUrl
          });
        };
        img.onerror = reject;
        img.src = ev.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  },

  /** สถานะห้อง -> สี/ไอคอน สำหรับ Room Status Card */
  statusMeta(status) {
    const map = {
      'ยังไม่ได้ทำความสะอาด': { color: 'gray', icon: 'fa-broom' },
      'กำลังทำความสะอาด': { color: 'blue', icon: 'fa-spray-can-sparkles' },
      'รอตรวจสอบ': { color: 'amber', icon: 'fa-clipboard-list' },
      'ตรวจสอบแล้ว': { color: 'teal', icon: 'fa-clipboard-check' },
      'ผ่านมาตรฐาน': { color: 'green', icon: 'fa-circle-check' },
      'ดีเยี่ยม': { color: 'gold', icon: 'fa-star' },
      'ไม่ผ่านมาตรฐาน': { color: 'red', icon: 'fa-circle-xmark' },
      'ควรปรับปรุง': { color: 'amber', icon: 'fa-triangle-exclamation' },
      'รอแก้ไข': { color: 'orange', icon: 'fa-screwdriver-wrench' },
      'ปิดปรับปรุง': { color: 'gray', icon: 'fa-ban' }
    };
    return map[status] || { color: 'gray', icon: 'fa-circle-question' };
  },

  // ---------- Auto-Save แบบร่าง (ป้องกันข้อมูลสูญหาย) ----------
  /** บันทึกร่างแบบฟอร์มลง sessionStorage ห้ามเก็บรหัสผ่านหรือข้อมูลสำคัญ */
  saveDraft(key, data) {
    try {
      sessionStorage.setItem(APP_CONFIG.DRAFT_STORAGE_PREFIX + key, JSON.stringify(data));
    } catch (e) { /* เพิกเฉยหาก storage เต็ม */ }
  },
  loadDraft(key) {
    try {
      const raw = sessionStorage.getItem(APP_CONFIG.DRAFT_STORAGE_PREFIX + key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  },
  clearDraft(key) {
    sessionStorage.removeItem(APP_CONFIG.DRAFT_STORAGE_PREFIX + key);
  },

  escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/[&<>"']/g, s => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[s]));
  },

  debounce(fn, wait = 300) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
  }
};
