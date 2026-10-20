(() => {
  'use strict';

  const TOKEN_KEY = 'attendance.token';
  // When the page is opened from VS Code Live Server (port 5500) the API lives on the Node server.
  const API_BASE = location.port === '5500' ? 'http://localhost:3000' : '';
  const $ = (id) => document.getElementById(id);
  const { t } = I18N;
  $('connectLink').href = `${API_BASE}/connect`;

  const state = {
    user: null,
    employees: [],
    stats: null,
    trend: null,
    records: [],
    monthly: null,
    requests: [],
    editingId: null,
  };

  /* ---------------- helpers ---------------- */

  // Small DOM builder. All text goes through textContent, never innerHTML.
  function h(tag, props = {}, ...children) {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value == null || value === false) continue;
      if (key === 'class') el.className = value;
      else if (key === 'dataset') Object.assign(el.dataset, value);
      else if (key in el) el[key] = value;
      else el.setAttribute(key, value);
    }
    el.append(...children.filter((c) => c != null));
    return el;
  }

  const getToken = () => localStorage.getItem(TOKEN_KEY);

  async function api(path, { method = 'GET', body } = {}) {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;

    let res;
    try {
      res = await fetch(`${API_BASE}/api${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new Error(t('Cannot reach the server. Is it running? (npm start)'));
    }
    const data = res.status === 204 ? null : await res.json().catch(() => null);

    if (res.status === 401 && path !== '/auth/login') {
      signOut();
      throw new Error(t('Session expired. Please sign in again.'));
    }
    if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
    return data;
  }

  function saveBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = h('a', { href: url, download: filename });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // Authenticated file download (a plain <a href> can't send the bearer token).
  async function download(path, filename) {
    let res;
    try {
      res = await fetch(`${API_BASE}/api${path}`, { headers: { Authorization: `Bearer ${getToken()}` } });
    } catch {
      throw new Error(t('Cannot reach the server. Is it running? (npm start)'));
    }
    if (res.status === 401) {
      signOut();
      throw new Error(t('Session expired. Please sign in again.'));
    }
    if (!res.ok) throw new Error(`Download failed (${res.status})`);
    saveBlob(await res.blob(), filename);
  }

  // Quotes CSV cells and neutralises spreadsheet formulas in text.
  function csvCell(value) {
    if (value === null || value === undefined) return '';
    let text = String(value);
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }
  function downloadCsv(filename, rows) {
    const text = `﻿${rows.map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;
    saveBlob(new Blob([text], { type: 'text/csv;charset=utf-8' }), filename);
  }

  const pad2 = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

  let toastTimer;
  function toast(message, type = 'success') {
    const el = $('toast');
    el.textContent = message;
    el.className = `toast ${type}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('hidden'), 3500);
  }

  // Dates and times are shown on the Ethiopian calendar/clock, with the Gregorian equivalent underneath.
  const dualNodes = ({ eth, greg }) => [eth, h('small', { class: 'sub' }, greg)];
  const fmtDateTime = (iso) => (iso ? dualNodes(I18N.instantParts(iso)) : ['—']);
  const fmtDate = (ymd) => {
    const { eth, greg } = I18N.dateParts(ymd);
    return `${eth} (${greg})`;
  };
  const fmtDateCell = (ymd) => dualNodes(I18N.dateParts(ymd));
  const fmtHours = (hours) => (hours == null ? '—' : `${hours.toFixed(2)}h`);

  const initials = (name) =>
    name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');

  /* ---------------- screens & auth ---------------- */

  function showScreen(name) {
    $('loginScreen').classList.toggle('hidden', name !== 'login');
    $('dashboardScreen').classList.toggle('hidden', name !== 'dashboard');
  }

  function signOut() {
    localStorage.removeItem(TOKEN_KEY);
    state.user = null;
    delete document.body.dataset.role;
    delete document.body.dataset.filter;
    showScreen('login');
  }

  async function enterDashboard(user) {
    state.user = user;
    document.body.dataset.role = user.role;
    document.body.dataset.filter = user.canFilterReports ? '1' : '0';
    $('welcomeName').textContent = user.name;
    showScreen('dashboard');
    hideEmployeeForm();
    await refresh();
  }

  $('loginForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = $('loginBtn');
    const message = $('loginMessage');
    message.textContent = '';
    button.disabled = true;
    try {
      const { token, user } = await api('/auth/login', {
        method: 'POST',
        body: { username: $('username').value, password: $('password').value },
      });
      localStorage.setItem(TOKEN_KEY, token);
      $('loginForm').reset();
      await enterDashboard(user);
    } catch (err) {
      message.textContent = err.message;
    } finally {
      button.disabled = false;
    }
  });

  $('logoutBtn').addEventListener('click', signOut);

  /* ---------------- data loading ---------------- */

  const isAdmin = () => state.user?.role === 'admin';
  const canFilter = () => !!state.user?.canFilterReports;

  async function refresh() {
    const recordQuery = recordFilters();
    const status = $('attendanceStatusFilter').value;
    if (canFilter() && status !== 'all') recordQuery.set('status', status);
    const reportQuery = new URLSearchParams(recordQuery);

    if (!$('monthInput').value) $('monthInput').value = ymd(new Date()).slice(0, 7);

    try {
      const [employees, stats, trend, records, report, monthly, requests] = await Promise.all([
        api('/employees'),
        api('/attendance/stats'),
        api('/attendance/trend?days=7'),
        api(`/attendance?${recordQuery}`),
        api(`/attendance/report?${reportQuery}`),
        api(`/attendance/monthly?month=${$('monthInput').value}`),
        api('/requests'),
      ]);
      state.requests = requests;
      state.employees = employees;
      state.stats = stats;
      state.trend = trend;
      state.records = records;
      state.monthly = monthly;
      if (stats.now) clockOffset = Date.parse(stats.now) - Date.now();
      renderSelectors();
      renderEmployees();
      renderStats();
      renderSchedule();
      renderOverview();
      renderTrend();
      renderTeam();
      renderStatusBadge();
      renderRecords($('attendanceTableBody'), records, 'No attendance records for this filter.', true);
      renderReport(report);
      renderMonthly(monthly);
      renderRequests();
    } catch (err) {
      if (state.user) toast(err.message, 'error');
    }
  }

  // Employee + date-range filters shared by the records table and the CSV export.
  function recordFilters() {
    const query = new URLSearchParams();
    const employee = $('employeeFilter').value;
    if (isAdmin() && employee !== 'all') query.set('employeeId', employee);
    if (canFilter() && $('dateFrom').value) query.set('from', $('dateFrom').value);
    if (canFilter() && $('dateTo').value) query.set('to', $('dateTo').value);
    return query;
  }

  /* ---------------- rendering ---------------- */

  function fillSelect(select, options, keepValue) {
    select.replaceChildren(...options.map(({ value, label }) => h('option', { value }, label)));
    if (options.some((o) => String(o.value) === keepValue)) select.value = keepValue;
  }

  function renderSelectors() {
    const people = state.employees.map((e) => ({ value: String(e.id), label: e.name }));
    fillSelect($('attendanceEmployeeSelect'), people, $('attendanceEmployeeSelect').value);
    fillSelect(
      $('employeeFilter'),
      [{ value: 'all', label: t('All Employees') }, ...people],
      $('employeeFilter').value,
    );
  }

  function renderEmployees() {
    const body = $('employeeTableBody');
    if (!state.employees.length) {
      body.replaceChildren(
        h('tr', {}, h('td', { colspan: 6, class: 'empty-state' }, t('No employees yet. Add your first one.'))),
      );
      return;
    }
    body.replaceChildren(
      ...state.employees.map((e) => {
        return h(
          'tr',
          {},
          h('td', {}, avatarFor(e)),
          h('td', {}, e.name),
          h('td', {}, e.email),
          h('td', {}, e.role),
          h('td', {}, e.idCard),
          h(
            'td',
            { class: 'employee-actions' },
            h('button', { class: 'edit-btn', type: 'button', dataset: { id: e.id } }, t('Edit')),
            h('button', { class: 'delete-btn', type: 'button', dataset: { id: e.id } }, t('Delete')),
          ),
        );
      }),
    );
  }

  function avatarFor(e) {
    return e.photo
      ? h('img', { class: 'employee-avatar', src: e.photo, alt: e.name })
      : h('div', { class: 'employee-avatar', 'aria-hidden': 'true' }, initials(e.name));
  }

  function renderStats() {
    $('totalEmployees').textContent = state.stats.totalEmployees;
    $('presentDays').textContent = state.stats.presentToday;
    $('lateCount').textContent = state.stats.lateToday;
    $('permissionCount').textContent = state.stats.permissionToday;
    $('fieldworkCount').textContent = state.stats.fieldworkToday;
    $('absentCount').textContent = state.stats.absentToday;
  }

  /* ---------------- charts ---------------- */

  const SVG_NS = 'http://www.w3.org/2000/svg';
  function s(tag, attrs = {}, ...children) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attrs)) if (value != null) el.setAttribute(key, value);
    el.append(...children);
    return el;
  }

  const tip = $('chartTip');
  function placeTip(event) {
    const x = Math.min(event.clientX + 14, window.innerWidth - tip.offsetWidth - 8);
    const y = Math.min(event.clientY + 14, window.innerHeight - tip.offsetHeight - 8);
    tip.style.left = `${Math.max(8, x)}px`;
    tip.style.top = `${Math.max(8, y)}px`;
  }
  // rows: [swatchClass | null, label, value]
  function bindTip(el, title, rows) {
    const show = (event) => {
      tip.replaceChildren(
        h('strong', {}, title),
        ...rows.map(([cls, label, value]) =>
          h('div', { class: 'row' }, cls ? h('span', { class: `swatch ${cls}` }) : null, `${label}: ${value}`),
        ),
      );
      tip.classList.remove('hidden');
      placeTip(event);
    };
    el.addEventListener('mouseenter', show);
    el.addEventListener('mousemove', placeTip);
    el.addEventListener('mouseleave', () => tip.classList.add('hidden'));
  }

  const STATUS_SERIES = [
    { cls: 'ontime', label: t('On time') },
    { cls: 'late', label: t('Late') },
  ];

  function legendItems(items) {
    return items.map(({ cls, label, n }) =>
      h('li', {}, h('span', { class: `swatch ${cls}` }), label, n == null ? null : h('strong', {}, n)),
    );
  }

  const dayName = (d) => I18N.dayName(d, true);

  // [1,2,3,4,5,6] -> "Mon–Sat"; [1,2,3,5] -> "Mon–Wed, Fri"
  function describeDays(days) {
    const order = [1, 2, 3, 4, 5, 6, 0].filter((d) => days.includes(d));
    if (!order.length) return t('no work days');
    const runs = [];
    for (const d of order) {
      const last = runs.at(-1);
      if (last && order.indexOf(d) === order.indexOf(last[1]) + 1) last[1] = d;
      else runs.push([d, d]);
    }
    return runs.map(([a, b]) => (a === b ? dayName(a) : `${dayName(a)}–${dayName(b)}`)).join(', ');
  }

  function renderSchedule() {
    const { workStart, workEnd, workEndSat, workDays, workday } = state.stats;
    const clock = I18N.scheduleTime;
    const saturday = workDays.includes(6) && workEndSat !== workEnd ? ` · ${t('Sat until')} ${clock(workEndSat)}` : '';
    $('scheduleText').textContent =
      `${t('Work hours')} ${clock(workStart)}–${clock(workEnd)} · ${describeDays(workDays)}${saturday}` +
      `${workday ? '' : ` · ${t('day off today')}`} (${t('Ethiopian time')})`;
  }

  function renderOverview() {
    const { totalEmployees: total, presentToday, lateToday, permissionToday, fieldworkToday, absentToday, workday } = state.stats;
    const parts = [
      { cls: 'ontime', label: t('On time'), n: presentToday - lateToday },
      { cls: 'late', label: t('Late'), n: lateToday },
      { cls: 'permission', label: t('Permission'), n: permissionToday },
      { cls: 'fieldwork', label: t('FieldWork'), n: fieldworkToday },
      { cls: 'pending', label: t('Not in yet'), n: absentToday }, // 0 on a day off
    ];
    const am = I18N.isAm();

    $('rateFigure').textContent = total && workday ? `${Math.round((presentToday / total) * 100)}%` : '—';
    if (!total) $('rateCaption').textContent = t('No employees yet');
    else if (!workday) {
      $('rateCaption').textContent = presentToday
        ? am ? `የዕረፍት ቀን · ${presentToday} ሰው ገብተዋል` : `Day off · ${presentToday} checked in anyway`
        : t('Day off · no attendance expected');
    } else {
      $('rateCaption').textContent = am
        ? `ከ${total} ሠራተኞች ${presentToday} ገብተዋል`
        : `${presentToday} of ${total} ${total === 1 ? 'employee has' : 'employees have'} checked in`;
    }

    const visible = parts.filter((p) => p.n > 0);
    $('todayBar').replaceChildren(
      ...(visible.length ? visible : [{ ...parts.at(-1), n: 1 }]).map((p) => {
        const seg = h('div', { class: `seg ${p.cls}` });
        seg.style.flex = `${p.n} 1 0`;
        if (total) bindTip(seg, p.label, [[p.cls, t('Employees'), p.n]]);
        return seg;
      }),
    );
    $('todayLegend').replaceChildren(...legendItems(parts));

    const records = state.stats.today;
    if (!records.length) {
      $('todayFacts').replaceChildren(h('div', {}, h('dt', {}, t('Nobody has checked in yet'))));
      return;
    }
    const first = records.reduce((a, b) => (a.checkIn <= b.checkIn ? a : b));
    const minutes = records.map((r) => {
      const a = I18N.addis(new Date(r.checkIn));
      return a.h * 60 + a.mi;
    });
    const avg = Math.round(minutes.reduce((a, b) => a + b, 0) / minutes.length);
    const fact = (label, value) => h('div', {}, h('dt', {}, label), h('dd', {}, value));
    $('todayFacts').replaceChildren(
      fact(t('First in'), `${first.employeeName} · ${fmtTime(first.checkIn)}`),
      fact(t('Average arrival'), I18N.ethClock(Math.floor(avg / 60), avg % 60)),
      fact(t('Still in the office'), String(records.filter((r) => !r.checkOut).length)),
    );
  }

  // Round the axis up to a tidy step so ticks land on whole people (0, 2, 4...).
  function niceStep(top) {
    const raw = top / 4;
    return [1, 2, 5, 10, 20, 50, 100, 200, 500].find((n) => n >= raw) ?? 1000;
  }

  // Column with a 4px rounded top (when it is the top of the stack) and a square base.
  function columnPath(x, y, w, hgt, roundTop) {
    const r = Math.min(4, hgt, w / 2);
    if (!roundTop) return `M${x},${y}h${w}v${hgt}h${-w}Z`;
    return `M${x},${y + hgt}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + hgt}Z`;
  }

  function renderTrend() {
    const { days, totalEmployees } = state.trend;
    // Draw at the real pixel width so axis text stays 11px on phones instead of scaling down.
    const W = Math.max(260, $('trendChart').clientWidth || 560);
    const H = 220;
    const m = { t: 16, r: 8, b: 28, l: 30 };
    const plotW = W - m.l - m.r;
    const plotH = H - m.t - m.b;
    const totals = days.map((d) => d.onTime + d.late);
    const top = Math.max(1, totalEmployees, ...totals);
    const step = niceStep(top);
    const yMax = Math.ceil(top / step) * step;
    const y = (v) => m.t + plotH - (v / yMax) * plotH;
    const band = plotW / days.length;
    const barW = Math.min(24, band * 0.6);

    const svg = s('svg', {
      viewBox: `0 0 ${W} ${H}`,
      role: 'img',
      'aria-label': `Check-ins per day: ${days.map((d, i) => `${d.date} ${totals[i]}`).join(', ')}`,
    });

    for (let v = 0; v <= yMax; v += step) {
      svg.append(
        s('line', { class: v === 0 ? 'axis' : 'grid', x1: m.l, x2: W - m.r, y1: y(v), y2: y(v) }),
        s('text', { x: m.l - 6, y: y(v) + 4, 'text-anchor': 'end' }, String(v)),
      );
    }
    if (!totals.some(Boolean)) {
      svg.append(s('text', { class: 'chart-empty', x: W / 2, y: m.t + plotH / 2 }, t('No check-ins in the last 7 days')));
    }

    days.forEach((d, i) => {
      const bandX = m.l + band * i;
      const x = bandX + (band - barW) / 2;
      const isToday = i === days.length - 1;
      const { wd, eth: ethDay } = I18N.dateParts(d.date);

      // Bottom segment = on time, top = late, separated by a 2px surface gap.
      const hOn = (d.onTime / yMax) * plotH;
      const hLate = (d.late / yMax) * plotH;
      if (d.onTime) svg.append(s('path', { class: 'bar ontime', d: columnPath(x, y(0) - hOn, barW, hOn, !d.late) }));
      if (d.late) {
        const gap = d.onTime ? 2 : 0;
        const hgt = Math.max(hLate - gap, 2);
        svg.append(s('path', { class: 'bar late', d: columnPath(x, y(0) - hOn - hLate, barW, hgt, true) }));
      }
      if (isToday && totals[i]) {
        svg.append(
          s('text', { class: 'today-label', x: x + barW / 2, y: y(totals[i]) - 6, 'text-anchor': 'middle' }, String(totals[i])),
        );
      }

      const label = isToday
        ? t('Today')
        : band < 56
          ? I18N.dayName(wd, true)
          : `${I18N.dayName(wd, true)} ${ethDay.split(' ')[1].replace(',', '')}`;
      svg.append(
        s(
          'text',
          {
            class: isToday ? 'today-label' : d.workday ? null : 'off-label',
            x: bandX + band / 2,
            y: H - 8,
            'text-anchor': 'middle',
          },
          d.workday || isToday ? label : `${label}${band < 56 ? '' : I18N.isAm() ? ' (ዕረፍት)' : ' (off)'}`,
        ),
      );

      const hit = s('rect', { class: 'hit', x: bandX, y: m.t, width: band, height: plotH });
      bindTip(hit, `${I18N.dayName(wd)}, ${ethDay}`, [
        ['ontime', t('On time'), d.onTime],
        ['late', t('Late'), d.late],
        [null, t('Total'), totals[i]],
      ]);
      svg.append(hit);
    });

    $('trendChart').replaceChildren(svg);
    $('trendLegend').replaceChildren(...legendItems(STATUS_SERIES));
    $('trendTableBody').replaceChildren(
      ...days
        .map((d, i) =>
          h('tr', {}, h('td', {}, ...fmtDateCell(d.date)), h('td', {}, d.onTime), h('td', {}, d.late), h('td', {}, totals[i])),
        )
        .reverse(),
    );
  }

  $('trendViewBtn').addEventListener('click', () => {
    const showTable = $('trendTableWrap').hidden;
    $('trendTableWrap').hidden = !showTable;
    $('trendChart').hidden = showTable;
    $('trendViewBtn').textContent = t(showTable ? 'View as chart' : 'View as table');
    $('trendViewBtn').setAttribute('aria-pressed', String(showTable));
    if (!showTable) renderTrend(); // the chart had no width while hidden
  });

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (state.trend && !$('trendChart').hidden && state.user) renderTrend();
    }, 150);
  });

  const fmtTime = (iso) => I18N.timeOnly(iso);

  function renderTeam() {
    const today = new Map(state.stats.today.map((r) => [r.employeeId, r]));
    // In the office first, then left, then not arrived.
    const rank = (e) => {
      const r = today.get(e.id);
      return !r ? 2 : r.checkOut ? 1 : 0;
    };
    const people = [...state.employees].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));

    $('teamGrid').replaceChildren(
      ...people.map((e) => {
        const r = today.get(e.id);
        let dot = 'none';
        let text = t('Not in yet');
        if (r?.status === 'permission') {
          dot = 'permission';
          text = t('Permission');
        } else if (r?.status === 'fieldwork') {
          dot = 'fieldwork';
          text = t('FieldWork');
        } else if (r && r.checkOut) {
          dot = 'out';
          text = `${t('Left at')} ${fmtTime(r.checkOut)}`;
        } else if (r) {
          dot = r.status === 'late' ? 'late' : 'in';
          text = `${t('In since')} ${fmtTime(r.checkIn)}${r.status === 'late' ? ` (${t('late')})` : ''}`;
        }
        return h(
          'div',
          { class: 'team-card' },
          avatarFor(e),
          h('div', { class: 'who' }, h('strong', {}, e.name), h('span', { class: 'state' }, h('span', { class: `dot ${dot}` }), text)),
        );
      }),
    );
  }

  function renderStatusBadge() {
    const id = Number($('attendanceEmployeeSelect').value);
    const record = state.stats.today.find((r) => r.employeeId === id);
    const badge = $('statusBadge');
    if (!record) badge.textContent = t('Not checked in');
    else if (record.status === 'permission' || record.status === 'fieldwork') badge.textContent = t(record.status);
    else if (record.checkOut) badge.textContent = t('Checked out');
    else badge.textContent = t(record.status === 'late' ? 'Checked in (late)' : 'Checked in');

    $('checkInBtn').disabled = Boolean(record);
    $('checkOutBtn').disabled = !record || !record.checkIn || Boolean(record.checkOut);
    $('fieldworkBtn').disabled = !id;
    $('fieldworkBtn').textContent = t(state.stats.fieldworkEmployeeIds.includes(id) ? 'Clear FieldWork' : 'Mark FieldWork');
    $('permissionBtn').disabled = !id;
    $('permissionBtn').textContent = t(state.stats.manualPermissionEmployeeIds.includes(id) ? 'Clear Permission' : 'Mark Permission');
  }

  // `withActions` adds Edit (everyone) and Delete (admin-only) buttons (only real records have an id to act on).
  function renderRecords(body, records, emptyText, withActions = false) {
    if (!records.length) {
      body.replaceChildren(h('tr', {}, h('td', { colspan: withActions ? 7 : 6, class: 'empty-state' }, t(emptyText))));
      return;
    }
    body.replaceChildren(
      ...records.map((r) =>
        h(
          'tr',
          {},
          h('td', {}, r.employeeName),
          h('td', {}, ...fmtDateCell(r.date)),
          h('td', {}, ...fmtDateTime(r.checkIn)),
          h(
            'td',
            {},
            ...fmtDateTime(r.checkOut),
            r.earlyLeave
              ? h('span', { class: 'pill early', title: t('Left before the end of the work day') }, t('early'))
              : null,
          ),
          h('td', {}, fmtHours(r.hours)),
          h('td', {}, h('span', { class: `pill ${r.status}` }, t(r.status))),
          withActions
            ? h(
                'td',
                { class: 'row-actions' },
                ...(r.id
                  ? [
                      h('button', { class: 'edit-btn', type: 'button', dataset: { recordId: r.id } }, t('Edit')),
                      h('button', { class: 'delete-btn admin-only', type: 'button', dataset: { recordId: r.id } }, t('Delete')),
                    ]
                  : []),
              )
            : null,
        ),
      ),
    );
  }

  function renderMonthly({ month, rows }) {
    const [y, m] = month.split('-').map(Number);
    const label = new Date(y, m - 1, 1).toLocaleDateString([], { month: 'long', year: 'numeric' });
    const totalDays = rows.reduce((sum, r) => sum + r.daysWorked, 0);
    $('monthlyCaption').textContent = I18N.isAm()
      ? `${label} · በጠቅላላው ${totalDays} የመግቢያ ቀናት`
      : `${label} · ${totalDays} check-in day${totalDays === 1 ? '' : 's'} in total`;

    if (!rows.length) {
      $('monthlyBody').replaceChildren(h('tr', {}, h('td', { colspan: 7, class: 'empty-state' }, t('No employees yet.'))));
      return;
    }
    $('monthlyBody').replaceChildren(
      ...rows.map((r) =>
        h(
          'tr',
          {},
          h('td', {}, r.employeeName),
          h('td', {}, r.daysWorked),
          h('td', {}, r.onTime),
          h('td', {}, r.late),
          h('td', {}, r.absentDays),
          h('td', {}, r.totalHours ? fmtHours(r.totalHours) : '—'),
          h('td', {}, r.averageHours ? fmtHours(r.averageHours) : '—'),
        ),
      ),
    );
  }

  function renderReport({ summary, records }) {
    $('reportTotal').textContent = summary.total;
    $('reportPresent').textContent = summary.present;
    $('reportLate').textContent = summary.late;
    $('reportAverage').textContent = `${summary.averageHours.toFixed(1)}h`;
    renderRecords($('attendanceReportBody'), records, 'No attendance report data.');
  }

  /* ---------------- clock ---------------- */

  // Real time from the server's clock (offset learned from /attendance/stats), shown in Addis Ababa time.
  let clockOffset = 0;

  function tick() {
    const now = new Date(Date.now() + clockOffset);
    const a = I18N.addis(now);
    const eth = I18N.gregorianToEthiopian(a.y, a.m, a.d);
    $('todayDate').textContent = I18N.ethDateText(eth, a.wd);
    $('todayTime').textContent = I18N.ethClock(a.h, a.mi, a.s);
    const pad = (n) => String(n).padStart(2, '0');
    $('todayGreg').textContent =
      `${t('Gregorian')}: ${I18N.gregDateText(a.y, a.m, a.d, a.wd)} · ${pad(a.h)}:${pad(a.mi)}:${pad(a.s)}`;
  }
  setInterval(tick, 1000);
  tick();

  /* ---------------- attendance actions ---------------- */

  async function mark(action) {
    const employeeId = Number($('attendanceEmployeeSelect').value);
    if (!employeeId) return toast(t('Select an employee first'), 'error');
    try {
      const record = await api(`/attendance/${action}`, { method: 'POST', body: { employeeId } });
      const verb = action === 'check-in' ? t('Checked in') : t('Checked out');
      toast(`${record.employeeName} · ${verb.toLowerCase()}`);
      await refresh();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function toggleFieldwork() {
    const employeeId = Number($('attendanceEmployeeSelect').value);
    if (!employeeId) return toast(t('Select an employee first'), 'error');
    const fieldwork = !state.stats.fieldworkEmployeeIds.includes(employeeId);
    try {
      await api('/attendance/fieldwork', { method: 'POST', body: { employeeId, fieldwork } });
      await refresh();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function togglePermission() {
    const employeeId = Number($('attendanceEmployeeSelect').value);
    if (!employeeId) return toast(t('Select an employee first'), 'error');
    const permission = !state.stats.manualPermissionEmployeeIds.includes(employeeId);
    try {
      await api('/attendance/permission', { method: 'POST', body: { employeeId, permission } });
      await refresh();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  $('checkInBtn').addEventListener('click', () => mark('check-in'));
  $('checkOutBtn').addEventListener('click', () => mark('check-out'));
  $('fieldworkBtn').addEventListener('click', toggleFieldwork);
  $('permissionBtn').addEventListener('click', togglePermission);
  $('attendanceEmployeeSelect').addEventListener('change', renderStatusBadge);
  $('attendanceStatusFilter').addEventListener('change', refresh);
  $('employeeFilter').addEventListener('change', refresh);
  $('monthInput').addEventListener('change', refresh);

  /* ---------------- date range, exports ---------------- */

  function presetRange(preset) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    switch (preset) {
      case 'today':
        return [ymd(today), ymd(today)];
      case 'week':
        return [ymd(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6)), ymd(today)];
      case 'month':
        return [ymd(new Date(today.getFullYear(), today.getMonth(), 1)), ymd(today)];
      case 'lastMonth':
        return [
          ymd(new Date(today.getFullYear(), today.getMonth() - 1, 1)),
          ymd(new Date(today.getFullYear(), today.getMonth(), 0)),
        ];
      default:
        return ['', ''];
    }
  }

  $('rangePreset').addEventListener('change', () => {
    const preset = $('rangePreset').value;
    if (preset !== 'custom') [$('dateFrom').value, $('dateTo').value] = presetRange(preset);
    refresh();
  });
  for (const id of ['dateFrom', 'dateTo']) {
    $(id).addEventListener('change', () => {
      $('rangePreset').value = 'custom';
      refresh();
    });
  }

  $('exportBtn').addEventListener('click', async () => {
    try {
      await download(`/attendance/export.csv?${recordFilters()}`, `attendance-${ymd(new Date())}.csv`);
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  $('reportDownloadBtn').addEventListener('click', async () => {
    const button = $('reportDownloadBtn');
    const period = $('reportPeriod').value;
    const format = $('reportFormat').value;
    button.disabled = true;
    try {
      await download(`/attendance/report/download?period=${period}&format=${format}`, `attendance-${period}-${ymd(new Date())}.${format}`);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      button.disabled = false;
    }
  });

  $('monthlyExportBtn').addEventListener('click', () => {
    if (!state.monthly) return;
    const header = ['Employee', 'Days worked', 'On time', 'Late', 'Absent days', 'Total hours', 'Avg hours per day'];
    const rows = state.monthly.rows.map((r) => [
      r.employeeName, r.daysWorked, r.onTime, r.late, r.absentDays, r.totalHours, r.averageHours,
    ]);
    downloadCsv(`monthly-${state.monthly.month}.csv`, [header, ...rows]);
  });

  /* ---------------- edit / delete a record (admin) ---------------- */

  const recordDialog = $('recordDialog');
  let editingRecord = null;
  const toLocalInput = (iso) => {
    const d = new Date(iso);
    return `${ymd(d)}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  };

  $('attendanceTableBody').addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-record-id]');
    if (!button) return;
    const record = state.records.find((r) => r.id === Number(button.dataset.recordId));
    if (!record) return;

    if (button.classList.contains('edit-btn')) {
      editingRecord = record;
      $('recordWho').textContent = `${record.employeeName} · ${fmtDate(record.date)}`;
      $('recordCheckIn').value = toLocalInput(record.checkIn);
      $('recordCheckOut').value = record.checkOut ? toLocalInput(record.checkOut) : '';
      $('recordMessage').textContent = '';
      recordDialog.showModal();
    } else if (
      confirm(
        I18N.isAm()
          ? `የ${record.employeeName}ን የ${fmtDate(record.date)} መዝገብ ይሰረዝ?`
          : `Delete ${record.employeeName}'s record for ${fmtDate(record.date)}?`,
      )
    ) {
      try {
        await api(`/attendance/${record.id}`, { method: 'DELETE' });
        toast(t('Record deleted'));
        await refresh();
      } catch (err) {
        toast(err.message, 'error');
      }
    }
  });

  $('recordForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = $('recordSubmitBtn');
    submit.disabled = true;
    try {
      const out = $('recordCheckOut').value;
      await api(`/attendance/${editingRecord.id}`, {
        method: 'PUT',
        body: {
          checkIn: new Date($('recordCheckIn').value).toISOString(),
          checkOut: out ? new Date(out).toISOString() : null,
        },
      });
      recordDialog.close();
      toast(t('Record updated'));
      await refresh();
    } catch (err) {
      $('recordMessage').textContent = err.message;
    } finally {
      submit.disabled = false;
    }
  });

  /* ---------------- permission requests ---------------- */

  function renderRequests() {
    const pending = state.requests.filter((r) => r.status === 'pending').length;
    $('requestsCaption').textContent = isAdmin()
      ? `${pending} ${t('pending')}`
      : t('Ask your manager for permission');

    if (!state.requests.length) {
      $('requestsBody').replaceChildren(
        h('tr', {}, h('td', { colspan: 5, class: 'empty-state' }, t('No permission requests yet.'))),
      );
      return;
    }
    $('requestsBody').replaceChildren(
      ...state.requests.map((r) => {
        const actions = [];
        if (r.status === 'pending' && isAdmin()) {
          actions.push(h('button', { class: 'edit-btn', type: 'button', dataset: { requestId: r.id, act: 'answer' } }, t('Answer')));
        }
        if (r.status === 'pending' && !isAdmin()) {
          actions.push(h('button', { class: 'delete-btn', type: 'button', dataset: { requestId: r.id, act: 'withdraw' } }, t('Withdraw')));
        }
        return h(
          'tr',
          {},
          h('td', {}, r.employeeName),
          h('td', {}, ...fmtDateCell(r.date)),
          h('td', {}, r.reason, r.managerNote ? h('small', { class: 'sub' }, `${t('Manager')}: ${r.managerNote}`) : null),
          h('td', {}, h('span', { class: `pill ${r.status}` }, t(r.status))),
          h('td', { class: 'row-actions' }, ...actions),
        );
      }),
    );
  }

  const requestDialog = $('requestDialog');
  const decisionDialog = $('decisionDialog');
  let answeringRequest = null;

  $('newRequestBtn').addEventListener('click', () => {
    $('requestForm').reset();
    $('requestDate').value = ymd(new Date());
    $('requestMessage').textContent = '';
    requestDialog.showModal();
  });

  $('requestForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = $('requestSubmitBtn');
    submit.disabled = true;
    try {
      await api('/requests', { method: 'POST', body: { date: $('requestDate').value, reason: $('requestReason').value } });
      requestDialog.close();
      toast(t('Request sent to your manager'));
      await refresh();
    } catch (err) {
      $('requestMessage').textContent = err.message;
    } finally {
      submit.disabled = false;
    }
  });

  $('requestsBody').addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-request-id]');
    if (!button) return;
    const request = state.requests.find((r) => r.id === Number(button.dataset.requestId));
    if (!request) return;

    if (button.dataset.act === 'answer') {
      answeringRequest = request;
      $('decisionWho').textContent = `${request.employeeName} · ${fmtDate(request.date)}`;
      $('decisionReason').textContent = request.reason;
      $('decisionNote').value = '';
      $('decisionMessage').textContent = '';
      decisionDialog.showModal();
    } else if (confirm(t('Withdraw this request?'))) {
      try {
        await api(`/requests/${request.id}`, { method: 'DELETE' });
        toast(t('Request withdrawn'));
        await refresh();
      } catch (err) {
        toast(err.message, 'error');
      }
    }
  });

  async function decide(status) {
    for (const id of ['approveBtn', 'declineBtn']) $(id).disabled = true;
    try {
      await api(`/requests/${answeringRequest.id}`, { method: 'PUT', body: { status, note: $('decisionNote').value } });
      decisionDialog.close();
      toast(t(status === 'approved' ? 'Request accepted' : 'Request declined'));
      await refresh();
    } catch (err) {
      $('decisionMessage').textContent = err.message;
    } finally {
      for (const id of ['approveBtn', 'declineBtn']) $(id).disabled = false;
    }
  }
  $('approveBtn').addEventListener('click', () => decide('approved'));
  $('declineBtn').addEventListener('click', () => decide('declined'));

  /* ---------------- change password ---------------- */

  const passwordDialog = $('passwordDialog');

  $('changePasswordBtn').addEventListener('click', () => {
    $('passwordForm').reset();
    $('passwordMessage').textContent = '';
    passwordDialog.showModal();
  });

  $('passwordForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const message = $('passwordMessage');
    message.textContent = '';
    if ($('newPassword').value !== $('confirmPassword').value) {
      message.textContent = t('The new passwords do not match');
      return;
    }
    const submit = $('passwordSubmitBtn');
    submit.disabled = true;
    try {
      const { token } = await api('/auth/change-password', {
        method: 'POST',
        body: { currentPassword: $('currentPassword').value, newPassword: $('newPassword').value },
      });
      localStorage.setItem(TOKEN_KEY, token); // the old token stopped working when the password changed
      passwordDialog.close();
      $('passwordForm').reset();
      toast(t('Password updated'));
    } catch (err) {
      message.textContent = err.message;
    } finally {
      submit.disabled = false;
    }
  });

  for (const button of document.querySelectorAll('dialog [data-close]')) {
    button.addEventListener('click', () => button.closest('dialog').close());
  }

  /* ---------------- theme ---------------- */

  const currentTheme = () =>
    document.documentElement.dataset.theme ||
    (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

  function syncThemeButtons() {
    const label = t(currentTheme() === 'dark' ? 'Light mode' : 'Dark mode');
    for (const button of document.querySelectorAll('.theme-btn')) button.textContent = label;
  }

  for (const button of document.querySelectorAll('.theme-btn')) {
    button.addEventListener('click', () => {
      const next = currentTheme() === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      try {
        localStorage.setItem('attendance.theme', next);
      } catch {
        // choice just won't persist
      }
      syncThemeButtons();
    });
  }
  syncThemeButtons();

  $('resetBtn').addEventListener('click', async () => {
    const am = I18N.isAm();
    if (
      !confirm(
        am
          ? 'ሁሉም የመገኘት መዝገቦች ይሰረዙ? ሠራተኞች ይቆያሉ። ይህ አይመለስም።'
          : 'Delete ALL attendance records? Employees are kept. This cannot be undone.',
      )
    ) return;
    try {
      const { deleted } = await api('/attendance', { method: 'DELETE' });
      toast(am ? `${deleted} መዝገቦች ተሰርዘዋል` : `Deleted ${deleted} record${deleted === 1 ? '' : 's'}`);
      await refresh();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  /* ---------------- employee management ---------------- */

  const form = $('employeeForm');

  function showEmployeeForm(employee) {
    state.editingId = employee ? employee.id : null;
    form.reset();
    if (employee) {
      $('employeeName').value = employee.name;
      $('employeeEmail').value = employee.email;
      $('employeeRole').value = employee.role;
      $('employeeIdCard').value = employee.idCard;
      $('employeeCanFilter').checked = !!employee.canFilterReports;
    }
    $('employeeSubmitBtn').textContent = t(employee ? 'Save Changes' : 'Add Employee');
    $('employeePassword').placeholder = t(
      employee ? 'Leave blank to keep current password' : 'Lets the employee sign in with their email',
    );
    form.hidden = false;
    $('employeeName').focus();
  }

  function hideEmployeeForm() {
    state.editingId = null;
    form.reset();
    form.hidden = true;
  }

  $('toggleEmployeeFormBtn').addEventListener('click', () =>
    form.hidden ? showEmployeeForm(null) : hideEmployeeForm(),
  );
  $('cancelEmployeeEditBtn').addEventListener('click', hideEmployeeForm);

  // Downscale to keep photos small (server rejects anything over ~500 KB).
  function readPhoto(file, maxSize = 256) {
    return new Promise((resolve, reject) => {
      // A data: URL (not a blob: URL) because the Content-Security-Policy only allows img-src 'self' data:.
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('That file is not a readable image'));
      reader.onload = () => {
        img.src = reader.result;
      };
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = () => reject(new Error('That file is not a readable image'));
      reader.readAsDataURL(file);
    });
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = $('employeeSubmitBtn');
    submit.disabled = true;
    try {
      const payload = {
        name: $('employeeName').value,
        email: $('employeeEmail').value,
        role: $('employeeRole').value,
        idCard: $('employeeIdCard').value,
        canFilterReports: $('employeeCanFilter').checked,
      };
      const password = $('employeePassword').value;
      if (password) payload.password = password;
      const file = $('employeePhoto').files[0];
      if (file) payload.photo = await readPhoto(file);

      const editing = state.editingId !== null;
      await api(editing ? `/employees/${state.editingId}` : '/employees', {
        method: editing ? 'PUT' : 'POST',
        body: payload,
      });
      toast(t(editing ? 'Employee updated' : 'Employee added'));
      hideEmployeeForm();
      await refresh();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      submit.disabled = false;
    }
  });

  $('employeeTableBody').addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-id]');
    if (!button) return;
    const id = Number(button.dataset.id);
    const employee = state.employees.find((e) => e.id === id);
    if (!employee) return;

    if (button.classList.contains('edit-btn')) {
      showEmployeeForm(employee);
    } else if (button.classList.contains('delete-btn')) {
      const ask = I18N.isAm()
        ? `${employee.name} እና ሁሉም የመገኘት መዝገቦቹ ይሰረዙ?`
        : `Delete ${employee.name} and all of their attendance records?`;
      if (!confirm(ask)) return;
      try {
        await api(`/employees/${id}`, { method: 'DELETE' });
        toast(t('Employee deleted'));
        if (state.editingId === id) hideEmployeeForm();
        await refresh();
      } catch (err) {
        toast(err.message, 'error');
      }
    }
  });

  /* ---------------- language ---------------- */

  for (const button of document.querySelectorAll('.lang-btn')) {
    button.addEventListener('click', () => I18N.setLang(I18N.isAm() ? 'en' : 'am'));
  }
  window.addEventListener('langchange', () => {
    syncThemeButtons();
    tick();
    if (!state.user) return;
    $('trendViewBtn').textContent = t($('trendTableWrap').hidden ? 'View as table' : 'View as chart');
    const editing = state.editingId !== null;
    $('employeeSubmitBtn').textContent = t(editing ? 'Save Changes' : 'Add Employee');
    $('employeePassword').placeholder = t(
      editing ? 'Leave blank to keep current password' : 'Lets the employee sign in with their email',
    );
    refresh();
  });

  /* ---------------- boot ---------------- */

  (async function init() {
    I18N.apply();
    syncThemeButtons();
    tick();
    if (!getToken()) return showScreen('login');
    try {
      const { user } = await api('/auth/me');
      await enterDashboard(user);
    } catch {
      signOut();
    }
  })();
})();
