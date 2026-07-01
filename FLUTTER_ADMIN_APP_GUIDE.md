# FitWave Pro Admin App — Flutter Build Guide

This guide walks through building a Flutter mobile app that connects to the **same
Firebase Realtime Database** as the FitWave Pro web app (`index.html`), but covering
**the full admin feature set** — everything the owner/manager can do from the web
dashboard:

- Admin login (the actual `gp_auth` admin password, not just an employee login)
- **Dashboard** — live stats, today's attendance, recent punches, and the
  **Trainer of the Month** spotlight + performance bar chart
- **Employees** — full CRUD (add/edit/deactivate)
- **User Accounts** — create/edit/disable employee logins, admin password reset
- **Attendance** — daily punch marking + manual entry
- **Monthly View** — the full attendance calendar grid (F/L/HL/X/M/E/P/A), editable
- **Leave** — balances, apply/edit/approve/reject leave, manual balance adjustments
- **Salary** — per-employee payroll calculation, mark-as-paid, printable slips,
  weekly/monthly report export
- **PT Sessions** — all trainers' financial PT entries + commission rate overrides
- **PT Packages** — full CRUD across all trainers, session checklists, progress
  reports (before/after charts)
- **Advances** — salary advance CRUD

There is a separate, already-written guide — `FLUTTER_EMPLOYEE_APP_GUIDE.md` — for a
*trainer-scoped* companion app (PT Sessions/Packages/Attendance limited to their own
records). This document is the admin counterpart: same backend, same conventions,
full read/write access, no `trainerId` scoping.

