import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { Express, RequestHandler } from "express";
import session from "express-session";
import bcrypt from "bcryptjs";
import connectPg from "connect-pg-simple";
import crypto from "crypto";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { eq } from "drizzle-orm";
import { storage } from "./storage";
import { db } from "./db";
import { User, users, companies } from "@shared/schema";
import { sessionDecision, isCompanyGateAllowed } from "./authGate";
import { sendPasswordResetEmail } from "./emailService";

// Rate limiters for auth endpoints

// Login, per IP + email: 10 FAILED logins per 15 min. Successful logins are
// not counted (skipSuccessfulRequests: status < 400), so staff sharing one
// school Wi-Fi don't lock each other out, and one person's typos only block
// that email from that IP. express.json runs app-wide before routes, so
// req.body is parsed here.
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 failed attempts per IP + email per window
  skipSuccessfulRequests: true,
  keyGenerator: (req) => {
    const rawEmail = req.body?.email;
    const email = typeof rawEmail === "string" ? rawEmail.trim().toLowerCase() : "";
    return `${ipKeyGenerator(req.ip ?? "")}|${email}`;
  },
  message: { message: "Too many attempts, please try again in 15 minutes" },
  standardHeaders: true,
  legacyHeaders: false,
});

// Login, per IP backstop: 100 FAILED logins per 15 min across all emails,
// against password spraying from one address. Runs before loginLimiter.
export const loginIpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 failed attempts per IP per window
  skipSuccessfulRequests: true,
  message: { message: "Too many attempts, please try again in 15 minutes" },
  standardHeaders: true,
  legacyHeaders: false,
});

// Sensitive non-login auth routes (forgot-password, reset-password, driver
// invitation verify/complete): 10 requests per 15 min per IP, ALL requests
// counted. One shared instance; no longer shared with login.
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 attempts per window
  message: { message: "Too many attempts, please try again in 15 minutes" },
  standardHeaders: true,
  legacyHeaders: false,
});

export const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5, // 5 registrations per hour
  message: { message: "Too many accounts created, please try again later" },
  standardHeaders: true,
  legacyHeaders: false,
});

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

declare global {
  namespace Express {
    interface User {
      id: string;
      email: string | null;
      firstName: string | null;
      lastName: string | null;
      role: string;
      companyId: string | null;
      companyRoleId: string | null;
      assignedRouteId?: string | null;
      isOnDuty?: boolean | null;
      // HF3: the user's company status, loaded at login and on every request.
      // Null when the user has no company or the company row is missing.
      companyStatus?: string | null;
      companyIsActive?: boolean | null;
    }
  }
}

const DEACTIVATED_MESSAGE = "This account has been deactivated. Contact your administrator.";

export async function hashPassword(password: string): Promise<string> {
  const salt = await bcrypt.genSalt(12);
  return bcrypt.hash(password, salt);
}

export async function comparePasswords(supplied: string, stored: string): Promise<boolean> {
  return bcrypt.compare(supplied, stored);
}

export function getSession() {
  const sessionTtl = 7 * 24 * 60 * 60 * 1000; // 1 week
  const PgStore = connectPg(session);
  const sessionStore = new PgStore({
    conString: process.env.DATABASE_URL,
    createTableIfMissing: false,
    ttl: sessionTtl,
    tableName: "sessions",
  });
  
  return session({
    secret: (() => {
      if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
      const env = process.env.NODE_ENV;
      // Only explicit dev/test environments get an ephemeral fallback.
      // Anything else (prod, staging, or unset) must provide SESSION_SECRET.
      if (env !== 'development' && env !== 'test') {
        throw new Error('SESSION_SECRET must be set (NODE_ENV=' + env + ')');
      }
      console.warn('SESSION_SECRET not set — generating ephemeral random secret for dev/test only');
      return crypto.randomBytes(32).toString('hex');
    })(),
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      maxAge: sessionTtl,
    },
  });
}

