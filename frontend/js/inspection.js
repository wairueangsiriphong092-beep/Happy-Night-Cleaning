/**
 * inspection.js
 * หน้ารายการห้องพัก แบบฟอร์มตรวจสอบ 5 หมวด หน้าสรุปก่อนส่ง ประวัติการตรวจสอบ
 * รายละเอียดผลตรวจ รายการปัญหา และหน้ายืนยันการแก้ไขของแม่บ้าน
 */

const InspectionView = {
  currentDraft: null, // ข้อมูลแบบร่างที่กำลังกรอกอยู่ (in-memory + auto-save)
  liveRefreshTimer: null,
  historyFilters: null,
  issueFilters: null,

  stopLiveRefresh() {
    if (this.liveRefreshTimer) clearInterval(this.liveRefreshTimer);
    this.liveRefreshTimer = null;
  },

  startLiveRefresh(callback) {
    this.stopLiveRefresh();
    this.liveRefreshTimer = setInterval(() => {
      if (document.visibilityState === 'visible') callback();
    }, 20000);
  },

  // ---------------- รายการห้องพัก ----------------
  async renderRoomList(container) {
    Utils.showLoading('กำลังโหลดรายการห้อง...');
    try {
      const rooms = await Api.call('getRooms', {});
      const user = Auth.getCurrentUser();
      container.innerHTML = `
        <div class="hci-page-header"><div><h1>รายการห้องพักและบ้านพัก</h1><p class="hci-subtitle">เลือกห้องที่ต้องการตรวจสอบความสะอาด</p></div></div>
        <div class="hci-filter-bar hci-card">
          <div class="hci-filter-group"><label>ประเภท</label>
            <select id="filterRoomType"><option value="">ทั้งหมด</option><option value="GUEST_ROOM">ห้องพัก</option><option value="VIP">VIP</option></select>
          </div>
          <div class="hci-filter-group"><label>ค้นหาหมายเลขห้อง</label><input type="text" id="filterRoomSearch" placeholder="เช่น 101"></div>
        </div>
        <div class="hci-room-grid" id="roomListGrid"></div>
      `;
      const grid = document.getElementById('roomListGrid');
      const draw = () => {
        const type = document.getElementById('filterRoomType').value;
        const kw = document.getElementById('filterRoomSearch').value.trim();
        let list = rooms.items;
        if (type) list = list.filter(r => r.RoomType === type);
        if (kw) list = list.filter(r => String(r.RoomNumber).indexOf(kw) !== -1);
        renderRoomGrid(grid, list, user);
      };
      document.getElementById('filterRoomType').addEventListener('change', draw);
      document.getElementById('filterRoomSearch').addEventListener('input', Utils.debounce(draw, 200));
      draw();
    } catch (e) {
      renderErrorState(container, 'ไม่สามารถโหลดรายการห้องได้', () => InspectionView.renderRoomList(container));
    } finally { Utils.hideLoading(); }
  },

  // ---------------- แบบฟอร์มตรวจสอบ ----------------
  async renderForm(container, roomId) {
    Utils.showLoading('กำลังเตรียมแบบฟอร์มตรวจสอบ...');
    try {
      const user = Auth.getCurrentUser();
      // แม่บ้านบันทึกผลตรวจในชื่อของตนเอง ไม่จำเป็นต้องขอรายชื่อพนักงานทั้งหมด
      const housekeeperRequest = user.Role === 'HOUSEKEEPER'
        ? Promise.resolve({ items: [{ UserID: user.UserID, FullName: user.FullName }] })
        : Api.call('getUsers', { role: 'HOUSEKEEPER', pageSize: 200 });
      const [checklist, rooms, users] = await Promise.all([
        Api.call('getChecklist', {}),
        Api.call('getRooms', {}),
        housekeeperRequest
      ]);

      // รองรับ Category ใน ChecklistItems แบบอังกฤษอย่างเดียว
      // และแบบ "อังกฤษ | ภาษาไทย" โดยไม่กระทบ key ภายในระบบ
      const checklistItems = normalizeChecklistItemsForForm(checklist.items || {});

      const room = rooms.items.find(r => r.RoomID === roomId);
      if (!room) { container.innerHTML = emptyState('ไม่พบห้องที่ระบุ'); Utils.hideLoading(); return; }

      const draftKey = 'inspection_' + roomId;
      const draft = Utils.loadDraft(draftKey);

      container.innerHTML = `
        <div class="hci-page-header"><div>
          <h1>แบบฟอร์มตรวจสอบ: ${room.RoomType === 'VIP' ? Utils.escapeHtml(room.RoomName) : 'ห้อง ' + Utils.escapeHtml(room.RoomNumber)}</h1>
          <p class="hci-subtitle">ผู้ตรวจสอบ: ${Utils.escapeHtml(user.FullName)} • วันที่ ${Utils.formatDateTh(new Date())}</p>
        </div></div>

        <form id="inspectionForm" class="hci-card">
          <div class="hci-form-row">
            <div class="hci-form-group"><label>รอบการตรวจ</label>
              <select name="round"><option>รอบเช้า</option><option>รอบบ่าย</option><option>รอบดึก</option><option>ตรวจซ้ำ</option></select>
            </div>
            <div class="hci-form-group"><label>สถานะห้องก่อนตรวจ</label>
              <select name="preStatus"><option>กำลังทำความสะอาด</option><option>ทำความสะอาดเสร็จแล้ว</option><option>รอตรวจซ้ำหลังแก้ไข</option></select>
            </div>
            <div class="hci-form-group"><label>พนักงานแม่บ้านผู้รับผิดชอบ</label>
              <input
                type="text"
                name="housekeeperName"
                list="housekeeperNameList"
                required
                autocomplete="off"
                maxlength="200"
                placeholder="พิมพ์ชื่อพนักงานแม่บ้าน"
                value="${user.Role === 'HOUSEKEEPER' ? Utils.escapeHtml(user.FullName || '') : ''}">
              <datalist id="housekeeperNameList">
                ${(users.items || []).map(h => `<option value="${Utils.escapeHtml(h.FullName || '')}" data-user-id="${Utils.escapeHtml(h.UserID || '')}"></option>`).join('')}
              </datalist>
            </div>
          </div>

          <div id="checklistCategories"></div>

          <div class="hci-form-group"><label>หมายเหตุทั่วไป</label><textarea name="generalNote" rows="2" placeholder="ระบุหมายเหตุเพิ่มเติม (ถ้ามี)"></textarea></div>

          <div class="hci-form-actions">
            <span class="hci-autosave-status" id="autosaveStatus"><i class="fa-solid fa-check"></i> บันทึกร่างอัตโนมัติแล้ว</span>
            <button type="button" class="hci-btn hci-btn-outline" onclick="history.back()">ยกเลิก</button>
            <button type="submit" class="hci-btn hci-btn-gold"><i class="fa-solid fa-magnifying-glass"></i> ตรวจทานก่อนส่ง</button>
          </div>
        </form>
      `;

      const catContainer = document.getElementById('checklistCategories');
      // หน้าแบบฟอร์มใช้เพียง 4 โซน และเริ่มต้นแสดงเฉพาะหัวข้อ
      catContainer.innerHTML = INSPECTION_CATEGORIES
        .map(cat => renderCategoryBlock(cat, checklistItems[cat] || [], draft))
        .join('');
      bindItemHandlers(catContainer);
      if (draft) restoreDraftValues(catContainer, draft);

      // Auto-Save แบบร่างทุกครั้งที่มีการเปลี่ยนแปลง (ไม่มีรหัสผ่านหรือข้อมูลสำคัญ)
      const form = document.getElementById('inspectionForm');
      const doAutosave = Utils.debounce(() => {
        const data = collectFormData(form, catContainer);
        Utils.saveDraft(draftKey, data);
        const el = document.getElementById('autosaveStatus');
        if (el) el.innerHTML = `<i class="fa-solid fa-check"></i> บันทึกร่างล่าสุด ${Utils.formatDateTh(new Date())}`;
      }, 600);
      form.addEventListener('input', doAutosave);
      form.addEventListener('change', doAutosave);
      if (draft) restoreFormFields(form, draft);

      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const data = collectFormData(form, catContainer);

        // โซนห้องนอน / โซนห้องน้ำ / โซนบริเวณโรงแรม
        // สามารถเว้นบางรายการเป็น “ยังไม่ได้ประเมิน” ได้
        // ภาพรวมความปลอดภัยยังคงบังคับให้ประเมินครบทุกข้อ
        const requiredItems = Array.from(
          catContainer.querySelectorAll('.hci-checklist-item')
        ).filter(item => item.dataset.category === 'SAFETY');

        const requiredAnswered = data.details.filter(
          detail => detail.category === 'SAFETY' && detail.result !== 'ยังไม่ได้ประเมิน'
        );

        if (requiredItems.length > 0 && requiredAnswered.length !== requiredItems.length) {
          openFirstIncompleteZone(catContainer);
          Utils.toast('warning', 'กรุณาประเมินผลในภาพรวมความปลอดภัยให้ครบทุกรายการก่อนตรวจทาน');
          return;
        }
        const missingNote = data.details.find(d => d.result === 'ไม่ผ่าน' && !d.note);
        if (missingNote) {
          Utils.toast('warning', 'รายการที่ไม่ผ่าน ต้องระบุหมายเหตุ: ' + missingNote.itemName);
          return;
        }
        const missingPhoto = data.details.find(d => d.result === 'ไม่ผ่าน' && !d.beforeImageUrl && !d._pendingBase64);
        if (missingPhoto) {
          Utils.toast('warning', 'กรุณาแนบรูปภาพหลักฐานสำหรับรายการที่ไม่ผ่าน: ' + missingPhoto.itemName);
          return;
        }
        if (!data.housekeeperName) {
          Utils.toast('warning', 'กรุณาพิมพ์ชื่อพนักงานแม่บ้านผู้รับผิดชอบ');
          return;
        }
        Utils.showLoading('กำลังอัปโหลดรูปภาพหลักฐาน...');
        try {
          await uploadPendingPhotos(data.details, room.RoomNumber || room.RoomName, user.FullName);
        } catch (err) {
          Utils.hideLoading();
          Utils.toast('error', 'อัปโหลดรูปภาพไม่สำเร็จ กรุณาลองใหม่');
          return;
        }
        Utils.hideLoading();
        InspectionView.renderReview(container, room, data, draftKey);
      });
    } catch (e) {
      renderErrorState(container, 'ไม่สามารถโหลดแบบฟอร์มตรวจสอบได้', () => InspectionView.renderForm(container, roomId));
    } finally { Utils.hideLoading(); }
  },

  // ---------------- หน้าสรุปก่อนส่ง ----------------
  renderReview(container, room, data, draftKey) {
    const score = calcPreviewScore(data.details);
    const evaluatedCount = data.details.filter(d => d.result !== 'ยังไม่ได้ประเมิน').length;
    container.innerHTML = `
      <div class="hci-page-header"><div><h1>ตรวจทานผลการตรวจสอบก่อนส่ง</h1><p class="hci-subtitle">ห้อง ${Utils.escapeHtml(room.RoomNumber || room.RoomName)}</p></div></div>
      <div class="hci-card">
        <div class="hci-score-summary">
          <div class="hci-score-circle" style="--score:${score.finalScore}"><span>${score.finalScore}%</span></div>
          <div>
            <p class="hci-score-status hci-color-${score.finalScore >= 80 ? 'green' : (score.finalScore >= 70 ? 'amber' : 'red')}">${score.finalStatus}</p>
            <p class="hci-muted">คะแนนคำนวณจากรายการที่ประเมินจริง ${evaluatedCount} รายการ</p>
          </div>
        </div>
        <table class="hci-table">
          <thead><tr><th>หมวด</th><th>คะแนน</th></tr></thead>
          <tbody>${INSPECTION_CATEGORIES.map(k => `<tr><td>${APP_CONFIG.CATEGORY_LABELS[k]}</td><td>${score.categoryScores[k] === null ? '-' : score.categoryScores[k] + '%'}</td></tr>`).join('')}</tbody>
        </table>
        <h3>รายการที่ไม่ผ่าน</h3>
        ${renderFailedList(data.details)}
        <div class="hci-form-actions">
          <button class="hci-btn hci-btn-outline" id="backToFormBtn">แก้ไขแบบฟอร์ม</button>
          <button class="hci-btn hci-btn-navy" id="confirmSubmitBtn"><i class="fa-solid fa-paper-plane"></i> ยืนยันบันทึกผลการตรวจสอบ</button>
        </div>
      </div>
    `;
    document.getElementById('backToFormBtn').addEventListener('click', () => InspectionView.renderForm(container, room.RoomID));
    document.getElementById('confirmSubmitBtn').addEventListener('click', async () => {
      await Api.withSubmitLock(async () => {
        const submitBtn = document.getElementById('confirmSubmitBtn');
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> กำลังบันทึก...';
        }
        Utils.showLoading('กำลังบันทึกผลการตรวจสอบ...');
        try {
          const result = await Api.call('saveInspection', {
            roomId: room.RoomID, roomNumber: room.RoomNumber || room.RoomName,
            housekeeperId: data.housekeeperId, housekeeperName: data.housekeeperName,
            inspectionRound: data.round,
            inspectionDate: Utils.todayISO(), startTime: data.startTime,
            generalNote: data.generalNote, details: data.details
          });
          Utils.clearDraft(draftKey);
          Utils.hideLoading();
          await Utils.success(
            'บันทึกข้อมูลแล้ว',
            `บันทึกผลการตรวจสอบเรียบร้อยแล้ว<br>เลขที่รายการ: <b>${Utils.escapeHtml(result.inspectionId || '-')}</b><br>คะแนนรวม: <b>${Number(result.finalScore) || 0}%</b> (${Utils.escapeHtml(result.finalStatus || '-')})`,
            `บันทึกข้อมูลแล้ว\nเลขที่รายการ: ${result.inspectionId || '-'}\nคะแนนรวม: ${Number(result.finalScore) || 0}% (${result.finalStatus || '-'})`
          );
          location.hash = '#/history';
        } catch (e) {
          Utils.hideLoading();
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> ยืนยันบันทึกผลการตรวจสอบ';
          }
        }
      });
    });
  },

  // ---------------- ประวัติการตรวจสอบ ----------------
  async renderHistory(container) {
    this.stopLiveRefresh();
    const today = Utils.todayISO();
    this.historyFilters = { dateFrom: today, dateTo: today };

    container.innerHTML = `
      <div class="hci-page-header">
        <div><h1>ประวัติการตรวจสอบ</h1><p class="hci-subtitle">แสดงข้อมูลแบบวันต่อวัน • ค่าเริ่มต้นคือวันนี้</p></div>
        <div class="hci-header-actions"><span class="hci-badge hci-badge-navy" id="historyUpdatedAt">กำลังโหลดข้อมูล...</span></div>
      </div>
      <div class="hci-card hci-dashboard-filter-card">
        <div class="hci-quick-filters" id="historyQuickFilters">
          <button type="button" class="hci-quick-filter active" data-range="today">วันนี้</button>
          <button type="button" class="hci-quick-filter" data-range="yesterday">เมื่อวาน</button>
          <button type="button" class="hci-quick-filter" data-range="custom">กำหนดเอง</button>
        </div>
        <form id="historyFilterForm" class="hci-filter-bar">
          <div class="hci-filter-group"><label>วันที่เริ่มต้น</label><input type="date" name="dateFrom" value="${today}"></div>
          <div class="hci-filter-group"><label>วันที่สิ้นสุด</label><input type="date" name="dateTo" value="${today}"></div>
          <button type="submit" class="hci-btn hci-btn-navy"><i class="fa-solid fa-filter"></i> กรองข้อมูล</button>
          <button type="button" class="hci-btn hci-btn-outline" id="historyRefreshBtn"><i class="fa-solid fa-rotate"></i> อัปเดตข้อมูล</button>
        </form>
      </div>
      <div class="hci-card">
        <div class="hci-table-scroll">
          <table class="hci-table">
            <thead><tr><th>เลขที่</th><th>ห้อง</th><th>ผู้ตรวจสอบ</th><th>พนักงาน/แม่บ้าน</th><th>วันที่ / เวลา</th><th>รอบการตรวจ</th><th>คะแนน</th><th>สถานะ</th><th>การอนุมัติ</th><th></th></tr></thead>
            <tbody id="historyTableBody">${emptyRow(10)}</tbody>
          </table>
        </div>
      </div>`;

    const form = document.getElementById('historyFilterForm');
    form.addEventListener('submit', async e => {
      e.preventDefault();
      this.historyFilters = Object.fromEntries(new FormData(form).entries());
      await this.refreshHistoryData();
    });
    document.getElementById('historyRefreshBtn').addEventListener('click', () => this.refreshHistoryData());
    document.querySelectorAll('#historyQuickFilters .hci-quick-filter').forEach(btn => {
      btn.addEventListener('click', async () => {
        document.querySelectorAll('#historyQuickFilters .hci-quick-filter').forEach(x => x.classList.toggle('active', x === btn));
        if (btn.dataset.range === 'custom') { form.elements.dateFrom.focus(); return; }
        const range = inspectionQuickDateRange(btn.dataset.range);
        form.elements.dateFrom.value = range.dateFrom;
        form.elements.dateTo.value = range.dateTo;
        this.historyFilters = range;
        await this.refreshHistoryData();
      });
    });
    ['dateFrom','dateTo'].forEach(name => form.elements[name].addEventListener('change', () => {
      document.querySelectorAll('#historyQuickFilters .hci-quick-filter').forEach(x => x.classList.toggle('active', x.dataset.range === 'custom'));
    }));

    await this.refreshHistoryData();
    this.startLiveRefresh(() => this.refreshHistoryData(true));
  },

  async refreshHistoryData(silent = false) {
    const tbody = document.getElementById('historyTableBody');
    if (!tbody) return;
    try {
      if (!silent) Utils.showLoading('กำลังโหลดประวัติการตรวจสอบ...');
      const filters = this.historyFilters || { dateFrom: Utils.todayISO(), dateTo: Utils.todayISO() };
      const history = await Api.call('getInspectionHistory', Object.assign({ page: 1, pageSize: 500 }, filters), { silent });
      tbody.innerHTML = history.items.map(i => `
        <tr>
          <td>${Utils.escapeHtml(i.InspectionID)}</td><td>${Utils.escapeHtml(i.RoomNumber)}</td><td>${Utils.escapeHtml(i.InspectorName)}</td>
          <td>${Utils.escapeHtml(i.HousekeeperName || '-')}</td><td>${inspectionHistoryDateTime(i)}</td>
          <td>${Utils.escapeHtml(i.InspectionRound || '-')}</td><td>${Number(i.FinalScore || 0)}%</td>
          <td><span class="hci-badge hci-badge-${Utils.statusMeta(i.FinalStatus).color}">${Utils.escapeHtml(i.FinalStatus)}</span></td>
          <td>${approvalLabel(i.ApprovalStatus)}</td>
          <td><button class="hci-btn-icon" onclick="location.hash='#/inspection-detail/${Utils.escapeHtml(i.InspectionID)}'"><i class="fa-solid fa-eye"></i></button></td>
        </tr>`).join('') || emptyRow(10);
      const badge = document.getElementById('historyUpdatedAt');
      if (badge) badge.textContent = `ข้อมูลล่าสุด ${inspectionClockText()} • ${history.total || 0} รายการ • อัปเดตอัตโนมัติ`;
    } catch (e) {
      if (!silent) Utils.toast('error', e.message || 'โหลดประวัติไม่สำเร็จ');
    } finally {
      if (!silent) Utils.hideLoading();
    }
  },

  // ---------------- รายละเอียดผลการตรวจ ----------------
  async renderDetail(container, inspectionId) {
    Utils.showLoading('กำลังโหลดรายละเอียด...');
    try {
      const data = await Api.call('getInspectionDetail', { inspectionId });
      const ins = data.inspection;
      const user = Auth.getCurrentUser();
      container.innerHTML = `
        <div class="hci-page-header no-print"><div><h1>รายละเอียดผลการตรวจสอบ ${ins.InspectionID}</h1></div>
          <div class="hci-header-actions">
            <button class="hci-btn hci-btn-outline" onclick="window.print()"><i class="fa-solid fa-print"></i> พิมพ์รายงาน</button>
            ${user.Role === 'ADMIN' && ins.ApprovalStatus === 'PENDING' ? `
              <button class="hci-btn hci-btn-navy" id="approveBtn"><i class="fa-solid fa-check"></i> อนุมัติ</button>
              <button class="hci-btn hci-btn-outline" id="rejectBtn"><i class="fa-solid fa-rotate-left"></i> ส่งกลับแก้ไข</button>` : ''}
          </div>
        </div>
        <div class="hci-card hci-print-area">
          <div class="hci-print-header"><h2>${APP_CONFIG.APP_NAME_TH}</h2><p>ใบรายงานผลการตรวจสอบความสะอาด เลขที่ ${ins.InspectionID}</p></div>
          <div class="hci-detail-grid">
            <p><b>ห้อง/บ้านพัก:</b> ${Utils.escapeHtml(ins.RoomNumber)}</p>
            <p><b>ผู้ตรวจสอบ:</b> ${Utils.escapeHtml(ins.InspectorName)}</p>
            <p><b>พนักงานแม่บ้านผู้รับผิดชอบ:</b> ${Utils.escapeHtml(ins.HousekeeperName || '-')}</p>
            <p><b>วันที่ตรวจสอบ:</b> ${inspectionHistoryDateTime(ins, true)}</p>
            <p><b>รอบการตรวจ:</b> ${Utils.escapeHtml(ins.InspectionRound || '-')}</p>
            <p><b>คะแนนรวม:</b> ${ins.FinalScore}% (${ins.FinalStatus})</p>
            <p><b>สถานะการอนุมัติ:</b> ${approvalLabel(ins.ApprovalStatus)}</p>
          </div>
          <p><b>หมายเหตุทั่วไป:</b> ${Utils.escapeHtml(ins.GeneralNote || '-')}</p>
          <table class="hci-table">
            <thead><tr><th>หมวด</th><th>รายการ</th><th>ผล</th><th>ระดับความรุนแรง</th><th>หมายเหตุ</th><th>รูปภาพ</th></tr></thead>
            <tbody>${data.details.map(d => `
              <tr>
                <td>${APP_CONFIG.CATEGORY_LABELS[d.Category] || d.Category}</td>
                <td>${Utils.escapeHtml(d.ItemName)}</td>
                <td><span class="hci-badge hci-badge-${resultColor(d.Result)}">${d.Result}</span></td>
                <td>${d.Severity || '-'}</td>
                <td>${Utils.escapeHtml(d.Note || '-')}</td>
                <td>${d.BeforeImageURL ? `<a href="${d.BeforeImageURL}" target="_blank"><img class="hci-thumb" src="${d.BeforeImageURL}"></a>` : '-'}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      `;
      if (document.getElementById('approveBtn')) {
        document.getElementById('approveBtn').addEventListener('click', async () => {
          if (!(await Utils.confirm('อนุมัติรายการนี้?', 'การอนุมัติจะทำให้ไม่สามารถแก้ไขรายการนี้ได้อีก', 'อนุมัติ'))) return;
          await Api.call('updateInspection', { inspectionId, approvalStatus: 'APPROVED' });
          Utils.toast('success', 'อนุมัติรายการสำเร็จ');
          InspectionView.renderDetail(container, inspectionId);
        });
        document.getElementById('rejectBtn').addEventListener('click', async () => {
          if (!(await Utils.confirm('ส่งกลับให้แก้ไข?', 'ผู้ตรวจสอบจะสามารถแก้ไขรายการนี้ได้อีกครั้ง', 'ส่งกลับ'))) return;
          await Api.call('updateInspection', { inspectionId, approvalStatus: 'REJECTED' });
          Utils.toast('success', 'ส่งกลับให้แก้ไขสำเร็จ');
          InspectionView.renderDetail(container, inspectionId);
        });
      }
    } catch (e) {
      renderErrorState(container, 'ไม่สามารถโหลดรายละเอียดได้', () => InspectionView.renderDetail(container, inspectionId));
    } finally { Utils.hideLoading(); }
  },

  // ---------------- รายงานปัญหา ----------------
  async renderIssues(container) {
    this.stopLiveRefresh();
    const today = Utils.todayISO();
    this.issueFilters = { dateFrom: today, dateTo: today, status: '', severity: '' };
    const user = Auth.getCurrentUser();

    container.innerHTML = `
      <div class="hci-page-header">
        <div><h1>รายงานปัญหา</h1><p class="hci-subtitle">ข้อมูลแบบวันต่อวัน • พนักงานแม่บ้านสามารถดูรายละเอียดได้ทั้งหมด</p></div>
        <div class="hci-header-actions"><span class="hci-badge hci-badge-navy" id="issuesUpdatedAt">กำลังโหลดข้อมูล...</span></div>
      </div>
      <div class="hci-card hci-dashboard-filter-card">
        <div class="hci-quick-filters" id="issuesQuickFilters">
          <button type="button" class="hci-quick-filter active" data-range="today">วันนี้</button>
          <button type="button" class="hci-quick-filter" data-range="yesterday">เมื่อวาน</button>
          <button type="button" class="hci-quick-filter" data-range="custom">กำหนดเอง</button>
        </div>
        <form id="issuesFilterForm" class="hci-filter-bar">
          <div class="hci-filter-group"><label>วันที่เริ่มต้น</label><input type="date" name="dateFrom" value="${today}"></div>
          <div class="hci-filter-group"><label>วันที่สิ้นสุด</label><input type="date" name="dateTo" value="${today}"></div>
          <div class="hci-filter-group"><label>สถานะ</label><select name="status"><option value="">ทั้งหมด</option>${APP_CONFIG.ISSUE_STATUS_OPTIONS.map(x => `<option value="${Utils.escapeHtml(x)}">${Utils.escapeHtml(x)}</option>`).join('')}</select></div>
          <div class="hci-filter-group"><label>ระดับความรุนแรง</label><select name="severity"><option value="">ทั้งหมด</option>${APP_CONFIG.SEVERITY_OPTIONS.map(x => `<option value="${Utils.escapeHtml(x)}">${Utils.escapeHtml(x)}</option>`).join('')}</select></div>
          <button type="submit" class="hci-btn hci-btn-navy"><i class="fa-solid fa-filter"></i> กรองข้อมูล</button>
          <button type="button" class="hci-btn hci-btn-outline" id="issuesRefreshBtn"><i class="fa-solid fa-rotate"></i> อัปเดตข้อมูล</button>
        </form>
      </div>
      <div class="hci-card">
        <div class="hci-table-scroll">
          <table class="hci-table hci-issue-table">
            <thead><tr>
              <th>ห้อง / VIP</th><th>รายละเอียดปัญหา</th><th>หมวด / โซน</th><th>วันที่</th><th>เวลา</th>
              <th>พนักงานแม่บ้าน / ผู้รายงาน</th><th>ผู้ตรวจสอบ</th><th>ระดับ</th><th>สถานะ</th><th>ผู้รับผิดชอบ</th>
              <th>ผู้แก้ไขสถานะล่าสุด</th><th>อัปเดตล่าสุด</th><th>หมายเหตุ</th><th></th>
            </tr></thead>
            <tbody id="issuesTableBody">${emptyRow(14)}</tbody>
          </table>
        </div>
      </div>`;

    const form = document.getElementById('issuesFilterForm');
    form.addEventListener('submit', async e => {
      e.preventDefault();
      this.issueFilters = Object.fromEntries(new FormData(form).entries());
      await this.refreshIssuesData();
    });
    document.getElementById('issuesRefreshBtn').addEventListener('click', () => this.refreshIssuesData());
    document.querySelectorAll('#issuesQuickFilters .hci-quick-filter').forEach(btn => {
      btn.addEventListener('click', async () => {
        document.querySelectorAll('#issuesQuickFilters .hci-quick-filter').forEach(x => x.classList.toggle('active', x === btn));
        if (btn.dataset.range === 'custom') { form.elements.dateFrom.focus(); return; }
        const range = inspectionQuickDateRange(btn.dataset.range);
        form.elements.dateFrom.value = range.dateFrom;
        form.elements.dateTo.value = range.dateTo;
        this.issueFilters = Object.assign({}, this.issueFilters || {}, range);
        await this.refreshIssuesData();
      });
    });
    ['dateFrom','dateTo'].forEach(name => form.elements[name].addEventListener('change', () => {
      document.querySelectorAll('#issuesQuickFilters .hci-quick-filter').forEach(x => x.classList.toggle('active', x.dataset.range === 'custom'));
    }));

    await this.refreshIssuesData();
    this.startLiveRefresh(() => this.refreshIssuesData(true));
  },

  async refreshIssuesData(silent = false) {
    const tbody = document.getElementById('issuesTableBody');
    if (!tbody) return;
    try {
      if (!silent) Utils.showLoading('กำลังโหลดรายงานปัญหา...');
      const filters = this.issueFilters || { dateFrom: Utils.todayISO(), dateTo: Utils.todayISO(), status: '', severity: '' };
      const issues = await Api.call('getIssues', filters, { silent });
      const user = Auth.getCurrentUser();
      tbody.innerHTML = issues.items.map(d => {
        const canEdit = user && (user.Role === 'ADMIN' || user.Role === 'INSPECTOR' || (user.Role === 'HOUSEKEEPER' && String(d.HousekeeperID || '') === String(user.UserID || '')));
        return `
        <tr>
          <td>${Utils.escapeHtml(issueRoomLabel(d))}</td>
          <td>${Utils.escapeHtml(d.ItemName || '-')}</td>
          <td>${Utils.escapeHtml(APP_CONFIG.CATEGORY_LABELS[d.Category] || d.Category || '-')}</td>
          <td>${Utils.escapeHtml(inspectionDisplayDate(d.ReportDate))}</td>
          <td>${Utils.escapeHtml(d.ReportTime || '-')}</td>
          <td>${Utils.escapeHtml(d.HousekeeperName || d.ReporterName || '-')}</td>
          <td>${Utils.escapeHtml(d.InspectorName || '-')}</td>
          <td><span class="hci-badge hci-badge-${d.Severity === 'เร่งด่วน' ? 'red' : 'amber'}">${Utils.escapeHtml(d.Severity || '-')}</span></td>
          <td>${issueStatusBadge(d.IssueStatus)}</td>
          <td>${Utils.escapeHtml(d.AssignedTo || '-')}</td>
          <td>${Utils.escapeHtml(d.LastStatusUpdatedBy || '-')}</td>
          <td>${Utils.escapeHtml(issueUpdatedDateTime(d))}</td>
          <td>${Utils.escapeHtml(d.LastStatusNote || d.AdminNote || d.Note || '-')}</td>
          <td class="hci-nowrap">
            <button class="hci-btn-icon" title="ดูรายละเอียด" onclick="InspectionView.openIssueDetail('${Utils.escapeHtml(d.DetailID)}')"><i class="fa-solid fa-eye"></i></button>
            ${canEdit ? `<button class="hci-btn-icon" title="แก้ไขสถานะ" onclick="InspectionView.openIssueDialog('${Utils.escapeHtml(d.DetailID)}','${Utils.escapeHtml(d.IssueStatus || '')}')"><i class="fa-solid fa-pen"></i></button>` : ''}
          </td>
        </tr>`;
      }).join('') || emptyRow(14);
      const badge = document.getElementById('issuesUpdatedAt');
      if (badge) badge.textContent = `ข้อมูลล่าสุด ${inspectionClockText()} • ${issues.total || 0} รายการ • อัปเดตอัตโนมัติ`;
    } catch (e) {
      if (!silent) Utils.toast('error', e.message || 'โหลดรายงานปัญหาไม่สำเร็จ');
    } finally {
      if (!silent) Utils.hideLoading();
    }
  },

  async openIssueDetail(detailId) {
    Utils.showLoading('กำลังโหลดรายละเอียดปัญหา...');
    try {
      const data = await Api.call('getIssueDetails', { detailId }, { silent: true });
      const issue = data.issue || {};
      const ins = data.inspection || {};
      const context = data.context || {};
      const history = data.history || [];
      await Swal.fire({
        title: `รายละเอียดปัญหา • ${Utils.escapeHtml(issueRoomLabel(Object.assign({}, context, ins)))}`,
        html: `
          <div class="hci-issue-detail-grid">
            ${issueDetailField('รายละเอียดปัญหา', issue.ItemName || '-')}
            ${issueDetailField('หมวด / โซน', APP_CONFIG.CATEGORY_LABELS[issue.Category] || issue.Category || '-')}
            ${issueDetailField('วันที่รายงาน', inspectionDisplayDate(context.ReportDate || ins.InspectionDate))}
            ${issueDetailField('เวลารายงาน', context.ReportTime || '-')}
            ${issueDetailField('พนักงานแม่บ้าน / ผู้รายงาน', context.HousekeeperName || context.ReporterName || ins.HousekeeperName || '-')}
            ${issueDetailField('ผู้ตรวจสอบ', context.InspectorName || ins.InspectorName || '-')}
            ${issueDetailField('ระดับความรุนแรง', issue.Severity || '-')}
            ${issueDetailField('สถานะ', issue.IssueStatus || '-')}
            ${issueDetailField('ผู้รับผิดชอบ', issue.AssignedTo || '-')}
            ${issueDetailField('ผู้แก้ไขสถานะล่าสุด', context.LastStatusUpdatedBy || issue.LastStatusUpdatedBy || '-')}
            ${issueDetailField('วันที่/เวลาแก้ไขล่าสุด', issueContextUpdatedText(context, issue))}
            ${issueDetailField('หมายเหตุ', context.LastStatusNote || issue.LastStatusNote || issue.AdminNote || issue.Note || '-')}
          </div>
          <h3 class="hci-modal-section-title">ประวัติการเปลี่ยนสถานะ</h3>
          ${renderIssueTimeline(history)}
        `,
        width: 960,
        confirmButtonText: 'ปิด',
        confirmButtonColor: '#0B1F3A'
      });
    } catch (e) {
      Utils.toast('error', e.message || 'โหลดรายละเอียดปัญหาไม่สำเร็จ');
    } finally {
      Utils.hideLoading();
    }
  },

  async openIssueDialog(detailId, currentStatus) {
    const user = Auth.getCurrentUser();
    if (!user || ['ADMIN','INSPECTOR','HOUSEKEEPER'].indexOf(user.Role) === -1) {
      Utils.toast('warning', 'คุณไม่มีสิทธิ์แก้ไขสถานะ');
      return;
    }
    const { value: formValues } = await Swal.fire({
      title: 'อัปเดตสถานะรายการปัญหา',
      html: `
        <select id="swalIssueStatus" class="swal2-select">
          ${APP_CONFIG.ISSUE_STATUS_OPTIONS.map(s => `<option value="${Utils.escapeHtml(s)}" ${s === currentStatus ? 'selected' : ''}>${Utils.escapeHtml(s)}</option>`).join('')}
        </select>
        <textarea id="swalIssueNote" class="swal2-textarea" placeholder="หมายเหตุการเปลี่ยนสถานะ (ถ้ามี)"></textarea>
        <input type="file" id="swalIssuePhoto" accept="image/*" class="swal2-file">
      `,
      focusConfirm: false, confirmButtonText: 'บันทึก', confirmButtonColor: '#0B1F3A', showCancelButton: true, cancelButtonText: 'ยกเลิก',
      preConfirm: async () => {
        const status = document.getElementById('swalIssueStatus').value;
        const note = document.getElementById('swalIssueNote').value;
        const fileInput = document.getElementById('swalIssuePhoto');
        let afterImageUrl = '';
        if (fileInput.files[0]) {
          const compressed = await Utils.compressImage(fileInput.files[0]);
          const uploadRes = await Api.call('uploadImage', { base64Data: compressed.base64, mimeType: compressed.mimeType, phase: 'after', sequence: 1 });
          afterImageUrl = uploadRes.url;
        }
        return { status, note, afterImageUrl };
      }
    });
    if (!formValues) return;
    Utils.showLoading('กำลังบันทึกสถานะ...');
    try {
      await Api.call('updateIssueStatus', { detailId, issueStatus: formValues.status, note: formValues.note, afterImageUrl: formValues.afterImageUrl });
      Utils.toast('success', 'อัปเดตสถานะสำเร็จ');
      await this.refreshIssuesData(true);
    } finally {
      Utils.hideLoading();
    }
  }
};

// ==================== ฟังก์ชันช่วยเหลือเฉพาะหน้าตรวจสอบ ====================

/**
 * รองรับ Category จาก Google Sheet ได้ทั้ง:
 * BEDROOM
 * BEDROOM | โซนห้องนอน
 * BATHROOM | โซนห้องน้ำ
 * AMENITIES | โซนบริเวณโรงแรม
 * SAFETY | ภาพรวมความปลอดภัย
 *
 * ระบบหน้าเว็บจะ normalize กลับเป็น key เดิมเสมอ
 */
function normalizeInspectionCategoryKey(value) {
  const text = String(value || '').trim();
  if (!text) return '';

  const upper = text.toUpperCase();

  if (upper.startsWith('BEDROOM') || text === 'โซนห้องนอน') return 'BEDROOM';
  if (upper.startsWith('BATHROOM') || text === 'โซนห้องน้ำ') return 'BATHROOM';
  if (
    upper.startsWith('AMENITIES') ||
    text === 'โซนบริเวณโรงแรม' ||
    text === 'สิ่งอำนวยความสะดวก'
  ) return 'AMENITIES';
  if (upper.startsWith('SAFETY') || text === 'ภาพรวมความปลอดภัย') return 'SAFETY';
  if (
    upper.startsWith('OVERALL') ||
    text === 'ภาพรวมและความพร้อมใช้งาน' ||
    text === 'ภาพรวม'
  ) return 'OVERALL';

  return '';
}

/**
 * แปลง checklist.items จาก API ให้ใช้ key มาตรฐาน
 * ป้องกันหน้าเว็บขึ้น 0/0 เมื่อ Category ใน Sheet มีชื่อไทยต่อท้าย
 */
function normalizeChecklistItemsForForm(sourceItems) {
  const normalized = {
    BEDROOM: [],
    BATHROOM: [],
    AMENITIES: [],
    SAFETY: [],
    OVERALL: []
  };

  const src = sourceItems && typeof sourceItems === 'object'
    ? sourceItems
    : {};

  Object.keys(src).forEach(rawKey => {
    const key = normalizeInspectionCategoryKey(rawKey);
    if (!key) return;

    const list = Array.isArray(src[rawKey]) ? src[rawKey] : [];
    list.forEach(item => {
      const itemKey = normalizeInspectionCategoryKey(item && item.Category) || key;
      if (!normalized[itemKey]) normalized[itemKey] = [];

      normalized[itemKey].push({
        ...item,
        Category: itemKey
      });
    });
  });

  return normalized;
}


const INSPECTION_CATEGORIES = ['BEDROOM', 'BATHROOM', 'AMENITIES', 'SAFETY'];

const INSPECTION_CATEGORY_ICONS = {
  BEDROOM: 'fa-bed',
  BATHROOM: 'fa-bath',
  AMENITIES: 'fa-hotel',
  SAFETY: 'fa-shield-halved'
};

function renderCategoryBlock(cat, items, draft) {
  return `
    <section class="hci-zone-accordion" data-zone="${cat}">
      <button type="button" class="hci-zone-toggle" aria-expanded="false">
        <span class="hci-zone-title">
          <span class="hci-zone-icon"><i class="fa-solid ${INSPECTION_CATEGORY_ICONS[cat] || 'fa-clipboard-check'}"></i></span>
          <span>${APP_CONFIG.CATEGORY_LABELS[cat] || cat}</span>
        </span>
        <span class="hci-zone-meta">
          <span class="hci-zone-progress"><b class="hci-zone-answered">0</b>/${items.length} รายการ</span>
          <i class="fa-solid fa-chevron-down hci-zone-chevron"></i>
        </span>
      </button>
      <div class="hci-zone-content" hidden>
        ${items.map(item => `
          <div class="hci-checklist-item" data-item-id="${item.ItemID}" data-category="${cat}" data-item-name="${Utils.escapeHtml(item.ItemName)}">
            <p class="hci-item-name">${Utils.escapeHtml(item.ItemName)}</p>
            <div class="hci-item-controls">
              <select class="hci-result-select">
                <option value="">-- เลือกผล --</option>
                ${APP_CONFIG.RESULT_OPTIONS.map(r => `<option value="${r}">${r}</option>`).join('')}
              </select>
              <select class="hci-severity-select" style="display:none">
                <option value="">ระดับความรุนแรง</option>
                ${APP_CONFIG.SEVERITY_OPTIONS.map(s => `<option value="${s}">${s}</option>`).join('')}
              </select>
            </div>
            <div class="hci-item-extra" style="display:none">
              <textarea class="hci-note-input" placeholder="หมายเหตุ (จำเป็นสำหรับรายการที่ไม่ผ่าน)" rows="1"></textarea>
              <input type="file" class="hci-photo-input" accept="image/*">
              <div class="hci-photo-preview"></div>
            </div>
          </div>
        `).join('')}
      </div>
    </section>
  `;
}

function bindItemHandlers(catContainer) {
  catContainer.querySelectorAll('.hci-zone-toggle').forEach(toggle => {
    toggle.addEventListener('click', () => toggleInspectionZone(toggle));
  });

  catContainer.querySelectorAll('.hci-checklist-item').forEach(itemEl => {
    const resultSelect = itemEl.querySelector('.hci-result-select');
    const severitySelect = itemEl.querySelector('.hci-severity-select');
    const extra = itemEl.querySelector('.hci-item-extra');
    const photoInput = itemEl.querySelector('.hci-photo-input');
    const preview = itemEl.querySelector('.hci-photo-preview');

    resultSelect.addEventListener('change', () => {
      const needsExtra = resultSelect.value === 'ไม่ผ่าน';
      extra.style.display = needsExtra ? 'flex' : 'none';
      severitySelect.style.display = needsExtra ? 'inline-block' : 'none';
      itemEl.classList.toggle('hci-item-fail', needsExtra);
      updateZoneProgress(itemEl.closest('.hci-zone-accordion'));
    });

    photoInput.addEventListener('change', async () => {
      if (!photoInput.files[0]) return;
      const compressed = await Utils.compressImage(photoInput.files[0]);
      preview.innerHTML = `<img src="${compressed.previewUrl}"><button type="button" class="hci-remove-photo">&times;</button>`;
      itemEl.dataset.imageBase64 = compressed.base64;
      itemEl.dataset.imageMime = compressed.mimeType;
      preview.querySelector('.hci-remove-photo').addEventListener('click', () => {
        preview.innerHTML = ''; photoInput.value = '';
        delete itemEl.dataset.imageBase64; delete itemEl.dataset.uploadedUrl;
      });
    });
  });
}

function toggleInspectionZone(toggle, forceOpen) {
  const zone = toggle.closest('.hci-zone-accordion');
  const content = zone.querySelector('.hci-zone-content');
  const shouldOpen = forceOpen === true || (forceOpen !== false && content.hidden);

  // เปิดครั้งละหนึ่งโซน เพื่อให้หน้าแบบฟอร์มอ่านง่ายบนโทรศัพท์
  if (shouldOpen) {
    document.querySelectorAll('.hci-zone-accordion.is-open').forEach(other => {
      if (other === zone) return;
      other.classList.remove('is-open');
      other.querySelector('.hci-zone-toggle').setAttribute('aria-expanded', 'false');
      other.querySelector('.hci-zone-content').hidden = true;
    });
  }
  zone.classList.toggle('is-open', shouldOpen);
  toggle.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
  content.hidden = !shouldOpen;
}

function updateZoneProgress(zone) {
  if (!zone) return;
  const selects = Array.from(zone.querySelectorAll('.hci-result-select'));
  const answered = selects.filter(select => Boolean(select.value)).length;
  const counter = zone.querySelector('.hci-zone-answered');
  if (counter) counter.textContent = answered;
  zone.classList.toggle('is-complete', selects.length > 0 && answered === selects.length);
}

function openFirstIncompleteZone(catContainer) {
  const item = Array.from(catContainer.querySelectorAll('.hci-checklist-item'))
    .find(el => el.dataset.category === 'SAFETY' && !el.querySelector('.hci-result-select').value);
  if (!item) return;
  const zone = item.closest('.hci-zone-accordion');
  const toggle = zone.querySelector('.hci-zone-toggle');
  toggleInspectionZone(toggle, true);
  item.scrollIntoView({ behavior: 'smooth', block: 'center' });
  setTimeout(() => item.querySelector('.hci-result-select').focus(), 350);
}

function restoreDraftValues() { /* placeholder เผื่อขยายในอนาคต (การกู้คืนค่า checklist แบบเต็มรูปแบบ) */ }
function restoreFormFields(form, draft) {
  if (draft.round) form.round.value = draft.round;
  if (draft.preStatus) form.preStatus.value = draft.preStatus;
  if (draft.housekeeperName && form.housekeeperName) form.housekeeperName.value = draft.housekeeperName;
  if (draft.generalNote) form.generalNote.value = draft.generalNote;
}

function collectFormData(form, catContainer) {
  const fd = new FormData(form);
  const housekeeperName = String(fd.get('housekeeperName') || '').trim();
  const housekeeperList = form.querySelector('#housekeeperNameList');
  const matchedHousekeeper = housekeeperList
    ? Array.from(housekeeperList.options).find(option =>
        String(option.value || '').trim().toLocaleLowerCase() === housekeeperName.toLocaleLowerCase()
      )
    : null;
  // เก็บ UserID เดิมไว้แบบเงียบ ๆ เมื่อชื่อที่พิมพ์ตรงกับพนักงานในระบบ
  // เพื่อไม่กระทบ Dashboard / ตัวกรอง / รายการงานของแม่บ้านเดิม
  const housekeeperId = matchedHousekeeper ? (matchedHousekeeper.dataset.userId || '') : '';
  const details = [];
  catContainer.querySelectorAll('.hci-checklist-item').forEach(itemEl => {
    const selectedResult = itemEl.querySelector('.hci-result-select').value;
    const result = selectedResult || 'ยังไม่ได้ประเมิน';
    details.push({
      itemId: itemEl.dataset.itemId,
      category: itemEl.dataset.category,
      itemName: itemEl.dataset.itemName,
      result,
      severity: itemEl.querySelector('.hci-severity-select').value,
      note: itemEl.querySelector('.hci-note-input').value,
      beforeImageUrl: itemEl.dataset.uploadedUrl || '',
      _pendingBase64: itemEl.dataset.imageBase64 || '',
      _pendingMime: itemEl.dataset.imageMime || '',
      _itemEl: itemEl
    });
  });
  return {
    round: fd.get('round'), preStatus: fd.get('preStatus'),
    housekeeperId, housekeeperName,
    generalNote: fd.get('generalNote'), startTime: Utilities_currentTime(), details
  };
}

function Utilities_currentTime() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

async function uploadPendingPhotos(details, roomNumber, inspectorName) {
  let seq = 1;
  for (const d of details) {
    if (d._pendingBase64 && !d.beforeImageUrl) {
      const res = await Api.call('uploadImage', {
        base64Data: d._pendingBase64, mimeType: d._pendingMime, roomNumber, inspectorName, sequence: seq++, phase: 'inspection'
      });
      d.beforeImageUrl = res.url;
    }
    delete d._pendingBase64; delete d._pendingMime; delete d._itemEl;
  }
  return details;
}

function calcPreviewScore(details) {
  const scoreMap = { 'ผ่าน': 5, 'ไม่ผ่าน': 1 };
  const catTotals = { BEDROOM: [], BATHROOM: [], AMENITIES: [], SAFETY: [] };
  let urgent = false;
  details.forEach(d => {
    const s = scoreMap[d.result];
    if (s !== null && s !== undefined && catTotals[d.category]) catTotals[d.category].push(s);
    if (d.severity === 'เร่งด่วน' && d.result === 'ไม่ผ่าน') urgent = true;
  });
  const categoryScores = {}; const all = [];
  Object.keys(catTotals).forEach(cat => {
    const arr = catTotals[cat];
    if (!arr.length) { categoryScores[cat] = null; return; }
    const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
    const pct = Math.round((avg / 5) * 10000) / 100;
    categoryScores[cat] = pct; all.push(pct);
  });
  const finalScore = all.length ? Math.round((all.reduce((a, b) => a + b, 0) / all.length) * 100) / 100 : 0;
  let finalStatus;
  if (urgent) finalStatus = 'ไม่ผ่านมาตรฐาน';
  else if (finalScore >= 90) finalStatus = 'ดีเยี่ยม';
  else if (finalScore >= 80) finalStatus = 'ผ่านมาตรฐาน';
  else if (finalScore >= 70) finalStatus = 'ควรปรับปรุง';
  else finalStatus = 'ไม่ผ่านมาตรฐาน';
  return { categoryScores, finalScore, finalStatus };
}

function renderFailedList(details) {
  const failed = details.filter(d => d.result === 'ไม่ผ่าน');
  if (!failed.length) return emptyState('ไม่พบรายการที่ไม่ผ่าน');
  return `<ul class="hci-fail-list">${failed.map(d => `<li><span class="hci-badge hci-badge-${d.severity === 'เร่งด่วน' ? 'red' : 'amber'}">${d.severity || '-'}</span> ${Utils.escapeHtml(d.itemName)} — ${Utils.escapeHtml(d.note)}</li>`).join('')}</ul>`;
}

function inspectionHistoryDateTime(item, showRange = false) {
  const rawDate = String((item && item.InspectionDate) || '').trim();
  let dateText = rawDate || '-';
  const dateMatch = rawDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (dateMatch) dateText = `${dateMatch[3]}/${dateMatch[2]}/${dateMatch[1]}`;

  const start = String((item && item.StartTime) || '').trim();
  const end = String((item && item.EndTime) || '').trim();

  let timeText = '';
  if (showRange && start && end) timeText = `${start} – ${end}`;
  else timeText = end || start;

  // CreatedAt เป็น fallback สำหรับข้อมูลเก่าที่อาจยังไม่มี StartTime/EndTime
  if (!timeText && item && item.CreatedAt) {
    const created = String(item.CreatedAt).trim();
    const createdTime = created.match(/(\d{1,2}:\d{2})/);
    if (createdTime) timeText = createdTime[1];
  }

  return Utils.escapeHtml(`${dateText}${timeText ? ' ' + timeText : ''}`);
}

function inspectionDateToISO(date) {
  const d = date instanceof Date ? date : new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function inspectionQuickDateRange(type) {
  const now = new Date();
  if (type === 'yesterday') {
    const y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    const key = inspectionDateToISO(y);
    return { dateFrom: key, dateTo: key };
  }
  const today = inspectionDateToISO(now);
  return { dateFrom: today, dateTo: today };
}

function inspectionDisplayDate(value) {
  const text = String(value || '').trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : (text || '-');
}

function inspectionClockText() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
}

function issueRoomLabel(item) {
  const number = item.RoomNumber || item.RoomName || '-';
  return item.RoomType === 'VIP' || String(number).toUpperCase().includes('VIP') ? String(item.RoomName || number) : `ห้อง ${number}`;
}

function issueStatusBadge(status) {
  const text = String(status || '-');
  let color = 'orange';
  if (/แก้ไขแล้ว|ปิดงาน/.test(text)) color = 'green';
  else if (/เร่งด่วน|ไม่ผ่าน/.test(text)) color = 'red';
  else if (/พบปัญหา|ต้องแก้ไข|รอ|กำลัง|รับเรื่อง/.test(text)) color = 'orange';
  return `<span class="hci-badge hci-badge-${color}">${Utils.escapeHtml(text)}</span>`;
}

function issueUpdatedDateTime(item) {
  const date = item.LastStatusUpdatedDate || '';
  const time = item.LastStatusUpdatedTime || '';
  if (date) return `${inspectionDisplayDate(date)}${time ? ' ' + time : ''}`;
  const raw = String(item.LastStatusUpdatedAt || item.UpdatedAt || '').trim();
  if (!raw) return '-';
  const dateMatch = raw.match(/(\d{4})-(\d{2})-(\d{2})/);
  const timeMatch = raw.match(/(\d{1,2}:\d{2})/);
  return `${dateMatch ? `${dateMatch[3]}/${dateMatch[2]}/${dateMatch[1]}` : raw}${timeMatch ? ' ' + timeMatch[1] : ''}`;
}

function issueContextUpdatedText(context, issue) {
  const date = context.LastStatusUpdatedDate || '';
  const time = context.LastStatusUpdatedTime || '';
  if (date) return `${inspectionDisplayDate(date)}${time ? ' ' + time : ''}`;
  return issueUpdatedDateTime(issue || {});
}

function issueDetailField(label, value) {
  return `<div class="hci-detail-field"><span>${Utils.escapeHtml(label)}</span><strong>${Utils.escapeHtml(value === null || value === undefined || value === '' ? '-' : value)}</strong></div>`;
}

function renderIssueTimeline(history) {
  if (!history || !history.length) return emptyState('ยังไม่มีประวัติการเปลี่ยนสถานะ');
  return `<div class="hci-status-timeline">${history.map(item => `
    <div class="hci-status-timeline-item">
      <div class="hci-status-timeline-dot"></div>
      <div class="hci-status-timeline-body">
        <div class="hci-status-timeline-head"><strong>${Utils.escapeHtml(item.NewStatus || '-')}</strong><span>${Utils.escapeHtml(item.DateTime || '-')}</span></div>
        <p><b>ผู้ดำเนินการ:</b> ${Utils.escapeHtml(item.Actor || '-')}</p>
        <p><b>สถานะเดิม:</b> ${Utils.escapeHtml(item.OldStatus || '-')} → <b>สถานะใหม่:</b> ${Utils.escapeHtml(item.NewStatus || '-')}</p>
        ${item.Note ? `<p><b>หมายเหตุ:</b> ${Utils.escapeHtml(item.Note)}</p>` : ''}
      </div>
    </div>`).join('')}</div>`;
}

function approvalLabel(status) {
  const map = { PENDING: '<span class="hci-badge hci-badge-amber">รออนุมัติ</span>', APPROVED: '<span class="hci-badge hci-badge-green">อนุมัติแล้ว</span>', REJECTED: '<span class="hci-badge hci-badge-red">ส่งกลับแก้ไข</span>' };
  return map[status] || status;
}

function resultColor(result) {
  const map = { 'ผ่าน': 'green', 'ไม่ผ่าน': 'red', 'ต้องแก้ไข': 'orange', 'ไม่เกี่ยวข้อง': 'gray', 'ไม่สามารถตรวจสอบได้': 'gray' };
  return map[result] || 'gray';
}
