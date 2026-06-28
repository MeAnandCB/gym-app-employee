# GymPro Employee App — Flutter Build Guide

This guide walks through building a Flutter mobile app that connects to the **same
Firebase Realtime Database** as the GymPro web app (`index.html`), but scoped to
**only the employee-facing features**:

- Employee login
- **PT Sessions** — the trainer's own financial PT entries + monthly commission (read-only)
- **PT Packages** — view/create PT packages, tick off sessions, log workouts
- **Final Progress Charts** — the before/after bar + line chart comparison report
- **Monthly Attendance** — the trainer's own read-only monthly attendance calendar

It does **not** cover admin features (Employees, Salary for other staff, Advances,
Leave management, etc.) — the Flutter app is intentionally a single-purpose
companion app for trainers to manage their own clients and check their own records.

> Note: in the web app today, an employee's role is restricted to only the **PT
> Sessions** and **PT Packages** pages — there's no employee-facing Monthly
> Attendance view yet. Adding it to the mobile app (read-only, scoped to their own
> records) is a reasonable companion-app feature even though the web app doesn't
> expose it for that role yet; if you also want this exposed in the web app, treat
> that as a separate follow-up task.

---

## 1. How the web app's data & auth actually work (read this first)

Before writing any Flutter code, understand three things about the existing system,
because the mobile app must replicate them exactly:

1. **There is no Firebase Authentication.** Login is fully custom: usernames and
   passwords are stored in plain text inside the Realtime Database itself, and the
   web app just does a string comparison. The Flutter app needs to do the same
   comparison — it will *not* use `firebase_auth`.
2. **All data lives under one RTDB node: `gymdata`.** Each "table" (employees,
   attendance, PT packages, etc.) is a child of `gymdata`, and its value is always
   wrapped as `{ "_json": "<stringified array>" }` — not a plain array/object. You
   must `jsonDecode` that inner string after reading.
3. **Role scoping (admin vs employee) is enforced client-side only.** The Realtime
   Database currently has no security rules restricting who can read/write what.
   The mobile app should filter data to "this employee's own records" the same way
   the web app does, but understand that this is a UI-level convention, not a
   server-enforced one (see [§11 Security](#11-recommended-security-hardening)).

### 1.1 Firebase project details

Reuse the exact same Firebase project as the web app — do not create a new one.

```
apiKey:            AIzaSyCeF7lqNDU28omkaF2tTKZSd2PBN0vVlKw
authDomain:         gympro-3459f.firebaseapp.com
databaseURL:        https://gympro-3459f-default-rtdb.firebaseio.com
projectId:          gympro-3459f
storageBucket:       gympro-3459f.firebasestorage.app
messagingSenderId:  630686270326
appId:              1:630686270326:web:7047e9aaeca06c107df057
```

You'll register a new **Android** and/or **iOS** app under this same project via
`flutterfire configure` (step 3) — that generates platform-specific config files
(`google-services.json` / `GoogleService-Info.plist`) automatically; you don't need
to type the values above by hand anywhere except as a sanity check.

### 1.2 Relevant data keys

The web app's `K` lookup table maps logical names to RTDB child keys. The ones the
employee app needs:

| Logical name | RTDB key under `gymdata/` | Shape |
|---|---|---|
| Employees | `gp_emp` | `Employee[]` |
| User accounts (employee logins) | `gp_user_acct` | `UserAccount[]` |
| Admin auth | `gp_auth` | `{ username, password }` |
| PT Packages | `gp_pt_pkg` | `PtPackage[]` |
| PT Sessions (financial entries) | `gp_pt` | `PtSession[]` |
| PT Commission rate overrides | `gp_pt_rate` | `PtRateOverride[]` |
| Attendance | `gp_att` | `AttendanceRecord[]` |

### 1.3 `UserAccount` shape (employee login records)

```json
{
  "id": "mqv4ox6stoz5k",
  "empId": "mqusimvk8aysq",
  "username": "testtrainer",
  "password": "pass123",
  "active": true
}
```

### 1.4 `Employee` shape (only the fields you need)

```json
{
  "id": "mqusimvk8aysq",
  "name": "Abhijith",
  "role": "Trainer",
  "status": "active"
}
```

### 1.5 `PtPackage` shape (this is the core data model)

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
  "endStats": { },
  "endMeasurements": { },
  "manualVerdicts": { "chest": "improved" },
  "createdBy": "admin"
}
```

`type` is one of: `12session` (12 sessions), `1month` (1 month), `couple`, `group` —
but for the **package tracker** (the part this app cares about) only `12session` and
`24session` are used, each defining `totalSessions`.

Each entry in `sessions[]` corresponds 1:1 by index to "Session 1", "Session 2", etc.
Ticking a session sets `done: true` and stamps `date` to today if empty.

### 1.6 `PtSession` shape (financial PT entry — separate from `PtPackage`)

This is a different, simpler record than the package tracker — it's just "trainer X
earned ₹Y from a PT session on date Z", used purely for commission calculation.

```json
{
  "id": "mqv4ox6stoz5k",
  "trainerId": "mqusimvk8aysq",
  "date": "2026-06-15",
  "shift": "morning",
  "type": "12session",
  "amount": 1500,
  "notes": "",
  "month": "2026-06"
}
```

`type` here is the plan label only (`12session` / `1month` / `couple` / `group`) —
it's just descriptive, it does **not** drive a session checklist like `PtPackage`
does.

### 1.7 `PtRateOverride` shape (admin-set commission %, read-only for employees)

```json
{ "id": "mqv4ox6stoz5k", "trainerId": "mqusimvk8aysq", "month": "2026-06", "rate": 35 }
```

If no override exists for a trainer+month, the commission rate is auto-tiered off
the trainer's **total** PT amount for that month:

| Total monthly PT amount | Commission rate |
|---|---|
| > ₹30,000 | 40% |
| ₹15,000 – ₹30,000 | 30% |
| < ₹15,000 | 20% |

### 1.8 `AttendanceRecord` shape

```json
{ "empId": "mqusimvk8aysq", "date": "2026-06-15", "shift": "morning", "status": "present", "reason": "" }
```

`status` is one of: `present`, `late`, `half-day` (all count as "worked"), `leave`
(paid leave), `lop` (loss of pay — leave taken beyond the monthly allowance),
`absent` (unpaid, not yet converted to leave/LOP). There's one record per
employee+date+shift — an employee with both morning and evening shifts has up to
two records per day.

---

## 2. Prerequisites

- Flutter SDK installed (`flutter doctor` clean)
- A Google account with access to the `gympro-3459f` Firebase project (ask the
  project owner to add you as an Editor if you don't have access yet)
- Android Studio / Xcode for platform builds
- Node.js (only needed for the `flutterfire` CLI, which runs via `dart pub global`)

---

## 3. Create the Flutter project & connect Firebase

```bash
flutter create gympro_employee_app
cd gympro_employee_app

flutter pub add firebase_core firebase_database

dart pub global activate flutterfire_cli
flutterfire configure --project=gympro-3459f
```

`flutterfire configure` will prompt you to pick platforms (Android/iOS/Web) and will:
- Register new app entries under the **existing** `gympro-3459f` project (it does
  **not** create a new project — make sure you select `gympro-3459f` from the list)
- Generate `lib/firebase_options.dart`
- Drop `google-services.json` into `android/app/`
- Drop `GoogleService-Info.plist` into `ios/Runner/` (if you picked iOS)

In `lib/main.dart`:

```dart
import 'package:flutter/material.dart';
import 'package:firebase_core/firebase_core.dart';
import 'firebase_options.dart';
import 'screens/login_screen.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Firebase.initializeApp(options: DefaultFirebaseOptions.currentPlatform);
  runApp(const GymProEmployeeApp());
}

