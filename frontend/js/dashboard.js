/**
 * dashboard.js
 * หน้าหลักหลังเข้าสู่ระบบ และหน้า Admin Dashboard (KPI, กราฟ, ตัวกรอง)
 *
 * Admin Dashboard:
 * - Firestore-first สำหรับวันเดียวและช่วงวันที่ (สูงสุด 62 วัน)
 * - Real-time ด้วย onSnapshot() ของ dashboardDaily ทุกวันที่อยู่ในช่วง
 * - รวมผลแบบห้องไม่ซ้ำ และใช้ผลตรวจล่าสุดของแต่ละห้องในช่วงวันที่เลือก
 * - หาก Firestore ใช้งานไม่ได้ / มีวันใดไม่มี Snapshot จะ Fallback ไป Google Apps Script อัตโนมัติ
 * - ตัวกรองพนักงาน/ผู้ตรวจ/ห้อง/สถานะยังใช้ Google Apps Script เพื่อรักษา Logic เดิมอย่างแม่นยำ
 *
 * หน้า Home, ระบบแม่บ้าน, ผู้ตรวจสอบ, Login และการบันทึก/แก้ไขข้อมูลยังใช้ระบบเดิม
 */

const DashboardView = {
  charts: {},

  // Firestore listener ใช้เฉพาะหน้า Admin Dashboard
  adminFirestoreUnsubscribe: null,
  adminFirestoreDate: '',
  adminDataSource: '',

  async renderHome(container) {
    const user = Auth.getCurrentUser();
    Utils.showLoading('กำลังโหลดข้อมูลหน้าหลัก...');
    try {
      // หน้า Home ยังคงใช้ระบบเดิมผ่าน GAS เพื่อไม่กระทบแม่บ้าน/ผู้ตรวจสอบ
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

    // ป้องกัน listener เก่าค้างเมื่อเปิด Dashboard ซ้ำ
    this.stopAdminFirestoreListener();

    this.adminContainer = container;
    this.adminFilters = { dateFrom: today, dateTo: today };
    this.adminData = null;
    this.adminDataSource = '';

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

        document.querySelectorAll('.hci-quick-filter').forEach(item => {
          item.classList.toggle('active', item === button);
        });

        if (range) {
          form.elements.dateFrom.value = range.dateFrom;
          form.elements.dateTo.value = range.dateTo;

          // Quick Filter วันที่ควรคงค่าตัวกรองอื่นตาม UI ปัจจุบันไว้
          this.adminFilters = Object.assign(
            {},
            this.adminFilters || {},
            range
          );

          await this.loadAdminDashboard(true);
        } else {
          form.elements.dateFrom.focus();
        }
      });
    });

    ['dateFrom', 'dateTo'].forEach(name => {
      form.elements[name].addEventListener('change', () => {
        document.querySelectorAll('.hci-quick-filter').forEach(item => {
          item.classList.toggle('active', item.dataset.range === 'custom');
        });
      });
    });
  },

  stopAdminFirestoreListener() {
    if (typeof this.adminFirestoreUnsubscribe === 'function') {
      try {
        this.adminFirestoreUnsubscribe();
      } catch (error) {
        console.warn('หยุด Firestore listener ไม่สำเร็จ:', error);
      }
    }

    this.adminFirestoreUnsubscribe = null;
    this.adminFirestoreDate = '';
  },

  applyAdminDashboardData(rawData, options = {}) {
    const content = document.getElementById('adminDashboardContent');
    if (!content) {
      this.stopAdminFirestoreListener();
      return null;
    }

    const dash = normalizeDashboardData(rawData);
    const source = options.source || 'GAS';
    const refreshFilters = options.refreshFilters !== false;

    this.adminData = dash;
    this.adminDataSource = source;

    if (refreshFilters) {
      populateDashboardFilters(
        dash.filterOptions,
        this.adminFilters || {}
      );
    }

    renderAdminDashboardContent(content, dash);
    bindAdminDashboardActions(dash);
    renderCharts(dash);

    const updated = document.getElementById('dashUpdatedAt');
    if (updated) {
      const sourceLabel =
        source === 'FIRESTORE'
          ? 'Firestore • Real-time'
          : 'Google Apps Script';

      updated.textContent =
        `ข้อมูลล่าสุด ${dashboardDateTime(dash.meta.generatedAt)} • ${sourceLabel}`;
    }

    return dash;
  },

  async handleAdminFirestoreRuntimeError(error) {
    console.warn(
      '⚠️ Firestore Dashboard Real-time มีปัญหา กำลังใช้ GAS สำรอง:',
      error
    );

    this.stopAdminFirestoreListener();

    // ถ้ายังอยู่หน้า Admin Dashboard ให้โหลดข้อมูลสดจาก GAS
    if (document.getElementById('adminDashboardContent')) {
      try {
        await this.loadAdminDashboard(false, true);
        Utils.toast(
          'warning',
          'Firestore มีปัญหาชั่วคราว ระบบเปลี่ยนไปใช้ Google Apps Script แล้ว'
        );
      } catch (_) {
        // loadAdminDashboard จัดการ error UI ภายในอยู่แล้ว
      }
    }
  },

  async loadAdminDashboard(showToast, forceRefresh = false) {
    const content = document.getElementById('adminDashboardContent');
    const button = document.getElementById('dashFilterButton');

    if (!content) return;

    if (button) {
      button.disabled = true;
      button.innerHTML =
        '<i class="fa-solid fa-spinner fa-spin"></i> กำลังโหลด...';
    }

    content.classList.add('is-loading');

    // ทุกครั้งที่เปลี่ยนช่วง/ตัวกรอง ให้หยุด listener เดิมก่อน
    this.stopAdminFirestoreListener();

    const requestFilters =
      Object.assign({}, this.adminFilters || {});

    let firestoreError = null;
    let loadedFromFirestore = false;

    try {
      // --------------------------------------------------
      // 1) Firestore-first
      //
      // รองรับ:
      // - วันเดียว
      // - 7 วันล่าสุด
      // - เดือนนี้
      // - กำหนดเอง สูงสุด 62 วัน
      //
      // เงื่อนไข:
      // - ต้องมี dashboardDaily ครบทุกวันในช่วง
      // - ไม่มีตัวกรองละเอียด
      // - forceRefresh=true จะบังคับ GAS
      // --------------------------------------------------
      if (
        !forceRefresh &&
        dashboardCanUseFirestore(requestFilters)
      ) {
        try {
          const dateFrom =
            requestFilters.dateFrom ||
            Utils.todayISO();

          const dateTo =
            requestFilters.dateTo ||
            dateFrom;

          const subscription =
            await dashboardSubscribeFirestoreRange(
              dateFrom,
              dateTo,
              realtimeData => {
                const activeFilters =
                  this.adminFilters || {};

                const activeDateFrom =
                  activeFilters.dateFrom ||
                  Utils.todayISO();

                const activeDateTo =
                  activeFilters.dateTo ||
                  activeDateFrom;

                // ถ้าเปลี่ยนหน้า/ช่วง/ตัวกรองไปแล้ว ห้ามข้อมูลจาก listener เก่าทับ
                if (
                  !document.getElementById('adminDashboardContent') ||
                  !dashboardCanUseFirestore(activeFilters) ||
                  String(activeDateFrom) !== String(dateFrom) ||
                  String(activeDateTo) !== String(dateTo)
                ) {
                  this.stopAdminFirestoreListener();
                  return;
                }

                this.applyAdminDashboardData(
                  realtimeData,
                  {
                    source: 'FIRESTORE',
                    refreshFilters: false
                  }
                );

                console.log(
                  '🔄 Admin Dashboard อัปเดต Real-time จาก Firestore:',
                  dateFrom === dateTo
                    ? dateFrom
                    : `${dateFrom} → ${dateTo}`
                );
              },
              runtimeError => {
                this.handleAdminFirestoreRuntimeError(runtimeError);
              }
            );

          this.adminFirestoreUnsubscribe =
            subscription.unsubscribe;

          this.adminFirestoreDate =
            dateFrom === dateTo
              ? dateFrom
              : `${dateFrom}..${dateTo}`;

          this.applyAdminDashboardData(
            subscription.data,
            {
              source: 'FIRESTORE',
              refreshFilters: true
            }
          );

          loadedFromFirestore = true;

          console.log(
            '✅ Admin Dashboard โหลดจาก Firestore:',
            dateFrom === dateTo
              ? dateFrom
              : `${dateFrom} → ${dateTo}`
          );

          if (showToast) {
            Utils.toast(
              'success',
              dateFrom === dateTo
                ? 'อัปเดต Dashboard จาก Firestore สำเร็จ'
                : 'อัปเดต Dashboard ช่วงวันที่จาก Firestore แบบ Real-time สำเร็จ'
            );
          }
        } catch (error) {
          firestoreError = error;

          console.warn(
            '⚠️ Firestore Dashboard ใช้งานไม่ได้/มี Snapshot ไม่ครบ จะ Fallback ไป GAS:',
            error
          );

          this.stopAdminFirestoreListener();
        }
      }

      // --------------------------------------------------
      // 2) Google Apps Script Fallback
      //
      // ใช้เมื่อ:
      // - Firestore error
      // - มีวันใดในช่วงไม่มี dashboardDaily
      // - ช่วงเกิน 62 วัน
      // - มีตัวกรองละเอียด
      // - forceRefresh
      // --------------------------------------------------
      if (!loadedFromFirestore) {
        const gasFilters =
          Object.assign({}, requestFilters);

        if (forceRefresh) {
          gasFilters.forceRefresh = true;
        }

        const gasData =
          await Api.call(
            'getAdminDashboard',
            gasFilters,
            {
              timeoutMs:
                APP_CONFIG.REQUEST_TIMEOUT_MS ||
                90000
            }
          );

        this.applyAdminDashboardData(
          gasData,
          {
            source: 'GAS',
            refreshFilters: true
          }
        );

        console.log(
          firestoreError
            ? '✅ Admin Dashboard Fallback ไป GAS สำเร็จ'
            : '✅ Admin Dashboard โหลดจาก GAS ตามเงื่อนไขตัวกรอง'
        );

        if (showToast) {
          Utils.toast(
            'success',
            firestoreError
              ? 'Firestore Snapshot ในช่วงวันที่ยังไม่ครบ ระบบใช้ Google Apps Script สำรอง'
              : 'อัปเดต Dashboard สำเร็จ'
          );
        }
      }
    } catch (error) {
      const detail =
        firestoreError
          ? `${error.message || 'โหลดข้อมูลไม่สำเร็จ'} | Firestore: ${firestoreError.message || firestoreError}`
          : (error.message || 'โหลดข้อมูลไม่สำเร็จ');

      renderErrorState(
        content,
        'ไม่สามารถโหลด Dashboard ได้',
        () => this.loadAdminDashboard(false),
        detail
      );
    } finally {
      content.classList.remove('is-loading');

      if (button) {
        button.disabled = false;
        button.innerHTML =
          '<i class="fa-solid fa-filter"></i> กรองข้อมูล';
      }

      Utils.hideLoading();
    }
  }
};


