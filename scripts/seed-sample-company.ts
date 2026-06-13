import "dotenv/config";
import { db, pool } from "../server/db";
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
} from "../shared/schema";
import { and, eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import crypto from "crypto";

// Seeds one sample tenant with an admin, a driver, a parent, plus a school,
// route, bus, and two students linked to the parent.
// Idempotent: re-running skips records that already exist.
// Run: npx tsx scripts/seed-sample-company.ts

const PASSWORD = "localdev123";

const COMPANY = {
  name: "Sunnyvale School District",
  slug: "sunnyvale",
};

const SAMPLE_USERS = [
  { email: "admin@sunnyvale.test", firstName: "Alice", lastName: "Adminson", role: "admin" as const, phone: "555-0100" },
  { email: "driver@sunnyvale.test", firstName: "Dave", lastName: "Driver", role: "driver" as const, phone: "555-0101" },
  { email: "parent@sunnyvale.test", firstName: "Pat", lastName: "Parent", role: "parent" as const, phone: "555-0102" },
];

async function seed() {
  // 1. Company
  let [company] = await db.select().from(companies).where(eq(companies.slug, COMPANY.slug));
  if (company) {
    console.log(`Company "${COMPANY.name}" already exists (${company.id}).`);
  } else {
    [company] = await db
      .insert(companies)
      .values({
        name: COMPANY.name,
        slug: COMPANY.slug,
        status: "approved",
        isActive: true,
        contactEmail: "admin@sunnyvale.test",
        planType: "professional",
        billingStatus: "active",
        staffUserLimit: 25,
        parentUserLimit: 500,
        parentPortalEnabled: true,
        gpsEnabled: true,
        timezone: "America/New_York",
        approvedAt: new Date(),
      })
      .returning();
    console.log(`Created company "${COMPANY.name}" (${company.id}).`);
  }
  const companyId = company.id;

  // 2. Users + password credentials
  const passwordHash = await bcrypt.hash(PASSWORD, 12);

  for (const u of SAMPLE_USERS) {
    const [existing] = await db.select().from(users).where(eq(users.email, u.email));
    if (existing) {
      console.log(`  User ${u.email} already exists — skipping.`);
      continue;
    }
    const userId = crypto.randomUUID();
    await db.insert(users).values({
      id: userId,
      email: u.email,
      firstName: u.firstName,
      lastName: u.lastName,
      role: u.role,
      companyId,
      phone: u.phone,
      isActive: true,
    });
    await db.insert(passwordCredentials).values({ userId, passwordHash });
    console.log(`  Created ${u.role}: ${u.email}`);
  }

  const [driver] = await db.select().from(users).where(eq(users.email, "driver@sunnyvale.test"));
  const [parent] = await db.select().from(users).where(eq(users.email, "parent@sunnyvale.test"));

  // 3. School
  let [school] = await db
    .select()
    .from(schools)
    .where(and(eq(schools.companyId, companyId), eq(schools.name, "Sunnyvale Elementary")));
  if (school) {
    console.log(`  School "${school.name}" already exists — skipping.`);
  } else {
    [school] = await db
      .insert(schools)
      .values({
        companyId,
        name: "Sunnyvale Elementary",
        address: "100 School Way, Sunnyvale, CA 94086",
        latitude: "37.36880000",
        longitude: "-122.03635000",
      })
      .returning();
    console.log(`  Created school: ${school.name}`);
  }

  // 4. Route (assigned to the driver)
  let [route] = await db
    .select()
    .from(routes)
    .where(and(eq(routes.companyId, companyId), eq(routes.name, "Route A — Morning")));
  if (route) {
    console.log(`  Route "${route.name}" already exists — skipping.`);
  } else {
    [route] = await db
      .insert(routes)
      .values({
        companyId,
        name: "Route A — Morning",
        description: "Morning pickup loop for the north neighborhoods.",
        driverId: driver.id,
        busNumber: "BUS-01",
        schoolId: school.id,
        isActive: true,
        estimatedDuration: 45,
      })
      .returning();
    console.log(`  Created route: ${route.name}`);
    // Assign the route to the driver
    await db.update(users).set({ assignedRouteId: route.id }).where(eq(users.id, driver.id));
  }

  // 5. Route stops
  const existingStops = await db.select().from(routeStops).where(eq(routeStops.routeId, route.id));
  if (existingStops.length > 0) {
    console.log(`  Route already has ${existingStops.length} stop(s) — skipping.`);
  } else {
    await db.insert(routeStops).values([
      {
        routeId: route.id,
        schoolId: school.id,
        name: "Maple & 1st",
        address: "1 Maple St, Sunnyvale, CA 94086",
        latitude: "37.37500000",
        longitude: "-122.04000000",
        order: 1,
        scheduledTime: "07:30",
        estimatedPickupTime: 0,
      },
      {
        routeId: route.id,
        schoolId: school.id,
        name: "Oak & 5th",
        address: "5 Oak Ave, Sunnyvale, CA 94086",
        latitude: "37.37200000",
        longitude: "-122.03800000",
        order: 2,
        scheduledTime: "07:40",
        estimatedPickupTime: 10,
      },
    ]);
    console.log("  Created 2 route stops.");
  }
  const stops = await db.select().from(routeStops).where(eq(routeStops.routeId, route.id));
  const stopByOrder = (o: number) => stops.find((s) => s.order === o);

  // 6. Bus (assigned to the driver + this route)
  let [bus] = await db.select().from(buses).where(eq(buses.busNumber, "BUS-01"));
  if (bus) {
    console.log(`  Bus "${bus.busNumber}" already exists — skipping.`);
  } else {
    [bus] = await db
      .insert(buses)
      .values({
        companyId,
        busNumber: "BUS-01",
        make: "Blue Bird",
        model: "Vision",
        year: 2021,
        capacity: 48,
        licensePlate: "SUN-001",
        driverId: driver.id,
        currentRouteId: route.id,
        status: "idle",
        fuelLevel: "full",
        mileage: 18250,
      })
      .returning();
    console.log(`  Created bus: ${bus.busNumber}`);
  }

  // 7. Students (linked to the parent) + parent-child links
  const SAMPLE_STUDENTS = [
    { firstName: "Sam", lastName: "Parent", grade: "3", order: 1 },
    { firstName: "Sky", lastName: "Parent", grade: "5", order: 2 },
  ];

  for (const s of SAMPLE_STUDENTS) {
    let [student] = await db
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
      console.log(`  Student ${s.firstName} ${s.lastName} already exists — skipping.`);
    } else {
      [student] = await db
        .insert(students)
        .values({
          companyId,
          firstName: s.firstName,
          lastName: s.lastName,
          grade: s.grade,
          parentId: parent.id,
          schoolId: school.id,
          routeId: route.id,
          stopId: stopByOrder(s.order)?.id,
          isActive: true,
        })
        .returning();
      console.log(`  Created student: ${s.firstName} ${s.lastName} (grade ${s.grade})`);
    }

    // Many-to-many parent link (used by getLinkedStudentsByParentId)
    await db
      .insert(parentChildLinks)
      .values({ parentId: parent.id, studentId: student.id })
      .onConflictDoNothing();
  }

  console.log("\nDone. All sample logins use password:", PASSWORD);
}

seed()
  .then(() => pool.end())
  .catch((err) => {
    console.error("Seed failed:", err);
    return pool.end().finally(() => process.exit(1));
  });