> **Branding note:** the web app was recently rebranded from "GymPro" (amber theme)
> to **FitWave Pro** (purple theme, accent `#A855F7` / `#7C3AED`). The employee guide
> still references the old name/colors — use **this** guide's branding as current.
> A matching app icon/logo asset is in progress; use the 💪 emoji placeholder shown
> below until it's available, then swap it the same way described in
> [§9 Branding & theming](#9-branding--theming).

---

## 1. How the web app's data & auth actually work (read this first)

Identical foundation to the employee app — read this even if you already built that
one, since the admin app touches every table instead of a scoped subset:

1. **There is no Firebase Authentication.** Both admin (`gp_auth`) and employee
   (`gp_user_acct`) logins are plain-text string comparisons against RTDB records.
   The admin app must check `gp_auth` first (this app *is* the admin login).
2. **All data lives under one RTDB node: `gymdata`.** Every "table" is a child of
   `gymdata`, and its value is always wrapped as `{ "_json": "<stringified array>" }`
   — never a plain array/object. Decode the inner string after reading, encode before
   writing. See §3 for the reusable data-layer code (identical to the employee app).
3. **Role scoping is enforced client-side only**, there are currently no RTDB
   security rules. The admin app doesn't need to filter by `trainerId`/`empId` at
   all (that's the whole point of "admin"), but see [§12](#12-recommended-security-hardening)
   before shipping either app to real users.
4. **Read-modify-write, not per-record updates.** Every mutation in the web app
   reads the *entire* list for a table, mutates it in memory, and writes the whole
   list back. Match this pattern exactly — see §3.

### 1.1 Firebase project details

Reuse the exact same Firebase project as the web app and the employee app — do not
create a new one.

```
apiKey:            AIzaSyCeF7lqNDU28omkaF2tTKZSd2PBN0vVlKw
authDomain:         gympro-3459f.firebaseapp.com
databaseURL:        https://gympro-3459f-default-rtdb.firebaseio.com
projectId:          gympro-3459f
storageBucket:       gympro-3459f.firebasestorage.app
messagingSenderId:  630686270326
appId:              1:630686270326:web:7047e9aaeca06c107df057
```

Register a new Android/iOS app under this **same** project via `flutterfire configure`
(if you already did this for the employee app, you can register a second app entry
for the admin app, or reuse the same Firebase app registration — RTDB access doesn't
care which app entry was used to configure the SDK).

### 1.2 Full data key reference

The web app's `K` lookup table (`index.html`, line 3191) maps logical names to RTDB
child keys:

```javascript
const K = {
  emp: 'gp_emp', att: 'gp_att', adv: 'gp_adv', pay: 'gp_pay',
  pt: 'gp_pt', ptRate: 'gp_pt_rate', ptPkg: 'gp_pt_pkg',
  leave: 'gp_leave', leaveApp: 'gp_leave_app', leaveAdj: 'gp_leave_adj',
  auth: 'gp_auth', userAcct: 'gp_user_acct', init: 'gp_init'
};
```

| Logical name | RTDB key | Shape | Used by |
|---|---|---|---|
| Employees | `gp_emp` | `Employee[]` | Everything |
| Attendance | `gp_att` | `AttendanceRecord[]` | Attendance, Monthly View, Salary, Leave |
| Advances | `gp_adv` | `Advance[]` | Advances, Salary |
| Paid salary records | `gp_pay` | `PayRecord[]` | Salary |
| PT Sessions (financial) | `gp_pt` | `PtSession[]` | PT Sessions, Dashboard (Trainer of the Month) |
| PT commission overrides | `gp_pt_rate` | `PtRateOverride[]` | PT Sessions, Salary |
| PT Packages | `gp_pt_pkg` | `PtPackage[]` | PT Packages |
| Leave templates | `gp_leave` | — | **Vestigial** — see note below |
| Leave applications | `gp_leave_app` | `LeaveApplication[]` | Leave, Monthly View, Salary |
| Leave adjustments | `gp_leave_adj` | `LeaveAdjustment[]` | Leave |
| Admin auth | `gp_auth` | `{ username, password }` | Login, password reset |
| User accounts | `gp_user_acct` | `UserAccount[]` | User Accounts |
| Init flag | `gp_init` | internal | Don't touch — used by the web app's first-run seeding |

> **`gp_leave` is dead code.** It has a getter (`getLeaveTemplates`) and a sorter
> (`getLeaveTemplatesList`) but no render function or UI ever displays it — the
> actual leave system is built entirely on `gp_leave_app` + `gp_leave_adj` +
> `gp_att`. Skip it in the Flutter app; don't build a screen for it.

---

## 2. Data model reference

### 2.1 `Employee` (`gp_emp`)

```json
{
  "id": "mqusimvk8aysq",
  "name": "Abhijith",
  "phone": "9037149211",
  "role": "Head Coach",
  "joinDate": "2026-06-01",
  "morningFrom": "05:30",
  "morningTo": "11:30",
  "eveningFrom": "15:00",
  "eveningTo": "21:00",
  "shift": "both",
  "salary": 18500,
  "wdays": 30,
  "status": "active",
  "createdAt": "2026-06-05T09:47:14.324Z"
}
```

- `shift` is one of `morning` / `evening` / `both` — drives `hasMorning(emp)` /
  `hasEvening(emp)` helpers used throughout attendance and salary logic
  (a shift is "active" if `shift === 'both'` or `shift === thatShift`, **and**
  the corresponding `*From`/`*To` times are set).
- `wdays` = working days per month, defaults to `26`, used as the salary divisor.
- `status` is `active` or `inactive` — inactive employees are filtered out of every
  list screen but their historical records are kept.

**Admin form fields** (Add/Edit Employee modal): Full Name*, Mobile No (10-digit),
Role/Designation (free text), Join Date*, Morning Shift toggle + Start/End time,
Evening Shift toggle + Start/End time, Salary (₹)*, Working Days/Month (default 26),
Status (Active/Inactive).

### 2.2 `AttendanceRecord` (`gp_att`)

```json
{ "id": "...", "empId": "mqusimvk8aysq", "date": "2026-06-15", "shift": "morning", "status": "present", "reason": "" }
```

`status` is one of:

| Status | Meaning | Counts as "present" (`isPresentStatus`) |
|---|---|---|
| `present` | Normal attendance | ✅ |
| `late` | Present but late (has `reason`) | ✅ |
| `half-day` | Worked partial shift | ✅ |
| `leave` | Paid leave (within monthly allowance) | ❌ |
| `lop` | Loss of pay (leave beyond allowance) | ❌ |
| `absent` | Unpaid, not yet converted to leave/LOP | ❌ |

One record per employee + date + shift — an employee with `shift: 'both'` can have
up to two records per day. `leave`/`lop` statuses are **not** directly settable from
the Manual Attendance modal (which only offers Present/Late/Absent/Half Day) — they
are set programmatically by the leave approval flow and `normalizeLeaveStatuses`
(§2.8).

### 2.3 `Advance` (`gp_adv`)

```json
{ "id": "...", "empId": "mqusimvk8aysq", "date": "2026-06-10", "month": "2026-06", "amount": 2000, "reason": "Emergency" }
```

`month` is the salary month this advance should be deducted from (not necessarily
the same as `date`, the day it was actually handed out).

### 2.4 `PayRecord` (`gp_pay`)

```json
{ "id": "...", "empId": "mqusimvk8aysq", "month": "2026-06", "amount": 24850, "paidDate": "2026-06-30" }
```

Written when admin clicks "Mark Paid" on the Salary screen — `amount` is the
rounded `net` figure from `calcSalary()` (§2.9) at the moment it was marked paid
(a frozen snapshot, not recalculated later).

### 2.5 `PtSession` (`gp_pt`) — financial entry

```json
{ "id": "...", "trainerId": "mqusimvk8aysq", "date": "2026-06-15", "shift": "morning", "type": "12session", "amount": 1500, "notes": "", "month": "2026-06" }
```

`type` is one of `12session` / `1month` / `couple` / `group` — descriptive label
only, doesn't drive a checklist (that's `PtPackage`, a separate table).

### 2.6 `PtRateOverride` (`gp_pt_rate`)

```json
{ "id": "...", "trainerId": "mqusimvk8aysq", "month": "2026-06", "rate": 35 }
```

Admin-only — overrides the auto-tiered commission % for one trainer+month. See
§2.10 for the tier formula.

### 2.7 `PtPackage` (`gp_pt_pkg`)

```json
{
  "id": "mqv4ox6stoz5k",
  "trainerId": "mqusimvk8aysq",
  "clientName": "Ammir",
  "type": "12session",
  "totalSessions": 12,
  "startDate": "2026-06-01",
  "dueDate": "2026-12-31",
  "notes": "",
  "sessions": [
    { "done": false, "date": "", "timeIn": "", "timeOut": "", "plan": "", "workout": "", "remarks": "" }
  ],
  "stats": { "height": 165, "weight": 76.7, "bmi": 32.8, "bodyFat": 47.2, "fatMass": 36.2,
             "muscleMass": 37.8, "boneMass": 2.7, "subFat": 33.5, "visceralFat": 16,
             "bodyAge": 47, "whr": 0.91 },
  "measurements": { "neck": 40, "shoulders": 110, "chest": 100, "waist": 90, "belly": 95,
                     "hips": 100, "rUpperArm": 32, "lUpperArm": 32, "rForearm": 27,
                     "lForearm": 27, "rThigh": 55, "lThigh": 55, "rCalf": 36, "lCalf": 36 },
  "endStats": {},
  "endMeasurements": {},
  "manualVerdicts": { "chest": "improved" },
  "createdBy": "admin"
}
```

Unlike the employee app, the admin app sees **all** packages (no `trainerId`
filter) and the **Workout Plan** field (`sessions[i].plan`) is **editable** here
(it's the employee app that renders it read-only). The full metric metadata table
(`ptMetrics` / `ptBodyParts`), comparison-row computation, bar/line chart widgets,
and improvement-score logic are identical to the employee guide §9 — reuse that
code verbatim, just without the `trainerId == empId` filter.

### 2.8 `LeaveApplication` (`gp_leave_app`)

```json
{
  "id": "...",
  "empId": "mqusimvk8aysq",
  "leaveType": "full",
  "fromDate": "2026-06-20",
  "toDate": "2026-06-21",
  "days": 2,
  "reason": "Personal",
  "status": "pending",
  "appliedAt": "2026-06-18T10:00:00.000Z",
  "reviewedAt": null
}
```

- `leaveType`: `full` or `half`. Half-day leave only marks the **first** active
  shift of each day as `leave`; the other shift is untouched.
  `status`: `pending` / `approved` / `rejected`.

**Approval flow** (`approveLeave(id)`, mirror exactly):
1. Walk every date from `fromDate` to `toDate`, skipping Sundays.
2. For each date, determine the employee's active shifts (`hasMorning`/`hasEvening`,
   falling back to `['morning']` if neither is set). If `leaveType === 'half'`, only
   take the first shift.
3. Upsert an `AttendanceRecord` for each (date, shift) with `status: 'leave'`.
4. Call `normalizeLeaveStatuses(empId, month)` for every month touched by the range
   (§2.8.1) — this is what converts excess leave into LOP.
5. Set the application's `status: 'approved'`, `reviewedAt: now()`.

**Rejection** (`rejectLeave(id)`) just flips `status: 'rejected'`, `reviewedAt: now()`
— it does **not** touch attendance (rejected leave never wrote attendance records
since approval is what creates them).

**Admin direct edit** (`saveEditedLeave`, the "Edit Leave" modal) lets the admin
change dates/type/reason **and** force a status directly (Pending/Approved/Rejected)
in one step:
- If the application was previously `approved`, first **undo** the old attendance
  marks (`_undoLeaveAttendance`) before applying the new ones.
- If the new status is `approved`, call the same `approveLeave()` path to (re)write
  attendance.
- Otherwise just save the updated application record as-is.

#### 2.8.1 How Monthly View's leave overlay sets (`_approvedDates`/`_pendingDates`/`_approvedHalf`) are built

`renderMonthly()` pre-computes these from `gp_leave_app` before rendering the grid:

```javascript
const leaveApps = getLeaveApps();
const _approvedDates = {}, _pendingDates = {}, _approvedHalf = {};
leaveApps.forEach(a => {
  if (a.status !== 'approved' && a.status !== 'pending') return;
  const map = a.status === 'approved' ? _approvedDates : _pendingDates;
  if (!map[a.empId]) map[a.empId] = new Set();
  if (a.status === 'approved' && a.leaveType === 'half' && !_approvedHalf[a.empId]) _approvedHalf[a.empId] = new Set();
  let dd = new Date(a.fromDate + 'T00:00:00');
  const endD = new Date(a.toDate + 'T00:00:00');
  while (dd <= endD) {
    const ds = dd.toISOString().slice(0, 10);
    map[a.empId].add(ds);
    if (a.status === 'approved' && a.leaveType === 'half') _approvedHalf[a.empId].add(ds);
    dd.setDate(dd.getDate() + 1);
  }
});
```

This is what lets Monthly View show a day as `L`/`HL`/`P` (pending) even before the
underlying attendance record exists — see §3's day-code table, which already folds
this in.

### 2.9 `LeaveAdjustment` (`gp_leave_adj`)

```json
{ "id": "...", "empId": "mqusimvk8aysq", "period": "2026-06", "days": 2, "type": "add", "inputDays": 2, "reason": "Bonus leave", "createdAt": "2026-06-01T00:00:00.000Z" }
```

- `period` is the `YYYY-MM` month this adjustment applies to.
- `days` is always the **signed delta** actually applied to that month's cap — for
  `type: 'set'`, the UI computes `days = inputDays - baseDays - sum(existingAdjs.days)`
  at save time so a "Set Total Allowed Days" adjustment still composes additively
  with the base cap and any prior adjustments. `inputDays` preserves what the admin
  actually typed, for display/audit only — **always use `days` for calculations,
  never `inputDays`.**
- `type` is `add` / `deduct` / `set` (display-only after the delta is computed).

### 2.10 Leave accrual, cap, and the LOP conversion (the core leave engine)

```javascript
const MONTHLY_LEAVE_DAYS = 1; // flat 1 day/month, no carryover, no last-month bonus

function getLeavePeriod(month) {           // 6-month reporting periods
  const [y, m] = month.split('-').map(Number);
  if (m <= 6) return { start: `${y}-01`, end: `${y}-06`, label: `Jan–Jun ${y}` };
  return { start: `${y}-07`, end: `${y}-12`, label: `Jul–Dec ${y}` };
}

function getMonthlyLeaveCap(empId, month) {
  const baseDays = MONTHLY_LEAVE_DAYS;
  const adjs = getLeaveAdjs().filter(a => a.empId === empId && a.period === month);
  const adjDays = adjs.reduce((sum, a) => sum + a.days, 0);
  return { capDays: Math.max(0, baseDays + adjDays), baseDays, adjs };
}

// THE KEY RULE: first `capDays` worth of shifts (chronologically, within the month)
// that are leave/lop/absent become paid 'leave'; everything past the cap becomes 'lop'.
function normalizeLeaveStatuses(empId, month) {
  const capShifts = getMonthlyLeaveCap(empId, month).capDays * 2; // 2 shifts/day
  const records = getAtt()
    .filter(a => a.empId === empId && a.date.slice(0, 7) === month &&
      (a.status === 'leave' || a.status === 'lop' || a.status === 'absent'))
    .sort((a, b) => a.date.localeCompare(b.date) || a.shift.localeCompare(b.shift));
  let count = 0;
  records.forEach(rec => {
    rec.status = count < capShifts ? 'leave' : 'lop';
    count++;
  });
  // ...save back to gp_att
}
```

Balance calculations layer on top of this:

```javascript
// One month's balance
function getMonthlyLeaveBalance(empId, month) {
  normalizeLeaveStatuses(empId, month); // re-sync first, balances must reflect current attendance
  const { capDays, baseDays, adjs } = getMonthlyLeaveCap(empId, month);
  const monthRecs = getAtt().filter(a => a.empId === empId && a.date.slice(0, 7) === month);
  const used = monthRecs.filter(a => a.status === 'leave').length / 2; // shifts → days
  const lop = monthRecs.filter(a => a.status === 'lop').length / 2;
  return { total: capDays, baseDays, used, remaining: Math.max(0, capDays - used), lop, adjs };
}

// Rolled up across the 6-month period (what the Leave page balance cards show)
function getLeaveBalance(empId, month) {
  const period = getLeavePeriod(month);
  const months = getMonthsInPeriod(period); // all 6 'YYYY-MM' strings in the period
  let total = 0, used = 0, lop = 0;
  const adjs = [];
  months.forEach(ym => {
    const mb = getMonthlyLeaveBalance(empId, ym);
    total += mb.total; used += mb.used; lop += mb.lop; adjs.push(...mb.adjs);
  });
  return { used, total, remaining: Math.max(0, total - used), lop, label: period.label, adjs };
}
```

**Replicate this exactly** — it's the trickiest piece of business logic in the app.
The important subtlety: leave balance isn't just "applications minus cap" — it's
driven by the **attendance records' actual status**, re-synced every time it's
read. An employee who's simply marked `absent` for 3 days (no leave application at
all) still consumes their monthly leave allowance before tipping into LOP.