/**
 * จำนวนวันสูงสุดที่เปิด Firestore listener พร้อมกัน
 * 62 วันครอบคลุม Today / Yesterday / 7 Days / Month และช่วงกำหนดเองทั่วไป
 * ช่วงที่ยาวกว่านี้จะใช้ GAS เพื่อไม่เปิด listener มากเกินจำเป็น
 */
const DASHBOARD_FIRESTORE_MAX_RANGE_DAYS = 62;


/**
 * ตรวจว่า Request นี้สามารถใช้ Firestore Daily Snapshots ได้หรือไม่
 *
 * รองรับช่วงวันที่หลายวันแล้ว แต่ตัวกรองละเอียดบางชนิดยังใช้ GAS
 * เพราะ Daily Snapshot เก็บผลล่าสุดรายห้องของแต่ละวัน ไม่ได้เก็บทุกการตรวจซ้ำ
 * จึงไม่ควรกรอง Housekeeper/Inspector ฝั่ง Client แล้วทำให้ผลคลาดเคลื่อน
 */
function dashboardCanUseFirestore(filters) {
  const user =
    typeof Auth !== 'undefined'
      ? Auth.getCurrentUser()
      : null;

  if (
    !user ||
    String(user.Role || '').toUpperCase() !== 'ADMIN'
  ) {
    return false;
  }

  const safe =
    filters && typeof filters === 'object'
      ? filters
      : {};

  const dateFrom =
    safe.dateFrom ||
    Utils.todayISO();

  const dateTo =
    safe.dateTo ||
    dateFrom;

  const dayCount =
    dashboardRangeDayCount(
      dateFrom,
      dateTo
    );

  if (
    !dayCount ||
    dayCount < 1 ||
    dayCount > DASHBOARD_FIRESTORE_MAX_RANGE_DAYS
  ) {
    return false;
  }

  // รักษาความแม่นยำของ Logic เดิม:
  // ตัวกรองเหล่านี้ให้ GAS เป็นผู้คำนวณ
  const advancedFilterKeys = [
    'housekeeperId',
    'inspectorId',
    'roomId',
    'status',
    'severity',
    'category'
  ];

  return !advancedFilterKeys.some(key => {
    return String(safe[key] || '').trim() !== '';
  });
}


