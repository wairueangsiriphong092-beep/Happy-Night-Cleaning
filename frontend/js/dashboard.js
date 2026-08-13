/**
 * dashboard.js
 * หน้าหลักหลังเข้าสู่ระบบ และหน้า Admin Dashboard (KPI, กราฟ, ตัวกรอง)
 * ข้อมูลทั้งหมดดึงจาก Google Sheets ผ่าน API จริง ไม่มีข้อมูล Mock
 */

const DashboardView = {
  charts: {},

  async renderHome(container) {
    const user = Auth.getCurrentUser();
    Utils.showLoading('กำลังโหลดข้อมูลหน้าหลัก...');
    try {
      // โหลดข้อมูลหน้า Home เพียงคำขอเดียว ป้องกัน GAS ทำงานหนัก 3-4 คำขอพร้อมกัน
      const homeData = await Api.call('getHomeData', {}, {
        timeoutMs: APP_CONFIG.HOME_REQUEST_TIMEOUT_MS || 120000
      });
      const dash = normalizeDashboardData(homeData.dashboard);
      const rooms = homeData.rooms || { items: [] };
      const notif = homeData.notifications || { notifications: [], totalCount: 0 };
      if (typeof AppShell !== 'undefined' && AppShell.applyNotifBadge) {
        AppShell.applyNotifBadge(notif);
      }

      container.innerHTML = `
        <div class="hci-page-header">
          <div>
            <h1>สวัสดี, ${Utils.escapeHtml(user.FullName)}</h1>
            <p class="hci-subtitle">${APP_CONFIG.ROLE_LABELS[user.Role]} • ${Utils.formatDateTh(new Date())}</p>
          </div>
          <div class="hci-header-actions">
            <button class="hci-btn hci-btn-gold" onclick="location.hash='#/rooms'"><i class="fa-solid fa-clipboard-check"></i> เริ่มตรวจสอบห้อง</button>
          </div>
        </div>

        <div class="hci-kpi-grid">
          ${kpiCard('จำนวนห้องทั้งหมด', dash.kpi.totalRooms, 'fa-hotel', 'navy')}
          ${kpiCard('ตรวจสอบแล้ววันนี้', dash.kpi.inspectedToday, 'fa-clipboard-check', 'teal')}
          ${kpiCard('ยังไม่ได้ตรวจ', dash.kpi.notInspectedToday, 'fa-hourglass-half', 'amber')}
          ${kpiCard('ผ่านมาตรฐาน', dash.kpi.passCount, 'fa-circle-check', 'green')}
          ${kpiCard('ไม่ผ่านมาตรฐาน', dash.kpi.failCount, 'fa-circle-xmark', 'red')}
          ${kpiCard('ปัญหารอแก้ไข', dash.kpi.pendingIssues, 'fa-screwdriver-wrench', 'orange')}
        </div>

        ${notif.notifications.length ? `
        <div class="hci-card hci-notif-card">
          <h3><i class="fa-solid fa-bell"></i> รายการแจ้งเตือน</h3>
          <ul class="hci-notif-list">
            ${notif.notifications.map(n => `<li><span class="hci-badge hci-badge-${n.type === 'URGENT' ? 'red' : 'gold'}">${n.count}</span> ${Utils.escapeHtml(n.message)}</li>`).join('')}
          </ul>
        </div>` : ''}

        <div class="hci-card">
          <div class="hci-card-head">
            <h3>สถานะห้องพักและบ้านพัก</h3>
            <span class="hci-muted">${rooms.items.length} ห้อง/หลัง</span>
          </div>
          <div class="hci-room-grid" id="homeRoomGrid"></div>
        </div>
      `;
      renderRoomGrid(document.getElementById('homeRoomGrid'), rooms.items, user);
    } catch (e) {
      const apiDetail = e && e.action ? `${e.message} (API: ${e.action})` : e.message;
      renderErrorState(container, 'ไม่สามารถโหลดข้อมูลหน้าหลักได้', () => DashboardView.renderHome(container), apiDetail);
    } finally {
      Utils.hideLoading();
    }
  },

  async renderAdminDashboard(container) {
    const today = Utils.todayISO();
    this.adminContainer = container;
    this.adminFilters = { dateFrom: today, dateTo: today };
    this.adminData = null;
    container.innerHTML = `
      <div class="hci-page-header">
        <div><h1>Admin Dashboard</h1><p class="hci-subtitle">Daily Operational Dashboard + Historical Analytics • เวลาไทย (ICT)</p></div>
        <div class="hci-header-actions"><span class="hci-badge hci-badge-gold">เวอร์ชัน ${Utils.escapeHtml(APP_CONFIG.BUILD_VERSION || '-')}</span><span class="hci-badge hci-badge-navy" id="dashUpdatedAt">กำลังโหลดข้อมูล...</span></div>
      </div>
      <div class="hci-card hci-dashboard-filter-card">
        <div class="hci-quick-filters" role="group" aria-label="ตัวกรองวันที่ด่วน">
          ${[['today','วันนี้'],['yesterday','เมื่อวาน'],['7days','7 วันล่าสุด'],['month','เดือนนี้'],['custom','กำหนดเอง']].map(q => `<button type="button" class="hci-quick-filter ${q[0] === 'today' ? 'active' : ''}" data-range="${q[0]}">${q[1]}</button>`).join('')}
        </div>
        <form id="dashFilterForm" class="hci-filter-bar">
          <div class="hci-filter-group"><label for="dashDateFrom">วันที่เริ่มต้น</label><input id="dashDateFrom" type="date" name="dateFrom" value="${today}"></div>
          <div class="hci-filter-group"><label for="dashDateTo">วันที่สิ้นสุด</label><input id="dashDateTo" type="date" name="dateTo" value="${today}"></div>
          <div class="hci-filter-group"><label for="dashHousekeeper">พนักงานแม่บ้าน</label><select id="dashHousekeeper" name="housekeeperId"><option value="">ทั้งหมด</option></select></div>
          <div class="hci-filter-group"><label for="dashInspector">ผู้ตรวจสอบ</label><select id="dashInspector" name="inspectorId"><option value="">ทั้งหมด</option></select></div>
          <div class="hci-filter-group"><label for="dashRoom">ห้องพัก / VIP</label><select id="dashRoom" name="roomId"><option value="">ทั้งหมด</option></select></div>
          <div class="hci-filter-group"><label for="dashStatus">สถานะ</label><select id="dashStatus" name="status"><option value="">ทั้งหมด</option></select></div>
          <button type="submit" class="hci-btn hci-btn-navy" id="dashFilterButton"><i class="fa-solid fa-filter"></i> กรองข้อมูล</button>
        </form>
      </div>
      <div id="adminDashboardContent" aria-live="polite">${emptyState('กำลังโหลดข้อมูล Dashboard...')}</div>
      <div id="adminDashboardModalRoot"></div>`;

    this.bindAdminFilters();
    await this.loadAdminDashboard(false);
  },

  bindAdminFilters() {
    const form = document.getElementById('dashFilterForm');
    if (!form) return;
    form.addEventListener('submit', async event => {
      event.preventDefault();
      this.adminFilters = Object.fromEntries(new FormData(form).entries());
      await this.loadAdminDashboard(true);
    });
    document.querySelectorAll('.hci-quick-filter').forEach(button => {
      button.addEventListener('click', async () => {
        const range = dashboardQuickRange(button.dataset.range);
        document.querySelectorAll('.hci-quick-filter').forEach(item => item.classList.toggle('active', item === button));
        if (range) {
          form.elements.dateFrom.value = range.dateFrom;
          form.elements.dateTo.value = range.dateTo;
          this.adminFilters = Object.assign(this.adminFilters || {}, range);
          await this.loadAdminDashboard(true);
        } else {
          form.elements.dateFrom.focus();
        }
      });
    });
    ['dateFrom', 'dateTo'].forEach(name => form.elements[name].addEventListener('change', () => {
      document.querySelectorAll('.hci-quick-filter').forEach(item => item.classList.toggle('active', item.dataset.range === 'custom'));
    }));
  },

  async loadAdminDashboard(showToast, forceRefresh = false) {
    const content = document.getElementById('adminDashboardContent');
    const button = document.getElementById('dashFilterButton');
    if (!content) return;
    if (button) { button.disabled = true; button.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> กำลังโหลด...'; }
    content.classList.add('is-loading');
    try {
      const requestFilters = Object.assign({}, this.adminFilters || {});
      if (forceRefresh) requestFilters.forceRefresh = true;
      const dash = normalizeDashboardData(await Api.call('getAdminDashboard', requestFilters, { timeoutMs: APP_CONFIG.REQUEST_TIMEOUT_MS || 90000 }));
      this.adminData = dash;
      populateDashboardFilters(dash.filterOptions, this.adminFilters);
      renderAdminDashboardContent(content, dash);
      bindAdminDashboardActions(dash);
      renderCharts(dash);
      const updated = document.getElementById('dashUpdatedAt');
      if (updated) updated.textContent = `ข้อมูลล่าสุด ${dashboardDateTime(dash.meta.generatedAt)}`;
      if (showToast) Utils.toast('success', 'อัปเดต Dashboard สำเร็จ');
    } catch (error) {
      renderErrorState(content, 'ไม่สามารถโหลด Dashboard ได้', () => this.loadAdminDashboard(false), error.message);
    } finally {
      content.classList.remove('is-loading');
      if (button) { button.disabled = false; button.innerHTML = '<i class="fa-solid fa-filter"></i> กรองข้อมูล'; }
      Utils.hideLoading();
    }
  }
};

/**
 * ทำให้ Dashboard รองรับชีตที่ยังไม่มีประวัติการตรวจและ Backend เวอร์ชันเก่า
 * โดยไม่เกิด Cannot read properties of undefined ที่ทำให้หน้าทั้งหน้าหายไป
 */
function normalizeDashboardData(data) {
  const dash = data && typeof data === 'object' ? data : {};
  dash.kpi = Object.assign({
    totalRooms: 0, inspectedToday: 0, notInspectedToday: 0,
    passCount: 0, failCount: 0, pendingIssues: 0,
    urgentIssues: 0, avgScoreToday: 0
  }, dash.kpi || {});
  dash.categoryAvg = Object.assign({ BEDROOM: 0, BATHROOM: 0, AMENITIES: 0, SAFETY: 0, OVERALL: 0 }, dash.categoryAvg || {});
  dash.trends = Object.assign({ daily: [], weekly: [], monthly: [] }, dash.trends || {});
  ['daily', 'weekly', 'monthly'].forEach(key => {
    if (!Array.isArray(dash.trends[key])) dash.trends[key] = [];
  });
  if (!Array.isArray(dash.topProblemRooms)) dash.topProblemRooms = [];
  if (!Array.isArray(dash.topFailedItems)) dash.topFailedItems = [];
  if (!Array.isArray(dash.housekeeperPerformance)) dash.housekeeperPerformance = [];
  dash.meta = Object.assign({ dateFrom: Utils.todayISO(), dateTo: Utils.todayISO(), generatedAt: '' }, dash.meta || {});
  dash.progress = Object.assign({ inspected: dash.kpi.inspectedToday, total: dash.kpi.totalRooms, percent: 0 }, dash.progress || {});
  dash.lists = Object.assign({ allRooms: [], inspectedRooms: [], pendingRooms: [], passedRooms: [], failedRooms: [], openIssues: [], urgentIssues: [] }, dash.lists || {});
  Object.keys(dash.lists).forEach(key => { if (!Array.isArray(dash.lists[key])) dash.lists[key] = []; });
  if (!Array.isArray(dash.roomStatuses)) dash.roomStatuses = dash.lists.allRooms;
  dash.filterOptions = Object.assign({ housekeepers: [], inspectors: [], rooms: [], statuses: [] }, dash.filterOptions || {});
  dash.avgResolutionHours = Number(dash.avgResolutionHours) || 0;
  return dash;
}

function dashboardQuickRange(type) {
  // คิดช่วงวันจากวันที่ประเทศไทยเสมอ ไม่ขึ้นกับ Timezone ของเครื่องผู้ใช้
  const todayParts = Utils.todayISO().split('-').map(Number);
  const now = new Date(Date.UTC(todayParts[0], todayParts[1] - 1, todayParts[2]));
  const iso = date => date.toISOString().slice(0, 10);
  if (type === 'custom') return null;
  if (type === 'today') return { dateFrom: iso(now), dateTo: iso(now) };
  if (type === 'yesterday') {
    const yesterday = new Date(now); yesterday.setUTCDate(now.getUTCDate() - 1);
    return { dateFrom: iso(yesterday), dateTo: iso(yesterday) };
  }
  if (type === '7days') {
    const start = new Date(now); start.setUTCDate(now.getUTCDate() - 6);
    return { dateFrom: iso(start), dateTo: iso(now) };
  }
  if (type === 'month') {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    return { dateFrom: iso(start), dateTo: iso(now) };
  }
  return null;
}

function populateDashboardFilters(options, selected) {
  if (!options) return;
  const setOptions = (id, items, valueField, labelFn) => {
    const select = document.getElementById(id);
    if (!select) return;
    const current = selected[select.name] || select.value || '';
    select.innerHTML = '<option value="">ทั้งหมด</option>' + items.map(item => {
      const value = typeof item === 'string' ? item : item[valueField];
      const label = typeof item === 'string' ? item : labelFn(item);
      return `<option value="${Utils.escapeHtml(value)}" ${String(value) === String(current) ? 'selected' : ''}>${Utils.escapeHtml(label)}</option>`;
    }).join('');
  };
  setOptions('dashHousekeeper', options.housekeepers || [], 'UserID', item => item.FullName);
  setOptions('dashInspector', options.inspectors || [], 'UserID', item => item.FullName);
  setOptions('dashRoom', options.rooms || [], 'RoomID', dashboardRoomLabel);
  setOptions('dashStatus', options.statuses || [], '', item => item);
  const form = document.getElementById('dashFilterForm');
  if (form) {
    form.elements.dateFrom.value = selected.dateFrom || Utils.todayISO();
    form.elements.dateTo.value = selected.dateTo || selected.dateFrom || Utils.todayISO();
  }
}

function renderAdminDashboardContent(container, dash) {
  const period = dash.meta.dateFrom === dash.meta.dateTo ? dashboardDate(dash.meta.dateFrom) : `${dashboardDate(dash.meta.dateFrom)} – ${dashboardDate(dash.meta.dateTo)}`;
  container.innerHTML = `
    <div class="hci-dashboard-period"><i class="fa-regular fa-calendar"></i> ช่วงข้อมูล: <strong>${period}</strong></div>
    <div class="hci-kpi-grid hci-admin-kpi-grid">
      ${adminKpiCard('all', 'จำนวนห้องทั้งหมด', dash.kpi.totalRooms, 'fa-hotel', 'navy', 'จำนวนห้อง/หน่วยในขอบเขตที่เลือก')}
      ${adminKpiCard('inspected', 'ตรวจแล้ว', dash.kpi.inspectedToday, 'fa-clipboard-check', 'teal', 'นับห้องไม่ซ้ำ ใช้ผลตรวจล่าสุด')}
      ${adminKpiCard('pending', 'รอตรวจ', dash.kpi.notInspectedToday, 'fa-hourglass-half', 'amber', 'ห้องที่ยังไม่มีผลตรวจในช่วงวันที่เลือก')}
      ${adminKpiCard('passed', 'ผ่าน', dash.kpi.passCount, 'fa-circle-check', 'green', 'ผลล่าสุดผ่านมาตรฐานหรือดีเยี่ยม')}
      ${adminKpiCard('failed', 'ไม่ผ่าน', dash.kpi.failCount, 'fa-circle-xmark', 'red', 'ผลล่าสุดไม่ผ่านมาตรฐาน')}
      ${adminKpiCard('issues', 'รอแก้ไข', dash.kpi.pendingIssues, 'fa-screwdriver-wrench', 'orange', 'รายการปัญหาที่ยังไม่ปิดงาน')}
      ${adminKpiCard('urgent', 'เร่งด่วน', dash.kpi.urgentIssues, 'fa-triangle-exclamation', 'red', 'ปัญหาระดับเร่งด่วน Urgent หรือ Critical')}
      ${adminKpiCard('average', 'คะแนนเฉลี่ย', `${Number(dash.kpi.avgScoreToday || 0).toFixed(2)}%`, 'fa-star', 'gold', 'เฉลี่ยเฉพาะห้องที่ตรวจแล้ว')}
    </div>

    <section class="hci-card hci-progress-card" aria-label="ความคืบหน้าการตรวจ">
      <div class="hci-card-head"><h3>ความคืบหน้าการตรวจ</h3><strong>${dash.progress.inspected} / ${dash.progress.total} ห้อง (${dash.progress.percent}%)</strong></div>
      <div class="hci-progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${dash.progress.percent}">
        <div class="hci-progress-fill" style="width:${Math.min(100, Math.max(0, Number(dash.progress.percent) || 0))}%"></div>
      </div>
    </section>

    <section class="hci-card">
      <div class="hci-card-head"><h3>สถานะห้องในช่วงวันที่เลือก</h3><span class="hci-muted">คลิกห้องเพื่อดูรายละเอียด</span></div>
      <div class="hci-daily-room-grid">
        ${dash.roomStatuses.length ? dash.roomStatuses.map(dashboardRoomStatusCard).join('') : emptyState('ยังไม่มีข้อมูลห้องพัก')}
      </div>
    </section>

    <div class="hci-grid-2">
      <div class="hci-card"><h3>ผลการตรวจรายวันในช่วงที่เลือก</h3><div class="hci-chart-wrap"><canvas id="chartDaily"></canvas></div></div>
      <div class="hci-card"><h3>คะแนนเฉลี่ยแยกตามหมวด</h3><div class="hci-chart-wrap"><canvas id="chartCategory"></canvas></div></div>
    </div>
    <div class="hci-grid-2">
      <div class="hci-card"><h3>แนวโน้มรายสัปดาห์</h3><div class="hci-chart-wrap"><canvas id="chartWeekly"></canvas></div></div>
      <div class="hci-card"><h3>แนวโน้มรายเดือน</h3><div class="hci-chart-wrap"><canvas id="chartMonthly"></canvas></div></div>
    </div>
    <div class="hci-grid-2">
      <div class="hci-card"><h3>ห้องที่มีปัญหาบ่อย</h3>${rankTable(dash.topProblemRooms, 'room', 'count', 'ห้อง', 'จำนวนครั้ง')}</div>
      <div class="hci-card"><h3>รายการที่ไม่ผ่านบ่อย</h3>${rankTable(dash.topFailedItems, 'item', 'count', 'รายการ', 'จำนวนครั้ง')}</div>
    </div>`;
}

function adminKpiCard(type, label, value, icon, color, tooltip) {
  return `<button type="button" class="hci-kpi-card hci-admin-kpi hci-color-${color}" data-kpi="${type}" title="${Utils.escapeHtml(tooltip)}" aria-label="${Utils.escapeHtml(label)} ${Utils.escapeHtml(value)} คลิกเพื่อดูรายละเอียด">
    <span class="hci-kpi-icon"><i class="fa-solid ${icon}"></i></span>
    <span><span class="hci-kpi-value">${Utils.escapeHtml(value)}</span><span class="hci-kpi-label">${Utils.escapeHtml(label)}</span></span>
    <i class="fa-solid fa-chevron-right hci-kpi-open-icon" aria-hidden="true"></i>
  </button>`;
}

function dashboardRoomStatusCard(room) {
  const meta = {
    PASS: ['green', 'fa-circle-check', 'ผ่าน'], FAIL: ['red', 'fa-circle-xmark', 'ไม่ผ่าน'],
    PENDING: ['amber', 'fa-hourglass-half', 'รอตรวจ'], NEEDS_FIX: ['orange', 'fa-screwdriver-wrench', 'รอแก้ไข'],
    URGENT: ['red', 'fa-triangle-exclamation', 'เร่งด่วน']
  }[room.StatusCode] || ['gray', 'fa-circle-question', room.StatusLabel || '-'];
  return `<button type="button" class="hci-daily-room-card hci-color-${meta[0]}" data-inspection-id="${Utils.escapeHtml(room.InspectionID || '')}" data-room-id="${Utils.escapeHtml(room.RoomID || '')}">
    <span class="hci-daily-room-head"><i class="fa-solid ${meta[1]}"></i><strong>${Utils.escapeHtml(dashboardRoomLabel(room))}</strong></span>
    <span class="hci-badge hci-badge-${meta[0]}">${Utils.escapeHtml(meta[2])}</span>
    <span>คะแนน: ${room.FinalScore === null || room.FinalScore === undefined ? '-' : Number(room.FinalScore).toFixed(2) + '%'}</span>
    <span>แม่บ้าน: ${Utils.escapeHtml(room.HousekeeperName || '-')}</span>
    <span>ผู้ตรวจ: ${Utils.escapeHtml(room.InspectorName || '-')}</span>
    <span>เวลาล่าสุด: ${Utils.escapeHtml(room.EndTime || '-')}</span>
  </button>`;
}

function bindAdminDashboardActions(dash) {
  document.querySelectorAll('[data-kpi]').forEach(card => card.addEventListener('click', () => openDashboardKpiModal(card.dataset.kpi, dash)));
  document.querySelectorAll('.hci-daily-room-card').forEach(card => card.addEventListener('click', () => {
    if (card.dataset.inspectionId) openDashboardInspectionDetail(card.dataset.inspectionId);
    else openDashboardPendingRoom(card.dataset.roomId, dash);
  }));
}

function openDashboardKpiModal(type, dash) {
  const config = {
    all: ['ห้องทั้งหมด', dash.lists.allRooms, 'rooms'], inspected: ['รายการห้องที่ตรวจแล้ว', dash.lists.inspectedRooms, 'inspections'],
    pending: ['รายการห้องที่รอตรวจ', dash.lists.pendingRooms, 'pending'], passed: ['รายการผ่านมาตรฐาน', dash.lists.passedRooms, 'inspections'],
    failed: ['รายการไม่ผ่านมาตรฐาน', dash.lists.failedRooms, 'inspections'], issues: ['รายการปัญหารอแก้ไข', dash.lists.openIssues, 'issues'],
    urgent: ['รายการปัญหาเร่งด่วน', dash.lists.urgentIssues, 'issues'], average: ['รายการที่ใช้คำนวณคะแนนเฉลี่ย', dash.lists.inspectedRooms, 'inspections']
  }[type];
  if (!config) return;
  dashboardShowModal(config[0], `<p class="hci-modal-summary">ทั้งหมด: <strong>${config[1].length}</strong> รายการ</p>${dashboardListTable(config[1], config[2])}`, 'wide');
  bindDashboardModalActions(dash);
}

function dashboardListTable(items, mode) {
  if (!items.length) return emptyState('ยังไม่มีข้อมูล');
  if (mode === 'issues') return `<div class="hci-table-scroll"><table class="hci-table"><thead><tr><th>ห้อง</th><th>ปัญหา</th><th>ระดับ</th><th>ผู้รับผิดชอบ</th><th>สถานะ</th><th>เปิดมาแล้ว</th><th>จัดการ</th></tr></thead><tbody>${items.map(item => `<tr class="${dashboardUrgent(item.Severity) ? 'hci-urgent-row' : ''}">
    <td>${Utils.escapeHtml(dashboardRoomLabel(item))}</td><td>${Utils.escapeHtml(item.ItemName || '-')}</td><td>${dashboardBadge(item.Severity || '-')}</td>
    <td>${Utils.escapeHtml(item.AssignedTo || '-')}</td><td>${dashboardBadge(item.IssueStatus || 'รอดำเนินการ')}</td><td>${dashboardAge(item.AgeHours)}</td>
    <td><button class="hci-btn hci-btn-outline hci-btn-sm" data-issue-id="${Utils.escapeHtml(item.DetailID)}">ดู/แก้ไข</button></td></tr>`).join('')}</tbody></table></div>`;
  if (mode === 'pending') return `<div class="hci-table-scroll"><table class="hci-table"><thead><tr><th>ห้อง</th><th>ประเภท</th><th>แม่บ้านรับผิดชอบ</th><th>ตรวจล่าสุด</th><th>ผู้ตรวจล่าสุด</th><th>สถานะ</th></tr></thead><tbody>${items.map(item => `<tr><td>${Utils.escapeHtml(dashboardRoomLabel(item))}</td><td>${Utils.escapeHtml(dashboardRoomType(item.RoomType))}</td><td>${Utils.escapeHtml(item.AssignedHousekeeper || '-')}</td><td>${Utils.escapeHtml(item.LastInspectionDate ? dashboardDate(item.LastInspectionDate) : '-')}</td><td>${Utils.escapeHtml(item.LastInspectorName || '-')}</td><td>${dashboardBadge('รอตรวจ')}</td></tr>`).join('')}</tbody></table></div>`;
  if (mode === 'rooms') return `<div class="hci-table-scroll"><table class="hci-table"><thead><tr><th>ห้อง</th><th>สถานะ</th><th>คะแนน</th><th>แม่บ้าน</th><th>ผู้ตรวจ</th><th>จัดการ</th></tr></thead><tbody>${items.map(item => `<tr><td>${Utils.escapeHtml(dashboardRoomLabel(item))}</td><td>${dashboardBadge(item.StatusLabel || '-')}</td><td>${item.FinalScore === null ? '-' : Number(item.FinalScore || 0).toFixed(2) + '%'}</td><td>${Utils.escapeHtml(item.HousekeeperName || '-')}</td><td>${Utils.escapeHtml(item.InspectorName || '-')}</td><td>${item.InspectionID ? `<button class="hci-btn hci-btn-outline hci-btn-sm" data-inspection-id="${Utils.escapeHtml(item.InspectionID)}">ดูรายละเอียด</button>` : '-'}</td></tr>`).join('')}</tbody></table></div>`;
  return `<div class="hci-table-scroll"><table class="hci-table"><thead><tr><th>ห้อง</th><th>วันที่/เวลา</th><th>คะแนน</th><th>แม่บ้าน</th><th>ผู้ตรวจ</th><th>ผลตรวจ</th><th>สถานะ</th><th>จัดการ</th></tr></thead><tbody>${items.map(item => `<tr>
    <td>${Utils.escapeHtml(dashboardRoomLabel(item))}</td><td>${Utils.escapeHtml(dashboardDate(item.InspectionDate))} ${Utils.escapeHtml(item.EndTime || '')}</td>
    <td>${Number(item.FinalScore || 0).toFixed(2)}%</td><td>${Utils.escapeHtml(item.HousekeeperName || '-')}</td><td>${Utils.escapeHtml(item.InspectorName || '-')}</td>
    <td>${dashboardBadge(item.FinalStatus || '-')}</td><td>${dashboardBadge(item.CurrentStatus || item.FinalStatus || '-')}</td>
    <td><button class="hci-btn hci-btn-outline hci-btn-sm" data-inspection-id="${Utils.escapeHtml(item.InspectionID)}">ดูรายละเอียด</button></td></tr>`).join('')}</tbody></table></div>`;
}

function bindDashboardModalActions(dash) {
  const root = document.getElementById('adminDashboardModalRoot');
  if (!root) return;
  root.querySelectorAll('[data-inspection-id]').forEach(button => button.addEventListener('click', () => openDashboardInspectionDetail(button.dataset.inspectionId)));
  root.querySelectorAll('[data-issue-id]').forEach(button => button.addEventListener('click', () => openDashboardIssueEditor(button.dataset.issueId)));
}

async function openDashboardInspectionDetail(inspectionId) {
  dashboardShowModal('รายละเอียดผลการตรวจ', '<div class="hci-modal-loading"><span class="hci-spinner"></span> กำลังโหลดรายละเอียด...</div>', 'wide');
  try {
    const result = await Api.call('getInspectionDetail', { inspectionId }, { silent: true });
    const inspection = result.inspection || {};
    const details = Array.isArray(result.details) ? result.details : [];
    const categories = { BEDROOM: 'โซนห้องนอน', BATHROOM: 'โซนห้องน้ำ', AMENITIES: 'สิ่งอำนวยความสะดวก', SAFETY: 'ภาพรวมความปลอดภัย', OVERALL: 'ภาพรวมและความพร้อมใช้งาน' };
    const issueCount = details.filter(item => item.Result === 'ไม่ผ่าน' || item.Result === 'ต้องแก้ไข').length;
    dashboardShowModal(`รายละเอียด ${dashboardRoomLabel(inspection)}`, `
      <div class="hci-detail-grid">
        ${dashboardDetailField('วันที่ตรวจ', dashboardDate(inspection.InspectionDate))}${dashboardDetailField('เวลา', `${dashboardTime(inspection.StartTime)} – ${dashboardTime(inspection.EndTime)}`)}
        ${dashboardDetailField('แม่บ้าน', inspection.HousekeeperName || '-')}${dashboardDetailField('ผู้ตรวจ', inspection.InspectorName || '-')}
        ${dashboardDetailField('คะแนน', `${Number(inspection.FinalScore || 0).toFixed(2)}%`)}${dashboardDetailField('ผลตรวจ', inspection.FinalStatus || '-')}
      </div>
      <div class="hci-detail-note"><strong>หมายเหตุ:</strong> ${Utils.escapeHtml(inspection.GeneralNote || '-')}</div>
      <h3 class="hci-modal-section-title">ผล Checklist (${details.length} รายการ / พบปัญหา ${issueCount})</h3>
      ${Object.keys(categories).map(category => {
        const list = details.filter(item => item.Category === category);
        if (!list.length) return '';
        return `<details class="hci-detail-accordion" ${category === 'BEDROOM' ? 'open' : ''}><summary>${categories[category]} <span>${list.length} รายการ</span></summary>
          <div class="hci-checklist-detail-list">${list.map(item => `<div class="hci-checklist-detail-item">
            <span>${dashboardBadge(item.Result || '-')}</span><div><strong>${Utils.escapeHtml(item.ItemName || '-')}</strong><p>${Utils.escapeHtml(item.Note || '')}</p></div>
            ${item.BeforeImageURL && dashboardSafeImageUrl(item.BeforeImageURL) ? `<a href="${dashboardSafeImageUrl(item.BeforeImageURL)}" target="_blank" rel="noopener"><img class="hci-detail-thumb" src="${dashboardSafeImageUrl(item.BeforeImageURL)}" alt="ภาพหลักฐาน"></a>` : ''}
            ${(item.Result === 'ไม่ผ่าน' || item.Result === 'ต้องแก้ไข' || item.IssueStatus) ? `<button class="hci-btn hci-btn-outline hci-btn-sm" data-issue-id="${Utils.escapeHtml(item.DetailID)}">จัดการ</button>` : ''}
          </div>`).join('')}</div></details>`;
      }).join('') || emptyState('ยังไม่มีข้อมูล Checklist')}` , 'wide');
    bindDashboardModalActions(DashboardView.adminData || {});
  } catch (error) {
    dashboardShowModal('โหลดรายละเอียดไม่สำเร็จ', `<div class="hci-error-inline">${Utils.escapeHtml(error.message || 'กรุณาลองใหม่')}</div>`);
  }
}

function openDashboardPendingRoom(roomId, dash) {
  const room = (dash.lists.pendingRooms || []).find(item => String(item.RoomID) === String(roomId)) || (dash.lists.allRooms || []).find(item => String(item.RoomID) === String(roomId));
  if (!room) return;
  dashboardShowModal(`รายละเอียด ${dashboardRoomLabel(room)}`, `<div class="hci-detail-grid">
    ${dashboardDetailField('สถานะช่วงวันที่เลือก', 'รอตรวจ')}${dashboardDetailField('ประเภท', dashboardRoomType(room.RoomType))}
    ${dashboardDetailField('แม่บ้านที่รับผิดชอบ', room.AssignedHousekeeper || '-')}${dashboardDetailField('วันที่ตรวจล่าสุดก่อนหน้า', room.LastInspectionDate ? dashboardDate(room.LastInspectionDate) : '-')}
    ${dashboardDetailField('ผู้ตรวจล่าสุด', room.LastInspectorName || '-')}${dashboardDetailField('ผลล่าสุดก่อนหน้า', room.LastStatus || '-')}
  </div><p class="hci-muted">ผลการตรวจของวันก่อนถูกเก็บในประวัติ แต่ไม่นำมาเป็นสถานะของช่วงวันที่ปัจจุบัน</p>`);
}

async function openDashboardIssueEditor(detailId) {
  dashboardShowModal('รายละเอียดและการจัดการปัญหา', '<div class="hci-modal-loading"><span class="hci-spinner"></span> กำลังโหลดรายละเอียด...</div>', 'wide');
  try {
    const data = await Api.call('getIssueDetails', { detailId }, { silent: true });
    const issue = data.issue || {}, inspection = data.inspection || {}, history = data.history || [];
    const options = DashboardView.adminData ? DashboardView.adminData.filterOptions : { housekeepers: [], inspectors: [] };
    const assignees = [...(options.housekeepers || []), ...(options.inspectors || [])];
    dashboardShowModal(`จัดการปัญหา • ${dashboardRoomLabel(inspection)}`, `
      <div class="hci-detail-grid">
        ${dashboardDetailField('ปัญหา', issue.ItemName || '-')}${dashboardDetailField('หมวด', dashboardCategory(issue.Category))}
        ${dashboardDetailField('วันที่ตรวจ', dashboardDate(inspection.InspectionDate))}${dashboardDetailField('ผู้แจ้ง/ผู้ตรวจ', inspection.InspectorName || '-')}
        ${dashboardDetailField('แม่บ้าน', inspection.HousekeeperName || '-')}${dashboardDetailField('คะแนนห้อง', `${Number(inspection.FinalScore || 0).toFixed(2)}%`)}
      </div>
      ${issue.BeforeImageURL && dashboardSafeImageUrl(issue.BeforeImageURL) ? `<a class="hci-evidence-link" href="${dashboardSafeImageUrl(issue.BeforeImageURL)}" target="_blank" rel="noopener"><img src="${dashboardSafeImageUrl(issue.BeforeImageURL)}" alt="ภาพหลักฐาน"><span>เปิดภาพหลักฐาน</span></a>` : ''}
      <form id="dashboardIssueForm" class="hci-issue-edit-form">
        <input type="hidden" name="detailId" value="${Utils.escapeHtml(issue.DetailID)}">
        <div class="hci-form-row">
          ${dashboardSelectField('ผลการตรวจ', 'result', ['ผ่าน','ไม่ผ่าน','ต้องแก้ไข','ไม่เกี่ยวข้อง','ไม่สามารถตรวจสอบได้'], issue.Result)}
          ${dashboardSelectField('สถานะ', 'issueStatus', ['พบปัญหา','รับเรื่องแล้ว','รอดำเนินการ','กำลังแก้ไข','กำลังดำเนินการ','ต้องแก้ไข','แก้ไขแล้ว','รอตรวจซ้ำ','ปิดงาน','ผ่าน','ไม่ผ่าน','ไม่เกี่ยวข้อง'], issue.IssueStatus)}
          ${dashboardSelectField('ระดับความรุนแรง', 'severity', ['ต่ำ','ปานกลาง','สูง','เร่งด่วน','Urgent','Critical'], issue.Severity)}
        </div>
        <div class="hci-form-row">
          <div class="hci-form-group"><label>ผู้รับผิดชอบ</label><input name="assignedTo" list="dashboardAssignees" value="${Utils.escapeHtml(issue.AssignedTo || '')}" maxlength="200"><datalist id="dashboardAssignees">${assignees.map(user => `<option value="${Utils.escapeHtml(user.FullName)}"></option>`).join('')}</datalist></div>
          <div class="hci-form-group"><label>วันที่ดำเนินการ</label><input type="date" name="actionDate" value="${Utils.escapeHtml(dashboardInputDate(issue.ActionDate))}"></div>
          <div class="hci-form-group"><label>เวลา</label><input type="time" name="actionTime" value="${Utils.escapeHtml(dashboardTime(issue.ActionTime))}"></div>
        </div>
        <div class="hci-form-group"><label>วิธีการแก้ไข</label><textarea name="resolutionMethod" rows="2" maxlength="2000">${Utils.escapeHtml(issue.ResolutionMethod || '')}</textarea></div>
        <div class="hci-form-group"><label>หมายเหตุเพิ่มเติม</label><textarea name="adminNote" rows="2" maxlength="2000">${Utils.escapeHtml(issue.AdminNote || '')}</textarea></div>
        <div class="hci-form-group"><label>หมายเหตุสำหรับประวัติการเปลี่ยนแปลง</label><textarea name="historyNote" rows="2" maxlength="2000" placeholder="อธิบายสิ่งที่เปลี่ยนแปลง"></textarea></div>
        <div class="hci-modal-actions"><button type="button" class="hci-btn hci-btn-outline" data-modal-close>ยกเลิก</button><button type="submit" class="hci-btn hci-btn-navy" id="dashboardIssueSave"><i class="fa-solid fa-floppy-disk"></i> บันทึกการเปลี่ยนแปลง</button></div>
      </form>
      <h3 class="hci-modal-section-title">ประวัติการเปลี่ยนแปลง</h3>${dashboardHistoryTimeline(history)}`, 'wide');
    const form = document.getElementById('dashboardIssueForm');
    const root = document.getElementById('adminDashboardModalRoot');
    root.querySelectorAll('[data-modal-close]').forEach(button => button.addEventListener('click', dashboardCloseModal));
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const saveButton = document.getElementById('dashboardIssueSave');
      if (saveButton.disabled) return;
      const payload = Object.fromEntries(new FormData(form).entries());
      saveButton.disabled = true;
      saveButton.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> กำลังบันทึกข้อมูล...';
      try {
        await Api.withSubmitLock(() => Api.call('updateIssueDetails', payload, { silent: true, timeoutMs: APP_CONFIG.SAVE_REQUEST_TIMEOUT_MS || 120000 }));
        Utils.toast('success', 'บันทึกข้อมูลสำเร็จ');
        dashboardCloseModal();
        await DashboardView.loadAdminDashboard(false, true);
      } catch (error) {
        Utils.toast('error', error.message === 'TIMEOUT' ? 'ระบบยังไม่ยืนยันการบันทึก กรุณาตรวจสอบข้อมูลก่อนลองอีกครั้ง' : (error.message || 'บันทึกข้อมูลไม่สำเร็จ'));
        saveButton.disabled = false;
        saveButton.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> บันทึกการเปลี่ยนแปลง';
      }
    });
  } catch (error) {
    dashboardShowModal('โหลดรายละเอียดไม่สำเร็จ', `<div class="hci-error-inline">${Utils.escapeHtml(error.message || 'กรุณาลองใหม่')}</div>`);
  }
}

