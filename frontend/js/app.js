/**
 * app.js
 * จุดเริ่มต้นแอปพลิเคชัน: Hash Router, Layout หลัก (Sidebar + Top Navigation),
 * หน้า Login, Dark/Light Mode, และการป้องกันการเข้าหน้าหลักโดยไม่ได้เข้าสู่ระบบ
 */

const Router = {
  currentRoute: null,

  routes: {
    '/login': { view: 'login', roles: null },
    '/': { view: 'home', roles: [] },
    '/dashboard': { view: 'adminDashboard', roles: ['ADMIN'] },
    '/rooms': { view: 'rooms', roles: ['ADMIN', 'INSPECTOR', 'HOUSEKEEPER'] },
    '/inspection/:id': { view: 'inspectionForm', roles: ['ADMIN', 'INSPECTOR', 'HOUSEKEEPER'] },
    '/history': { view: 'history', roles: [] },
    '/inspection-detail/:id': { view: 'inspectionDetail', roles: [] },
    '/issues': { view: 'issues', roles: [] },
    '/admin/users': { view: 'adminUsers', roles: ['ADMIN'] },
    '/admin/rooms': { view: 'adminRooms', roles: ['ADMIN'] },
    '/admin/audit': { view: 'adminAudit', roles: ['ADMIN'] },
    '/settings': { view: 'settings', roles: ['ADMIN'] },
    '/profile': { view: 'profile', roles: [] },
    '/access-denied': { view: 'accessDenied', roles: null },
    '/404': { view: 'notFound', roles: null }
  },

  init() {
    window.addEventListener('hashchange', () => this.handle());
    this.handle();
  },

  reload() { this.handle(true); },

  matchRoute(path) {
    for (const pattern in this.routes) {
      const paramNames = [];
      const regexStr = '^' + pattern.replace(/:[^/]+/g, (m) => { paramNames.push(m.slice(1)); return '([^/]+)'; }) + '$';
      const match = path.match(new RegExp(regexStr));
      if (match) {
        const params = {};
        paramNames.forEach((name, i) => { params[name] = match[i + 1]; });
        return { config: this.routes[pattern], params };
      }
    }
    return null;
  },

  async handle(force) {
    const path = (window.location.hash || '#/').slice(1) || '/';
    if (!force && path === this.currentRoute) return;
    this.currentRoute = path;

    const matched = this.matchRoute(path);
    if (!matched) { window.location.hash = '#/404'; return; }
    const { config, params } = matched;

    if (config.roles !== null) {
      const ok = Auth.guardRoute(config.roles);
      if (!ok) return;
    }

    if (config.view === 'login') {
      if (Auth.getCurrentUser()) { window.location.hash = '#/'; return; }
      AppShell.renderLoginOnly();
      return;
    }

    AppShell.renderLayout();
    const content = document.getElementById('appContent');
    content.innerHTML = '<div class="hci-skeleton-block"></div>'.repeat(3);

    switch (config.view) {
      case 'home': return DashboardView.renderHome(content);
      case 'adminDashboard': return DashboardView.renderAdminDashboard(content);
      case 'rooms': return InspectionView.renderRoomList(content);
      case 'inspectionForm': return InspectionView.renderForm(content, params.id);
      case 'history': return InspectionView.renderHistory(content);
      case 'inspectionDetail': return InspectionView.renderDetail(content, params.id);
      case 'issues': return InspectionView.renderIssues(content);
      case 'adminUsers': return AdminView.renderUsers(content);
      case 'adminRooms': return AdminView.renderRoomsAdmin(content);
      case 'adminAudit': return AdminView.renderAuditLog(content);
      case 'settings': return AdminView.renderSettings(content);
      case 'profile': return AdminView.renderProfile(content);
      case 'accessDenied': return AppShell.renderAccessDenied(content);
      case 'notFound': return AppShell.renderNotFound(content);
    }
  }
};