/**
 * จำนวนวันแบบรวมวันต้นและวันปลาย
 */
function dashboardRangeDayCount(dateFrom, dateTo) {
  const start =
    dashboardParseIsoDateUtc(dateFrom);

  const end =
    dashboardParseIsoDateUtc(dateTo);

  if (
    !start ||
    !end ||
    start.getTime() > end.getTime()
  ) {
    return 0;
  }

  return (
    Math.floor(
      (
        end.getTime() -
        start.getTime()
      ) / 86400000
    ) + 1
  );
}


/**
 * แปลง yyyy-MM-dd เป็น Date แบบ UTC
 * เพื่อไม่ให้ Timezone ของเครื่องผู้ใช้ทำให้วันเลื่อน
 */
function dashboardParseIsoDateUtc(value) {
  const match =
    String(value || '')
      .match(
        /^(\d{4})-(\d{2})-(\d{2})$/
      );

  if (!match) {
    return null;
  }

  const date =
    new Date(
      Date.UTC(
        Number(match[1]),
        Number(match[2]) - 1,
        Number(match[3])
      )
    );

  return isNaN(date.getTime())
    ? null
    : date;
}


/**
 * คืนรายการวันที่ทั้งหมดในช่วง เช่น
 * 2026-08-15 -> 2026-08-17
 * = ['2026-08-15','2026-08-16','2026-08-17']
 */
function dashboardDateKeysInRange(dateFrom, dateTo) {
  const start =
    dashboardParseIsoDateUtc(dateFrom);

  const end =
    dashboardParseIsoDateUtc(dateTo);

  if (
    !start ||
    !end ||
    start.getTime() > end.getTime()
  ) {
    return [];
  }

  const result = [];
  const cursor =
    new Date(start.getTime());

  while (
    cursor.getTime() <=
    end.getTime()
  ) {
    result.push(
      cursor
        .toISOString()
        .slice(0, 10)
    );

    cursor.setUTCDate(
      cursor.getUTCDate() + 1
    );
  }

  return result;
}


/**
 * รอ Firebase Core เดิมจาก firebase.js
 * ไม่แก้ firebase.js และไม่ initialize Firebase ซ้ำ
 */
async function dashboardWaitForFirebase(timeoutMs = 10000) {
  const startedAt =
    Date.now();

  while (
    Date.now() - startedAt <
    timeoutMs
  ) {
    const firebase =
      window.HappyNightFirebase;

    if (
      firebase &&
      firebase.db &&
      typeof firebase.doc === 'function' &&
      typeof firebase.onSnapshot === 'function'
    ) {
      return firebase;
    }

    await new Promise(resolve => {
      setTimeout(resolve, 100);
    });
  }

  throw new Error(
    'Firebase ยังไม่พร้อมใช้งานสำหรับ Dashboard'
  );
}


/**
 * Subscribe dashboardDaily ทุกวันในช่วงวันที่
 *
 * เงื่อนไขความถูกต้อง:
 * - ต้องมี Document ครบทุกวันในช่วง
 * - หากขาดแม้แต่ 1 วัน จะ Reject และให้ loadAdminDashboard Fallback ไป GAS
 *
 * หลัง Snapshot ครบ:
 * - รวมข้อมูลทุกวัน
 * - ห้องเดียวกันนับ 1 ห้อง
 * - ใช้ Inspection ล่าสุดของห้องนั้นในช่วง
 * - เมื่อ Document วันใดเปลี่ยน จะ Merge ใหม่และ Render Real-time
 */