function dashboardShowModal(title, body, size = '') {
  const root = document.getElementById('adminDashboardModalRoot');
  if (!root) return;
  root.innerHTML = `<div class="hci-admin-modal-backdrop" role="presentation"><section class="hci-admin-modal ${size === 'wide' ? 'wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="dashboardModalTitle">
    <header><h2 id="dashboardModalTitle">${Utils.escapeHtml(title)}</h2><button type="button" class="hci-admin-modal-close" aria-label="ปิดหน้าต่าง"><i class="fa-solid fa-xmark"></i></button></header>
    <div class="hci-admin-modal-body">${body}</div></section></div>`;
  const backdrop = root.querySelector('.hci-admin-modal-backdrop');
  root.querySelector('.hci-admin-modal-close').addEventListener('click', dashboardCloseModal);
  backdrop.addEventListener('click', event => { if (event.target === backdrop) dashboardCloseModal(); });
  document.addEventListener('keydown', dashboardModalEscape);
  setTimeout(() => root.querySelector('.hci-admin-modal-close')?.focus(), 0);
}

function dashboardCloseModal() {
  const root = document.getElementById('adminDashboardModalRoot');
  if (root) root.innerHTML = '';
  document.removeEventListener('keydown', dashboardModalEscape);
}
function dashboardModalEscape(event) { if (event.key === 'Escape') dashboardCloseModal(); }

