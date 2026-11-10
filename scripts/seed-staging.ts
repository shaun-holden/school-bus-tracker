// Staging seed: two synthetic districts (A "staging-alpha", B "staging-bravo")
// plus a pending and a suspended company and one company-less parent.
// Synthetic data ONLY. Staging is never a copy of production.
//
// Run from a plain terminal (never a Claude window, never via `!`), with the
// STAGING database URL set in that terminal only. See STAGING.md:
//   SEED_TARGET=staging STAGING_SEED_PASSWORD=... DATABASE_URL=... npx tsx scripts/seed-staging.ts
//
// Safety:
// - No `dotenv/config`: DATABASE_URL, SEED_TARGET and STAGING_SEED_PASSWORD
//   must come from the terminal; .env must never supply them.
// - server/db is imported dynamically, only after the env checks pass.
// - It refuses to run if any company other than SEED_SLUGS exists (exact
//   match), or any user other than the seed users / master_admin exists.
// - Every write happens in one transaction that first locks `companies` and
//   re-runs those checks.
// Re-runnable: every row is upserted.

import bcrypt from 'bcryptjs';
import { and, eq, sql } from 'drizzle-orm';
import {
  companies,
  users,
  passwordCredentials,
  schools,
  routes,
  routeStops,
  buses,
  students,
  parentChildLinks,
  linkCodes,
} from '../shared/schema';
import {
  SEED_USERS,
  checkEnv,
  checkCompanies,
  checkUsers,
  describeDbTarget,
  seedEmail,
} from './seed-staging-guard';

class GuardError extends Error {}

