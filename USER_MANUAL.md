# School Bus Tracker — User Manual

A practical guide for the three roles that use the app every day: **parents**, **drivers**, and **administrators**. A brief section for **master administrators** (platform owners) is at the end.

The app is available as a web app at **https://www.schoolbustracker.org** and as an iOS app ("School Bus Tracker" in the App Store). Both versions share the same data.

---

## For parents

### Signing up

1. Open the app and tap **Sign up** on the landing page, then choose **Parent**.
2. Enter your email and create a password (minimum 8 characters).
3. You'll be taken to the parent dashboard. It will be empty until you link a child.

### Linking your child

Your school or camp's administrator generates a **link code** for each child. It looks like `TNT-483921`.

1. On the dashboard, tap **Add Child**.
2. Enter the link code the administrator gave you.
3. The child now appears in your dashboard with their route, bus, and pickup stop.

Multiple parents can link to the same child using the same code or different codes (the admin controls how many uses each code has).

### Tracking the bus

When your child's driver is on duty and sharing GPS:

- The **Live Tracking** card shows the bus's current position on a map.
- A status line shows how many stops away the bus is from your child's stop, or **"Bus arrived!"** when it reaches the stop.
- An estimated arrival time is shown (a 3-minute-per-stop heuristic; exact times depend on traffic).

If the driver's phone cannot share location (permission denied, GPS unavailable), the card shows why. You will not see stale location data — the bus card hides itself when tracking is unavailable.

### Notifications

The app sends push notifications for:

- **Bus arrival** at your child's stop
- **Route alerts** posted by the driver (delays, route changes, emergencies)
- **Direct messages** from the driver or administrator

On iOS, allow notifications when prompted. You can also review past notifications in the **Notifications** tab.

### Messaging

Tap the message icon on your child's card to send a direct message to the assigned driver. Drivers can reply when they are off duty — they cannot send messages while driving.

### Managing your children

- **Rename / edit:** tap the child's card, then **Edit**.
- **Unlink:** tap the child's card, then **Unlink**. This removes your access; the child's record is kept for the administrator.

---

## For drivers

### First-time setup

You do not sign up yourself. After an administrator adds you as a driver, you will receive an **invitation email** with a link like `/driver/password-setup?token=...`. The link is valid for 24 hours. Click it and create a password. If the link expires, ask the admin to resend it.

### Daily check-in

Before starting your route each day:

1. Log in and tap **Check In**.
2. Select the **bus** you are driving and the **route** you are running.
3. Record the starting **fuel level** and confirm the bus interior and exterior are clean.
4. Tap **Start Shift**. You are now on duty.

Once on duty:

- The app automatically begins sharing your GPS location every 30 seconds.
- **Allow location access when prompted.** If permission is denied, the **GPS Location Sharing** card turns red and parents will not be able to see the bus. Open device Settings → School Bus Tracker → Location to re-enable.
- The route view shows the sequence of stops.

### During the route

- Tap **Mark Arrived** next to a stop when you reach it. This notifies parents of students at that stop and shows a green checkmark in your list.
- Tap a student's row to mark them **Present** or **Absent** as they board/exit. Attendance counts reset daily.
- Use **Report Issue** to flag vehicle or safety problems to administrators.
- Use **Broadcast** to send a notification to all parents on the route — pick **Info**, **Delay**, **Emergency**, or **Route change**.

### Ending your shift

1. Tap **End Shift**. The bus status returns to idle and your bus assignment is cleared.
2. A shift report is generated automatically (duration, stops visited, students picked up/dropped off, starting/ending fuel level).

Ending the shift stops GPS sharing. Do not leave the app in "on duty" mode after you park for the day.

### Messaging

The **Messages** tab lets you reply to parents on your route. You can only message users in your own organization.

### Troubleshooting

- **"Bus is not tracking":** you are off duty, no bus is assigned, or location permission is denied.
- **"No route assigned":** an administrator has not assigned you to a route. Contact them.
- **Can't log in:** your invitation may have expired or your account may have been deactivated. Contact an admin.

---

## For administrators