function dashboardHistoryTimeline(items) {
  if (!items.length) return emptyState('ยังไม่มีประวัติ');
  return `<ol class="hci-issue-timeline">${items.map(item => `<li><span class="hci-timeline-dot"></span><div><strong>${Utils.escapeHtml(dashboardDateTime(item.DateTime))}</strong><p>${Utils.escapeHtml(item.Actor || '-')} • ${Utils.escapeHtml(item.OldStatus || '-')} → ${Utils.escapeHtml(item.NewStatus || '-')}</p>${item.Note ? `<small>${Utils.escapeHtml(item.Note)}</small>` : ''}</div></li>`).join('')}</ol>`;
}

function dashboardSelectField(label, name, options, selected) {
  return `<div class="hci-form-group"><label>${Utils.escapeHtml(label)}</label><select name="${name}"><option value="">-- เลือก --</option>${options.map(option => `<option value="${Utils.escapeHtml(option)}" ${String(option) === String(selected || '') ? 'selected' : ''}>${Utils.escapeHtml(option)}</option>`).join('')}</select></div>`;
}
function dashboardDetailField(label, value) { return `<div class="hci-detail-field"><span>${Utils.escapeHtml(label)}</span><strong>${Utils.escapeHtml(value === null || value === undefined || value === '' ? '-' : value)}</strong></div>`; }
function dashboardBadge(value) {
  const text = String(value || '-');
  let color = 'gray';
  if (/ผ่าน|แก้ไขแล้ว|ปิดงาน|ดีเยี่ยม/.test(text) && !/ไม่ผ่าน/.test(text)) color = 'green';
  else if (/ไม่ผ่าน|เร่งด่วน|Critical|Urgent/.test(text)) color = 'red';
  else if (/รอ|ต้องแก้|กำลัง/.test(text)) color = 'orange';
  else if (/ตรวจแล้ว/.test(text)) color = 'teal';
  return `<span class="hci-badge hci-badge-${color}">${Utils.escapeHtml(text)}</span>`;
}
function dashboardRoomLabel(item) { return item.RoomType === 'VIP' || String(item.RoomNumber || '').toUpperCase().includes('VIP') ? (item.RoomName || item.RoomNumber || '-') : `ห้อง ${item.RoomNumber || '-'}`; }
function dashboardRoomType(type) { return type === 'VIP' ? 'VIP' : (type === 'GUEST_ROOM' ? 'ห้องพัก' : (type || '-')); }
function dashboardCategory(category) { return ({ BEDROOM: 'โซนห้องนอน', BATHROOM: 'โซนห้องน้ำ', AMENITIES: 'สิ่งอำนวยความสะดวก', SAFETY: 'ภาพรวมความปลอดภัย', OVERALL: 'ภาพรวม' })[category] || category || '-'; }
function dashboardDate(value) { if (!value) return '-'; const parts = String(value).slice(0, 10).split('-'); return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : String(value); }
function dashboardDateTime(value) { if (!value) return '-'; const text = String(value).replace('T', ' '); return `${dashboardDate(text.slice(0, 10))}${text.length >= 16 ? ' ' + text.slice(11, 16) : ''}`; }
function dashboardTime(value) { if (!value) return ''; const match = String(value).match(/(\d{1,2}):(\d{2})/); return match ? `${String(match[1]).padStart(2, '0')}:${match[2]}` : ''; }
function dashboardInputDate(value) { if (!value) return ''; const match = String(value).match(/\d{4}-\d{2}-\d{2}/); return match ? match[0] : ''; }
function dashboardAge(hours) { const value = Number(hours) || 0; if (value < 24) return `${value} ชม.`; return `${Math.floor(value / 24)} วัน ${value % 24} ชม.`; }
function dashboardUrgent(severity) { return ['เร่งด่วน', 'urgent', 'critical'].includes(String(severity || '').toLowerCase()) || severity === 'เร่งด่วน'; }
function dashboardSafeImageUrl(value) { try { const url = new URL(String(value)); return ['https:', 'http:'].includes(url.protocol) ? url.href : ''; } catch (_) { return ''; } }