class GymProEmployeeApp extends StatelessWidget {
  const GymProEmployeeApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'GymPro — PT Details',
      theme: ThemeData(
        brightness: Brightness.dark,
        colorSchemeSeed: const Color(0xFFF59E0B), // matches the web app's accent orange
        useMaterial3: true,
      ),
      home: const LoginScreen(),
    );
  }
}
```

---

## 4. Data layer — reading/writing the `_json`-wrapped RTDB nodes

Create `lib/services/db_service.dart`. This is the single place that knows about the
`{ "_json": "..." }` wrapping convention, so every other file can work with plain
Dart lists/maps.

```dart
import 'dart:convert';
import 'package:firebase_database/firebase_database.dart';

class DbService {
  final _db = FirebaseDatabase.instance.ref('gymdata');

  /// Reads a node (e.g. 'gp_pt_pkg') and returns it as a decoded List.
  Future<List<dynamic>> readList(String key) async {
    final snap = await _db.child(key).get();
    if (!snap.exists) return [];
    final raw = (snap.value as Map)['_json'] as String?;
    if (raw == null) return [];
    return jsonDecode(raw) as List<dynamic>;
  }

  /// Writes a full list back, wrapped the same way the web app expects.
  Future<void> writeList(String key, List<dynamic> data) {
    return _db.child(key).set({'_json': jsonEncode(data)});
  }

  /// Reads a single object node (e.g. 'gp_auth').
  Future<Map<String, dynamic>> readObject(String key) async {
    final snap = await _db.child(key).get();
    if (!snap.exists) return {};
    final raw = (snap.value as Map)['_json'] as String?;
    if (raw == null) return {};
    return jsonDecode(raw) as Map<String, dynamic>;
  }