async function dashboardSubscribeFirestoreRange(
  dateFrom,
  dateTo,
  onRealtimeData,
  onRuntimeError
) {
  const firebase =
    await dashboardWaitForFirebase();

  const dateKeys =
    dashboardDateKeysInRange(
      dateFrom,
      dateTo
    );

  if (!dateKeys.length) {
    throw new Error(
      'ช่วงวันที่สำหรับ Firestore ไม่ถูกต้อง'
    );
  }

  if (
    dateKeys.length >
    DASHBOARD_FIRESTORE_MAX_RANGE_DAYS
  ) {
    throw new Error(
      `Firestore Real-time รองรับช่วงสูงสุด ${DASHBOARD_FIRESTORE_MAX_RANGE_DAYS} วัน`
    );
  }

  return new Promise(
    (resolve, reject) => {
      const dataByDate = {};
      const readyDates =
        new Set();

      const unsubscribers = [];

      let initialResolved =
        false;

      let closed =
        false;

      const unsubscribeAll =
        () => {
          if (closed) {
            return;
          }

          closed = true;

          unsubscribers.forEach(
            unsubscribe => {
              if (
                typeof unsubscribe ===
                'function'
              ) {
                try {
                  unsubscribe();
                } catch (_) {}
              }
            }
          );
        };

      const fail =
        error => {
          if (closed) {
            return;
          }

          if (!initialResolved) {
            unsubscribeAll();
            reject(error);
            return;
          }

          unsubscribeAll();

          if (
            typeof onRuntimeError ===
            'function'
          ) {
            onRuntimeError(error);
          }
        };

      const emitMerged =
        () => {
          if (
            closed ||
            readyDates.size !==
              dateKeys.length
          ) {
            return;
          }

          let mergedData;

          try {
            mergedData =
              dashboardMergeDailyFirestoreData(
                dataByDate,
                dateFrom,
                dateTo
              );
          } catch (error) {
            fail(error);
            return;
          }

          if (!initialResolved) {
            initialResolved = true;

            resolve({
              data: mergedData,
              unsubscribe: unsubscribeAll,
              dateKeys: dateKeys.slice()
            });

            return;
          }

          if (
            typeof onRealtimeData ===
            'function'
          ) {
            onRealtimeData(
              mergedData
            );
          }
        };

      dateKeys.forEach(
        dateKey => {
          try {
            const ref =
              firebase.doc(
                firebase.db,
                'dashboardDaily',
                dateKey
              );

            const unsubscribe =
              firebase.onSnapshot(
                ref,
                snapshot => {
                  if (!snapshot.exists()) {
                    const notFound =
                      new Error(
                        `ไม่พบ Firestore Dashboard Snapshot วันที่ ${dateKey}`
                      );

                    notFound.code =
                      'FIRESTORE_DASHBOARD_NOT_FOUND';

                    notFound.dateKey =
                      dateKey;

                    fail(notFound);
                    return;
                  }

                  dataByDate[dateKey] =
                    snapshot.data();

                  readyDates.add(
                    dateKey
                  );

                  emitMerged();
                },
                error => {
                  fail(error);
                }
              );

            unsubscribers.push(
              unsubscribe
            );
          } catch (error) {
            fail(error);
          }
        }
      );
    }
  );
}


/**
 * รวม Daily Snapshots หลายวันให้มี Shape เดียวกับ getAdminDashboard
 *
 * กฎหลัก:
 * - ห้องไม่ซ้ำ
 * - ใช้ผลตรวจล่าสุดของแต่ละห้องในช่วง
 * - ปัญหา/เร่งด่วนรวมตาม DetailID
 * - pending = ห้องที่ไม่เคยตรวจในช่วง
 */
