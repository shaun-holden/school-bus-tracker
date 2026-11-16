import { db } from "../server/db";
import { users, passwordCredentials } from "../shared/schema";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { pgError } from "../server/dbErrors";

export async function seedMasterAdmin() {
  const email = process.env.MASTER_ADMIN_EMAIL;
  const password = process.env.MASTER_ADMIN_PASSWORD;

  if (!email || !password) {
    console.log("MASTER_ADMIN_EMAIL or MASTER_ADMIN_PASSWORD not set, skipping master admin seed.");
    return;
  }

  try {
    const [existing] = await db.select().from(users).where(eq(users.email, email));

    // Never promote an existing account: whoever registered that address first
    // would become master of every school (SB-4). A lost master is recovered
    // by hand outside the app.
    if (existing) {
      if (existing.role !== "master_admin") {
        console.warn("Master admin seed: MASTER_ADMIN_EMAIL belongs to an existing non-master account; not promoted.");
        return;
      }
      console.log("Master admin seed: already exists.");
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

    console.log("Master admin seed: account created.");
  } catch (err) {
    // Never log the raw err: drizzle errors carry SQL params, incl. the email.
    console.error("Master admin seed error:", pgError(err)?.code, err instanceof Error ? err.name : typeof err);
    return;
  }
}