  /// Live stream of a list node — use this for the PT Packages screen so it
  /// updates in real time when admin edits something from the web app.
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

> **Why read-modify-write the whole list instead of updating one item?** That's
> exactly what the web app does too (`save()` always writes the entire array back).
> It keeps both apps consistent and avoids needing per-record RTDB paths. The
> trade-off is a small risk of last-write-wins if two devices edit the *same*
> package at the *exact* same moment — acceptable for a small-gym use case.

---

## 5. Authentication — replicating the custom login

Create `lib/services/auth_service.dart`:

```dart
import 'db_service.dart';

class AuthResult {
  final bool success;
  final String role; // 'employee' (this app never logs in as admin)
  final String empId;
  final String empName;
  AuthResult(this.success, this.role, this.empId, this.empName);
}

class AuthService {
  final _db = DbService();

  Future<AuthResult> login(String username, String password) async {
    final accounts = await _db.readList('gp_user_acct');
    final match = accounts.cast<Map<String, dynamic>>().firstWhere(
      (a) => a['username'] == username && a['password'] == password && a['active'] != false,
      orElse: () => {},
    );
    if (match.isEmpty) return AuthResult(false, '', '', '');

    final employees = await _db.readList('gp_emp');
    final emp = employees.cast<Map<String, dynamic>>().firstWhere(
      (e) => e['id'] == match['empId'],
      orElse: () => {},
    );
    if (emp.isEmpty || emp['status'] == 'inactive') {
      return AuthResult(false, '', '', ''); // login disabled / employee removed
    }

    return AuthResult(true, 'employee', emp['id'] as String, emp['name'] as String);
  }
}
```

> Note this app **only** authenticates against `gp_user_acct` (employee logins) —
> it deliberately does not check `gp_auth` (the admin password), since this app has
> no admin screens for that login to unlock anyway.

### 5.1 Persisting the session locally

Use `shared_preferences` so the trainer doesn't have to log in every time they open
the app:

```bash
flutter pub add shared_preferences
```

```dart
import 'package:shared_preferences/shared_preferences.dart';

class SessionStore {
  static const _kEmpId = 'emp_id';
  static const _kEmpName = 'emp_name';

  static Future<void> save(String empId, String empName) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_kEmpId, empId);
    await prefs.setString(_kEmpName, empName);
  }

  static Future<({String empId, String empName})?> read() async {
    final prefs = await SharedPreferences.getInstance();
    final empId = prefs.getString(_kEmpId);
    final empName = prefs.getString(_kEmpName);
    if (empId == null) return null;
    return (empId: empId, empName: empName ?? '');
  }

  static Future<void> clear() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_kEmpId);
    await prefs.remove(_kEmpName);
  }
}
```

The web app auto-logs-out after **20 minutes** of inactivity (see `isLoggedIn()` in
`index.html`). You can mirror this by storing a login timestamp alongside `empId` and
checking `DateTime.now().difference(loginTime) > Duration(minutes: 20)` on app
resume — optional, but keeps behavior consistent across web and mobile.

### 5.2 Login screen

```dart
import 'package:flutter/material.dart';
import '../services/auth_service.dart';
import '../services/session_store.dart';
import 'pt_packages_screen.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});
  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _userCtrl = TextEditingController();
  final _passCtrl = TextEditingController();
  bool _loading = false;
  String? _error;

  Future<void> _submit() async {
    setState(() { _loading = true; _error = null; });
    final result = await AuthService().login(_userCtrl.text.trim(), _passCtrl.text);
    setState(() => _loading = false);
    if (!result.success) {
      setState(() => _error = 'Invalid username or password');
      return;
    }
    await SessionStore.save(result.empId, result.empName);
    if (!mounted) return;
    Navigator.pushReplacement(context, MaterialPageRoute(
      builder: (_) => PtPackagesScreen(empId: result.empId, empName: result.empName),
    ));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Text('💪 GymPro', style: TextStyle(fontSize: 28, fontWeight: FontWeight.bold)),
              const Text('PT Details — Trainer Login'),
              const SizedBox(height: 24),
              TextField(controller: _userCtrl, decoration: const InputDecoration(labelText: 'Username')),
              const SizedBox(height: 12),
              TextField(controller: _passCtrl, obscureText: true, decoration: const InputDecoration(labelText: 'Password')),
              if (_error != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text(_error!, style: const TextStyle(color: Colors.red))),
              const SizedBox(height: 20),
              FilledButton(
                onPressed: _loading ? null : _submit,
                child: _loading ? const CircularProgressIndicator() : const Text('Login'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
```

---

## 6. PT Sessions screen (financial — read-only)

This mirrors the web app's "PT Sessions" page for an employee: their own logged PT
sessions for a month, the total amount, and their commission — but **read-only** for
the rate itself, since only admin can change a trainer's commission % (see §1.7).

```dart
import 'package:flutter/material.dart';
import '../services/db_service.dart';

class PtSessionsScreen extends StatefulWidget {
  final String empId;
  const PtSessionsScreen({super.key, required this.empId});
  @override
  State<PtSessionsScreen> createState() => _PtSessionsScreenState();
}

class _PtSessionsScreenState extends State<PtSessionsScreen> {
  String _month = DateTime.now().toIso8601String().substring(0, 7); // 'yyyy-MM'

  int _commissionRate(List<Map<String, dynamic>> rateOverrides, num total) {
    final override = rateOverrides.firstWhere(
      (r) => r['trainerId'] == widget.empId && r['month'] == _month,
      orElse: () => {},
    );
    if (override.isNotEmpty) return override['rate'] as int;
    if (total > 30000) return 40;
    if (total >= 15000) return 30;
    return 20;
  }

  @override
  Widget build(BuildContext context) {
    final db = DbService();
    return Scaffold(
      appBar: AppBar(title: const Text('PT Sessions')),
      body: FutureBuilder(
        future: Future.wait([db.readList('gp_pt'), db.readList('gp_pt_rate')]),
        builder: (context, snap) {
          if (!snap.hasData) return const Center(child: CircularProgressIndicator());
          final sessions = (snap.data![0]).cast<Map<String, dynamic>>()
              .where((p) => p['trainerId'] == widget.empId && p['month'] == _month)
              .toList();
          final rateOverrides = (snap.data![1]).cast<Map<String, dynamic>>();
          final total = sessions.fold<num>(0, (s, p) => s + (p['amount'] ?? 0));
          final rate = _commissionRate(rateOverrides, total);
          final commission = (total * rate / 100).round();

          return Column(
            children: [
              Card(
                margin: const EdgeInsets.all(12),
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceAround,
                    children: [
                      _StatTile(label: 'Sessions', value: '${sessions.length}'),
                      _StatTile(label: 'Total Amount', value: '₹$total'),
                      _StatTile(label: 'Commission ($rate%)', value: '₹$commission'),
                    ],
                  ),
                ),
              ),
              Expanded(
                child: ListView.builder(
                  itemCount: sessions.length,
                  itemBuilder: (context, i) {
                    final s = sessions[i];
                    return ListTile(
                      title: Text('₹${s['amount']} — ${s['date']}'),
                      subtitle: Text('${s['shift']} • ${s['type']}${(s['notes'] ?? '').isNotEmpty ? ' • ${s['notes']}' : ''}'),
                    );
                  },
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}

class _StatTile extends StatelessWidget {
  final String label, value;
  const _StatTile({required this.label, required this.value});
  @override
  Widget build(BuildContext context) => Column(
    children: [
      Text(value, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
      Text(label, style: const TextStyle(fontSize: 11, color: Colors.grey)),
    ],
  );
}
```

> Don't add a UI for editing `rate` — that mirrors the web app, where the commission
> % editor inside the trainer detail modal is admin-only and hidden for the employee
> role entirely.

A trainer **can** log their own new PT session (the web app allows this too, since
the financial PT entry form isn't gated to admin-only). To add one, append to
`gp_pt` the same way §7.1 appends to `gp_pt_pkg`, locking `trainerId` to `empId`:

```dart
Future<void> logPtSession({
  required String empId,
  required String date,
  required String shift, // 'morning' | 'evening'
  required String type,  // '12session' | '1month' | 'couple' | 'group'
  required num amount,
  String notes = '',
}) async {
  final db = DbService();
  final sessions = await db.readList('gp_pt');
  sessions.add({
    'id': DateTime.now().millisecondsSinceEpoch.toString(),
    'trainerId': empId,
    'date': date,
    'shift': shift,
    'type': type,
    'amount': amount,
    'notes': notes,
    'month': date.substring(0, 7),
  });
  await db.writeList('gp_pt', sessions);
}
```

---

## 7. PT Packages list screen ("PT Details")

This mirrors the web app's employee-scoped PT Details page: only packages where
`trainerId == empId`.

```dart
import 'package:flutter/material.dart';
import '../services/db_service.dart';
import 'package_detail_screen.dart';

class PtPackagesScreen extends StatelessWidget {
  final String empId;
  final String empName;
  const PtPackagesScreen({super.key, required this.empId, required this.empName});

  @override
  Widget build(BuildContext context) {
    final db = DbService();
    return Scaffold(
      appBar: AppBar(title: Text('PT Details — $empName')),
      floatingActionButton: FloatingActionButton.extended(
        icon: const Icon(Icons.add),
        label: const Text('New Package'),
        onPressed: () {}, // see §7.1 below
      ),
      body: StreamBuilder<List<dynamic>>(
        stream: db.watchList('gp_pt_pkg'),
        builder: (context, snap) {
          if (!snap.hasData) return const Center(child: CircularProgressIndicator());
          final mine = snap.data!
              .cast<Map<String, dynamic>>()
              .where((p) => p['trainerId'] == empId)
              .toList();
          if (mine.isEmpty) return const Center(child: Text('No PT packages yet'));
          return ListView.builder(
            padding: const EdgeInsets.all(12),
            itemCount: mine.length,
            itemBuilder: (context, i) {
              final pkg = mine[i];
              final sessions = (pkg['sessions'] as List).cast<Map<String, dynamic>>();
              final done = sessions.where((s) => s['done'] == true).length;
              final total = sessions.length;
              return Card(
                child: ListTile(
                  title: Text(pkg['clientName'] ?? ''),
                  subtitle: Text('${pkg['type']} • $done / $total sessions'),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () => Navigator.push(context, MaterialPageRoute(
                    builder: (_) => PackageDetailScreen(packageId: pkg['id'], empId: empId),
                  )),
                ),
              );
            },
          );
        },
      ),
    );
  }
}
```

### 7.1 Creating a new package

Read-modify-write the `gp_pt_pkg` list, same shape as §1.5, with `trainerId` locked
to the logged-in employee's `empId` (mirrors `openPtPkgModal()` in the web app
disabling the trainer dropdown for employee role):

```dart
Future<void> createPackage({
  required String empId,
  required String clientName,
  required String type, // '12session' or '24session'
  required String startDate, // 'yyyy-MM-dd'
  required String dueDate,
}) async {
  final db = DbService();
  final packages = await db.readList('gp_pt_pkg');
  final totalSessions = type == '24session' ? 24 : 12;
  final newPkg = {
    'id': DateTime.now().millisecondsSinceEpoch.toString(),
    'trainerId': empId,
    'clientName': clientName,
    'type': type,
    'totalSessions': totalSessions,
    'startDate': startDate,
    'dueDate': dueDate,
    'notes': '',
    'sessions': List.generate(totalSessions, (_) => {
      'done': false, 'date': '', 'timeIn': '', 'timeOut': '', 'plan': '', 'workout': '', 'remarks': ''
    }),
    'stats': {},
    'measurements': {},
    'manualVerdicts': {},
    'createdBy': 'employee',
  };
  packages.add(newPkg);
  await db.writeList('gp_pt_pkg', packages);
}
```

---

## 8. Package detail / session checklist screen

This mirrors `renderPtPkgDetail()` + `togglePkgSession()` in the web app.

```dart
import 'package:flutter/material.dart';
import '../services/db_service.dart';

class PackageDetailScreen extends StatelessWidget {
  final String packageId;
  final String empId;
  const PackageDetailScreen({super.key, required this.packageId, required this.empId});

  @override
  Widget build(BuildContext context) {
    final db = DbService();
    return Scaffold(
      appBar: AppBar(title: const Text('Sessions')),
      body: StreamBuilder<List<dynamic>>(
        stream: db.watchList('gp_pt_pkg'),
        builder: (context, snap) {
          if (!snap.hasData) return const Center(child: CircularProgressIndicator());
          final pkg = snap.data!.cast<Map<String, dynamic>>().firstWhere((p) => p['id'] == packageId);

          // Ownership guard — same rule as the web app's role check
          if (pkg['trainerId'] != empId) {
            return const Center(child: Text('Not authorized'));
          }

          final sessions = (pkg['sessions'] as List).cast<Map<String, dynamic>>();
          return ListView.builder(
            itemCount: sessions.length,
            itemBuilder: (context, i) {
              final s = sessions[i];
              return CheckboxListTile(
                title: Text('Session ${i + 1}'),
                subtitle: Text(s['workout']?.toString().isNotEmpty == true ? s['workout'] : 'No workout logged'),
                value: s['done'] == true,
                onChanged: (checked) => _toggleSession(db, packageId, i, checked ?? false),
              );
            },
          );
        },
      ),
    );
  }

  Future<void> _toggleSession(DbService db, String pkgId, int index, bool checked) async {
    final packages = await db.readList('gp_pt_pkg');
    final list = packages.cast<Map<String, dynamic>>();
    final pkgIdx = list.indexWhere((p) => p['id'] == pkgId);
    final sessions = (list[pkgIdx]['sessions'] as List).cast<Map<String, dynamic>>();
    sessions[index]['done'] = checked;
    sessions[index]['date'] = checked
        ? (sessions[index]['date']?.toString().isNotEmpty == true
            ? sessions[index]['date']
            : DateTime.now().toIso8601String().substring(0, 10))
        : '';
    await db.writeList('gp_pt_pkg', list);
  }
}
```

To let the trainer edit **Workout Done** / **Remarks** / **Time In** / **Time Out**
per session, add `TextField`s in an expanded row or a small edit dialog, writing back
through the same read-modify-write pattern as `_toggleSession` (just setting a
different key inside `sessions[index]`).

> **Important:** the **Workout Plan** field is admin-set and the trainer app should
> render it **read-only** — don't add an editable field for it, exactly like the web
> app disables that textarea for the employee role.

---

## 9. Final progress charts (before/after, bar + line)

This mirrors the web app's Progress Report modal (`renderPtPkgReport()`,
`pkgBarChartHtml()`, `pkgLineChartSvg()`) — a bar chart comparing Start vs Final per
metric, plus a line chart of % change across metrics, fed by `pkg['stats']` /
`pkg['measurements']` (Start) vs `pkg['endStats']` / `pkg['endMeasurements']` (Final).