function dashboardMergeDailyFirestoreData(
  dataByDate,
  dateFrom,
  dateTo
) {
  const dateKeys =
    Object.keys(
      dataByDate || {}
    ).sort();

  if (!dateKeys.length) {
    throw new Error(
      'ไม่มี Daily Snapshot สำหรับรวม Dashboard'
    );
  }

  const dailyData =
    dateKeys.map(
      dateKey => {
        const raw =
          dataByDate[dateKey];

        if (
          !raw ||
          typeof raw !==
            'object'
        ) {
          throw new Error(
            `ข้อมูล Firestore วันที่ ${dateKey} ไม่สมบูรณ์`
          );
        }

        return {
          dateKey,
          dash:
            normalizeDashboardData(
              raw
            )
        };
      }
    );

  const firstDash =
    dailyData[0].dash;

  const latestDash =
    dailyData[
      dailyData.length - 1
    ].dash;


  // --------------------------------------------------
  // รายการห้องทั้งหมด
  // --------------------------------------------------

  const allRoomsMap =
    new Map();

  dailyData.forEach(
    ({ dash }) => {
      const candidates =
        (dash.lists &&
          Array.isArray(
            dash.lists.allRooms
          )
          ? dash.lists.allRooms
          : dash.roomStatuses) ||
        [];

      candidates.forEach(
        room => {
          const roomId =
            String(
              room.RoomID || ''
            );

          if (!roomId) {
            return;
          }

          allRoomsMap.set(
            roomId,
            Object.assign(
              {},
              allRoomsMap.get(
                roomId
              ) || {},
              room
            )
          );
        }
      );
    }
  );


  // --------------------------------------------------
  // ผลตรวจล่าสุดต่อห้องตลอดทั้งช่วง
  // --------------------------------------------------

  const latestInspectionByRoom =
    new Map();

  const latestRoomStatusByRoom =
    new Map();

  dailyData.forEach(
    ({ dateKey, dash }) => {
      const statuses =
        Array.isArray(
          dash.roomStatuses
        )
          ? dash.roomStatuses
          : [];

      const statusByInspection =
        new Map();

      const statusByRoom =
        new Map();

      statuses.forEach(
        status => {
          if (
            status.InspectionID
          ) {
            statusByInspection.set(
              String(
                status.InspectionID
              ),
              status
            );
          }

          if (status.RoomID) {
            statusByRoom.set(
              String(
                status.RoomID
              ),
              status
            );
          }
        }
      );

      const inspected =
        dash.lists &&
        Array.isArray(
          dash.lists.inspectedRooms
        )
          ? dash.lists.inspectedRooms
          : [];

      inspected.forEach(
        inspection => {
          const roomId =
            String(
              inspection.RoomID || ''
            );

          if (!roomId) {
            return;
          }

          const current =
            latestInspectionByRoom.get(
              roomId
            );

          const candidateTime =
            dashboardInspectionTimeMs(
              inspection,
              dateKey
            );

          const currentTime =
            current
              ? dashboardInspectionTimeMs(
                  current.inspection,
                  current.dateKey
                )
              : -1;

          if (
            !current ||
            candidateTime >=
              currentTime
          ) {
            const roomStatus =
              statusByInspection.get(
                String(
                  inspection.InspectionID ||
                  ''
                )
              ) ||
              statusByRoom.get(
                roomId
              ) ||
              null;

            latestInspectionByRoom.set(
              roomId,
              {
                inspection:
                  Object.assign(
                    {},
                    inspection
                  ),
                dateKey,
                roomStatus
              }
            );

            if (roomStatus) {
              latestRoomStatusByRoom.set(
                roomId,
                Object.assign(
                  {},
                  roomStatus
                )
              );
            }
          }
        }
      );
    }
  );


  const inspectedRooms =
    Array.from(
      latestInspectionByRoom.values()
    )
      .map(
        item =>
          Object.assign(
            {},
            item.inspection
          )
      )
      .sort(
        dashboardRoomSortClient
      );


  // --------------------------------------------------
  // ผ่าน / ไม่ผ่าน
  // --------------------------------------------------

  const passedRooms =
    inspectedRooms.filter(
      dashboardInspectionIsPass
    );

  const failedRooms =
    inspectedRooms.filter(
      dashboardInspectionIsFail
    );


  // --------------------------------------------------
  // ปัญหารอแก้ไข / เร่งด่วน
  // --------------------------------------------------

  const openIssueMap =
    new Map();

  const urgentIssueMap =
    new Map();

  dailyData.forEach(
    ({ dash }) => {
      const openIssues =
        dash.lists &&
        Array.isArray(
          dash.lists.openIssues
        )
          ? dash.lists.openIssues
          : [];

      openIssues.forEach(
        issue => {
          const key =
            String(
              issue.DetailID ||
              `${issue.InspectionID || ''}:${issue.ItemName || ''}`
            );

          openIssueMap.set(
            key,
            Object.assign(
              {},
              issue
            )
          );
        }
      );

      const urgentIssues =
        dash.lists &&
        Array.isArray(
          dash.lists.urgentIssues
        )
          ? dash.lists.urgentIssues
          : [];

      urgentIssues.forEach(
        issue => {
          const key =
            String(
              issue.DetailID ||
              `${issue.InspectionID || ''}:${issue.ItemName || ''}`
            );

          urgentIssueMap.set(
            key,
            Object.assign(
              {},
              issue
            )
          );
        }
      );
    }
  );

  const openIssues =
    Array.from(
      openIssueMap.values()
    ).sort(
      dashboardIssueSortClient
    );

  const urgentIssues =
    Array.from(
      urgentIssueMap.values()
    ).sort(
      dashboardIssueSortClient
    );


  // --------------------------------------------------
  // Pending Rooms
  // ใช้ข้อมูล LastInspection ก่อนช่วงจาก Snapshot วันแรก
  // --------------------------------------------------

  const firstPendingMap =
    new Map();

  (
    firstDash.lists &&
    Array.isArray(
      firstDash.lists.pendingRooms
    )
      ? firstDash.lists.pendingRooms
      : []
  ).forEach(
    room => {
      if (room.RoomID) {
        firstPendingMap.set(
          String(room.RoomID),
          room
        );
      }
    }
  );

  const pendingRooms =
    Array.from(
      allRoomsMap.entries()
    )
      .filter(
        ([roomId]) =>
          !latestInspectionByRoom.has(
            roomId
          )
      )
      .map(
        ([roomId, room]) => {
          const previous =
            firstPendingMap.get(
              roomId
            );

          return Object.assign(
            {
              RoomID:
                room.RoomID,
              RoomNumber:
                room.RoomNumber,
              RoomName:
                room.RoomName,
              RoomType:
                room.RoomType,
              AssignedHousekeeper:
                room.AssignedHousekeeper ||
                '',
              CurrentStatus:
                'รอตรวจ',
              LastInspectionID:
                '',
              LastInspectionDate:
                '',
              LastInspectorName:
                '',
              LastScore:
                null,
              LastStatus:
                ''
            },
            previous || {}
          );
        }
      )
      .sort(
        dashboardRoomSortClient
      );


  // --------------------------------------------------
  // Room Status ของช่วงวันที่
  // --------------------------------------------------

  const roomStatuses =
    Array.from(
      allRoomsMap.entries()
    )
      .map(
        ([roomId, room]) => {
          if (
            latestInspectionByRoom.has(
              roomId
            )
          ) {
            const latest =
              latestInspectionByRoom.get(
                roomId
              );

            if (
              latest.roomStatus
            ) {
              return Object.assign(
                {},
                latest.roomStatus
              );
            }

            return dashboardStatusFromInspection(
              latest.inspection,
              room
            );
          }

          return {
            RoomID:
              room.RoomID,
            RoomNumber:
              room.RoomNumber,
            RoomName:
              room.RoomName,
            RoomType:
              room.RoomType,
            StatusCode:
              'PENDING',
            StatusLabel:
              'รอตรวจ',
            FinalScore:
              null,
            HousekeeperName:
              '',
            InspectorName:
              '',
            InspectionDate:
              '',
            StartTime:
              '',
            EndTime:
              '',
            InspectionID:
              ''
          };
        }
      )
      .sort(
        dashboardRoomSortClient
      );


  // --------------------------------------------------
  // KPI / Progress
  // --------------------------------------------------

  const totalRooms =
    allRoomsMap.size ||
    Number(
      latestDash.kpi.totalRooms
    ) ||
    0;

  const inspectedCount =
    inspectedRooms.length;

  const scores =
    inspectedRooms
      .map(
        item =>
          Number(
            item.FinalScore
          )
      )
      .filter(
        score =>
          !isNaN(score)
      );

  const avgScore =
    scores.length
      ? dashboardRound2(
          scores.reduce(
            (sum, score) =>
              sum + score,
            0
          ) / scores.length
        )
      : 0;

  const progressPercent =
    totalRooms
      ? dashboardRound2(
          (
            inspectedCount /
            totalRooms
          ) * 100
        )
      : 0;


  // --------------------------------------------------
  // Category Average
  // รวม Daily Average แบบถ่วงน้ำหนักด้วยจำนวน Inspection ของวัน
  // --------------------------------------------------

  const categoryKeys = [
    'BEDROOM',
    'BATHROOM',
    'AMENITIES',
    'SAFETY',
    'OVERALL'
  ];

  const categoryAccumulator =
    {};

  categoryKeys.forEach(
    key => {
      categoryAccumulator[key] =
        {
          total: 0,
          weight: 0
        };
    }
  );

  dailyData.forEach(
    ({ dash }) => {
      const dailyWeight =
        dashboardDailyInspectionCount(
          dash
        );

      if (!dailyWeight) {
        return;
      }

      categoryKeys.forEach(
        key => {
          const value =
            Number(
              dash.categoryAvg &&
              dash.categoryAvg[key]
            );

          if (!isNaN(value)) {
            categoryAccumulator[
              key
            ].total +=
              value *
              dailyWeight;

            categoryAccumulator[
              key
            ].weight +=
              dailyWeight;
          }
        }
      );
    }
  );

  const categoryAvg = {};

  categoryKeys.forEach(
    key => {
      const acc =
        categoryAccumulator[key];

      categoryAvg[key] =
        acc.weight
          ? dashboardRound2(
              acc.total /
              acc.weight
            )
          : 0;
    }
  );


  // --------------------------------------------------
  // Daily Trend
  // --------------------------------------------------

  const dailyTrend = [];

  dailyData.forEach(
    ({ dateKey, dash }) => {
      const source =
        dash.trends &&
        Array.isArray(
          dash.trends.daily
        )
          ? dash.trends.daily
          : [];

      const pass =
        source.reduce(
          (sum, item) =>
            sum +
            Number(
              item.pass || 0
            ),
          0
        );

      const fail =
        source.reduce(
          (sum, item) =>
            sum +
            Number(
              item.fail || 0
            ),
          0
        );

      if (
        pass ||
        fail
      ) {
        dailyTrend.push({
          label:
            `${dateKey.slice(8, 10)}/${dateKey.slice(5, 7)}`,
          pass,
          fail
        });
      }
    }
  );


  // --------------------------------------------------
  // Top Problem Rooms / Failed Items
  // --------------------------------------------------

  const topProblemRooms =
    dashboardMergeRankCounts(
      dailyData.map(
        item =>
          item.dash.topProblemRooms
      ),
      'room'
    );

  const topFailedItems =
    dashboardMergeRankCounts(
      dailyData.map(
        item =>
          item.dash.topFailedItems
      ),
      'item'
    );


  // --------------------------------------------------
  // Housekeeper Performance
  // --------------------------------------------------

  const housekeeperPerformance =
    dashboardMergeHousekeeperPerformance(
      dailyData.map(
        item =>
          item.dash.housekeeperPerformance
      )
    );


  // --------------------------------------------------
  // Resolution Hours
  // Daily Snapshot ไม่มีจำนวน resolved item
  // จึงใช้ค่าเฉลี่ยของวันที่มีข้อมูล
  // --------------------------------------------------

  const resolutionValues =
    dailyData
      .map(
        item =>
          Number(
            item.dash.avgResolutionHours
          )
      )
      .filter(
        value =>
          !isNaN(value) &&
          value > 0
      );

  const avgResolutionHours =
    resolutionValues.length
      ? dashboardRound2(
          resolutionValues.reduce(
            (sum, value) =>
              sum + value,
            0
          ) /
          resolutionValues.length
        )
      : 0;


  // --------------------------------------------------
  // Meta
  // --------------------------------------------------

  const generatedAt =
    dailyData.reduce(
      (latest, item) => {
        const value =
          String(
            item.dash.meta &&
            item.dash.meta.generatedAt ||
            ''
          );

        return value > latest
          ? value
          : latest;
      },
      ''
    );


  return {
    meta: {
      dateFrom,
      dateTo,
      isToday:
        dateFrom ===
          Utils.todayISO() &&
        dateTo ===
          Utils.todayISO(),
      generatedAt:
        generatedAt ||
        (
          latestDash.meta &&
          latestDash.meta.generatedAt
        ) ||
        '',
      timezone:
        latestDash.meta.timezone ||
        'Asia/Bangkok',
      apiVersion:
        latestDash.meta.apiVersion ||
        '',
      fastPath:
        dateFrom === dateTo,
      cacheHit:
        false,
      firestoreRange:
        true,
      firestoreDocuments:
        dateKeys.length
    },

    kpi: {
      totalRooms,
      inspectedToday:
        inspectedCount,
      notInspectedToday:
        Math.max(
          totalRooms -
          inspectedCount,
          0
        ),
      passCount:
        passedRooms.length,
      failCount:
        failedRooms.length,
      pendingIssues:
        openIssues.length,
      urgentIssues:
        urgentIssues.length,
      avgScoreToday:
        avgScore
    },

    progress: {
      inspected:
        inspectedCount,
      total:
        totalRooms,
      percent:
        progressPercent
    },

    lists: {
      allRooms:
        roomStatuses,
      inspectedRooms,
      pendingRooms,
      passedRooms,
      failedRooms,
      openIssues,
      urgentIssues
    },

    roomStatuses,

    filterOptions:
      latestDash.filterOptions ||
      firstDash.filterOptions ||
      {
        housekeepers: [],
        inspectors: [],
        rooms: [],
        statuses: []
      },

    categoryAvg,

    trends: {
      daily:
        dailyTrend,
      weekly:
        (
          latestDash.trends &&
          Array.isArray(
            latestDash.trends.weekly
          )
        )
          ? latestDash.trends.weekly
          : [],
      monthly:
        (
          latestDash.trends &&
          Array.isArray(
            latestDash.trends.monthly
          )
        )
          ? latestDash.trends.monthly
          : []
    },

    topProblemRooms,
    topFailedItems,
    housekeeperPerformance,
    avgResolutionHours
  };
}