### 2.11 `AdminAuth` (`gp_auth`)

```json
{ "username": "admin", "password": "admin" }
```

Singleton object (not a list). First read auto-seeds `{username:'admin',
password:'admin'}` if missing — **don't replicate the auto-seed in the mobile
app**; if the node is empty, that means the web app hasn't been opened yet, which
shouldn't happen in practice, but if it does, show a clear "no admin account found"
error rather than silently creating one from a mobile client.

### 2.12 `UserAccount` (`gp_user_acct`) — employee logins, admin-managed

```json
{ "id": "...", "empId": "mqusimvk8aysq", "username": "testtrainer", "password": "pass123", "active": true }
```

One account per employee (`saveUserAcct` upserts by `empId`). Username must be
unique across **both** `gp_user_acct` and not collide with the admin's own
`gp_auth.username`.

---

## 3. Data layer — reading/writing the `_json`-wrapped RTDB nodes

Identical to the employee app — if you're building both apps from one shared Dart
package, reuse this verbatim:

```dart
import 'dart:convert';
import 'package:firebase_database/firebase_database.dart';

class DbService {
  final _db = FirebaseDatabase.instance.ref('gymdata');

  Future<List<dynamic>> readList(String key) async {
    final snap = await _db.child(key).get();
    if (!snap.exists) return [];
    final raw = (snap.value as Map)['_json'] as String?;
    if (raw == null) return [];
    return jsonDecode(raw) as List<dynamic>;
  }

  Future<void> writeList(String key, List<dynamic> data) {
    return _db.child(key).set({'_json': jsonEncode(data)});
  }

  Future<Map<String, dynamic>> readObject(String key) async {
    final snap = await _db.child(key).get();
    if (!snap.exists) return {};
    final raw = (snap.value as Map)['_json'] as String?;
    if (raw == null) return {};
    return jsonDecode(raw) as Map<String, dynamic>;
  }

  Future<void> writeObject(String key, Map<String, dynamic> data) {
    return _db.child(key).set({'_json': jsonEncode(data)});
  }

  Stream<List<dynamic>> watchList(String key) {
    return _db.child(key).onValue.map((event) {
      if (!event.snapshot.exists) return [];
      final raw = (event.snapshot.value as Map)['_json'] as String?;
      if (raw == null) return [];
      return jsonDecode(raw) as List<dynamic>;
    });
  }
}
```