Add a real charting package rather than hand-rolling canvas drawing — `fl_chart` is
the most widely used Flutter charting library and covers both chart types you need:

```bash
flutter pub add fl_chart
```

### 9.1 Metric metadata (copy this verbatim from `index.html`)

This table drives both the auto-calculated "improved / needs work / neutral"
verdict and the chart labels. `dir: -1` = lower is better, `dir: 1` = higher is
better, `dir: 0` = neutral (goal-dependent, e.g. most body measurements).

```dart
class MetricMeta {
  final String key, label, unit;
  final int dir;
  const MetricMeta(this.key, this.label, this.unit, this.dir);
}

const ptMetrics = [
  MetricMeta('height', 'Height', 'cm', 0),
  MetricMeta('weight', 'Weight', 'kg', 0),
  MetricMeta('bmi', 'BMI', '', 0),
  MetricMeta('bodyFat', 'Body Fat', '%', -1),
  MetricMeta('fatMass', 'Fat Mass', 'kg', -1),
  MetricMeta('muscleMass', 'Muscle Mass', 'kg', 1),
  MetricMeta('boneMass', 'Bone Mass', 'kg', 1),
  MetricMeta('subFat', 'Subcutaneous Fat', '%', -1),
  MetricMeta('visceralFat', 'Visceral Fat', '', -1),
  MetricMeta('bodyAge', 'Body Age', 'yrs', -1),
  MetricMeta('whr', 'WHR', '', -1),
];

const ptBodyParts = [
  MetricMeta('neck', 'Neck', 'cm', 0),
  MetricMeta('shoulders', 'Shoulders', 'cm', 0),
  MetricMeta('chest', 'Chest/Bust', 'cm', 0),
  MetricMeta('waist', 'Waist (Narrowest)', 'cm', -1),
  MetricMeta('belly', 'Belly/Abdomen', 'cm', -1),
  MetricMeta('hips', 'Hips/Glutes', 'cm', 0),
  MetricMeta('rUpperArm', 'Right Upper Arm', 'cm', 0),
  MetricMeta('lUpperArm', 'Left Upper Arm', 'cm', 0),
  MetricMeta('rForearm', 'Right Forearm', 'cm', 0),
  MetricMeta('lForearm', 'Left Forearm', 'cm', 0),
  MetricMeta('rThigh', 'Right Thigh', 'cm', 0),
  MetricMeta('lThigh', 'Left Thigh', 'cm', 0),
  MetricMeta('rCalf', 'Right Calf', 'cm', 0),
  MetricMeta('lCalf', 'Left Calf', 'cm', 0),
];
```