/**
 * เวลา Inspection สำหรับเลือกผลล่าสุดข้ามหลายวัน
 */
function dashboardInspectionTimeMs(
  inspection,
  fallbackDateKey
) {
  const dateKey =
    String(
      inspection &&
      inspection.InspectionDate ||
      fallbackDateKey ||
      ''
    ).slice(0, 10);

  const timeMatch =
    String(
      inspection &&
      (
        inspection.EndTime ||
        inspection.StartTime
      ) ||
      '00:00'
    ).match(
      /(\d{1,2}):(\d{2})/
    );

  const timeText =
    timeMatch
      ? `${String(timeMatch[1]).padStart(2, '0')}:${timeMatch[2]}`
      : '00:00';

  const time =
    new Date(
      `${dateKey}T${timeText}:00+07:00`
    ).getTime();

  return isNaN(time)
    ? 0
    : time;
}


/**
 * Logic ผ่าน/ไม่ผ่านให้ตรงกับ StatusFix ฝั่ง Apps Script
 */
function dashboardInspectionIsPass(item) {
  const currentStatus =
    String(
      item &&
      item.CurrentStatus ||
      ''
    );

  if (
    currentStatus === 'ไม่ผ่าน' ||
    currentStatus === 'รอแก้ไข' ||
    currentStatus === 'เร่งด่วน'
  ) {
    return false;
  }

  const failedCount =
    Number(
      item &&
      item.FailedItemCount ||
      0
    );

  const needsFixCount =
    Number(
      item &&
      item.NeedsFixItemCount ||
      0
    );

  if (
    failedCount > 0 ||
    needsFixCount > 0
  ) {
    return false;
  }

  return [
    'ผ่านมาตรฐาน',
    'ดีเยี่ยม'
  ].includes(
    String(
      item &&
      item.FinalStatus ||
      ''
    )
  );
}


