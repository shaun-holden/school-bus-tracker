import { db } from "../server/db";
import { users, passwordCredentials } from "../shared/schema";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import crypto from "crypto";

export async function seedMasterAdmin() {
  const email = process.env.MASTER_ADMIN_EMAIL;
  const password = process.env.MASTER_ADMIN_PASSWORD;

  if (!email || !password) {
    console.log("MASTER_ADMIN_EMAIL or MASTER_ADMIN_PASSWORD not set, skipping master admin seed.");
    return;
  }

  const [existing] = await db.select().from(users).where(eq(users.email, email));

  if (existing) {
    if (existing.role !== "master_admin") {
      await db.update(users).set({ role: "master_admin", companyId: null }).where(eq(users.email, email));
      console.log(`Updated existing user ${email} to master_admin.`);
    } else {
      console.log(`Master admin ${email} already exists.`);
    }
    return;
  }

  const userId = crypto.randomUUID();
  const passwordHash = await bcrypt.hash(password, 12);

  await db.insert(users).values({
    id: userId,
    email,
    firstName: "Master",
    lastName: "Admin",
    role: "master_admin",
    companyId: null,
    isActive: true,
  });

  await db.insert(passwordCredentials).values({
    userId,
    passwordHash,
  });

  console.log(`Master admin account created: ${email}`);
}