### 9.2 Computing the comparison rows

```dart
class ComparisonRow {
  final MetricMeta meta;
  final num start, end, change, pctChange;
  final String verdict; // 'improved' | 'worsened' | 'neutral'
  ComparisonRow(this.meta, this.start, this.end, this.change, this.pctChange, this.verdict);
}

List<ComparisonRow> buildComparisonRows(Map<String, dynamic> pkg) {
  final start = {...(pkg['stats'] ?? {}), ...(pkg['measurements'] ?? {})};
  final end = {...(pkg['endStats'] ?? {}), ...(pkg['endMeasurements'] ?? {})};
  final manual = (pkg['manualVerdicts'] ?? {}) as Map<String, dynamic>;

  final rows = <ComparisonRow>[];
  for (final m in [...ptMetrics, ...ptBodyParts]) {
    final sv = start[m.key], ev = end[m.key];
    if (sv == null || ev == null) continue;
    final change = (ev as num) - (sv as num);
    final pctChange = sv != 0 ? (change / sv.abs()) * 100 : 0;
    var verdict = 'neutral';
    if (m.dir != 0 && change.abs() > 0.001) {
      verdict = (change * m.dir > 0) ? 'improved' : 'worsened';
    }
    if (manual[m.key] != null) verdict = manual[m.key]; // manual override wins, same as web app
    rows.add(ComparisonRow(m, sv, ev, change, pctChange, verdict));
  }
  return rows;
}

Color verdictColor(String verdict) => switch (verdict) {
  'improved' => const Color(0xFF10B981),
  'worsened' => const Color(0xFFEF4444),
  _ => const Color(0xFF6B7280),
};
```

