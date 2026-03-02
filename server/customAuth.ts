import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { Express, RequestHandler } from "express";
import session from "express-session";
import bcrypt from "bcryptjs";
import connectPg from "connect-pg-simple";
import crypto from "crypto";
import { storage } from "./storage";
import { User } from "@shared/schema";
import { sendPasswordResetEmail } from "./emailService";

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
    }
  }
}

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
    secret: process.env.SESSION_SECRET || 'dev-secret-change-in-production',
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: sessionTtl,
    },
  });
}

export async function setupCustomAuth(app: Express) {
  app.set("trust proxy", 1);
  app.use(getSession());
  app.use(passport.initialize());
  app.use(passport.session());

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

          return done(null, {
            id: user.id,
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName,
            role: user.role,
            companyId: user.companyId,
            companyRoleId: user.companyRoleId,
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
      const user = await storage.getUser(id);
      if (!user) {
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
      });
    } catch (error) {
      done(error);
    }
  });

  app.post("/api/auth/register", async (req, res) => {
    try {
      const { email, password, firstName, lastName, companySlug } = req.body;

      if (!email || !password) {
        return res.status(400).json({ message: "Email and password are required" });
      }

      if (password.length < 8) {
        return res.status(400).json({ message: "Password must be at least 8 characters" });
      }

      const existingUser = await storage.getUserByEmail(email);
      if (existingUser) {
        return res.status(400).json({ message: "Email already registered" });
      }

      let companyId: string | null = null;
      if (companySlug) {
        const company = await storage.getCompanyBySlug(companySlug);
        if (!company) {
          return res.status(400).json({ message: "Invalid company" });
        }
        companyId = company.id;

        // Check plan limits for parent registration
        const canCreate = await storage.canCreateUser(companyId, 'parent');
        if (!canCreate.allowed) {
          return res.status(403).json({ message: canCreate.reason });
        }
      }

      const hashedPassword = await hashPassword(password);

      const user = await storage.createUserWithPassword({
        email,
        firstName: firstName || null,
        lastName: lastName || null,
        companyId,
        role: 'parent',
      }, hashedPassword);

      req.login({
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        companyId: user.companyId,
        companyRoleId: user.companyRoleId,
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

  app.post("/api/auth/login", (req, res, next) => {
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

  app.post("/api/auth/logout", (req, res) => {
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
    res.json(req.user);
  });

  app.post("/api/auth/forgot-password", async (req, res) => {
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

  app.post("/api/auth/reset-password", async (req, res) => {
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