function dashboardInspectionIsFail(item) {
  const currentStatus =
    String(
      item &&
      item.CurrentStatus ||
      ''
    );

  if (
    currentStatus === 'รอแก้ไข'
  ) {
    return false;
  }

  if (
    currentStatus === 'ไม่ผ่าน'
  ) {
    return true;
  }

  if (
    Number(
      item &&
      item.FailedItemCount ||
      0
    ) > 0
  ) {
    return true;
  }

  return (
    String(
      item &&
      item.FinalStatus ||
      ''
    ) === 'ไม่ผ่านมาตรฐาน' &&
    Number(
      item &&
      item.NeedsFixItemCount ||
      0
    ) === 0
  );
}


/**
 * สร้าง Room Status กรณี Snapshot รุ่นเก่าไม่มี roomStatus ที่ตรง Inspection
 */
function dashboardStatusFromInspection(
  inspection,
  room
) {
  let statusCode =
    'FAIL';

  let statusLabel =
    'ไม่ผ่าน';

  if (
    String(
      inspection.CurrentStatus ||
      ''
    ) === 'รอแก้ไข' ||
    Number(
      inspection.NeedsFixItemCount ||
      0
    ) > 0
  ) {
    statusCode =
      'NEEDS_FIX';

    statusLabel =
      'รอแก้ไข';
  } else if (
    dashboardInspectionIsPass(
      inspection
    )
  ) {
    statusCode =
      'PASS';

    statusLabel =
      'ผ่าน';
  }

  if (
    dashboardUrgent(
      inspection.MaxSeverity
    )
  ) {
    statusCode =
      'URGENT';

    statusLabel =
      'เร่งด่วน';
  }

  return {
    RoomID:
      inspection.RoomID ||
      room.RoomID ||
      '',
    RoomNumber:
      inspection.RoomNumber ||
      room.RoomNumber ||
      '',
    RoomName:
      inspection.RoomName ||
      room.RoomName ||
      '',
    RoomType:
      inspection.RoomType ||
      room.RoomType ||
      '',
    StatusCode:
      statusCode,
    StatusLabel:
      statusLabel,
    FinalScore:
      Number(
        inspection.FinalScore
      ) || 0,
    HousekeeperName:
      inspection.HousekeeperName ||
      '',
    InspectorName:
      inspection.InspectorName ||
      '',
    InspectionDate:
      inspection.InspectionDate ||
      '',
    StartTime:
      inspection.StartTime ||
      '',
    EndTime:
      inspection.EndTime ||
      '',
    InspectionID:
      inspection.InspectionID ||
      ''
  };
}


