/**
 * api.js
 * ชั้นเชื่อมต่อ Google Apps Script Web App (Backend API) ทุกคำขอผ่านฟังก์ชันนี้เท่านั้น
 * ใช้ Content-Type: text/plain;charset=utf-8 ตอน POST เพื่อหลีกเลี่ยง CORS Preflight
 * ซึ่งเป็นข้อจำกัดที่ทราบกันดีของ Google Apps Script Web App (ตามข้อ 21: "รองรับ CORS เท่าที่ Google Apps Script รองรับ")
 */

const Api = {
  _pendingSubmit: false, // ป้องกันการกดปุ่มส่งข้อมูลซ้ำ (ใช้คู่กับ withSubmitLock)
  _inflightReads: new Map(), // รวมคำขออ่านซ้ำที่เกิดพร้อมกัน เช่น getNotifications

  _safeRetryActions: [
    'verifySession', 'getUsers', 'getRooms', 'getChecklist',
    'getInspectionHistory', 'getInspectionDetail', 'getIssues', 'getIssueDetails', 'getIssueHistory',
    'getHomeData', 'getDashboard', 'getAdminDashboard', 'getNotifications', 'getAuditLogs'
  ],

  async call(action, payload = {}, { silent = false, timeoutMs = null } = {}) {
    if (!APP_CONFIG.GAS_WEB_APP_URL || APP_CONFIG.GAS_WEB_APP_URL.indexOf('YOUR_DEPLOYMENT_ID') !== -1) {
      Utils.toast('error', 'ยังไม่ได้ตั้งค่า Web App URL ใน js/config.js');
      throw new Error('GAS_WEB_APP_URL ยังไม่ถูกตั้งค่า');
    }

    const session = Auth.getSession();
    const body = Object.assign({ action, sessionToken: session ? session.sessionToken : '' }, payload);

    // หน้า Home และ Topbar อาจเรียก API เดียวกันพร้อมกัน ใช้ Promise เดียวเพื่อลดภาระ GAS
    const canDeduplicate = this._safeRetryActions.indexOf(action) !== -1;
    const requestKey = canDeduplicate ? action + '|' + JSON.stringify(body) : '';
    if (canDeduplicate && this._inflightReads.has(requestKey)) {
      return this._inflightReads.get(requestKey);
    }

    const request = this._callWithRetry(action, body, { silent, timeoutMs });
    if (canDeduplicate) this._inflightReads.set(requestKey, request);
    try {
      return await request;
    } finally {
      if (canDeduplicate) this._inflightReads.delete(requestKey);
    }
  },

  async _callWithRetry(action, body, { silent, timeoutMs }) {
    const canRetry = this._safeRetryActions.indexOf(action) !== -1;
    const maxAttempts = canRetry ? 2 : 1;
    let lastError;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await this._send(action, body, { silent: silent || attempt < maxAttempts, timeoutMs });
      } catch (err) {
        lastError = err;
        // ห้าม Retry อัตโนมัติเมื่อ Timeout: การ abort ของ Browser ไม่ได้หยุดงาน GAS
        // หากยิงใหม่ทันที งานเก่าและงานใหม่จะทำพร้อมกันและยิ่งทำให้ระบบช้าลง
        const retryable = err.code === 'NETWORK_ERROR';
        if (!retryable || attempt === maxAttempts) break;
        await new Promise(resolve => setTimeout(resolve, APP_CONFIG.API_RETRY_DELAY_MS || 1200));
      }
    }

    if (!silent) {
      if (lastError && lastError.code === 'TIMEOUT') {
        Utils.toast('error', 'ระบบตอบกลับช้ากว่าปกติ กรุณาลองใหม่อีกครั้ง');
      } else if (lastError && lastError.code === 'NETWORK_ERROR') {
        Utils.toast('error', 'ไม่สามารถเชื่อมต่อระบบได้ โปรดตรวจสอบอินเทอร์เน็ต');
      }
    }
    throw lastError;
  },

  async _send(action, body, { silent = false, timeoutMs = null } = {}) {

    const controller = new AbortController();
    // saveInspection เขียนข้อมูลรายละเอียดหลายรายการ จึงต้องมีเวลารอมากกว่าคำขออ่านข้อมูลทั่วไป
    const effectiveTimeout = timeoutMs || (action === 'saveInspection'
      ? (APP_CONFIG.SAVE_REQUEST_TIMEOUT_MS || 120000)
      : APP_CONFIG.REQUEST_TIMEOUT_MS);
    const timeoutId = setTimeout(() => controller.abort(), effectiveTimeout);

    try {
      // แนบ action ซ้ำใน Query String และ JSON body
      // เพื่อป้องกัน GAS redirect บางคำขอแล้ว postData หายจน Backend แจ้ง MISSING_ACTION
      const requestUrl = this._buildRequestUrl(action);
      const response = await fetch(requestUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // สำคัญ: หลีกเลี่ยง CORS preflight ของ GAS
        body: JSON.stringify(body),
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        const httpErr = new Error('เครือข่ายผิดพลาด (HTTP ' + response.status + ')');
        httpErr.code = 'NETWORK_ERROR';
        throw httpErr;
      }
      const responseText = await response.text();
      let json;
      try {
        json = JSON.parse(responseText);
      } catch (parseErr) {
        const invalidResponse = new Error('Web App ตอบกลับข้อมูลที่ไม่ใช่ JSON กรุณาตรวจสอบ Deployment');
        invalidResponse.code = 'INVALID_RESPONSE';
        throw invalidResponse;
      }

      if (!json.success) {
        if (json.errorCode === 'SESSION_EXPIRED') {
          Auth.clearSession();
          if (!silent) Utils.toast('warning', 'Session หมดอายุ กรุณาเข้าสู่ระบบใหม่');
          setTimeout(() => { window.location.hash = '#/login'; }, 1200);
        } else if (!silent) {
          Utils.toast('error', json.message || 'เกิดข้อผิดพลาด');
        }
        const err = new Error(json.message || 'เกิดข้อผิดพลาด');
        err.errorCode = json.errorCode;
        err.action = action;
        err.response = json;
        throw err;
      }
      return json.data;
    } catch (err) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') {
        const timeoutError = new Error('TIMEOUT');
        timeoutError.code = 'TIMEOUT';
        throw timeoutError;
      }
      if (err instanceof TypeError && !err.errorCode) {
        err.code = 'NETWORK_ERROR';
      }
      throw err;
    }
  },

  _buildRequestUrl(action) {
    const baseUrl = String(APP_CONFIG.GAS_WEB_APP_URL || '').trim();
    const separator = baseUrl.indexOf('?') === -1 ? '?' : '&';
    return baseUrl + separator + 'action=' + encodeURIComponent(String(action || ''));
  },

  /** ป้องกันการกดปุ่มส่งข้อมูลซ้ำระหว่างรอผลลัพธ์จาก Server */
  async withSubmitLock(fn) {
    if (this._pendingSubmit) return;
    this._pendingSubmit = true;
    try {
      return await fn();
    } finally {
      this._pendingSubmit = false;
    }
  }
};