The administrator dashboard is the control panel for your organization. It is split into tabs: **Overview, Routes, Buses, Drivers, Students, Schools, Reports, Settings**.

### Adding drivers

1. Go to **Drivers** → **Add Driver**.
2. Enter name, email, phone, license details, hire date, and emergency contact.
3. On save, the system sends an invitation email with a password setup link. You can **resend** the invitation from the driver's row (envelope icon) if the original expires.

Until a driver sets up their password, their invitation status reads **Pending**.

### Adding schools

Schools are the locations buses pick up from and drop off at. Each school has a name, address, and (optionally) geocoded coordinates. You can then attach a school to one or more routes.

### Designing routes

1. Go to **Routes** → **Add Route**. Give it a name, description, and estimated duration.
2. After creating, open the route to add **stops** in order. Each stop has a schedule time and typically ties to a school.
3. Attach schools to the route so that student assignments work correctly.
4. Assign a bus and a default driver in the route's **Assignment** section.

### Managing students

1. Go to **Students** → **Add Student**. Capture first/last name, grade, school, route, and stop.
2. Generate a **link code** (stored under the student's profile) for parents to use when linking their account. You can configure:
   - **Max uses** (default: 2, typically one code shared between both parents)
   - **Expiration** (default: 7 days)
3. To see which parents are linked to a student, open the student and view **Linked Parents**. You can revoke any parent's link from here.

**Note:** link codes require the Parent Portal feature, which is on Professional and Enterprise plans only.

### Fleet management

**Buses** tab:

- Add buses with number, make, model, capacity, license plate, mileage, and insurance / registration expiry.
- Change status (idle, on_route, maintenance, emergency, inactive).
- Assign/unassign drivers.
- When a bus moves to **maintenance**, the system records the date. When it moves to **inactive**, any driver assignment is automatically cleared.

### Attendance and reports

- **Attendance** shows present/absent per student for any given day. Dates are interpreted in your company's configured timezone.
- **Shift reports** are generated automatically whenever a driver ends their shift.
- **Journey reports** record bus departures and arrivals between homebase and schools.

### Messaging

Send one-to-one messages to parents or drivers within your organization. Administrators cannot message users outside their own company.

### Settings

- **Homebase address** — the origin for all journey reports.
- **Timezone** — an IANA name like `America/New_York`, `America/Los_Angeles`, `America/Chicago`. Affects how "today" is calculated for attendance, shift reports, and journey reports.
- **Plan and billing** — view your subscription tier and user counts. Upgrades go through Stripe.

### Subscription limits

| Plan | Staff (admin + driver) | Parents | Parent portal | GPS | Link codes |
|---|---|---|---|---|---|
| Starter ($49/mo) | up to 3 | not allowed | — | — | — |
| Professional ($99/mo) | up to 5 | unlimited | yes | yes | yes |
| Enterprise ($249/mo) | unlimited | unlimited | yes | yes | yes |

If you hit a limit, new user creation is blocked with an error message. Upgrade to unblock.

---

## For master administrators

Master administrators are platform owners (the people who operate the School Bus Tracker service itself), not school staff. The master-admin dashboard lives at `/` when logged in with a `master_admin` account.

- **Companies** — approve, reject, suspend, or cancel tenant accounts.
- **Impersonate** — step into a company's admin view for troubleshooting. Your role remains `master_admin`, but all your requests are scoped to that company's data.
- **Stop impersonating** — returns you to the global view.
- **Stats** — platform-wide metrics.

Master admins can read across tenants. Normal admins cannot — they only ever see their own company's data.

---

## Support and common issues

- **Forgot password:** use **Forgot Password** on the login page. A reset link is emailed (15-minute expiry).
- **Not receiving notifications:** check that push notifications are enabled in your device settings for the School Bus Tracker app.
- **Wrong timezone on reports:** administrators can fix this in **Settings → Timezone**.
- **Bus location looks stale:** drivers must be on duty *and* have location permission granted. If either is false, parents will see no tracking.
- **"Too many attempts, please try again in 15 minutes":** rate-limit protection on login/password-reset/invitation endpoints. Wait 15 minutes.