function kpiCard(label, value, icon, color) {
  return `<div class="hci-kpi-card hci-color-${color}"><div class="hci-kpi-icon"><i class="fa-solid ${icon}"></i></div><div><p class="hci-kpi-value">${value}</p><p class="hci-kpi-label">${label}</p></div></div>`;
}

function rankTable(items, keyField, valField, keyLabel, valLabel) {
  if (!items.length) return emptyState('ยังไม่มีข้อมูล');
  return `<table class="hci-table"><thead><tr><th>#</th><th>${keyLabel}</th><th>${valLabel}</th></tr></thead>
  <tbody>${items.map((it, idx) => `<tr><td>${idx + 1}</td><td>${Utils.escapeHtml(it[keyField])}</td><td>${it[valField]}</td></tr>`).join('')}</tbody></table>`;
}

function emptyRow(cols) { return `<tr><td colspan="${cols}" class="hci-empty-cell">ยังไม่มีข้อมูล</td></tr>`; }

function emptyState(msg) {
  return `<div class="hci-empty-state"><i class="fa-regular fa-folder-open"></i><p>${msg}</p></div>`;
}

function renderErrorState(container, msg, retryFn, detail) {
  const detailHtml = detail ? `<p class="hci-muted" style="max-width:650px;margin:8px auto 18px">${Utils.escapeHtml(detail)}</p>` : '';
  container.innerHTML = `<div class="hci-error-state"><i class="fa-solid fa-triangle-exclamation"></i><p>${msg}</p>${detailHtml}<button class="hci-btn hci-btn-navy" id="retryBtn">ลองใหม่อีกครั้ง</button></div>`;
  document.getElementById('retryBtn').addEventListener('click', retryFn);
}