### 9.3 Bar chart — Start vs Final per metric

```dart
import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';

class StartFinalBarChart extends StatelessWidget {
  final List<ComparisonRow> rows;
  const StartFinalBarChart({super.key, required this.rows});

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 220,
      child: BarChart(
        BarChartData(
          alignment: BarChartAlignment.spaceAround,
          barGroups: [
            for (var i = 0; i < rows.length; i++)
              BarChartGroupData(x: i, barRods: [
                BarChartRodData(toY: rows[i].start.toDouble(), color: Colors.grey, width: 7),
                BarChartRodData(toY: rows[i].end.toDouble(), color: verdictColor(rows[i].verdict), width: 7),
              ]),
          ],
          titlesData: FlTitlesData(
            bottomTitles: AxisTitles(sideTitles: SideTitles(
              showTitles: true,
              getTitlesWidget: (value, meta) {
                final i = value.toInt();
                if (i < 0 || i >= rows.length) return const SizedBox();
                return Padding(
                  padding: const EdgeInsets.only(top: 6),
                  child: Text(rows[i].meta.label, style: const TextStyle(fontSize: 8)),
                );
              },
            )),
            leftTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
          ),
          gridData: const FlGridData(show: false),
          borderData: FlBorderData(show: false),
        ),
      ),
    );
  }
}
```

### 9.4 Line chart — % change trend across metrics