> Every write in this app re-reads, mutates, and writes back the **whole** list for
> a key. With an admin app there's more concurrent-edit risk than the employee app
> (multiple lists are being touched per screen, e.g. approving leave touches both
> `gp_leave_app` and `gp_att`) — keep mutations small and re-fetch immediately
> before each write rather than caching lists across multiple user actions.

---

## 4. Authentication — admin login + password reset

```dart
class AuthResult {
  final bool success;
  final String role; // always 'admin' in this app
  AuthResult(this.success, this.role);
}

class AdminAuthService {
  final _db = DbService();

  Future<AuthResult> login(String username, String password) async {
    final auth = await _db.readObject('gp_auth');
    if (auth['username'] == username && auth['password'] == password) {
      return AuthResult(true, 'admin');
    }
    return AuthResult(false, '');
  }

  Future<bool> changePassword(String current, String next) async {
    final auth = await _db.readObject('gp_auth');
    if (auth['password'] != current) return false; // wrong current password
    await _db.writeObject('gp_auth', {'username': auth['username'], 'password': next});
    return true;
  }
}
```

Session persistence (`shared_preferences`) and the 20-minute inactivity auto-logout
are identical in spirit to the employee app's §5.1 — just store a simple
`isAdminLoggedIn` boolean + timestamp instead of `empId`/`empName`.

---

## 5. Dashboard

Mirrors `renderDash()` (`index.html`, lines ~6315–6381) plus the new
`renderTrainerPerfHtml()` section added below it. Four data sources, all read
fresh on screen load (or via `Stream` if you want live updates):

```dart
class DashboardData {
  final int totalStaff, presentToday, morningShift, eveningShift;
  final num advancesThisMonth, ptCommissionThisMonth;
  final List<TodayAttendanceRow> todayAttendance;
  final List<RecentPunchRow> recentPunches;
  final TrainerPerf? topTrainer;
  final List<TrainerPerf> allTrainers; // sorted by revenue desc
}
```

### 5.1 Stat tiles

```dart
final emps = (await db.readList('gp_emp')).cast<Map<String, dynamic>>();
final att = (await db.readList('gp_att')).cast<Map<String, dynamic>>();
final adv = (await db.readList('gp_adv')).cast<Map<String, dynamic>>();
final activeEmps = emps.where((e) => e['status'] != 'inactive').toList();
final empIds = activeEmps.map((e) => e['id']).toSet();

final today = DateTime.now().toIso8601String().substring(0, 10);
final month = DateTime.now().toIso8601String().substring(0, 7);

bool isPresent(String? s) => s == 'present' || s == 'late' || s == 'half-day';

final todayAtt = att.where((a) =>
    a['date'] == today && isPresent(a['status']) && empIds.contains(a['empId'])).toList();
final presentIds = todayAtt.map((a) => a['empId']).toSet();
final morning = todayAtt.where((a) => a['shift'] == 'morning').length;
final evening = todayAtt.where((a) => a['shift'] == 'evening').length;
final monthAdv = adv
    .where((a) => a['month'] == month && empIds.contains(a['empId']))
    .fold<num>(0, (s, a) => s + (a['amount'] ?? 0));
final monthPtCommission = empIds.fold<num>(
    0, (s, id) => s + getPtCommissionAmount(id, month)); // §2.10/§7 formula

// Tiles: Total Staff = activeEmps.length, Present Today = presentIds.length,
// Morning Shift = morning, Evening Shift = evening,
// Advances This Month = ₹monthAdv, PT Commission = ₹monthPtCommission
```

