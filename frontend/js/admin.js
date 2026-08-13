/**
 * admin.js
 * หน้าจัดการสำหรับ Admin: พนักงาน, ห้องพัก, รายการตรวจสอบ (Checklist), รายงาน,
 * Audit Log, ตั้งค่าระบบ และโปรไฟล์ผู้ใช้งาน
 */

const AdminView = {
  // ---------------- จัดการพนักงาน ----------------
  async renderUsers(container) {
    Utils.showLoading('กำลังโหลดรายชื่อพนักงาน...');
    try {
      const users = await Api.call('getUsers', { pageSize: 200 });
      container.innerHTML = `
        <div class="hci-page-header"><div><h1>จัดการพนักงาน</h1></div>
          <button class="hci-btn hci-btn-gold" id="addUserBtn"><i class="fa-solid fa-user-plus"></i> เพิ่มพนักงาน</button>
        </div>
        <div class="hci-card">
          <table class="hci-table">
            <thead><tr><th>ชื่อ-สกุล</th><th>Username</th><th>บทบาท</th><th>สถานะ</th><th>เข้าสู่ระบบล่าสุด</th><th></th></tr></thead>
            <tbody>${users.items.map(u => `
              <tr>
                <td>${Utils.escapeHtml(u.FullName)}</td><td>${Utils.escapeHtml(u.Username)}</td>
                <td>${APP_CONFIG.ROLE_LABELS[u.Role] || u.Role}</td>
                <td><span class="hci-badge hci-badge-${u.Status === 'ACTIVE' ? 'green' : 'gray'}">${u.Status === 'ACTIVE' ? 'ใช้งาน' : 'ปิดใช้งาน'}</span></td>
                <td>${u.LastLogin ? Utils.formatDateTh(u.LastLogin) : '-'}</td>
                <td>
                  <button class="hci-btn-icon" onclick="AdminView.openUserDialog('${u.UserID}')"><i class="fa-solid fa-pen"></i></button>
                  <button class="hci-btn-icon" onclick="AdminView.toggleUserStatus('${u.UserID}', '${u.Status}')"><i class="fa-solid ${u.Status === 'ACTIVE' ? 'fa-ban' : 'fa-check'}"></i></button>
                </td>
              </tr>`).join('') || emptyRow(6)}
            </tbody>
          </table>
        </div>
      `;
      document.getElementById('addUserBtn').addEventListener('click', () => AdminView.openUserDialog(null));
      AdminView._usersCache = users.items;
    } catch (e) {
      renderErrorState(container, 'ไม่สามารถโหลดรายชื่อพนักงานได้', () => AdminView.renderUsers(container));
    } finally { Utils.hideLoading(); }
  },

  async openUserDialog(userId) {
    const existing = userId ? AdminView._usersCache.find(u => u.UserID === userId) : null;
    const { value } = await Swal.fire({
      title: existing ? 'แก้ไขข้อมูลพนักงาน' : 'เพิ่มพนักงานใหม่',
      html: `
        <input id="swalFullName" class="swal2-input" placeholder="ชื่อ-สกุล" value="${existing ? Utils.escapeHtml(existing.FullName) : ''}">
        <input id="swalUsername" class="swal2-input" placeholder="Username" value="${existing ? Utils.escapeHtml(existing.Username) : ''}" ${existing ? 'disabled' : ''}>
        <input id="swalEmail" class="swal2-input" placeholder="อีเมล" value="${existing ? Utils.escapeHtml(existing.Email || '') : ''}">
        <input id="swalPassword" type="password" class="swal2-input" placeholder="${existing ? 'รหัสผ่านใหม่ (เว้นว่างถ้าไม่เปลี่ยน)' : 'รหัสผ่าน'}">
        <select id="swalRole" class="swal2-select">
          ${Object.keys(APP_CONFIG.ROLE_LABELS).map(r => `<option value="${r}" ${existing && existing.Role === r ? 'selected' : ''}>${APP_CONFIG.ROLE_LABELS[r]}</option>`).join('')}
        </select>
      `,
      confirmButtonText: 'บันทึก', confirmButtonColor: '#0B1F3A', showCancelButton: true, cancelButtonText: 'ยกเลิก',
      preConfirm: () => ({
        fullName: document.getElementById('swalFullName').value,
        username: document.getElementById('swalUsername').value,
        email: document.getElementById('swalEmail').value,
        password: document.getElementById('swalPassword').value,
        role: document.getElementById('swalRole').value
      })
    });
    if (!value) return;
    if (!value.fullName || (!existing && (!value.username || !value.password))) {
      Utils.toast('warning', 'กรุณากรอกข้อมูลให้ครบถ้วน'); return;
    }
    Utils.showLoading('กำลังบันทึกข้อมูล...');
    try {
      if (existing) {
        await Api.call('updateUser', { userId: existing.UserID, fullName: value.fullName, email: value.email, password: value.password, role: value.role });
      } else {
        await Api.call('createUser', value);
      }
      Utils.toast('success', 'บันทึกข้อมูลพนักงานสำเร็จ');
      Router.reload();
    } finally { Utils.hideLoading(); }
  },

  async toggleUserStatus(userId, currentStatus) {
    const newStatus = currentStatus === 'ACTIVE' ? 'DISABLED' : 'ACTIVE';
    if (!(await Utils.confirm(newStatus === 'ACTIVE' ? 'เปิดใช้งานบัญชีนี้?' : 'ปิดใช้งานบัญชีนี้?', '', 'ยืนยัน'))) return;
    Utils.showLoading('กำลังอัปเดตสถานะ...');
    try {
      await Api.call('disableUser', { userId, status: newStatus });
      Utils.toast('success', 'อัปเดตสถานะสำเร็จ');
      Router.reload();
    } finally { Utils.hideLoading(); }
  },

  // ---------------- จัดการห้องพัก/บ้านพัก ----------------
  async renderRoomsAdmin(container) {
    Utils.showLoading('กำลังโหลดข้อมูลห้องพัก...');
    try {
      const [rooms, users] = await Promise.all([Api.call('getRooms', {}), Api.call('getUsers', { role: 'HOUSEKEEPER', pageSize: 200 })]);
      AdminView._roomsCache = rooms.items; AdminView._housekeepersCache = users.items;
      container.innerHTML = `
        <div class="hci-page-header"><div><h1>จัดการห้องพักและบ้านพัก</h1><p class="hci-subtitle">เพิ่ม แก้ไข หรือปิดใช้งานห้องพัก/บ้านพักได้โดยไม่ต้องแก้ไขโค้ด</p></div>
          <button class="hci-btn hci-btn-gold" id="addRoomBtn"><i class="fa-solid fa-plus"></i> เพิ่มห้อง/บ้านพัก</button>
        </div>
        <div class="hci-card">
          <table class="hci-table">
            <thead><tr><th>หมายเลข/ชื่อ</th><th>ประเภท</th><th>ชั้น</th><th>สถานะ</th><th>ผู้รับผิดชอบ</th><th></th></tr></thead>
            <tbody>${rooms.items.map(r => `
              <tr>
                <td>${Utils.escapeHtml(r.RoomName || r.RoomNumber)}</td>
                <td>${r.RoomType === 'VIP' ? 'VIP' : 'ห้องพัก'}</td><td>${Utils.escapeHtml(r.Floor || '-')}</td>
                <td><span class="hci-badge hci-badge-${Utils.statusMeta(r.Status).color}">${r.Status}</span></td>
                <td>${Utils.escapeHtml((users.items.find(h => h.UserID === r.AssignedHousekeeper) || {}).FullName || '-')}</td>
                <td><button class="hci-btn-icon" onclick="AdminView.openRoomDialog('${r.RoomID}')"><i class="fa-solid fa-pen"></i></button></td>
              </tr>`).join('') || emptyRow(6)}
            </tbody>
          </table>
        </div>
      `;
      document.getElementById('addRoomBtn').addEventListener('click', () => AdminView.openRoomDialog(null));
    } catch (e) {
      renderErrorState(container, 'ไม่สามารถโหลดข้อมูลห้องพักได้', () => AdminView.renderRoomsAdmin(container));
    } finally { Utils.hideLoading(); }
  },

  async openRoomDialog(roomId) {
    const existing = roomId ? AdminView._roomsCache.find(r => r.RoomID === roomId) : null;
    const hks = AdminView._housekeepersCache || [];
    const { value } = await Swal.fire({
      title: existing ? 'แก้ไขห้อง/บ้านพัก' : 'เพิ่มห้อง/บ้านพักใหม่',
      html: `
        <input id="swalRoomNumber" class="swal2-input" placeholder="หมายเลขห้อง เช่น 101" value="${existing ? Utils.escapeHtml(existing.RoomNumber) : ''}">
        <input id="swalRoomName" class="swal2-input" placeholder="ชื่อแสดงผล เช่น ห้อง 1 หรือ VIP 1" value="${existing ? Utils.escapeHtml(existing.RoomName) : ''}">
        <select id="swalRoomType" class="swal2-select">
          <option value="GUEST_ROOM" ${existing && existing.RoomType === 'GUEST_ROOM' ? 'selected' : ''}>ห้องพัก</option>
          <option value="VIP" ${existing && existing.RoomType === 'VIP' ? 'selected' : ''}>VIP</option>
        </select>
        <input id="swalFloor" class="swal2-input" placeholder="ชั้น" value="${existing ? Utils.escapeHtml(existing.Floor || '') : ''}">
        <select id="swalHousekeeper" class="swal2-select">
          <option value="">-- ไม่ระบุ --</option>
          ${hks.map(h => `<option value="${h.UserID}" ${existing && existing.AssignedHousekeeper === h.UserID ? 'selected' : ''}>${Utils.escapeHtml(h.FullName)}</option>`).join('')}
        </select>
      `,
      confirmButtonText: 'บันทึก', confirmButtonColor: '#0B1F3A', showCancelButton: true, cancelButtonText: 'ยกเลิก',
      preConfirm: () => ({
        roomNumber: document.getElementById('swalRoomNumber').value,
        roomName: document.getElementById('swalRoomName').value,
        roomType: document.getElementById('swalRoomType').value,
        floor: document.getElementById('swalFloor').value,
        assignedHousekeeper: document.getElementById('swalHousekeeper').value
      })
    });
    if (!value) return;
    if (!value.roomNumber) { Utils.toast('warning', 'กรุณาระบุหมายเลขห้อง'); return; }
    Utils.showLoading('กำลังบันทึกข้อมูล...');
    try {
      if (existing) await Api.call('updateRoom', Object.assign({ roomId: existing.RoomID }, value));
      else await Api.call('createRoom', value);
      Utils.toast('success', 'บันทึกข้อมูลห้องพักสำเร็จ');
      Router.reload();
    } finally { Utils.hideLoading(); }
  },

  // ---------------- Audit Log ----------------
  async renderAuditLog(container) {
    Utils.showLoading('กำลังโหลด Audit Log...');
    try {
      const logs = await Api.call('getAuditLogs', { page: 1, pageSize: 50 });
      container.innerHTML = `
        <div class="hci-page-header"><div><h1>Audit Log</h1><p class="hci-subtitle">ประวัติการเพิ่ม แก้ไข ลบ และอนุมัติข้อมูลในระบบ</p></div></div>
        <div class="hci-card">
          <table class="hci-table">
            <thead><tr><th>วันเวลา</th><th>ผู้ใช้งาน</th><th>การกระทำ</th><th>โมดูล</th><th>อ้างอิง</th></tr></thead>
            <tbody>${logs.items.map(l => `<tr><td>${l.DateTime}</td><td>${Utils.escapeHtml(l.Username || l.UserID)}</td><td>${l.Action}</td><td>${l.Module}</td><td>${Utils.escapeHtml(l.ReferenceID)}</td></tr>`).join('') || emptyRow(5)}</tbody>
          </table>
        </div>
      `;
    } catch (e) {
      renderErrorState(container, 'ไม่สามารถโหลด Audit Log ได้', () => AdminView.renderAuditLog(container));
    } finally { Utils.hideLoading(); }
  },

  // ---------------- ตั้งค่าระบบ ----------------
  renderSettings(container) {
    container.innerHTML = `
      <div class="hci-page-header"><div><h1>ตั้งค่าระบบ</h1></div></div>
      <div class="hci-card">
        <p class="hci-muted">ค่าตั้งค่าหลักของระบบ เช่น Spreadsheet ID และ Drive Folder ID ถูกจัดเก็บอัตโนมัติในชีต <b>Settings</b>
        ของ Google Sheets เมื่อรันฟังก์ชัน <code>setupSystem()</code> ครั้งแรก หากต้องการเปลี่ยนค่า สามารถแก้ไขได้โดยตรงในชีต Settings
        หรือปรับค่า Web App URL ได้ที่ไฟล์ <code>js/config.js</code> ของ Frontend</p>
        <table class="hci-table">
          <thead><tr><th>รายการตั้งค่า</th><th>วิธีแก้ไข</th></tr></thead>
          <tbody>
            <tr><td>Web App URL (GAS_WEB_APP_URL)</td><td>แก้ไขในไฟล์ frontend/js/config.js</td></tr>
            <tr><td>Spreadsheet ID</td><td>Script Properties ของ Apps Script (ตั้งอัตโนมัติเมื่อรัน setupSystem)</td></tr>
            <tr><td>Drive Folder ID สำหรับรูปภาพ</td><td>ชีต Settings แถว DRIVE_FOLDER_ID</td></tr>
            <tr><td>เกณฑ์คะแนนผ่านมาตรฐาน</td><td>แก้ไขในฟังก์ชัน calculateInspectionScore_ (InspectionService.gs)</td></tr>
          </tbody>
        </table>
      </div>
    `;
  },

  // ---------------- โปรไฟล์ผู้ใช้งาน ----------------
  renderProfile(container) {
    const user = Auth.getCurrentUser();
    container.innerHTML = `
      <div class="hci-page-header"><div><h1>โปรไฟล์ผู้ใช้งาน</h1></div></div>
      <div class="hci-card hci-profile-card">
        <div class="hci-profile-avatar"><i class="fa-solid fa-user"></i></div>
        <div>
          <p class="hci-profile-name">${Utils.escapeHtml(user.FullName)}</p>
          <p class="hci-muted">${APP_CONFIG.ROLE_LABELS[user.Role]} • ${Utils.escapeHtml(user.Username)}</p>
          <p class="hci-muted">อีเมล: ${Utils.escapeHtml(user.Email || '-')}</p>
        </div>
      </div>
      <div class="hci-card">
        <h3>เปลี่ยนรหัสผ่าน</h3>
        <form id="changePwForm" class="hci-form-row">
          <div class="hci-form-group"><label>รหัสผ่านปัจจุบัน</label><input type="password" name="currentPassword" required autocomplete="current-password"></div>
          <div class="hci-form-group"><label>รหัสผ่านใหม่</label><input type="password" name="newPassword" required minlength="8" autocomplete="new-password"></div>
          <button type="submit" class="hci-btn hci-btn-navy" style="align-self:flex-end">บันทึก</button>
        </form>
      </div>
    `;
    document.getElementById('changePwForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const currentPassword = e.target.currentPassword.value;
      const newPassword = e.target.newPassword.value;
      Utils.showLoading('กำลังเปลี่ยนรหัสผ่าน...');
      try {
        await Api.call('changeMyPassword', { currentPassword, newPassword });
        Utils.toast('success', 'เปลี่ยนรหัสผ่านสำเร็จ');
        e.target.reset();
      } finally { Utils.hideLoading(); }
    });
  }
};