```dart
class PctChangeLineChart extends StatelessWidget {
  final List<ComparisonRow> rows;
  const PctChangeLineChart({super.key, required this.rows});

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 200,
      child: LineChart(
        LineChartData(
          gridData: const FlGridData(show: false),
          borderData: FlBorderData(show: false),
          titlesData: FlTitlesData(
            bottomTitles: AxisTitles(sideTitles: SideTitles(
              showTitles: true,
              getTitlesWidget: (value, meta) {
                final i = value.toInt();
                if (i < 0 || i >= rows.length) return const SizedBox();
                return Text(rows[i].meta.label, style: const TextStyle(fontSize: 8));
              },
            )),
            leftTitles: const AxisTitles(sideTitles: SideTitles(showTitles: true)),
          ),
          lineBarsData: [
            LineChartBarData(
              spots: [for (var i = 0; i < rows.length; i++) FlSpot(i.toDouble(), rows[i].pctChange.toDouble())],
              isCurved: true,
              color: const Color(0xFFF59E0B), // matches the web app's accent orange
              barWidth: 2.5,
              belowBarData: BarAreaData(show: true, color: const Color(0x1AF59E0B)),
              dotData: FlDotData(
                show: true,
                getDotPainter: (spot, percent, bar, index) => FlDotCirclePainter(
                  radius: 5,
                  color: verdictColor(rows[index].verdict),
                  strokeColor: Colors.black,
                  strokeWidth: 2,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
```

### 9.5 Improvement score + manual verdict override

Same as the web app: count how many `dir != 0` metrics improved, show it as a
percentage, and let the trainer/admin manually override any row's verdict (writes to
`pkg['manualVerdicts'][key]`, same read-modify-write pattern as everywhere else):

```dart
Future<void> setMetricVerdict(String packageId, String key, String? verdict) async {
  final db = DbService();
  final packages = await db.readList('gp_pt_pkg');
  final list = packages.cast<Map<String, dynamic>>();
  final pkg = list.firstWhere((p) => p['id'] == packageId);
  final manual = (pkg['manualVerdicts'] ??= <String, dynamic>{}) as Map<String, dynamic>;
  if (verdict == null) {
    manual.remove(key); // "Auto" button — revert to calculated verdict
  } else {
    manual[key] = verdict; // 'improved' | 'neutral' | 'worsened'
  }
  await db.writeList('gp_pt_pkg', list);
}
```

```dart
int improvementScorePct(List<ComparisonRow> rows) {
  final tracked = rows.where((r) => r.verdict != 'neutral').toList();
  if (tracked.isEmpty) return 0;
  final improved = tracked.where((r) => r.verdict == 'improved').length;
  return ((improved / tracked.length) * 100).round();
}
```

Put `StartFinalBarChart`, `PctChangeLineChart`, the score, and a `ListView` of rows
(each row showing 4 small buttons: Auto / Improved / Same / Needs Work, calling
`setMetricVerdict`) together in a `ProgressReportScreen` — the same composition as
`renderPtPkgReport()` in the web app, just as Flutter widgets instead of HTML.

---

## 10. Monthly Attendance view (read-only, own records only)

This mirrors the web app's Monthly Attendance grid (`renderMonthly()`), but scoped to
just the logged-in trainer's own row, and **read-only** — there's no edit affordance
in the employee app, unlike the admin pencil-icon edit in the web app.

### 10.1 Computing a day's display code

```dart
enum DayCode { full, leave, halfLeave, morningOnly, eveningOnly, lop, absent, sunday, future, none }

class DayCell {
  final DayCode code;
  final String label; // 'F' | 'L' | 'HL' | 'M' | 'E' | 'X' | 'A' | '—' | '·'
  const DayCell(this.code, this.label);
}

DayCell computeDayCell({
  required DateTime date,
  Map<String, dynamic>? morning,
  Map<String, dynamic>? evening,
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

  if (hm && he) return const DayCell(DayCode.full, 'F');
  if (mLeave && eLeave) return const DayCell(DayCode.leave, 'L');
  if ((mLeave && he) || (eLeave && hm)) return const DayCell(DayCode.halfLeave, 'HL');
  // LOP on either shift must show even if the other shift was worked — same
  // ordering fix applied to the web app's grid (LOP checked before present-only).
  if (mLop || eLop) return const DayCell(DayCode.lop, 'X');
  if (hm) return const DayCell(DayCode.morningOnly, 'M');
  if (he) return const DayCell(DayCode.eveningOnly, 'E');
  if (mLeave || eLeave) return const DayCell(DayCode.halfLeave, 'HL');
  return const DayCell(DayCode.absent, 'A');
}
```

### 10.2 Screen