### 5.2 Today's Attendance + Recent Punches lists

`Today's Attendance` = every active employee, with a computed Present/Absent badge
from that day's morning+evening records. `Recent Punches` = the last 8 attendance
records (any status) across all active employees, sorted by `date` desc then
`shift` desc. **Bound the list height** (e.g. a fixed-height `ListView` inside a
`Card`, ~4–5 rows visible with scroll) rather than letting it grow unbounded — the
web app originally let these two cards grow to whatever height the longer list
needed, which pushed everything below it down by an inconsistent amount; capping
both to a fixed height keeps the rest of the dashboard layout stable regardless of
how much attendance/punch history exists.

### 5.3 Trainer of the Month + performance chart

This is the newest dashboard feature (added after the employee guide was written —
not in that doc, build it fresh here):

```dart
class TrainerPerf {
  final Map<String, dynamic> emp;
  final int sessions;
  final num revenue, commission;
  TrainerPerf(this.emp, this.sessions, this.revenue, this.commission);
}

Future<List<TrainerPerf>> trainerPerformance(DbService db, String month) async {
  final emps = (await db.readList('gp_emp')).cast<Map<String, dynamic>>();
  final pts = (await db.readList('gp_pt')).cast<Map<String, dynamic>>()
      .where((p) => p['month'] == month).toList();
  final trainerIds = pts.map((p) => p['trainerId']).toSet();

  final stats = <TrainerPerf>[];
  for (final id in trainerIds) {
    final emp = emps.cast<Map<String, dynamic>?>().firstWhere((e) => e?['id'] == id, orElse: () => null);
    if (emp == null) continue;
    final tpts = pts.where((p) => p['trainerId'] == id).toList();
    final revenue = tpts.fold<num>(0, (s, p) => s + (p['amount'] ?? 0));
    stats.add(TrainerPerf(emp, tpts.length, revenue, await getPtCommissionAmount(db, id, month)));
  }
  stats.sort((a, b) => b.revenue.compareTo(a.revenue));
  return stats;
}
```

UI: a spotlight card for `stats.first` (avatar circle with first-letter initial,
name, role, Revenue/Sessions/Commission stat trio) in a purple-accented bordered
card, followed by a bar chart (one bar per trainer, ranked by revenue, top trainer's
bar in the brand accent purple, the rest in blue) with a 🥇 marker and value label
under the top bar. Use `fl_chart`'s `BarChart` (already a dependency if you built
the employee app's progress charts) rather than hand-rolling bars.

If no trainer has any PT sessions logged for the current month, show an empty state
("No PT sessions logged this month yet.") instead of the spotlight/chart — don't
show a chart with no bars.

---

## 6. Employees screen

Standard list + modal CRUD over `gp_emp` (§2.1 for the shape and form fields).
List view: name, role, status badge, salary, tap to edit. Deactivating an employee
(`status: 'inactive'`) should be preferred over deleting — it preserves historical
attendance/salary/PT records (the same convention the web app follows; there is a
"delete option" but it should be used carefully since it does not cascade-clean
related attendance/PT/leave records — mirror that same caution in the mobile app,
i.e. don't add a "delete" action without a strong confirmation, and prefer
deactivate as the primary action).

---

## 7. User Accounts screen

CRUD over `gp_user_acct`, one row per active employee showing: name, role,
username (or "No Login"), status badge (Active/Disabled/No Login), and actions
(Create Login / Edit / Disable / Enable / Remove).

```dart
Future<void> saveUserAccount(DbService db, {
  required String empId, required String username, required String password,
}) async {
  final auth = await db.readObject('gp_auth');
  if (username == auth['username']) {
    throw Exception('Username already used by admin login');
  }
  final accts = (await db.readList('gp_user_acct')).cast<Map<String, dynamic>>();
  final clash = accts.any((a) => a['username'] == username && a['empId'] != empId);
  if (clash) throw Exception('Username already taken');

  final idx = accts.indexWhere((a) => a['empId'] == empId);
  if (idx >= 0) {
    accts[idx] = {...accts[idx], 'username': username, 'password': password, 'active': true};
  } else {
    accts.add({'id': DateTime.now().millisecondsSinceEpoch.toString(),
      'empId': empId, 'username': username, 'password': password, 'active': true});
  }
  await db.writeList('gp_user_acct', accts);
}
```

Also surface the **admin's own password reset** here (or in a Profile/Settings
screen) — Current Password / New Password / Confirm New Password, calling
`AdminAuthService.changePassword` (§4).

---

## 8. Attendance & Monthly View

### 8.1 Manual Attendance entry

Mirrors the "Quick Attendance Entry" modal: Employee (dropdown), Date, Shift
(Morning/Evening), Status (Present/Late/Absent/Half Day — **not** Leave/LOP, those
are leave-flow-only per §2.2), and a conditional Reason field shown only when
Status = Late. Upsert one `AttendanceRecord` keyed by `(empId, date, shift)`.

### 8.2 Monthly View grid — the day-code logic

This is the same calendar the employee app's §10 builds (read-only there) — the
admin version is **editable** (tapping a day opens the Manual Attendance modal
pre-filled for that employee/date) and additionally overlays the leave-application
sets from §2.8.1. The exact priority order (each day picks the **first** matching
rule):