export async function setupCustomAuth(app: Express) {
  app.set("trust proxy", 1);
  app.use(getSession());
  app.use(passport.initialize());
  app.use(passport.session());

  // HF3 / SEC-7: company gate. Runs right after passport.session(), before the
  // master-admin impersonation overlay in routes.ts, so the real role is seen.
  // Users of a company that is not approved+active may only reach the
  // onboarding/billing allow-list in server/authGate.ts. Path matching there is
  // case-insensitive (Express routes match /API/drivers too).
  app.use((req, res, next) => {
    const user = req.user as Express.User | undefined;
    if (!isCompanyGateAllowed(req.path, user)) {
      return res.status(403).json({
        message: "Your company account is not active yet.",
        code: "COMPANY_NOT_ACTIVE",
      });
    }
    next();
  });

  passport.use(
    new LocalStrategy(
      { usernameField: 'email', passwordField: 'password' },
      async (email, password, done) => {
        try {
          const user = await storage.getUserByEmail(email);
          if (!user) {
            return done(null, false, { message: 'Invalid email or password' });
          }

          const credentials = await storage.getPasswordCredentials(user.id);
          if (!credentials) {
            return done(null, false, { message: 'Password login not enabled for this account' });
          }

          const isValid = await comparePasswords(password, credentials.passwordHash);
          if (!isValid) {
            return done(null, false, { message: 'Invalid email or password' });
          }

          // HF3 / SEC-19: only after the password check passes, so a wrong
          // password never reveals that an account is deactivated.
          const company = user.companyId ? await storage.getCompanyById(user.companyId) : undefined;
          if (sessionDecision(user, company) === 'reject') {
            return done(null, false, { message: DEACTIVATED_MESSAGE });
          }

          return done(null, {
            id: user.id,
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName,
            role: user.role,
            companyId: user.companyId,
            companyRoleId: user.companyRoleId,
            companyStatus: company?.status ?? null,
            companyIsActive: company?.isActive ?? null,
          });
        } catch (error) {
          return done(error);
        }
      }
    )
  );

  passport.serializeUser((user: Express.User, done) => {
    done(null, user.id);
  });

  passport.deserializeUser(async (id: string, done) => {
    try {
      // HF3 / SEC-19: one users LEFT JOIN companies query per request (instead
      // of getUser + getCompanyById). companyStatus is null when the user has
      // no company or the company row is missing; the company gate blocks the
      // latter. A thrown lookup goes to done(err) and never allows the session.
      const [row] = await db
        .select({
          user: users,
          companyStatus: companies.status,
          companyIsActive: companies.isActive,
          companyRowId: companies.id,
        })
        .from(users)
        .leftJoin(companies, eq(users.companyId, companies.id))
        .where(eq(users.id, id))
        .limit(1);
      const user = row?.user;
      if (!user) {
        return done(null, false);
      }
      const company = row.companyRowId
        ? { status: row.companyStatus, isActive: row.companyIsActive }
        : null;
      // Archived user or suspended/rejected company: end the session.
      if (sessionDecision(user, company) === 'reject') {
        return done(null, false);
      }
      done(null, {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        companyId: user.companyId,
        companyRoleId: user.companyRoleId,
        assignedRouteId: user.assignedRouteId,
        isOnDuty: user.isOnDuty,
        companyStatus: company?.status ?? null,
        companyIsActive: company?.isActive ?? null,
      });
    } catch (error) {
      done(error);
    }
  });

  app.post("/api/auth/register", registerLimiter, async (req, res) => {
    try {
      // HF3 / SEC-8: `companySlug` is deliberately ignored. Nobody joins a
      // company by its slug any more: parents join through a link code
      // (/api/link-child assigns the company), drivers through an invitation.
      const { email, password, firstName, lastName, role } = req.body;

      if (!email || !password) {
        return res.status(400).json({ message: "Email and password are required" });
      }

      if (password.length < 8) {
        return res.status(400).json({ message: "Password must be at least 8 characters" });
      }

      // Drivers are invited by their company admin. Checked BEFORE the
      // email-exists lookup so this response never reveals whether an email
      // is registered.
      if (role === 'driver') {
        return res.status(400).json({ message: "Drivers join by invitation from their company administrator." });
      }

      // Self-registration creates parents only, with no company.
      const userRole = 'parent';
      const companyId: string | null = null;

      const existingUser = await storage.getUserByEmail(email);
      if (existingUser) {
        return res.status(400).json({ message: "Email already registered" });
      }

      const hashedPassword = await hashPassword(password);

      const user = await storage.createUserWithPassword({
        email,
        firstName: firstName || null,
        lastName: lastName || null,
        companyId,
        role: userRole,
      }, hashedPassword);

      req.login({
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        companyId: user.companyId,
        companyRoleId: user.companyRoleId,
        companyStatus: null,
        companyIsActive: null,
      }, (err) => {
        if (err) {
          console.error("Login after register error:", err);
          return res.status(500).json({ message: "Registration successful but login failed" });
        }
        res.status(201).json({
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
          companyId: user.companyId,
        });
      });
    } catch (error) {
      console.error("Registration error:", error);
      res.status(500).json({ message: "Registration failed" });
    }
  });

  app.post("/api/auth/login", loginIpLimiter, loginLimiter, (req, res, next) => {
    passport.authenticate('local', (err: any, user: any, info: any) => {
      if (err) {
        return res.status(500).json({ message: "Login failed" });
      }
      if (!user) {
        return res.status(401).json({ message: info?.message || "Invalid credentials" });
      }
      req.login(user, (loginErr) => {
        if (loginErr) {
          return res.status(500).json({ message: "Login failed" });
        }
        res.json({
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
          companyId: user.companyId,
        });
      });
    })(req, res, next);
  });

  app.post("/api/auth/logout", async (req, res) => {
    // Deactivate all of this user's push-notification device tokens before
    // destroying the session. Relying on the client to call DELETE
    // /api/device-tokens is brittle — force-quits and network failures leave
    // orphan tokens that would deliver notifications to a future session/user
    // on the same device.
    const userId = (req.user as Express.User | undefined)?.id;
    if (userId) {
      try {
        await storage.deactivateDeviceTokensForUser(userId);
      } catch (err) {
        console.error("Failed to deactivate device tokens on logout:", err);
        // Proceed with logout anyway — session destruction is more important
        // than token cleanup, and stale tokens are a lesser evil than a
        // stuck session.
      }
    }
    req.logout((err) => {
      if (err) {
        return res.status(500).json({ message: "Logout failed" });
      }
      res.json({ message: "Logged out successfully" });
    });
  });

  app.get("/api/auth/user", (req, res) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const user = req.user as any;
    const impersonatedCompanyId = (req.session as any)?.impersonatedCompanyId;
    if (user.role === 'master_admin' && impersonatedCompanyId) {
      return res.json({
        ...user,
        companyId: impersonatedCompanyId,
        // Keep role as master_admin so frontend allows access to all views
        _masterAdminImpersonating: true,
      });
    }
    res.json(req.user);
  });

  app.post("/api/auth/forgot-password", authLimiter, async (req, res) => {
    try {
      const { email } = req.body;

      if (!email) {
        return res.status(400).json({ message: "Email is required" });
      }

      const user = await storage.getUserByEmail(email);
      if (!user) {
        return res.json({ message: "If an account exists with that email, a reset link has been sent" });
      }

      let credentials = await storage.getPasswordCredentials(user.id);
      
      if (!credentials) {
        const tempHash = await hashPassword(crypto.randomBytes(32).toString('hex'));
        await storage.createPasswordCredentials(user.id, tempHash);
        credentials = await storage.getPasswordCredentials(user.id);
      }

      if (!credentials) {
        return res.json({ message: "If an account exists with that email, a reset link has been sent" });
      }

      const resetToken = crypto.randomBytes(32).toString('hex');
      const hashedToken = hashToken(resetToken);
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

      await storage.setPasswordResetToken(user.id, hashedToken, expiresAt);

      const baseUrl = `${req.protocol}://${req.get('host')}`;
      const resetUrl = `${baseUrl}/reset-password?token=${resetToken}`;

      const result = await sendPasswordResetEmail(email, resetToken, resetUrl);
      
      if (!result.success) {
        console.error("Failed to send reset email:", result.error);
        await storage.clearPasswordResetToken(user.id);
        return res.status(500).json({ message: "Failed to send reset email. Please try again." });
      }

      res.json({ message: "If an account exists with that email, a reset link has been sent" });
    } catch (error) {
      console.error("Forgot password error:", error);
      res.status(500).json({ message: "Failed to process request" });
    }
  });

  app.post("/api/auth/reset-password", authLimiter, async (req, res) => {
    try {
      const { token, password } = req.body;

      if (!token || !password) {
        return res.status(400).json({ message: "Token and password are required" });
      }

      if (password.length < 8) {
        return res.status(400).json({ message: "Password must be at least 8 characters" });
      }

      const hashedToken = hashToken(token);
      const credentials = await storage.getCredentialsByResetToken(hashedToken);
      if (!credentials) {
        return res.status(400).json({ message: "Invalid or expired reset token" });
      }

      if (!credentials.passwordResetExpires || credentials.passwordResetExpires < new Date()) {
        await storage.clearPasswordResetToken(credentials.userId);
        return res.status(400).json({ message: "Reset token has expired" });
      }

      const hashedPassword = await hashPassword(password);
      await storage.updatePassword(credentials.userId, hashedPassword);

      res.json({ message: "Password has been reset successfully" });
    } catch (error) {
      console.error("Reset password error:", error);
      res.status(500).json({ message: "Failed to reset password" });
    }
  });
}

export const isAuthenticated: RequestHandler = (req, res, next) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  next();
};