/**
 * จำนวน Inspection ของวันจาก Daily Trend
 * ใช้เป็น Weight รวม Category Average
 */
function dashboardDailyInspectionCount(dash) {
  const daily =
    dash &&
    dash.trends &&
    Array.isArray(
      dash.trends.daily
    )
      ? dash.trends.daily
      : [];

  const count =
    daily.reduce(
      (sum, item) =>
        sum +
        Number(item.pass || 0) +
        Number(item.fail || 0),
      0
    );

  if (count) {
    return count;
  }

  return (
    dash &&
    dash.lists &&
    Array.isArray(
      dash.lists.inspectedRooms
    )
  )
    ? dash.lists.inspectedRooms.length
    : 0;
}


function dashboardMergeRankCounts(
  groups,
  keyField
) {
  const counts =
    new Map();

  (groups || []).forEach(
    group => {
      if (!Array.isArray(group)) {
        return;
      }

      group.forEach(
        item => {
          const key =
            String(
              item &&
              item[keyField] ||
              ''
            );

          if (!key) {
            return;
          }

          counts.set(
            key,
            (
              counts.get(key) ||
              0
            ) +
            Number(
              item.count || 0
            )
          );
        }
      );
    }
  );

  return Array.from(
    counts.entries()
  )
    .map(
      ([key, count]) => ({
        [keyField]: key,
        count
      })
    )
    .sort(
      (a, b) =>
        b.count - a.count
    )
    .slice(0, 10);
}


function dashboardMergeHousekeeperPerformance(
  groups
) {
  const stats =
    new Map();

  (groups || []).forEach(
    group => {
      if (!Array.isArray(group)) {
        return;
      }

      group.forEach(
        item => {
          const name =
            String(
              item &&
              item.name ||
              ''
            ).trim();

          if (!name) {
            return;
          }

          const taskCount =
            Number(
              item.taskCount || 0
            );

          const avgScore =
            Number(
              item.avgScore || 0
            );

          const current =
            stats.get(name) ||
            {
              taskCount: 0,
              weightedScore: 0
            };

          current.taskCount +=
            taskCount;

          current.weightedScore +=
            avgScore *
            taskCount;

          stats.set(
            name,
            current
          );
        }
      );
    }
  );

  return Array.from(
    stats.entries()
  )
    .map(
      ([name, value]) => ({
        name,
        taskCount:
          value.taskCount,
        avgScore:
          value.taskCount
            ? dashboardRound2(
                value.weightedScore /
                value.taskCount
              )
            : 0
      })
    )
    .sort(
      (a, b) =>
        b.taskCount -
        a.taskCount
    );
}


function dashboardRoomSortClient(a, b) {
  const av =
    String(
      a.RoomNumber ||
      a.RoomName ||
      ''
    );

  const bv =
    String(
      b.RoomNumber ||
      b.RoomName ||
      ''
    );

  const aVip =
    /VIP/i.test(av) ||
    /VIP/i.test(
      String(
        a.RoomName || ''
      )
    );

  const bVip =
    /VIP/i.test(bv) ||
    /VIP/i.test(
      String(
        b.RoomName || ''
      )
    );

  if (
    aVip !== bVip
  ) {
    return aVip
      ? 1
      : -1;
  }

  const an =
    Number(
      av.replace(
        /\D/g,
        ''
      )
    );

  const bn =
    Number(
      bv.replace(
        /\D/g,
        ''
      )
    );

  return (
    (
      isNaN(an)
        ? 9999
        : an
    ) -
    (
      isNaN(bn)
        ? 9999
        : bn
    )
  ) ||
    av.localeCompare(
      bv
    );
}


function dashboardIssueSortClient(a, b) {
  const au =
    dashboardUrgent(
      a && a.Severity
    )
      ? 1
      : 0;

  const bu =
    dashboardUrgent(
      b && b.Severity
    )
      ? 1
      : 0;

  if (au !== bu) {
    return bu - au;
  }

  return (
    Number(
      b && b.AgeHours ||
      0
    ) -
    Number(
      a && a.AgeHours ||
      0
    )
  );
}


function dashboardRound2(value) {
  return (
    Math.round(
      (
        Number(value) ||
        0
      ) * 100
    ) / 100
  );
}


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
    const categories = { BEDROOM: 'โซนห้องนอน', BATHROOM: 'โซนห้องน้ำ', AMENITIES: 'โซนบริเวณโรงแรม', SAFETY: 'แจ้งอุปกรณ์เสียหาย', OVERALL: 'ภาพรวมและความพร้อมใช้งาน' };
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
        await DashboardView.loadAdminDashboard(false);
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
function dashboardCategory(category) { return ({ BEDROOM: 'โซนห้องนอน', BATHROOM: 'โซนห้องน้ำ', AMENITIES: 'โซนบริเวณโรงแรม', SAFETY: 'แจ้งอุปกรณ์เสียหาย', OVERALL: 'ภาพรวม' })[category] || category || '-'; }
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