```dart
enum DayCode { full, leave, halfLeave, morningOnly, eveningOnly, lop, pending, absent, sunday, future }

DayCell computeDayCell({
  required DateTime date,
  Map<String, dynamic>? morning,
  Map<String, dynamic>? evening,
  required bool isApproved,   // date is in _approvedDates[empId]
  required bool isApprovedHalf, // date is in _approvedHalf[empId]
  required bool isPending,    // date is in _pendingDates[empId]
}) {
  final today = DateTime.now();
  if (date.weekday == DateTime.sunday) return const DayCell(DayCode.sunday, '—');
  if (date.isAfter(DateTime(today.year, today.month, today.day))) {
    return const DayCell(DayCode.future, '·');
  }

  bool isPresent(Map<String, dynamic>? r) =>
      r != null && (r['status'] == 'present' || r['status'] == 'late' || r['status'] == 'half-day');
  final hm = isPresent(morning), he = isPresent(evening);
  final mLeave = morning?['status'] == 'leave', eLeave = evening?['status'] == 'leave';
  final mLop = morning?['status'] == 'lop', eLop = evening?['status'] == 'lop';

  if (hm && he) return const DayCell(DayCode.full, 'F');                       // full day present
  if (mLeave && eLeave) return const DayCell(DayCode.leave, 'L');              // full day paid leave
  if ((mLeave && he) || (eLeave && hm)) return const DayCell(DayCode.halfLeave, 'HL');

  // LOP takes priority over present-only, but shows WHICH shift was actually
  // worked (M/E) rather than collapsing to a bare 'X', when the other shift
  // was worked. Both-LOP (or LOP + genuinely absent) still shows plain 'X'.
  if (mLop || eLop) {
    if (hm || he) return DayCell(DayCode.lop, hm ? 'M' : 'E'); // styled red, not the normal M/E blue
    return const DayCell(DayCode.lop, 'X');
  }

  if (hm) return const DayCell(DayCode.morningOnly, 'M');
  if (he) return const DayCell(DayCode.eveningOnly, 'E');
  if (mLeave || eLeave) return const DayCell(DayCode.halfLeave, 'HL');

  // No attendance record at all yet — fall back to the leave-application overlay
  if (isApproved) return DayCell(DayCode.halfLeave, isApprovedHalf ? 'HL' : 'L'); // 'L' or 'HL'
  if (isPending) return const DayCell(DayCode.pending, 'P');

  return const DayCell(DayCode.absent, 'A');
}
```

> **This differs slightly from the employee guide's version** (written before two
> follow-up fixes): (1) the LOP branch now distinguishes "LOP but the other shift
> was worked" (shows `M`/`E` in red) from "fully LOP/absent" (shows `X`), instead of
> always showing `X`; (2) the employee guide's version didn't include the
> `isApproved`/`isPending` leave-overlay fallback at all, since the employee app
> only reads attendance records directly. The admin app needs both — replicate the
> version above, not the employee guide's.

Color mapping (purple-themed, matches the rebrand): `full` → green tint, `leave`/
`halfLeave` → purple tint, `lop` → red tint, `morningOnly` → blue tint,
`eveningOnly` → purple/accent tint, `pending` → amber tint, `absent` → red
(lighter), `sunday`/`future` → neutral gray.

Tapping any non-future, non-Sunday cell should open the Manual Attendance modal
pre-filled with that employee + date (mirrors the web app's pencil-icon edit
affordance on each cell).

---

## 9. Leave screen

Four sections, matching `renderLeavePage()`:

1. **Balance cards** (one per active employee) — `getLeaveBalance(empId, curMonth)`
   (§2.10): Allowed / Used / Remaining / LOP for the current 6-month period.
2. **Apply Leave** (FAB or button) — Employee*, Leave Type* (Full/Half day),
   From Date*, To Date*, computed Working Days (Sundays excluded), Reason*. Submits
   a `pending` `LeaveApplication` (§2.8) — does **not** touch attendance until
   approved.