```dart
import 'package:flutter/material.dart';
import '../services/db_service.dart';

class MonthlyAttendanceScreen extends StatefulWidget {
  final String empId;
  const MonthlyAttendanceScreen({super.key, required this.empId});
  @override
  State<MonthlyAttendanceScreen> createState() => _MonthlyAttendanceScreenState();
}

class _MonthlyAttendanceScreenState extends State<MonthlyAttendanceScreen> {
  DateTime _month = DateTime(DateTime.now().year, DateTime.now().month);

  @override
  Widget build(BuildContext context) {
    final db = DbService();
    final daysInMonth = DateTime(_month.year, _month.month + 1, 0).day;

    return Scaffold(
      appBar: AppBar(title: const Text('My Monthly Attendance')),
      body: FutureBuilder<List<dynamic>>(
        future: db.readList('gp_att'),
        builder: (context, snap) {
          if (!snap.hasData) return const Center(child: CircularProgressIndicator());
          final att = snap.data!.cast<Map<String, dynamic>>().where((a) => a['empId'] == widget.empId);

          Map<String, dynamic>? findRec(int day, String shift) {
            final ds = '${_month.year}-${_month.month.toString().padLeft(2, '0')}-${day.toString().padLeft(2, '0')}';
            return att.cast<Map<String, dynamic>?>().firstWhere(
              (a) => a?['date'] == ds && a?['shift'] == shift,
              orElse: () => null,
            );
          }

          return GridView.builder(
            padding: const EdgeInsets.all(8),
            gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(crossAxisCount: 7),
            itemCount: daysInMonth,
            itemBuilder: (context, i) {
              final day = i + 1;
              final date = DateTime(_month.year, _month.month, day);
              final cell = computeDayCell(
                date: date,
                morning: findRec(day, 'morning'),
                evening: findRec(day, 'evening'),
              );
              return Container(
                margin: const EdgeInsets.all(2),
                alignment: Alignment.center,
                decoration: BoxDecoration(color: _cellColor(cell.code), borderRadius: BorderRadius.circular(6)),
                child: Text('$day\n${cell.label}', textAlign: TextAlign.center, style: const TextStyle(fontSize: 10)),
              );
            },
          );
        },
      ),
    );
  }

  Color _cellColor(DayCode code) => switch (code) {
    DayCode.full => const Color(0xFF1F4D3A),
    DayCode.leave || DayCode.halfLeave => const Color(0xFF4C3D8F),
    DayCode.lop => const Color(0xFF7A1F2B),
    DayCode.absent => const Color(0xFF5C1A1A),
    DayCode.morningOnly || DayCode.eveningOnly => const Color(0xFF3B5C8F),
    DayCode.sunday => const Color(0xFF2A2A40),
    _ => const Color(0xFF1A1A1A),
  };
}
```

Add a month-picker (e.g. two `IconButton`s with `Icons.chevron_left` /
`Icons.chevron_right` adjusting `_month`) and a legend row reusing the same color
mapping — same idea as the web app's legend strip above the grid.

---

## 11. Recommended security hardening

Right now, **anyone with the Firebase config** (which is not a secret, but is also
not access control) can read/write the entire `gymdata` node, because there are no
Realtime Database security rules restricting access. This matches the web app's
current trust model, but it's worth flagging explicitly since you're adding a second
client:

- At minimum, set rules requiring **some** form of Firebase Auth before any
  read/write, and use **Firebase Anonymous Auth** (no extra login UI needed) as a
  cheap way to require *a* valid Firebase session before touching the database:

  ```json
  {
    "rules": {
      ".read": "auth != null",
      ".write": "auth != null"
    }
  }
  ```

  Then in Flutter, call `FirebaseAuth.instance.signInAnonymously()` once at startup
  before any `DbService` calls. This stops totally anonymous internet scraping of
  your gym's data without changing your custom username/password login flow at all.

- A stronger (but bigger) change would be migrating the custom username/password
  scheme to real Firebase Authentication (email/password or custom tokens), then
  writing RTDB rules that check `auth.uid` against an allow-list. That's a larger
  project-wide change affecting the web app too — flag it as a separate task if you
  want to pursue it, don't bolt it onto just the mobile app.

---

## 12. Running & building

```bash
flutter run                  # dev, connected device/emulator
flutter build apk --release  # Android release build
flutter build ios --release  # iOS release build (needs Xcode + signing)
```

Test with a real employee login created from the web app's **User Accounts** page
(admin → User Accounts → Create Login) — there's no separate "register" flow in this
app by design, accounts are admin-provisioned only, exactly like the web app.

---

## 13. Quick checklist

- [ ] `flutterfire configure` points at the existing `gympro-3459f` project (not a new one)
- [ ] Login checks `gp_user_acct`, not `gp_auth`
- [ ] Login is rejected if the matching employee's `status == 'inactive'` or the account's `active == false`
- [ ] PT Sessions screen filters to `trainerId == empId` only, commission rate shown read-only (no editor)
- [ ] PT Packages screen filters to `trainerId == empId` only
- [ ] New packages/sessions created from the app force `trainerId = empId` (employee can't pick another trainer)
- [ ] Session checklist enforces the same "Workout Plan is admin-only / read-only" rule
- [ ] Progress report charts read both `stats`/`measurements` (Start) and `endStats`/`endMeasurements` (Final), and respect `manualVerdicts` overrides
- [ ] Monthly Attendance screen filters to `empId == ` the logged-in trainer only, and is fully read-only (no tap-to-edit)
- [ ] (Optional) Firebase Anonymous Auth + RTDB rules added per §11