function renderRoomGrid(el, rooms, user) {
  if (!rooms.length) { el.innerHTML = emptyState('ยังไม่มีข้อมูลห้องพัก'); return; }
  el.innerHTML = rooms.map(r => {
    // ตรวจวันที่ซ้ำฝั่งหน้าเว็บ ป้องกันสถานะค้างหากเปิดแท็บข้ามวัน
    const hasDailyStatus = Object.prototype.hasOwnProperty.call(r, 'InspectedToday');
    const isInspectedToday = r.InspectedToday === true && r.InspectionDate === Utils.todayISO();
    const oldInspectionStatuses = ['ดีเยี่ยม', 'ผ่านมาตรฐาน', 'ไม่ผ่านมาตรฐาน', 'ควรปรับปรุง', 'ตรวจสอบแล้ว'];
    const effectiveStatus = hasDailyStatus && !isInspectedToday && oldInspectionStatuses.indexOf(r.Status) !== -1
      ? 'ยังไม่ได้ทำความสะอาด'
      : r.Status;
    const meta = Utils.statusMeta(effectiveStatus);
    const canInspect = ['ADMIN', 'INSPECTOR', 'HOUSEKEEPER'].indexOf(user.Role) !== -1;
    return `<div class="hci-room-card hci-color-${meta.color}" ${canInspect ? `onclick="location.hash='#/inspection/${r.RoomID}'"` : ''}>
      <div class="hci-room-icon"><i class="fa-solid ${meta.icon}"></i></div>
      <p class="hci-room-number">${r.RoomType === 'VIP' ? Utils.escapeHtml(r.RoomName || r.RoomNumber) : 'ห้อง ' + Utils.escapeHtml(r.RoomNumber)}</p>
      <p class="hci-room-status">${Utils.escapeHtml(effectiveStatus)}</p>
    </div>`;
  }).join('');
}

