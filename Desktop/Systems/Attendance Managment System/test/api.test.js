const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../server/app');

let server;
let base;
let adminToken;

async function call(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function login(username, password) {
  const res = await call('/api/auth/login', { method: 'POST', body: { username, password } });
  return res;
}

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

// Starts an isolated app (own in-memory database) so schedule settings can differ per test.
async function startApp(overrides = {}) {
  const { app, db } = await createApp({
    dbPath: ':memory:',
    adminUsername: 'admin',
    adminPassword: 'admin-pass-123',
    workStart: '00:00', // everyone checking in after midnight counts as late
    workDays: ALL_DAYS, // deterministic whatever day the tests run
    ...(overrides.workEnd ? { workEndSat: overrides.workEnd } : {}), // same end every day, Saturday included
    ...overrides,
  });
  const srv = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const url = `http://127.0.0.1:${srv.address().port}`;
  const res = await fetch(`${url}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin-pass-123' }),
  });
  const { token } = await res.json();
  const api = async (path, { method = 'GET', body } = {}) => {
    const r = await fetch(url + path, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await r.text();
    return { status: r.status, body: text ? JSON.parse(text) : null };
  };
  return { api, db, close: () => srv.close() };
}

before(async () => {
  const { app } = await createApp({
    dbPath: ':memory:',
    adminUsername: 'admin',
    adminPassword: 'admin-pass-123',
    workStart: '00:00', // everyone checking in after midnight counts as late
    workDays: ALL_DAYS,
  });
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
  adminToken = (await login('admin', 'admin-pass-123')).body.token;
});

after(() => server.close());

const newEmployee = (n, extra = {}) => ({
  name: `Person ${n}`,
  email: `person${n}@example.com`,
  role: 'developer',
  idCard: `ID-${n}`,
  ...extra,
});

test('rejects unauthenticated and bad credentials', async () => {
  assert.equal((await call('/api/employees')).status, 401);
  assert.equal((await login('admin', 'wrong')).status, 401);
  assert.equal((await login('nobody', 'x')).status, 401);
  assert.equal((await call('/api/employees', { token: 'garbage' })).status, 401);
});

test('employee CRUD with validation and uniqueness', async () => {
  const created = await call('/api/employees', { method: 'POST', token: adminToken, body: newEmployee(1) });
  assert.equal(created.status, 201);
  assert.equal(created.body.email, 'person1@example.com');

  // duplicate email / id card
  const dupEmail = await call('/api/employees', {
    method: 'POST',
    token: adminToken,
    body: newEmployee(99, { email: 'PERSON1@example.com' }),
  });
  assert.equal(dupEmail.status, 409);
  const dupCard = await call('/api/employees', {
    method: 'POST',
    token: adminToken,
    body: newEmployee(98, { idCard: 'ID-1' }),
  });
  assert.equal(dupCard.status, 409);

  // validation
  const bad = await call('/api/employees', {
    method: 'POST',
    token: adminToken,
    body: newEmployee(2, { email: 'not-an-email' }),
  });
  assert.equal(bad.status, 400);
  const badPhoto = await call('/api/employees', {
    method: 'POST',
    token: adminToken,
    body: newEmployee(3, { photo: 'data:text/html;base64,PHNjcmlwdD4=' }),
  });
  assert.equal(badPhoto.status, 400);

  // update keeps photo unless told otherwise
  const png = 'data:image/png;base64,iVBORw0KGgo=';
  const withPhoto = await call(`/api/employees/${created.body.id}`, {
    method: 'PUT',
    token: adminToken,
    body: newEmployee(1, { name: 'Renamed', photo: png }),
  });
  assert.equal(withPhoto.body.photo, png);
  const keep = await call(`/api/employees/${created.body.id}`, {
    method: 'PUT',
    token: adminToken,
    body: newEmployee(1, { name: 'Renamed Again' }),
  });
  assert.equal(keep.body.name, 'Renamed Again');
  assert.equal(keep.body.photo, png);

  assert.equal((await call('/api/employees/9999', { method: 'PUT', token: adminToken, body: newEmployee(5) })).status, 404);

  const del = await call(`/api/employees/${created.body.id}`, { method: 'DELETE', token: adminToken });
  assert.equal(del.status, 204);
  assert.equal((await call(`/api/employees/${created.body.id}`, { method: 'DELETE', token: adminToken })).status, 404);
});

test('attendance flow: check-in, duplicates, check-out, report, absent', async () => {
  const a = (await call('/api/employees', { method: 'POST', token: adminToken, body: newEmployee(10) })).body;
  const b = (await call('/api/employees', { method: 'POST', token: adminToken, body: newEmployee(11) })).body;

  // check-out before check-in
  assert.equal(
    (await call('/api/attendance/check-out', { method: 'POST', token: adminToken, body: { employeeId: a.id } })).status,
    409,
  );

  const inRes = await call('/api/attendance/check-in', { method: 'POST', token: adminToken, body: { employeeId: a.id } });
  assert.equal(inRes.status, 201);
  assert.equal(inRes.body.status, 'late'); // workStart is 00:00
  assert.equal(inRes.body.checkOut, null);

  assert.equal(
    (await call('/api/attendance/check-in', { method: 'POST', token: adminToken, body: { employeeId: a.id } })).status,
    409,
  );

  const outRes = await call('/api/attendance/check-out', { method: 'POST', token: adminToken, body: { employeeId: a.id } });
  assert.equal(outRes.status, 200);
  assert.ok(outRes.body.checkOut);
  assert.equal(typeof outRes.body.hours, 'number');
  assert.equal(
    (await call('/api/attendance/check-out', { method: 'POST', token: adminToken, body: { employeeId: a.id } })).status,
    409,
  );

  const report = await call('/api/attendance/report?status=late', { token: adminToken });
  assert.equal(report.body.summary.late, 1);
  assert.equal(report.body.records[0].employeeName, 'Person 10');

  const absent = await call('/api/attendance/report?status=absent', { token: adminToken });
  assert.ok(absent.body.records.some((r) => r.employeeId === b.id));
  assert.ok(!absent.body.records.some((r) => r.employeeId === a.id));

  const stats = await call('/api/attendance/stats', { token: adminToken });
  assert.equal(stats.body.presentToday, 1);
  assert.equal(stats.body.lateToday, 1);
  assert.equal(stats.body.absentToday, stats.body.totalEmployees - 1);

  assert.equal((await call('/api/attendance?from=nope', { token: adminToken })).status, 400);
  assert.equal((await call('/api/attendance?status=weird', { token: adminToken })).status, 400);
});

test('permission and fieldwork are separate from present and absent', async () => {
  const before = (await call('/api/attendance/stats', { token: adminToken })).body;
  const presentEmployee = (await call('/api/employees', { method: 'POST', token: adminToken, body: newEmployee(12) })).body;
  const permissionAccount = await call('/api/employees', {
    method: 'POST',
    token: adminToken,
    body: newEmployee(13, { password: 'employee-pass-13' }),
  });
  const permissionEmployee = permissionAccount.body;
  const fieldworkEmployee = (await call('/api/employees', { method: 'POST', token: adminToken, body: newEmployee(14) })).body;
  const absentEmployee = (await call('/api/employees', { method: 'POST', token: adminToken, body: newEmployee(15) })).body;
  const manualPermissionEmployee = (await call('/api/employees', { method: 'POST', token: adminToken, body: newEmployee(17) })).body;

  await call('/api/attendance/check-in', { method: 'POST', token: adminToken, body: { employeeId: presentEmployee.id } });
  await call('/api/attendance/check-in', { method: 'POST', token: adminToken, body: { employeeId: permissionEmployee.id } });
  const permissionLogin = await login(permissionEmployee.email, 'employee-pass-13');
  const request = await call('/api/requests', {
    method: 'POST',
    token: permissionLogin.body.token,
    body: { date: before.date, reason: 'Approved leave' },
  });
  assert.equal(request.status, 201);
  const approved = await call(`/api/requests/${request.body.id}`, {
    method: 'PUT',
    token: adminToken,
    body: { status: 'approved' },
  });
  assert.equal(approved.status, 200);

  const marked = await call('/api/attendance/fieldwork', {
    method: 'POST',
    token: adminToken,
    body: { employeeId: fieldworkEmployee.id, fieldwork: true },
  });
  assert.equal(marked.status, 200);
  assert.equal((await call('/api/attendance/fieldwork', {
    method: 'POST',
    token: permissionLogin.body.token,
    body: { employeeId: fieldworkEmployee.id, fieldwork: true },
  })).status, 403);
  const manualPermission = await call('/api/attendance/permission', {
    method: 'POST',
    token: adminToken,
    body: { employeeId: manualPermissionEmployee.id, permission: true },
  });
  assert.equal(manualPermission.status, 200);
  assert.equal((await call('/api/attendance/permission', {
    method: 'POST',
    token: permissionLogin.body.token,
    body: { employeeId: manualPermissionEmployee.id, permission: true },
  })).status, 403);

  const stats = (await call('/api/attendance/stats', { token: adminToken })).body;
  assert.equal(stats.presentToday, before.presentToday + 1);
  assert.equal(stats.permissionToday, before.permissionToday + 2);
  assert.equal(stats.fieldworkToday, before.fieldworkToday + 1);
  assert.equal(stats.absentToday, before.absentToday + 1);
  assert.ok(stats.today.some((row) => row.employeeId === permissionEmployee.id && row.status === 'permission'));
  assert.ok(stats.today.some((row) => row.employeeId === manualPermissionEmployee.id && row.status === 'permission'));
  assert.ok(stats.today.some((row) => row.employeeId === fieldworkEmployee.id && row.status === 'fieldwork'));

  for (const [status, expectedId] of [
    ['late', presentEmployee.id],
    ['permission', permissionEmployee.id],
    ['permission', manualPermissionEmployee.id],
    ['fieldwork', fieldworkEmployee.id],
    ['absent', absentEmployee.id],
  ]) {
    const response = await call(`/api/attendance?status=${status}&employeeId=${expectedId}`, { token: adminToken });
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.map((row) => row.employeeId), [expectedId]);
    if (status === 'permission' && expectedId === permissionEmployee.id) {
      assert.ok(response.body[0].checkIn);
      assert.equal(response.body[0].status, 'permission');
    }
  }
  assert.deepEqual((await call(`/api/attendance?status=late&employeeId=${permissionEmployee.id}`, { token: adminToken })).body, []);
  assert.deepEqual((await call(`/api/attendance?status=late&employeeId=${fieldworkEmployee.id}`, { token: adminToken })).body, []);
});

test('employee accounts are restricted to their own data', async () => {
  const me = (
    await call('/api/employees', {
      method: 'POST',
      token: adminToken,
      body: newEmployee(20, { password: 'employee-pass-1' }),
    })
  ).body;
  const other = (await call('/api/employees', { method: 'POST', token: adminToken, body: newEmployee(21) })).body;

  const short = await call('/api/employees', {
    method: 'POST',
    token: adminToken,
    body: newEmployee(22, { password: 'short' }),
  });
  assert.equal(short.status, 400);

  const session = await login('person20@example.com', 'employee-pass-1');
  assert.equal(session.status, 200);
  assert.equal(session.body.user.role, 'employee');
  const token = session.body.token;

  const list = await call('/api/employees', { token });
  assert.deepEqual(list.body.map((e) => e.id), [me.id]);

  // cannot manage employees or wipe data
  assert.equal((await call('/api/employees', { method: 'POST', token, body: newEmployee(23) })).status, 403);
  assert.equal((await call(`/api/employees/${other.id}`, { method: 'DELETE', token })).status, 403);
  assert.equal((await call('/api/attendance', { method: 'DELETE', token })).status, 403);

  // employeeId in the body is ignored: check-in always applies to self
  const checkIn = await call('/api/attendance/check-in', { method: 'POST', token, body: { employeeId: other.id } });
  assert.equal(checkIn.status, 201);
  assert.equal(checkIn.body.employeeId, me.id);

  // and reports are scoped to self even when asking for someone else
  const records = await call(`/api/attendance?employeeId=${other.id}`, { token });
  assert.ok(records.body.every((r) => r.employeeId === me.id));
  const stats = await call('/api/attendance/stats', { token });
  assert.equal(stats.body.totalEmployees, 1);
});

test('admin can reset attendance; deleting an employee removes their records', async () => {
  const emp = (await call('/api/employees', { method: 'POST', token: adminToken, body: newEmployee(30) })).body;
  await call('/api/attendance/check-in', { method: 'POST', token: adminToken, body: { employeeId: emp.id } });
  await call(`/api/employees/${emp.id}`, { method: 'DELETE', token: adminToken });
  const after = await call('/api/attendance', { token: adminToken });
  assert.ok(!after.body.some((r) => r.employeeId === emp.id));

  const reset = await call('/api/attendance', { method: 'DELETE', token: adminToken });
  assert.equal(reset.status, 200);
  assert.deepEqual((await call('/api/attendance', { token: adminToken })).body, []);
});

test('trend returns one entry per day, oldest first, with today counted', async () => {
  const emp = (await call('/api/employees', { method: 'POST', token: adminToken, body: newEmployee(40) })).body;
  await call('/api/attendance/check-in', { method: 'POST', token: adminToken, body: { employeeId: emp.id } });
  const res = await call('/api/attendance/trend?days=7', { token: adminToken });
  assert.equal(res.status, 200);
  assert.equal(res.body.days.length, 7);
  const dates = res.body.days.map((d) => d.date);
  assert.deepEqual(dates, [...dates].sort());
  const today = res.body.days.at(-1);
  assert.equal(today.onTime + today.late, 1);
  assert.equal(res.body.totalEmployees, (await call('/api/employees', { token: adminToken })).body.length);
  assert.equal(res.body.days[0].onTime + res.body.days[0].late, 0);
  assert.equal((await call('/api/attendance/trend?days=0', { token: adminToken })).status, 400);
  assert.equal((await call('/api/attendance/trend?days=99', { token: adminToken })).status, 400);
});

test('change password: validates, rotates the token, invalidates old sessions', async () => {
  const emp = (
    await call('/api/employees', { method: 'POST', token: adminToken, body: newEmployee(50, { password: 'first-pass-123' }) })
  ).body;
  const first = (await login(emp.email, 'first-pass-123')).body.token;

  const change = (body) => call('/api/auth/change-password', { method: 'POST', token: first, body });
  assert.equal((await change({ currentPassword: 'wrong-pass', newPassword: 'second-pass-123' })).status, 400);
  assert.equal((await change({ currentPassword: 'first-pass-123', newPassword: 'short' })).status, 400);
  assert.equal((await change({ currentPassword: 'first-pass-123', newPassword: 'first-pass-123' })).status, 400);
  assert.equal((await change({ currentPassword: 'first-pass-123', newPassword: 'x'.repeat(80) })).status, 400);
  assert.equal((await call('/api/auth/change-password', { method: 'POST', body: {} })).status, 401);

  const ok = await change({ currentPassword: 'first-pass-123', newPassword: 'second-pass-123' });
  assert.equal(ok.status, 200);
  assert.equal((await call('/api/auth/me', { token: first })).status, 401); // old session is void
  assert.equal((await call('/api/auth/me', { token: ok.body.token })).status, 200); // new one works
  assert.equal((await login(emp.email, 'first-pass-123')).status, 401);
  assert.equal((await login(emp.email, 'second-pass-123')).status, 200);
});

test('CSV export: header, filters, formula escaping, scoping', async () => {
  const emp = (
    await call('/api/employees', {
      method: 'POST',
      token: adminToken,
      body: newEmployee(60, { name: '=HYPERLINK("x")', password: 'csv-pass-1234' }),
    })
  ).body;
  await call('/api/attendance/check-in', { method: 'POST', token: adminToken, body: { employeeId: emp.id } });

  const res = await fetch(`${base}/api/attendance/export.csv`, { headers: { Authorization: `Bearer ${adminToken}` } });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/csv/);
  assert.match(res.headers.get('content-disposition'), /attachment; filename="attendance-\d{4}-\d{2}-\d{2}\.csv"/);
  const bytes = Buffer.from(await res.arrayBuffer()); // text() would strip the BOM
  assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  const text = bytes.toString('utf8');
  assert.ok(text.includes('Employee,Date,Check in,Check out,Hours,Status'));
  assert.ok(text.includes(`"'=HYPERLINK(""x"")"`), 'formula must be neutralised and quoted');

  const empToken = (await login(emp.email, 'csv-pass-1234')).body.token;
  const own = await (await fetch(`${base}/api/attendance/export.csv`, { headers: { Authorization: `Bearer ${empToken}` } })).text();
  assert.equal(own.trim().split('\r\n').length, 2); // header + own single record
  assert.equal((await fetch(`${base}/api/attendance/export.csv`)).status, 401);
});

test('monthly summary aggregates per employee', async () => {
  const month = new Date().toISOString().slice(0, 7);
  const res = await call(`/api/attendance/monthly?month=${month}`, { token: adminToken });
  assert.equal(res.status, 200);
  assert.equal(res.body.month, month);
  const row = res.body.rows.find((r) => r.employeeName.startsWith('=HYPERLINK'));
  assert.equal(row.daysWorked, 1);
  assert.equal(row.onTime + row.late, 1);
  assert.equal(row.totalHours, 0);
  const empty = await call('/api/attendance/monthly?month=2001-01', { token: adminToken });
  assert.ok(empty.body.rows.every((r) => r.daysWorked === 0));
  assert.equal((await call('/api/attendance/monthly?month=2026-13', { token: adminToken })).status, 400);
});

test('employees can correct only their own record; only admins can delete', async () => {
  const emp = (await call('/api/employees', { method: 'POST', token: adminToken, body: newEmployee(70, { password: 'fix-pass-1234' }) })).body;
  const rec = (await call('/api/attendance/check-in', { method: 'POST', token: adminToken, body: { employeeId: emp.id } })).body;
  const empToken = (await login(emp.email, 'fix-pass-1234')).body.token;

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(8, 30, 0, 0);
  const out = new Date(yesterday.getTime() + 8 * 3_600_000);
  const put = (body, token = adminToken) => call(`/api/attendance/${rec.id}`, { method: 'PUT', token, body });

  const other = (await call('/api/employees', { method: 'POST', token: adminToken, body: newEmployee(71, { password: 'fix-pass-1234' }) })).body;
  const otherToken = (await login(other.email, 'fix-pass-1234')).body.token;
  assert.equal((await put({ checkIn: yesterday.toISOString() }, otherToken)).status, 403); // not their record
  assert.equal((await put({ checkIn: yesterday.toISOString() }, empToken)).status, 200); // their own record
  assert.equal((await put({ checkIn: 'garbage' })).status, 400);
  assert.equal((await put({ checkIn: out.toISOString(), checkOut: yesterday.toISOString() })).status, 400);
  assert.equal((await put({ checkIn: new Date(Date.now() + 86_400_000).toISOString() })).status, 400);

  const fixed = await put({ checkIn: yesterday.toISOString(), checkOut: out.toISOString() });
  assert.equal(fixed.status, 200);
  assert.equal(fixed.body.hours, 8);
  assert.notEqual(fixed.body.date, rec.date); // moved to yesterday

  assert.equal((await call('/api/attendance/999999', { method: 'PUT', token: adminToken, body: { checkIn: yesterday.toISOString() } })).status, 404);
  assert.equal((await call(`/api/attendance/${rec.id}`, { method: 'DELETE', token: empToken })).status, 403);
  assert.equal((await call(`/api/attendance/${rec.id}`, { method: 'DELETE', token: adminToken })).status, 204);
  assert.equal((await call(`/api/attendance/${rec.id}`, { method: 'DELETE', token: adminToken })).status, 404);
});

test('schedule: leaving before the end of the work day is flagged early', async () => {
  for (const [workEnd, expected] of [['23:59', true], ['00:00', false]]) {
    const app = await startApp({ workEnd });
    try {
      const emp = (await app.api('/api/employees', { method: 'POST', body: newEmployee(80) })).body;
      await app.api('/api/attendance/check-in', { method: 'POST', body: { employeeId: emp.id } });
      const out = await app.api('/api/attendance/check-out', { method: 'POST', body: { employeeId: emp.id } });
      assert.equal(out.body.earlyLeave, expected, `workEnd ${workEnd}`);
    } finally {
      app.close();
    }
  }
});

test('schedule: nobody is absent on a day off', async () => {
  const app = await startApp({ workDays: [] });
  try {
    await app.api('/api/employees', { method: 'POST', body: newEmployee(81) });
    const stats = (await app.api('/api/attendance/stats')).body;
    assert.equal(stats.workday, false);
    assert.equal(stats.absentToday, 0);
    assert.equal(stats.totalEmployees, 1);
    assert.deepEqual((await app.api('/api/attendance/report?status=absent')).body.records, []);
    const trend = (await app.api('/api/attendance/trend?days=3')).body;
    assert.ok(trend.days.every((d) => d.workday === false));
  } finally {
    app.close();
  }

  const working = await startApp({ workDays: ALL_DAYS });
  try {
    await working.api('/api/employees', { method: 'POST', body: newEmployee(82) });
    const stats = (await working.api('/api/attendance/stats')).body;
    assert.equal(stats.workday, true);
    assert.equal(stats.absentToday, 1);
    assert.equal((await working.api('/api/attendance/report?status=absent')).body.records.length, 1);
  } finally {
    working.close();
  }
});

test('monthly summary counts absent work days (Monday-Saturday, from the day the employee was added)', async () => {
  const app = await startApp({ workDays: [1, 2, 3, 4, 5, 6] });
  try {
    const emp = (await app.api('/api/employees', { method: 'POST', body: newEmployee(83) })).body;
    app.db.prepare("UPDATE employees SET created_at = '2001-01-01 00:00:00' WHERE id = ?").run(emp.id);

    // February 2001 has 28 days and 4 Sundays (4, 11, 18, 25) -> 24 work days, none attended.
    const feb = (await app.api('/api/attendance/monthly?month=2001-02')).body.rows[0];
    assert.equal(feb.daysWorked, 0);
    assert.equal(feb.absentDays, 24);

    // Added mid-month: only days from the day the employee was added count (Feb 15 onwards -> 12 work days).
    app.db.prepare("UPDATE employees SET created_at = '2001-02-15 09:00:00' WHERE id = ?").run(emp.id);
    const late = (await app.api('/api/attendance/monthly?month=2001-02')).body.rows[0];
    assert.equal(late.absentDays, 12); // Feb 15-28 = 14 days, minus Sundays 18 and 25

    // A month before the employee existed has no absences.
    assert.equal((await app.api('/api/attendance/monthly?month=2000-12')).body.rows[0].absentDays, 0);
    // Future months have none either.
    assert.equal((await app.api('/api/attendance/monthly?month=2999-01')).body.rows[0].absentDays, 0);
  } finally {
    app.close();
  }
});

test('phone access page and installable-app files are served', async () => {
  const page = await fetch(`${base}/connect`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /text\/html/);
  const html = await page.text();
  assert.ok(html.includes('Open on a phone'));
  assert.ok(!html.includes('<script>'), 'no inline scripts (CSP)');

  const manifest = await fetch(`${base}/manifest.webmanifest`);
  assert.equal(manifest.status, 200);
  const json = await manifest.json();
  assert.equal(json.display, 'standalone');
  for (const icon of json.icons) {
    const res = await fetch(`${base}/${icon.src}`);
    assert.equal(res.status, 200, icon.src);
    assert.equal(res.headers.get('content-type'), 'image/png');
  }
  assert.equal((await fetch(`${base}/icons/apple-touch-icon.png`)).status, 200);
});

test('health check is public', async () => {
  const res = await fetch(`${base}/api/health`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
});

test('CORS allows only configured origins', async () => {
  const allowed = await fetch(`${base}/api/auth/login`, {
    method: 'OPTIONS',
    headers: { Origin: 'http://127.0.0.1:5500', 'Access-Control-Request-Method': 'POST' },
  });
  assert.equal(allowed.status, 204);
  assert.equal(allowed.headers.get('access-control-allow-origin'), 'http://127.0.0.1:5500');

  const denied = await fetch(`${base}/api/auth/login`, {
    method: 'OPTIONS',
    headers: { Origin: 'http://evil.example', 'Access-Control-Request-Method': 'POST' },
  });
  assert.equal(denied.headers.get('access-control-allow-origin'), null);
});

test('malformed JSON and unknown routes return JSON errors', async () => {
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{not json',
  });
  assert.equal(res.status, 400);
  assert.ok((await res.json()).error);
  assert.equal((await call('/api/nope', { token: adminToken })).status, 404);
});

test('weekly and monthly reports download as xlsx, docx and pdf', async () => {
  const emp = (await call('/api/employees', { method: 'POST', token: adminToken, body: newEmployee(90) })).body;
  await call('/api/attendance/check-in', { method: 'POST', token: adminToken, body: { employeeId: emp.id } });
  const signatures = { xlsx: 'PK', docx: 'PK', pdf: '%PDF' };
  for (const period of ['week', 'month', 'lastMonth']) {
    for (const [format, magic] of Object.entries(signatures)) {
      const res = await fetch(`${base}/api/attendance/report/download?period=${period}&format=${format}`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      assert.equal(res.status, 200, `${period} ${format}`);
      assert.match(res.headers.get('content-disposition'), new RegExp(`\.${format}"`));
      const bytes = Buffer.from(await res.arrayBuffer());
      assert.equal(bytes.subarray(0, magic.length).toString('latin1'), magic, `${period} ${format}`);
    }
  }
  assert.equal((await call('/api/attendance/report/download?period=year&format=pdf', { token: adminToken })).status, 400);
  assert.equal((await call('/api/attendance/report/download?period=week&format=exe', { token: adminToken })).status, 400);
});