const AppShell = {
  renderLoginOnly() {
    document.getElementById('root').innerHTML = `
      <div class="hci-login-page">
        <div class="hci-login-card">
          <div class="hci-login-brand">
            <i class="fa-solid fa-gem"></i>
            <h1>${APP_CONFIG.APP_NAME}</h1>
            <p>${APP_CONFIG.APP_NAME_TH}</p>
          </div>
          <form id="loginForm">
            <div class="hci-form-group"><label>ชื่อผู้ใช้งานหรืออีเมล</label><input type="text" name="username" required autocomplete="username"></div>
            <div class="hci-form-group">
              <label>รหัสผ่าน</label>
              <div class="hci-password-wrap">
                <input type="password" name="password" id="loginPassword" required autocomplete="current-password">
                <button type="button" id="togglePwBtn"><i class="fa-regular fa-eye"></i></button>
              </div>
            </div>
            <label class="hci-remember"><input type="checkbox" name="remember"> จดจำการเข้าสู่ระบบ</label>
            <button type="submit" class="hci-btn hci-btn-navy hci-btn-block" id="loginSubmitBtn">
              <span class="btn-label">เข้าสู่ระบบ</span>
            </button>
            <p class="hci-login-error" id="loginError" style="display:none"></p>
          </form>
        </div>
      </div>
    `;
    document.getElementById('togglePwBtn').addEventListener('click', () => {
      const pw = document.getElementById('loginPassword');
      const icon = document.querySelector('#togglePwBtn i');
      const show = pw.type === 'password';
      pw.type = show ? 'text' : 'password';
      icon.className = show ? 'fa-regular fa-eye-slash' : 'fa-regular fa-eye';
    });
    document.getElementById('loginForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = document.getElementById('loginSubmitBtn');
      const errorEl = document.getElementById('loginError');
      errorEl.style.display = 'none';
      btn.disabled = true;
      btn.querySelector('.btn-label').innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> กำลังเข้าสู่ระบบ...';
      try {
        const fd = new FormData(e.target);
        await Auth.login(fd.get('username'), fd.get('password'));
        window.location.hash = '#/';
        Router.reload();
      } catch (err) {
        errorEl.textContent = err.message || 'เข้าสู่ระบบไม่สำเร็จ';
        errorEl.style.display = 'block';
      } finally {
        btn.disabled = false;
        btn.querySelector('.btn-label').textContent = 'เข้าสู่ระบบ';
      }
    });
  },

  renderLayout() {
    const user = Auth.getCurrentUser();
    if (document.getElementById('appShell')) { this.updateActiveNav(); return; }

    document.getElementById('root').innerHTML = `
      <div class="hci-shell" id="appShell">
        <aside class="hci-sidebar" id="sidebar">
          <div class="hci-sidebar-brand">
            <i class="fa-solid fa-gem"></i>
            <span class="hci-brand-text">${APP_CONFIG.APP_NAME}</span>
          </div>
          <nav class="hci-nav" id="sidebarNav"></nav>
          <button class="hci-sidebar-toggle" id="sidebarToggleBtn"><i class="fa-solid fa-angles-left"></i></button>
        </aside>
        <div class="hci-main">
          <header class="hci-topbar">
            <button class="hci-icon-btn" id="mobileMenuBtn"><i class="fa-solid fa-bars"></i></button>
            <div class="hci-topbar-spacer"></div>
            <button class="hci-icon-btn" id="themeToggleBtn"><i class="fa-solid fa-moon"></i></button>
            <div class="hci-notif-wrap">
              <button class="hci-icon-btn" id="notifBtn"><i class="fa-solid fa-bell"></i><span class="hci-notif-dot" id="notifDot" style="display:none"></span></button>
            </div>
            <div class="hci-user-chip" onclick="location.hash='#/profile'">
              <i class="fa-solid fa-circle-user"></i>
              <div><p>${Utils.escapeHtml(user.FullName)}</p><span>${APP_CONFIG.ROLE_LABELS[user.Role]}</span></div>
            </div>
            <button class="hci-icon-btn" id="logoutBtn" title="ออกจากระบบ"><i class="fa-solid fa-right-from-bracket"></i></button>
          </header>
          <main class="hci-content" id="appContent"></main>
        </div>
      </div>
    `;

    this.buildNav(user.Role);
    document.getElementById('logoutBtn').addEventListener('click', async () => {
      if (await Utils.confirm('ออกจากระบบ?', '', 'ออกจากระบบ')) Auth.logout();
    });
    document.getElementById('sidebarToggleBtn').addEventListener('click', () => document.getElementById('sidebar').classList.toggle('collapsed'));
    document.getElementById('mobileMenuBtn').addEventListener('click', () => document.getElementById('sidebar').classList.toggle('open'));
    document.getElementById('themeToggleBtn').addEventListener('click', () => this.toggleTheme());
    this.applyStoredTheme();
    // หน้า Home จะได้ข้อมูลแจ้งเตือนจาก getHomeData อยู่แล้ว ไม่ยิงซ้ำ
    // หน้าอื่นหน่วงเวลาเล็กน้อย ไม่ให้แย่งทรัพยากรกับ API หลักทันทีหลังเปลี่ยนหน้า
    if (Router.currentRoute !== '/') {
      clearTimeout(this._notifRefreshTimer);
      this._notifRefreshTimer = setTimeout(() => this.refreshNotifBadge(), 5000);
    }
  },

  buildNav(role) {
    const items = [
      { hash: '#/', icon: 'fa-house', label: 'หน้าหลัก', roles: null },
      { hash: '#/dashboard', icon: 'fa-chart-line', label: 'Dashboard', roles: ['ADMIN'] },
      { hash: '#/rooms', icon: 'fa-door-open', label: 'ตรวจสอบห้องพัก', roles: ['ADMIN', 'INSPECTOR', 'HOUSEKEEPER'] },
      { hash: '#/history', icon: 'fa-clock-rotate-left', label: 'ประวัติการตรวจสอบ', roles: null },
      { hash: '#/issues', icon: 'fa-screwdriver-wrench', label: 'รายการปัญหา', roles: null },
      { hash: '#/admin/users', icon: 'fa-users', label: 'จัดการพนักงาน', roles: ['ADMIN'] },
      { hash: '#/admin/rooms', icon: 'fa-hotel', label: 'จัดการห้องพัก', roles: ['ADMIN'] },
      { hash: '#/admin/audit', icon: 'fa-file-shield', label: 'Audit Log', roles: ['ADMIN'] },
      { hash: '#/settings', icon: 'fa-gear', label: 'ตั้งค่าระบบ', roles: ['ADMIN'] },
      { hash: '#/profile', icon: 'fa-id-card', label: 'โปรไฟล์', roles: null }
    ];
    const nav = document.getElementById('sidebarNav');
    nav.innerHTML = items.filter(i => !i.roles || i.roles.indexOf(role) !== -1).map(i =>
      `<a href="${i.hash}" class="hci-nav-item" data-hash="${i.hash}"><i class="fa-solid ${i.icon}"></i><span>${i.label}</span></a>`
    ).join('');
    this.updateActiveNav();
  },

  updateActiveNav() {
    const current = window.location.hash || '#/';
    document.querySelectorAll('.hci-nav-item').forEach(a => {
      a.classList.toggle('active', a.dataset.hash === current || (a.dataset.hash !== '#/' && current.startsWith(a.dataset.hash)));
    });
  },

  toggleTheme() {
    const isDark = document.documentElement.classList.toggle('dark');
    document.getElementById('themeToggleBtn').innerHTML = isDark ? '<i class="fa-solid fa-sun"></i>' : '<i class="fa-solid fa-moon"></i>';
    sessionStorage.setItem('hci_theme', isDark ? 'dark' : 'light');
  },
  applyStoredTheme() {
    const theme = sessionStorage.getItem('hci_theme');
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
      const btn = document.getElementById('themeToggleBtn');
      if (btn) btn.innerHTML = '<i class="fa-solid fa-sun"></i>';
    }
  },

  async refreshNotifBadge() {
    try {
      const data = await Api.call('getNotifications', {}, { silent: true });
      this.applyNotifBadge(data);
    } catch (e) { /* เพิกเฉยหาก session หมดอายุ จะถูกจัดการที่ Api.call แล้ว */ }
  },

  applyNotifBadge(data) {
    const dot = document.getElementById('notifDot');
    const count = Number(data && data.totalCount) || 0;
    if (dot) dot.style.display = count > 0 ? 'flex' : 'none';
    if (dot && count > 0) dot.textContent = count > 9 ? '9+' : count;
  },

  renderAccessDenied(container) {
    container.innerHTML = `<div class="hci-error-state"><i class="fa-solid fa-lock"></i><p>คุณไม่มีสิทธิ์เข้าถึงหน้านี้</p><button class="hci-btn hci-btn-navy" onclick="location.hash='#/'">กลับหน้าหลัก</button></div>`;
  },
  renderNotFound(container) {
    container.innerHTML = `<div class="hci-error-state"><i class="fa-solid fa-map-signs"></i><p>ไม่พบหน้าที่ต้องการ (404)</p><button class="hci-btn hci-btn-navy" onclick="location.hash='#/'">กลับหน้าหลัก</button></div>`;
  }
};

// ตรวจวันใหม่ทุก 60 วินาที เพื่อไม่ให้เครื่องหมายสถานะของเมื่อวานค้างบนหน้าจอ
const DayBoundaryWatcher = {
  currentDate: null,
  timer: null,

  init() {
    this.currentDate = Utils.todayISO();
    this.timer = setInterval(() => this.check(), 60000);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) this.check();
    });
  },

  check() {
    const today = Utils.todayISO();
    if (today === this.currentDate) return;
    this.currentDate = today;
    Router.currentRoute = null;
    Router.reload();
  }
};

// ==================== เริ่มต้นแอปพลิเคชัน ====================
(async function bootstrap() {
  const root = document.getElementById('root');
  root.innerHTML = '<div class="hci-boot-loading"><div class="hci-spinner"></div></div>';
  const hasValidSession = await Auth.verify();
  if (!hasValidSession && window.location.hash !== '#/login') {
    window.location.hash = '#/login';
  }
  Router.init();
  DayBoundaryWatcher.init();
})();