function renderCharts(dash) {
  // หาก CDN ของ Chart.js ถูกบล็อก ให้แสดง Dashboard ส่วนอื่นต่อได้
  // และแจ้งเฉพาะบริเวณกราฟแทนการทำให้ทั้งหน้าล้มเหลว
  if (typeof Chart === 'undefined') {
    ['chartDaily', 'chartCategory', 'chartWeekly', 'chartMonthly'].forEach(id => {
      const canvas = document.getElementById(id);
      if (!canvas) return;
      const notice = document.createElement('div');
      notice.className = 'hci-empty-state';
      notice.innerHTML = '<i class="fa-solid fa-chart-line"></i><p>ไม่สามารถโหลดไลบรารีกราฟได้ แต่ข้อมูล Dashboard ส่วนอื่นยังใช้งานได้</p>';
      canvas.replaceWith(notice);
    });
    return;
  }
  const palette = { navy: '#0B1F3A', gold: '#C9A24B', green: '#3E8E5A', red: '#B23A48', gray: '#C8C4BA' };
  ['chartDaily', 'chartCategory', 'chartWeekly', 'chartMonthly'].forEach(id => {
    if (DashboardView.charts[id]) DashboardView.charts[id].destroy();
  });

  const dailyEl = document.getElementById('chartDaily');
  if (dailyEl) DashboardView.charts.chartDaily = new Chart(dailyEl, {
    type: 'bar',
    data: { labels: dash.trends.daily.map(d => d.label), datasets: [
      { label: 'ผ่าน', data: dash.trends.daily.map(d => d.pass), backgroundColor: palette.green },
      { label: 'ไม่ผ่าน', data: dash.trends.daily.map(d => d.fail), backgroundColor: palette.red }
    ]},
    options: { responsive: true, plugins: { legend: { position: 'bottom' } } }
  });

  const catEl = document.getElementById('chartCategory');
  if (catEl) DashboardView.charts.chartCategory = new Chart(catEl, {
    type: 'radar',
    data: { labels: Object.values(APP_CONFIG.CATEGORY_LABELS), datasets: [{
      label: 'คะแนนเฉลี่ย (%)', data: Object.keys(APP_CONFIG.CATEGORY_LABELS).map(k => dash.categoryAvg[k] || 0),
      backgroundColor: 'rgba(201,162,75,0.25)', borderColor: palette.gold, pointBackgroundColor: palette.gold
    }]},
    options: { responsive: true, scales: { r: { min: 0, max: 100 } } }
  });

  const weeklyEl = document.getElementById('chartWeekly');
  if (weeklyEl) DashboardView.charts.chartWeekly = new Chart(weeklyEl, {
    type: 'line',
    data: { labels: dash.trends.weekly.map(d => d.label), datasets: [
      { label: 'ผ่าน', data: dash.trends.weekly.map(d => d.pass), borderColor: palette.green, tension: 0.3 },
      { label: 'ไม่ผ่าน', data: dash.trends.weekly.map(d => d.fail), borderColor: palette.red, tension: 0.3 }
    ]},
    options: { responsive: true, plugins: { legend: { position: 'bottom' } } }
  });

  const monthlyEl = document.getElementById('chartMonthly');
  if (monthlyEl) DashboardView.charts.chartMonthly = new Chart(monthlyEl, {
    type: 'line',
    data: { labels: dash.trends.monthly.map(d => d.label), datasets: [
      { label: 'ผ่าน', data: dash.trends.monthly.map(d => d.pass), borderColor: palette.navy, tension: 0.3 },
      { label: 'ไม่ผ่าน', data: dash.trends.monthly.map(d => d.fail), borderColor: palette.red, tension: 0.3 }
    ]},
    options: { responsive: true, plugins: { legend: { position: 'bottom' } } }
  });
}