3. **Pending requests** — table/list of `status == 'pending'` apps with
   Approve/Reject actions (§2.8's `approveLeave`/`rejectLeave`), and an Edit action
   opening the same form pre-filled, additionally exposing a Status dropdown
   (Pending/Approved/Rejected) for direct admin override (§2.8's `saveEditedLeave`
   — remember to undo old attendance marks before reapplying if status changes).
4. **Update Leave Balance** (adjustment) — Employee*, Month*, Adjustment Type*
   (Add Days / Deduct Days / Set Total Allowed Days), Days*, Reason* — writes a
   `LeaveAdjustment` (§2.9), remembering the `set` type needs the delta computed
   client-side exactly as shown there, not a raw `days` value.

---

## 10. Salary screen

### 10.1 The calculation — replicate `calcSalary(emp, month)` exactly

```dart
class SalaryCalc {
  final int mp, ep;                  // morning/evening present-shift counts
  final num paidLeaveShifts, lopShifts, absentShifts;
  final num wd, shiftsPerDay, perShift;
  final num earned, absentDeduction, lopDeduction;
  final num totalAdv, ptRevenue, ptRate, ptCommission, net, base;
  SalaryCalc({ /* ... */ });
}

Future<SalaryCalc> calcSalary(DbService db, Map<String, dynamic> emp, String month) async {
  // 0. Re-sync leave/LOP status first — salary must reflect current attendance
  await normalizeLeaveStatuses(db, emp['id'], month);

  final att = (await db.readList('gp_att')).cast<Map<String, dynamic>>();
  final adv = (await db.readList('gp_adv')).cast<Map<String, dynamic>>();
  final parts = month.split('-').map(int.parse).toList();
  final daysInMonth = DateTime(parts[0], parts[1] + 1, 0).day;
  final wd = (emp['wdays'] ?? 26) as num;
  final shiftsPerDay = ((hasMorning(emp) ? 1 : 0) + (hasEvening(emp) ? 1 : 0)).clamp(1, 2);
  final perShift = (emp['salary'] as num) / (wd * shiftsPerDay);

  // Approved leave-application dates not yet reflected as attendance records
  final approvedDates = <String>{};
  for (final a in await db.readList('gp_leave_app')) {
    final app = a as Map<String, dynamic>;
    if (app['empId'] != emp['id'] || app['status'] != 'approved') continue;
    var d = DateTime.parse(app['fromDate']);
    final end = DateTime.parse(app['toDate']);
    while (!d.isAfter(end)) { approvedDates.add(d.toIso8601String().substring(0, 10)); d = d.add(const Duration(days: 1)); }
  }

  int mp = 0, ep = 0;
  num paidLeaveShifts = 0, lopShifts = 0, absentShifts = 0;
  for (var day = 1; day <= daysInMonth; day++) {
    final ds = '$month-${day.toString().padLeft(2, '0')}';
    final mr = att.cast<Map<String, dynamic>?>().firstWhere((a) => a?['empId'] == emp['id'] && a?['date'] == ds && a?['shift'] == 'morning', orElse: () => null);
    final er = att.cast<Map<String, dynamic>?>().firstWhere((a) => a?['empId'] == emp['id'] && a?['date'] == ds && a?['shift'] == 'evening', orElse: () => null);
    final onApprovedLeave = approvedDates.contains(ds);

    if (isPresentStatus(mr?['status'])) mp++;
    if (isPresentStatus(er?['status'])) ep++;

    if (mr?['status'] == 'leave') paidLeaveShifts++;
    else if (mr == null && onApprovedLeave && hasMorning(emp)) paidLeaveShifts++;
    if (er?['status'] == 'leave') paidLeaveShifts++;
    else if (er == null && onApprovedLeave && hasEvening(emp)) paidLeaveShifts++;

    if (mr?['status'] == 'lop') lopShifts++;
    if (er?['status'] == 'lop') lopShifts++;
    if (mr?['status'] == 'absent') absentShifts++;
    if (er?['status'] == 'absent') absentShifts++;
  }

  final earned = (mp + ep + paidLeaveShifts) * perShift;                 // ← core formula
  final totalAdv = adv.where((a) => a['empId'] == emp['id'] && a['month'] == month)
      .fold<num>(0, (s, a) => s + (a['amount'] ?? 0));
  final ptRevenue = await getPtTotal(db, emp['id'], month);
  final ptRate = await getPtRate(db, emp['id'], month);
  final ptCommission = await getPtCommissionAmount(db, emp['id'], month);

  return SalaryCalc(
    /* mp, ep, paidLeaveShifts, lopShifts, absentShifts, wd, shiftsPerDay, perShift, */
    earned: earned,
    absentDeduction: absentShifts * perShift,
    lopDeduction: lopShifts * perShift,
    totalAdv: totalAdv, ptRevenue: ptRevenue, ptRate: ptRate, ptCommission: ptCommission,
    net: earned - totalAdv + ptCommission,                                // ← net salary formula
    base: emp['salary'],
  );
}
```

**Net salary = (present shifts + paid-leave shifts) × per-shift rate − total
advances + PT commission.** LOP and plain-absent shifts simply aren't counted in
`earned` at all — there's no separate "deduction line" subtracted from a full
salary, the formula only ever pays for shifts actually worked or on paid leave.
(`absentDeduction`/`lopDeduction` are computed for **display only**, e.g. showing
"⚠️ LOP (unpaid): 2 shifts — ₹620 not earned" on the slip — they aren't subtracted
a second time from `net`.)

### 10.2 Screen layout

Per active employee: Base Salary, Morning/Evening shift counts, Days Present /
Working Days, Earned (green), Paid Leave Shifts, LOP Shifts, Absent Shifts, Advance
Deduction (red), PT Commission % + amount (blue, only if they have PT revenue), Net
Payable (large, brand accent purple), and action buttons: **Details**, **🖨 Slip**,
**Mark Paid / Undo**.

"Mark Paid" writes a `PayRecord` (§2.4) with the rounded `net` as a frozen snapshot;
"Undo" removes that record (doesn't recompute anything, just deletes the payment
marker).

### 10.3 Salary slip

A printable/shareable breakdown per employee+month: header (💪 FitWave Pro / Salary
Slip — {Month}), then Morning Shifts (count × rate), Evening Shifts, Paid Leave
Shifts, LOP shifts (unpaid, informational), Absent shifts (unpaid, informational),
Gross Earned, each Advance line item, PT Commission (+), **Net Payable**, and the
period's Leave Balance summary. On mobile, generate this as a `pdf` package
document (or share as styled text/image) rather than relying on browser print —
see §11 for the export approach generally.

---

## 11. PT Sessions & PT Packages (admin scope)

Build these exactly as described in the employee guide §6–§9, with one change
throughout: **drop every `trainerId == empId` filter.** The admin sees/edits PT
Sessions and PT Packages across **all** trainers, with a Trainer picker (dropdown
of active employees) instead of a value locked to the logged-in user. Additionally:

- The admin can set a **manual commission rate override** per trainer+month
  (`gp_pt_rate`, §2.6) — add a small editable field next to the auto-computed rate;
  saving writes/upserts a `PtRateOverride` record, clearing it (or setting it back
  to "Auto") removes the override and falls back to the tier formula:

  ```dart
  num ptCommissionRate(num amount) { // returns a 0.0–1.0 fraction
    if (amount > 30000) return 0.4;
    if (amount >= 15000) return 0.3;
    return 0.2;
  }

  Future<num> getPtRate(DbService db, String trainerId, String month) async {
    final overrides = (await db.readList('gp_pt_rate')).cast<Map<String, dynamic>>();
    final override = overrides.cast<Map<String, dynamic>?>()
        .firstWhere((r) => r?['trainerId'] == trainerId && r?['month'] == month, orElse: () => null);
    if (override != null) return override['rate'];
    final total = await getPtTotal(db, trainerId, month);
    return (ptCommissionRate(total) * 100).round();
  }
  ```

- The **Workout Plan** field in the package session checklist is **editable** by
  admin (it's the employee app that locks it read-only) — don't carry over that
  restriction here.
- The Progress Report charts (bar + line, §9.3–9.4 of the employee guide) and
  improvement-score/manual-verdict logic (§9.5) are identical — reuse verbatim.

---

## 12. Advances screen

Standard CRUD over `gp_adv` (§2.3): list filtered by Employee + Month, columns
Employee / Date / Amount / Month / Reason / Actions. Form fields: Employee*,
Date*, For Month* (month picker — what salary month this deducts from, which can
differ from the date it was actually given), Amount (₹)*, Reason. No special
business logic beyond the shape itself — salary calculation (§10.1) is what
actually consumes these records.

---

## 13. Excel / report export on mobile

The web app exports via Electron's `ipcMain.handle('save-excel', ...)` (`main.js`),
which writes an `.xlsx` straight to a `report/` folder under the OS Documents
directory using the `xlsx` npm package, given `{ fileName, sheets: [{ name,
headers, rows }] }`. There's no Electron/filesystem equivalent on mobile — replace
it with:

```bash
flutter pub add excel share_plus path_provider
```

```dart
import 'package:excel/excel.dart' as xl;
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';
import 'dart:io';

Future<void> exportAndShare(String fileName, List<ReportSheet> sheets) async {
  final workbook = xl.Excel.createExcel();
  for (final sheet in sheets) {
    final ws = workbook[sheet.name];
    ws.appendRow(sheet.headers.map((h) => xl.TextCellValue(h)).toList());
    for (final row in sheet.rows) {
      ws.appendRow(sheet.headers.map((h) => xl.TextCellValue('${row[h] ?? ''}')).toList());
    }
  }
  workbook.delete('Sheet1'); // excel package's default empty sheet

  final dir = await getTemporaryDirectory();
  final file = File('${dir.path}/$fileName')..writeAsBytesSync(workbook.encode()!);
  await Share.shareXFiles([XFile(file.path)], subject: fileName);
}

class ReportSheet {
  final String name;
  final List<String> headers;
  final List<Map<String, dynamic>> rows;
  ReportSheet(this.name, this.headers, this.rows);
}
```

Replicate the same two reports the web app produces:

- **Monthly Salary Report** — one row per employee: Employee, Role, Month, Base
  Salary, Working Days, Present Days, Morning Shifts, Evening Shifts, Paid Leave
  Shifts, LOP Shifts, Absent Shifts, Earned, PT Revenue, PT Commission, Advance
  Deduction, Net Payable, Payment Status, Paid Date.
- **Weekly Summary Report** — same idea over a rolling 7-day period: Employee,
  Role, Period, Morning Shifts, Evening Shifts, Present Days, Paid Leave Shifts,
  LOP Shifts, Absent Shifts, Estimated Earned, PT Revenue, PT Commission, Advance
  Deduction, Net Estimate.

Both are built from the same `calcSalary()` (§10.1) run across all active
employees for the relevant period — the export is just that data flattened into
rows, there's no separate calculation path.

The salary **slip** (§10.3) is better exported as a PDF (`pdf` package) than an
Excel sheet, since it's a single-employee formatted document meant to be
printed/shared, not tabular data.

---

## 14. Navigation structure

Mirror the current web app sidebar groupings exactly (this was reorganized
recently — Profile and User Accounts now live in their own bottom section, not
under Main):

```
Main
 ├─ Dashboard
 └─ Employees
Attendance
 ├─ Attendance (daily/manual entry)
 ├─ Monthly View
 └─ Leave
Finance
 ├─ Salary
 ├─ PT Sessions
 ├─ PT Packages
 └─ Advances
Account
 ├─ Profile
 └─ User Accounts
```

Use a `NavigationDrawer`/`NavigationRail` (tablet) or a bottom-sheet "More" menu +
bottom nav bar (phone) — the web app itself collapses to a bottom nav + "More"
sheet below a mobile breakpoint, which is a reasonable pattern to mirror directly
for the phone form factor rather than inventing a new one.

---

## 15. Branding & theming

The app was rebranded to **FitWave Pro** with a purple theme (previously "GymPro"
with an amber theme — if you're referencing the employee guide, ignore its colors,
they're stale).

```dart
MaterialApp(
  title: 'FitWave Pro — Admin',
  theme: ThemeData(
    brightness: Brightness.dark,
    colorSchemeSeed: const Color(0xFFA855F7), // --accent
    useMaterial3: true,
  ),
)
```

Core palette (from `index.html`'s `:root`): background `#0A0A0A`, card `#1A1A1A`,
border `#2A2A2A`, accent `#A855F7` → `#7C3AED` (gradient/hover), green `#10B981`
(present/success), red `#EF4444` (absent/error), blue `#3B82F6` (morning/info),
text `#F3F4F6` / `#9CA3AF` / `#6B7280`. **Keep green/red/blue as-is** — those are
semantic status colors (present/absent/morning), not brand colors, and changing
them would hurt at-a-glance readability that matches the web app.

A dedicated app icon (the dumbbell + heartbeat "FW" mark, purple gradient) exists
but hasn't been dropped into the project yet — once available, save it as
`assets/icon/app_icon.png` and run `flutter pub run flutter_launcher_icons` to
generate platform icons, and use it in place of the 💪 emoji on the login screen,
loading state, and any printed slip/report headers.

---

## 16. Recommended security hardening

Identical situation and recommendation as the employee app's §11 — **anyone with
the Firebase config can read/write the entire `gymdata` node**, since there are no
RTDB security rules. This matters *more* for the admin app, since it touches every
table including salary and login credentials:

```json
{
  "rules": {
    ".read": "auth != null",
    ".write": "auth != null"
  }
}
```

Pair with `FirebaseAuth.instance.signInAnonymously()` at startup (in **both** the
admin and employee apps, and ideally the web app too) as a low-effort floor that
at least requires *a* valid Firebase session before touching data, without
changing the existing custom username/password UX. A real fix — migrating off
plain-text passwords entirely — is a larger cross-app project; flag it separately
rather than bolting it onto this build.

---

## 17. Quick checklist

- [ ] `flutterfire configure` points at the existing `gympro-3459f` project
- [ ] Login checks `gp_auth` (admin), not `gp_user_acct`
- [ ] Dashboard caps the Today's Attendance / Recent Punches list heights so layout doesn't shift with data volume
- [ ] Trainer of the Month spotlight handles the "no PT sessions this month" empty state
- [ ] Monthly View day-code logic matches §8.2 exactly, including the LOP→M/E-in-red refinement and the leave-application overlay fallback (`isApproved`/`isPending`)
- [ ] Leave balance reads always call `normalizeLeaveStatuses` first (balances must reflect synced attendance, not stale leave/lop flags)
- [ ] Leave adjustment "Set Total Allowed Days" computes a signed delta client-side exactly as shown in §2.9 — never stores the raw target as `days`
- [ ] Salary `net` formula matches §10.1 precisely: `(present + paidLeave shifts) × perShift − advances + ptCommission`
- [ ] PT commission rate override (`gp_pt_rate`) takes priority over the auto tier; clearing it reverts to auto
- [ ] PT Packages / PT Sessions have no `trainerId`/`empId` filter anywhere (full admin visibility), with a Trainer picker on create
- [ ] Workout Plan field is editable here (unlike the employee app)
- [ ] User Accounts blocks usernames that collide with the admin's own `gp_auth.username` or another employee's account
- [ ] Excel export reproduces both the Monthly Salary Report and Weekly Summary Report column sets from §13
- [ ] Theme uses the FitWave Pro purple accent (`#A855F7`/`#7C3AED`), not the old GymPro amber
- [ ] (Optional) Firebase Anonymous Auth + RTDB rules added per §16