const ROLE_LABELS: Record<string, string> = {
  admin: 'Admin',
  driver_admin: 'DriverAdmin',
  driver: 'Driver',
  parent: 'Parent',
};

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function fail(problems: string[]): never {
  console.error('Staging seed REFUSED:');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

type District = {
  slug: 'staging-alpha' | 'staging-bravo';
  name: string;
  letter: 'A' | 'B';
  timezone: string;
  city: string;
};

const DISTRICTS: District[] = [
  { slug: 'staging-alpha', name: 'Staging Alpha District', letter: 'A', timezone: 'America/New_York', city: 'Alphaville' },
  { slug: 'staging-bravo', name: 'Staging Bravo District', letter: 'B', timezone: 'America/Los_Angeles', city: 'Bravotown' },
];

async function seed() {
  // 1. Environment checks, before anything touches the database.
  const envProblems = checkEnv(process.env);
  if (envProblems.length) fail(envProblems);
  const databaseUrl = process.env.DATABASE_URL!;
  const password = process.env.STAGING_SEED_PASSWORD!;
  console.log(describeDbTarget(databaseUrl));

  // 2. Only now load the DB module (it throws at import without DATABASE_URL).
  const { db, pool } = await import('../server/db');

  const readGuards = async (q: typeof db) => {
    const companyRows = await q.select({ slug: companies.slug }).from(companies);
    const userRows = await q.select({ email: users.email, role: users.role }).from(users);
    return [...checkCompanies(companyRows.map((r) => r.slug)), ...checkUsers(userRows)];
  };

  try {
    // 3. Read-only pre-check, so a wrong target fails before the transaction.
    const pre = await readGuards(db);
    if (pre.length) fail(pre);

    const passwordHash = await bcrypt.hash(password, 12);
    const now = new Date();
    const linkExpiry = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
    const counts: Record<string, number> = {};
    const bump = (k: string, n = 1) => (counts[k] = (counts[k] ?? 0) + n);

    await db.transaction(async (tx) => {
      // 4. Lock, then re-check before the first write.
      await tx.execute(sql`LOCK TABLE companies IN SHARE ROW EXCLUSIVE MODE`);
      const inTx = await readGuards(tx as unknown as typeof db);
      if (inTx.length) throw new GuardError(inTx.join('\n'));

      // ---- Companies ----
      const upsertCompany = async (values: typeof companies.$inferInsert) => {
        const { slug, ...rest } = values;
        const [row] = await tx
          .insert(companies)
          .values(values)
          .onConflictDoUpdate({ target: companies.slug, set: { ...rest, updatedAt: now } })
          .returning();
        bump('companies');
        return row;
      };

      const companyIds: Record<string, string> = {};
      for (const d of DISTRICTS) {
        const c = await upsertCompany({
          name: d.name,
          slug: d.slug,
          status: 'approved',
          isActive: true,
          billingStatus: 'active',
          approvedAt: now,
          suspendedAt: null,
          planType: 'professional',
          staffUserLimit: 25,
          parentUserLimit: 500,
          parentPortalEnabled: true,
          gpsEnabled: true,
          timezone: d.timezone,
          contactEmail: seedEmail('admin', 1, d.slug),
        });
        companyIds[d.slug] = c.id;
      }
      companyIds['staging-pending'] = (
        await upsertCompany({
          name: 'Staging Pending District',
          slug: 'staging-pending',
          status: 'pending_approval',
          isActive: false,
          approvedAt: null,
          suspendedAt: null,
          contactEmail: seedEmail('admin', 1, 'staging-pending'),
        })
      ).id;
      companyIds['staging-suspended'] = (
        await upsertCompany({
          name: 'Staging Suspended District',
          slug: 'staging-suspended',
          status: 'suspended',
          isActive: false,
          suspendedAt: now,
          contactEmail: seedEmail('admin', 1, 'staging-suspended'),
        })
      ).id;

      // ---- Users + password credentials ----
      const userIds: Record<string, string> = {};
      for (const u of SEED_USERS) {
        // Obviously fake names, e.g. "Driver 2" / "Alpha".
        const n = u.email.split('@')[0].split('-').pop();
        const firstName = `${ROLE_LABELS[u.role]} ${n}`;
        const lastName = u.slug ? capitalize(u.slug.replace('staging-', '')) : 'Nocompany';
        const values = {
          email: u.email,
          role: u.role,
          companyId: u.slug ? companyIds[u.slug] : null,
          isActive: u.isActive,
          firstName,
          lastName,
        };
        const [row] = await tx
          .insert(users)
          .values(values)
          .onConflictDoUpdate({
            target: users.email,
            set: {
              role: values.role,
              companyId: values.companyId,
              isActive: values.isActive,
              firstName: values.firstName,
              lastName: values.lastName,
              updatedAt: now,
            },
          })
          .returning({ id: users.id });
        userIds[u.email] = row.id;
        bump('users');
        await tx
          .insert(passwordCredentials)
          .values({ userId: row.id, passwordHash })
          .onConflictDoUpdate({ target: passwordCredentials.userId, set: { passwordHash } });
        bump('passwordCredentials');
      }

      // ---- Per-district data (A and B) ----
      for (const d of DISTRICTS) {
        const companyId = companyIds[d.slug];
        const uid = (role: string, n: number) => userIds[seedEmail(role, n, d.slug)];
        const adminId = uid('admin', 1);
        const driver1 = uid('driver', 1);
        const driverAdmin = uid('driver_admin', 1);
        const parent1 = uid('parent', 1);
        const parent2 = uid('parent', 2);

        // School (match on companyId + name).
        const schoolName = `${d.name.replace(' District', '')} Elementary`;
        const schoolValues = { companyId, name: schoolName, address: `100 Test St, ${d.city}` };
        let [school] = await tx
          .select()
          .from(schools)
          .where(and(eq(schools.companyId, companyId), eq(schools.name, schoolName)));
        if (school) {
          [school] = await tx.update(schools).set(schoolValues).where(eq(schools.id, school.id)).returning();
        } else {
          [school] = await tx.insert(schools).values(schoolValues).returning();
        }
        bump('schools');

        // Routes (match on companyId + name), 3 stops each (match on routeId + order).
        const routeIds: string[] = [];
        const stopIds: string[][] = [];
        for (const r of [1, 2]) {
          const routeName = `Route ${d.letter}${r}`;
          const routeValues = {
            companyId,
            name: routeName,
            description: 'Synthetic staging route',
            driverId: r === 1 ? driver1 : driverAdmin,
            busNumber: `${d.letter}-0${r}`,
            schoolId: school.id,
            isActive: true,
            updatedAt: now,
          };
          let [route] = await tx
            .select()
            .from(routes)
            .where(and(eq(routes.companyId, companyId), eq(routes.name, routeName)));
          if (route) {
            [route] = await tx.update(routes).set(routeValues).where(eq(routes.id, route.id)).returning();
          } else {
            [route] = await tx.insert(routes).values(routeValues).returning();
          }
          routeIds.push(route.id);
          bump('routes');

          const ids: string[] = [];
          for (const order of [1, 2, 3]) {
            const stopValues = {
              routeId: route.id,
              name: `${d.letter}${r} Stop ${order}`,
              address: `${order}${r}0 Test St, ${d.city}`,
              order,
              scheduledTime: `07:${String(order * 10).padStart(2, '0')}`,
            };
            let [stop] = await tx
              .select()
              .from(routeStops)
              .where(and(eq(routeStops.routeId, route.id), eq(routeStops.order, order)));
            if (stop) {
              [stop] = await tx.update(routeStops).set(stopValues).where(eq(routeStops.id, stop.id)).returning();
            } else {
              [stop] = await tx.insert(routeStops).values(stopValues).returning();
            }
            ids.push(stop.id);
            bump('routeStops');
          }
          stopIds.push(ids);
        }

        // Drivers' assigned routes.
        await tx.update(users).set({ assignedRouteId: routeIds[0] }).where(eq(users.id, driver1));
        await tx.update(users).set({ assignedRouteId: routeIds[1] }).where(eq(users.id, driverAdmin));

        // Buses (match on busNumber, unique across companies).
        for (const b of [1, 2]) {
          const busValues = {
            companyId,
            busNumber: `${d.letter}-0${b}`,
            make: 'Testmaker',
            model: 'Staging',
            capacity: 48,
            driverId: b === 1 ? driver1 : driverAdmin,
            currentRouteId: null,
            status: 'idle' as const,
          };
          const { busNumber, ...rest } = busValues;
          await tx
            .insert(buses)
            .values(busValues)
            .onConflictDoUpdate({ target: buses.busNumber, set: { ...rest, lastUpdated: now } });
          bump('buses');
        }

        // Students (match on companyId + name). parentId = parent-1 for all.
        const studentIds: string[] = [];
        const studentDefs = [
          { firstName: 'Student', lastName: `${d.letter} One`, route: 0, stop: 0, grade: '1' },
          { firstName: 'Student', lastName: `${d.letter} Two`, route: 0, stop: 1, grade: '3' },
          { firstName: 'Student', lastName: `${d.letter} Three`, route: 1, stop: 2, grade: '5' },
        ];
        for (const s of studentDefs) {
          const studentValues = {
            companyId,
            firstName: s.firstName,
            lastName: s.lastName,
            grade: s.grade,
            parentId: parent1,
            schoolId: school.id,
            routeId: routeIds[s.route],
            stopId: stopIds[s.route][s.stop],
            isActive: true,
            updatedAt: now,
          };
          let [student] = await tx
            .select()
            .from(students)
            .where(
              and(
                eq(students.companyId, companyId),
                eq(students.firstName, s.firstName),
                eq(students.lastName, s.lastName),
              ),
            );
          if (student) {
            [student] = await tx.update(students).set(studentValues).where(eq(students.id, student.id)).returning();
          } else {
            [student] = await tx.insert(students).values(studentValues).returning();
          }
          studentIds.push(student.id);
          bump('students');
        }

        // parent-2 is linked ONLY via parentChildLinks (exercises
        // getLinkedStudentsByParentId). No link row for parent-1.
        await tx
          .insert(parentChildLinks)
          .values({ parentId: parent2, studentId: studentIds[2] })
          .onConflictDoNothing();
        bump('parentChildLinks');

        // Link code, fixed value, reset on every run.
        const code = `ST${d.letter}-000001`;
        await tx
          .insert(linkCodes)
          .values({ companyId, code, studentId: studentIds[1], createdById: adminId, status: 'active', usesCount: 0, expiresAt: linkExpiry })
          .onConflictDoUpdate({
            target: linkCodes.code,
            set: { companyId, studentId: studentIds[1], createdById: adminId, status: 'active', usesCount: 0, expiresAt: linkExpiry },
          });
        bump('linkCodes');
      }
    });

    // 5. Summary. Never print the password.
    console.log('\nStaging seed complete. Rows upserted:');
    for (const [k, v] of Object.entries(counts)) console.log(`  ${k.padEnd(20)} ${v}`);
    console.log('\nLogins (password: the STAGING_SEED_PASSWORD you entered):');
    console.table(
      SEED_USERS.map((u) => ({ email: u.email, role: u.role, company: u.slug ?? '(none)', active: u.isActive })),
    );
  } catch (err) {
    if (err instanceof GuardError) {
      fail(err.message.split('\n'));
    }
    console.error('Staging seed FAILED (transaction rolled back):', (err as Error)?.message ?? err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

seed();
