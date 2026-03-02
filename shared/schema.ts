import { sql, relations } from 'drizzle-orm';
import {
  index,
  jsonb,
  pgTable,
  timestamp,
  varchar,
  text,
  integer,
  boolean,
  decimal,
  pgEnum,
  unique,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ============================================
// MULTI-TENANT TABLES
// ============================================

// Company/Business status enum for approval workflow
export const companyStatusEnum = pgEnum('company_status', [
  'pending_approval',
  'approved', 
  'suspended',
  'rejected',
  'cancelled'
]);

// Billing status enum for Stripe subscription state
export const billingStatusEnum = pgEnum('billing_status', [
  'none',
  'trialing',
  'active',
  'past_due',
  'canceled',
  'unpaid'
]);

// Plan type enum for subscription tiers
export const planTypeEnum = pgEnum('plan_type', [
  'starter',
  'professional',
  'enterprise'
]);

// Plan configuration - defines limits and features for each plan
export const PLAN_CONFIGS = {
  starter: {
    staffUserLimit: 3,
    parentUserLimit: 0, // Parents not allowed
    parentPortalEnabled: false,
    gpsEnabled: false,
  },
  professional: {
    staffUserLimit: 5,
    parentUserLimit: null, // Unlimited
    parentPortalEnabled: true,
    gpsEnabled: true,
  },
  enterprise: {
    staffUserLimit: null, // Unlimited
    parentUserLimit: null, // Unlimited
    parentPortalEnabled: true,
    gpsEnabled: true,
  },
} as const;

export type PlanType = 'starter' | 'professional' | 'enterprise';

// Company/Tenant table - the core of multi-tenancy
export const companies = pgTable("companies", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name").notNull(),
  slug: varchar("slug").notNull().unique(), // URL-friendly identifier
  logo: varchar("logo"), // URL to company logo
  primaryColor: varchar("primary_color").default('#3b82f6'),
  secondaryColor: varchar("secondary_color").default('#1e40af'),
  isActive: boolean("is_active").default(true),
  // Contact information
  contactEmail: varchar("contact_email"),
  contactPhone: varchar("contact_phone"),
  // Business approval workflow
  status: companyStatusEnum("status").default('pending_approval'),
  ownerUserId: varchar("owner_user_id"), // The business owner/admin
  // Stripe billing fields
  stripeCustomerId: varchar("stripe_customer_id"),
  stripeSubscriptionId: varchar("stripe_subscription_id"),
  stripePriceId: varchar("stripe_price_id"),
  billingStatus: billingStatusEnum("billing_status").default('none'),
  trialEndsAt: timestamp("trial_ends_at"),
  currentPeriodEnd: timestamp("current_period_end"),
  // Plan configuration
  planType: planTypeEnum("plan_type").default('starter'),
  staffUserLimit: integer("staff_user_limit").default(3), // NULL = unlimited
  parentUserLimit: integer("parent_user_limit").default(0), // NULL = unlimited, 0 = not allowed
  parentPortalEnabled: boolean("parent_portal_enabled").default(false),
  gpsEnabled: boolean("gps_enabled").default(false),
  // Approval tracking
  approvedAt: timestamp("approved_at"),
  approvedBy: varchar("approved_by"),
  suspendedAt: timestamp("suspended_at"),
  suspendedBy: varchar("suspended_by"),
  suspensionReason: text("suspension_reason"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Company settings for customization
export const companySettings = pgTable("company_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").references(() => companies.id, { onDelete: 'cascade' }).notNull(),
  settingKey: varchar("setting_key").notNull(),
  settingValue: text("setting_value"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  companySettingUnique: unique().on(table.companyId, table.settingKey),
}));

// Company modules - toggle features on/off per company
export const companyModulesEnum = pgEnum('company_module', [
  'fleet_management',
  'route_planning', 
  'attendance_tracking',
  'parent_notifications',
  'driver_tasks',
  'shift_reports',
  'live_tracking',
  'maintenance'
]);

export const companyModules = pgTable("company_modules", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").references(() => companies.id, { onDelete: 'cascade' }).notNull(),
  module: companyModulesEnum("module").notNull(),
  isEnabled: boolean("is_enabled").default(true),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  companyModuleUnique: unique().on(table.companyId, table.module),
}));

// Company roles - custom roles per company
export const companyRoleTypeEnum = pgEnum('company_role_type', ['super_admin', 'company_admin', 'manager', 'driver', 'parent', 'employee']);

export const companyRoles = pgTable("company_roles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").references(() => companies.id, { onDelete: 'cascade' }).notNull(),
  name: varchar("name").notNull(),
  roleType: companyRoleTypeEnum("role_type").notNull(),
  permissions: jsonb("permissions").default('[]'), // JSON array of permission strings
  isDefault: boolean("is_default").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

// Employee invitations status enum (table defined after users)
export const invitationStatusEnum = pgEnum('invitation_status', ['pending', 'accepted', 'expired', 'cancelled']);

// Company departments
export const departments = pgTable("departments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").references(() => companies.id, { onDelete: 'cascade' }).notNull(),
  name: varchar("name").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Types for core multi-tenant tables (invitations defined after users)
export type Company = typeof companies.$inferSelect;
export type InsertCompany = typeof companies.$inferInsert;
export type CompanySetting = typeof companySettings.$inferSelect;
export type InsertCompanySetting = typeof companySettings.$inferInsert;
export type CompanyModule = typeof companyModules.$inferSelect;
export type InsertCompanyModule = typeof companyModules.$inferInsert;
export type CompanyRole = typeof companyRoles.$inferSelect;
export type InsertCompanyRole = typeof companyRoles.$inferInsert;
export type Department = typeof departments.$inferSelect;
export type InsertDepartment = typeof departments.$inferInsert;

// Zod schemas for core multi-tenant tables
export const insertCompanySchema = createInsertSchema(companies).omit({ id: true, createdAt: true, updatedAt: true });
export const insertCompanySettingSchema = createInsertSchema(companySettings).omit({ id: true, createdAt: true, updatedAt: true });
export const insertCompanyModuleSchema = createInsertSchema(companyModules).omit({ id: true, createdAt: true });
export const insertCompanyRoleSchema = createInsertSchema(companyRoles).omit({ id: true, createdAt: true });
export const insertDepartmentSchema = createInsertSchema(departments).omit({ id: true, createdAt: true });

// ============================================
// SESSION AND AUTH TABLES
// ============================================

// Session storage table (required for Replit Auth)
export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)],
);

// User roles enum (master_admin is platform owner, admin is company admin)
export const userRoleEnum = pgEnum('user_role', ['master_admin', 'parent', 'driver', 'admin']);

// User storage table (with multi-tenant support)
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email").unique(),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  role: userRoleEnum("role").notNull().default('parent'),
  // Multi-tenant fields
  companyId: varchar("company_id").references(() => companies.id),
  companyRoleId: varchar("company_role_id").references(() => companyRoles.id),
  departmentId: varchar("department_id").references(() => departments.id),
  // Driver-specific fields
  phone: varchar("phone"),
  address: text("address"),
  licenseNumber: varchar("license_number"),
  licenseState: varchar("license_state"),
  licenseExpiryDate: timestamp("license_expiry_date"),
  dateOfBirth: timestamp("date_of_birth"),
  emergencyContactName: varchar("emergency_contact_name"),
  emergencyContactPhone: varchar("emergency_contact_phone"),
  hireDate: timestamp("hire_date"),
  isActive: boolean("is_active").default(true),
  isOnDuty: boolean("is_on_duty").default(false),
  dutyStartTime: timestamp("duty_start_time"),
  // Driver check-in data
  lastCheckInFuelLevel: varchar("last_check_in_fuel_level"),
  lastCheckInInteriorClean: boolean("last_check_in_interior_clean"),
  lastCheckInExteriorClean: boolean("last_check_in_exterior_clean"),
  lastCheckInTime: timestamp("last_check_in_time"),
  assignedRouteId: varchar("assigned_route_id"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Employee invitations (defined after users to avoid circular reference)
export const invitations = pgTable("invitations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").references(() => companies.id, { onDelete: 'cascade' }).notNull(),
  email: varchar("email").notNull(),
  roleId: varchar("role_id").references(() => companyRoles.id),
  roleType: companyRoleTypeEnum("role_type").notNull().default('employee'),
  invitedById: varchar("invited_by_id").references(() => users.id),
  token: varchar("token").notNull().unique(),
  status: invitationStatusEnum("status").default('pending'),
  expiresAt: timestamp("expires_at").notNull(),
  acceptedAt: timestamp("accepted_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Password credentials for email/password auth
export const passwordCredentials = pgTable("password_credentials", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id, { onDelete: 'cascade' }).notNull().unique(),
  passwordHash: varchar("password_hash").notNull(),
  passwordResetToken: varchar("password_reset_token"),
  passwordResetExpires: timestamp("password_reset_expires"),
  lastPasswordChange: timestamp("last_password_change").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

// Types and schemas for auth tables
export type Invitation = typeof invitations.$inferSelect;
export type InsertInvitation = typeof invitations.$inferInsert;
export type PasswordCredential = typeof passwordCredentials.$inferSelect;
export type InsertPasswordCredential = typeof passwordCredentials.$inferInsert;
export const insertInvitationSchema = createInsertSchema(invitations).omit({ id: true, createdAt: true, acceptedAt: true });

// Schools table
export const schools = pgTable("schools", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").references(() => companies.id),
  name: varchar("name").notNull(),
  address: text("address").notNull(),
  latitude: decimal("latitude", { precision: 10, scale: 8 }),
  longitude: decimal("longitude", { precision: 11, scale: 8 }),
  createdAt: timestamp("created_at").defaultNow(),
});

// Bus routes table
export const routes = pgTable("routes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").references(() => companies.id),
  name: varchar("name").notNull(),
  description: text("description"),
  driverId: varchar("driver_id").references(() => users.id),
  busNumber: varchar("bus_number"),
  schoolId: varchar("school_id").references(() => schools.id),
  isActive: boolean("is_active").default(true),
  estimatedDuration: integer("estimated_duration"), // in minutes
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Route stops table
export const routeStops = pgTable("route_stops", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  routeId: varchar("route_id").references(() => routes.id, { onDelete: 'cascade' }).notNull(),
  schoolId: varchar("school_id").references(() => schools.id),
  name: varchar("name").notNull(),
  address: text("address").notNull(),
  latitude: decimal("latitude", { precision: 10, scale: 8 }),
  longitude: decimal("longitude", { precision: 11, scale: 8 }),
  order: integer("order").notNull(),
  scheduledTime: varchar("scheduled_time"), // HH:MM format
  estimatedPickupTime: integer("estimated_pickup_time"), // minutes from route start
  createdAt: timestamp("created_at").defaultNow(),
});

// Students table
export const students = pgTable("students", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").references(() => companies.id),
  firstName: varchar("first_name").notNull(),
  lastName: varchar("last_name").notNull(),
  grade: varchar("grade"),
  parentId: varchar("parent_id").references(() => users.id).notNull(),
  schoolId: varchar("school_id").references(() => schools.id),
  routeId: varchar("route_id").references(() => routes.id),
  stopId: varchar("stop_id").references(() => routeStops.id),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Daily attendance table
export const attendance = pgTable("attendance", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").references(() => companies.id),
  studentId: varchar("student_id").references(() => students.id).notNull(),
  routeId: varchar("route_id").references(() => routes.id).notNull(),
  date: timestamp("date").notNull(),
  isPresent: boolean("is_present").default(false),
  isAbsent: boolean("is_absent").default(false), // parent reported absence
  pickupTime: timestamp("pickup_time"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Bus status enum
export const busStatusEnum = pgEnum('bus_status', ['idle', 'on_route', 'maintenance', 'emergency', 'inactive']);

// Buses table
export const buses = pgTable("buses", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").references(() => companies.id),
  busNumber: varchar("bus_number").notNull().unique(),
  make: varchar("make"),
  model: varchar("model"),
  year: integer("year"),
  capacity: integer("capacity"),
  licensePlate: varchar("license_plate"),
  driverId: varchar("driver_id").references(() => users.id),
  currentRouteId: varchar("current_route_id").references(() => routes.id),
  status: busStatusEnum("status").default('idle'),
  currentLatitude: decimal("current_latitude", { precision: 10, scale: 8 }),
  currentLongitude: decimal("current_longitude", { precision: 11, scale: 8 }),
  speed: decimal("speed", { precision: 5, scale: 2 }), // mph
  fuelLevel: varchar("fuel_level"),
  mileage: integer("mileage"),
  lastMaintenanceDate: timestamp("last_maintenance_date"),
  nextMaintenanceDate: timestamp("next_maintenance_date"),
  insuranceExpiry: timestamp("insurance_expiry"),
  registrationExpiry: timestamp("registration_expiry"),
  lastUpdated: timestamp("last_updated").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

// Vehicle issues table
export const vehicleIssues = pgTable("vehicle_issues", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").references(() => companies.id),
  busId: varchar("bus_id").references(() => buses.id).notNull(),
  driverId: varchar("driver_id").references(() => users.id).notNull(),
  issueType: varchar("issue_type").notNull(),
  description: text("description").notNull(),
  severity: varchar("severity").default('normal'), // normal, high, urgent
  isResolved: boolean("is_resolved").default(false),
  createdAt: timestamp("created_at").defaultNow(),
  resolvedAt: timestamp("resolved_at"),
});

// Driver tasks table
export const driverTasks = pgTable("driver_tasks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").references(() => companies.id),
  title: varchar("title").notNull(),
  description: text("description"),
  assignedToId: varchar("assigned_to_id").references(() => users.id).notNull(),
  assignedById: varchar("assigned_by_id").references(() => users.id).notNull(),
  priority: varchar("priority").default('normal'), // normal, high, urgent
  isCompleted: boolean("is_completed").default(false),
  dueDate: timestamp("due_date"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Route schools junction table (many-to-many relationship)
export const routeSchools = pgTable("route_schools", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  routeId: varchar("route_id").references(() => routes.id, { onDelete: 'cascade' }).notNull(),
  schoolId: varchar("school_id").references(() => schools.id, { onDelete: 'cascade' }).notNull(),
  order: integer("order").notNull().default(0), // Order of school/stop in the route
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  // Ensure unique route-school combinations
  routeSchoolUnique: unique().on(table.routeId, table.schoolId),
}));

// Emergency contacts table
export const emergencyContacts = pgTable("emergency_contacts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  studentId: varchar("student_id").references(() => students.id).notNull(),
  name: varchar("name").notNull(),
  phone: varchar("phone").notNull(),
  relationship: varchar("relationship").notNull(),
  isPrimary: boolean("is_primary").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

// Driver invitations for password setup
export const driverInvitations = pgTable("driver_invitations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").references(() => companies.id, { onDelete: 'cascade' }).notNull(),
  driverId: varchar("driver_id").references(() => users.id, { onDelete: 'cascade' }).notNull(),
  email: varchar("email").notNull(),
  tokenHash: varchar("token_hash").notNull(), // SHA256 hash of the token
  status: varchar("status").default('pending'), // pending, accepted, expired
  expiresAt: timestamp("expires_at").notNull(),
  acceptedAt: timestamp("accepted_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type DriverInvitation = typeof driverInvitations.$inferSelect;
export type InsertDriverInvitation = typeof driverInvitations.$inferInsert;

// Define relations
export const usersRelations = relations(users, ({ many }) => ({
  children: many(students, { relationName: "parent_children" }),
  assignedRoutes: many(routes, { relationName: "driver_routes" }),
  assignedTasks: many(driverTasks, { relationName: "assigned_tasks" }),
  createdTasks: many(driverTasks, { relationName: "created_tasks" }),
  reportedIssues: many(vehicleIssues, { relationName: "driver_issues" }),
  assignedBus: many(buses, { relationName: "driver_bus" }),
}));

export const studentsRelations = relations(students, ({ one, many }) => ({
  parent: one(users, { 
    fields: [students.parentId], 
    references: [users.id],
    relationName: "parent_children"
  }),
  school: one(schools, { fields: [students.schoolId], references: [schools.id] }),
  route: one(routes, { fields: [students.routeId], references: [routes.id] }),
  stop: one(routeStops, { fields: [students.stopId], references: [routeStops.id] }),
  attendance: many(attendance),
  emergencyContacts: many(emergencyContacts),
}));

export const routesRelations = relations(routes, ({ one, many }) => ({
  driver: one(users, { 
    fields: [routes.driverId], 
    references: [users.id],
    relationName: "driver_routes"
  }),
  stops: many(routeStops),
  students: many(students),
  attendance: many(attendance),
  buses: many(buses),
  routeSchools: many(routeSchools),
}));

export const routeStopsRelations = relations(routeStops, ({ one, many }) => ({
  route: one(routes, { fields: [routeStops.routeId], references: [routes.id] }),
  school: one(schools, { fields: [routeStops.schoolId], references: [schools.id] }),
  students: many(students),
}));

export const schoolsRelations = relations(schools, ({ many }) => ({
  students: many(students),
  routeStops: many(routeStops),
  routeSchools: many(routeSchools),
}));

export const attendanceRelations = relations(attendance, ({ one }) => ({
  student: one(students, { fields: [attendance.studentId], references: [students.id] }),
  route: one(routes, { fields: [attendance.routeId], references: [routes.id] }),
}));

export const busesRelations = relations(buses, ({ one, many }) => ({
  driver: one(users, { 
    fields: [buses.driverId], 
    references: [users.id],
    relationName: "driver_bus"
  }),
  currentRoute: one(routes, { fields: [buses.currentRouteId], references: [routes.id] }),
  issues: many(vehicleIssues),
}));

export const vehicleIssuesRelations = relations(vehicleIssues, ({ one }) => ({
  bus: one(buses, { fields: [vehicleIssues.busId], references: [buses.id] }),
  driver: one(users, { 
    fields: [vehicleIssues.driverId], 
    references: [users.id],
    relationName: "driver_issues"
  }),
}));

export const driverTasksRelations = relations(driverTasks, ({ one }) => ({
  assignedTo: one(users, { 
    fields: [driverTasks.assignedToId], 
    references: [users.id],
    relationName: "assigned_tasks"
  }),
  assignedBy: one(users, { 
    fields: [driverTasks.assignedById], 
    references: [users.id],
    relationName: "created_tasks"
  }),
}));

export const emergencyContactsRelations = relations(emergencyContacts, ({ one }) => ({
  student: one(students, { fields: [emergencyContacts.studentId], references: [students.id] }),
}));

export const routeSchoolsRelations = relations(routeSchools, ({ one }) => ({
  route: one(routes, {
    fields: [routeSchools.routeId],
    references: [routes.id],
  }),
  school: one(schools, {
    fields: [routeSchools.schoolId],
    references: [schools.id],
  }),
}));

// Export types
export type UpsertUser = typeof users.$inferInsert;
export type User = typeof users.$inferSelect;

// School visit tracking table for driver arrivals/departures
export const schoolVisits = pgTable("school_visits", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").references(() => companies.id),
  driverId: varchar("driver_id").notNull(),
  schoolId: varchar("school_id").notNull(),
  routeId: varchar("route_id").notNull(),
  arrivedAt: timestamp("arrived_at"),
  departedAt: timestamp("departed_at"),
  visitDate: timestamp("visit_date").defaultNow(),
  notes: varchar("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Student attendance tracking
export const studentAttendance = pgTable("student_attendance", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").references(() => companies.id),
  studentId: varchar("student_id").notNull().references(() => students.id),
  driverId: varchar("driver_id").notNull().references(() => users.id),
  routeId: varchar("route_id").notNull().references(() => routes.id),
  attendanceDate: timestamp("attendance_date").defaultNow(),
  status: varchar("status", { enum: ["present", "absent"] }).notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type SchoolVisit = typeof schoolVisits.$inferSelect;
export type InsertSchoolVisit = typeof schoolVisits.$inferInsert;

// Driver profile schema for form validation
export const updateDriverProfileSchema = createInsertSchema(users, {
  email: z.string().email("Invalid email address").optional(),
  phone: z.string().min(10, "Phone number must be at least 10 digits").optional(),
  licenseNumber: z.string().min(1, "License number is required").optional(),
  licenseState: z.string().min(2, "License state is required").optional(),
  licenseExpiryDate: z.string().optional(),
  dateOfBirth: z.string().optional(),
  emergencyContactName: z.string().min(1, "Emergency contact name is required").optional(),
  emergencyContactPhone: z.string().min(10, "Emergency contact phone must be at least 10 digits").optional(),
  hireDate: z.string().optional(),
}).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  role: true,
});

export type UpdateDriverProfile = z.infer<typeof updateDriverProfileSchema>;

// Driver check-in schema
export const driverCheckInSchema = z.object({
  driverId: z.string().min(1, "Please select a driver"),
  fuelLevel: z.enum(["Empty", "1/4", "1/2", "3/4", "Full"]),
  interiorClean: z.boolean(),
  exteriorClean: z.boolean(),
  routeId: z.string().min(1, "Please select a route"),
  busId: z.string().min(1, "Please select a vehicle"),
});

export type DriverCheckIn = z.infer<typeof driverCheckInSchema>;

export type InsertSchool = typeof schools.$inferInsert;
export type School = typeof schools.$inferSelect;

export type InsertRoute = typeof routes.$inferInsert;
export type Route = typeof routes.$inferSelect & {
  stopCount?: number;
};

export type InsertRouteStop = typeof routeStops.$inferInsert;
export type RouteStop = typeof routeStops.$inferSelect;

export type InsertStudent = typeof students.$inferInsert;
export type Student = typeof students.$inferSelect;

export type InsertAttendance = typeof attendance.$inferInsert;
export type Attendance = typeof attendance.$inferSelect;

export type InsertBus = typeof buses.$inferInsert;
export type Bus = typeof buses.$inferSelect;

export type InsertVehicleIssue = typeof vehicleIssues.$inferInsert;
export type VehicleIssue = typeof vehicleIssues.$inferSelect;

export type InsertDriverTask = typeof driverTasks.$inferInsert;
export type DriverTask = typeof driverTasks.$inferSelect;

export type InsertEmergencyContact = typeof emergencyContacts.$inferInsert;
export type EmergencyContact = typeof emergencyContacts.$inferSelect;

export type InsertRouteSchool = typeof routeSchools.$inferInsert;
export type RouteSchool = typeof routeSchools.$inferSelect;

export type InsertStudentAttendance = typeof studentAttendance.$inferInsert;
export type StudentAttendance = typeof studentAttendance.$inferSelect;

// Admin requests table for driver communication
export const adminRequests = pgTable("admin_requests", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").references(() => companies.id),
  title: varchar("title").notNull(),
  description: text("description").notNull(),
  status: varchar("status").notNull().default('pending'), // pending, acknowledged, completed
  priority: varchar("priority").notNull().default('medium'), // low, medium, high
  driverId: varchar("driver_id").references(() => users.id), // null means all drivers
  acknowledgedAt: timestamp("acknowledged_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type AdminRequest = typeof adminRequests.$inferSelect;
export type InsertAdminRequest = typeof adminRequests.$inferInsert;

export const insertAdminRequestSchema = createInsertSchema(adminRequests).omit({ id: true, createdAt: true, acknowledgedAt: true, completedAt: true });

// Driver shift reports table
export const driverShiftReports = pgTable("driver_shift_reports", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").references(() => companies.id),
  driverId: varchar("driver_id").notNull().references(() => users.id),
  driverName: varchar("driver_name").notNull(),
  busId: varchar("bus_id").references(() => buses.id),
  routeId: varchar("route_id").references(() => routes.id),
  busNumber: varchar("bus_number"),
  routeName: varchar("route_name"),
  shiftStartTime: timestamp("shift_start_time").notNull(),
  shiftEndTime: timestamp("shift_end_time").notNull(),
  totalDurationMinutes: integer("total_duration_minutes").notNull(),
  startingFuelLevel: varchar("starting_fuel_level"),
  endingFuelLevel: varchar("ending_fuel_level"),
  startingMileage: integer("starting_mileage"),
  endingMileage: integer("ending_mileage"),
  milesDriven: integer("miles_driven"),
  schoolsVisited: integer("schools_visited").default(0),
  studentsPickedUp: integer("students_picked_up").default(0),
  studentsDroppedOff: integer("students_dropped_off").default(0),
  issuesReported: integer("issues_reported").default(0),
  interiorCleanStart: boolean("interior_clean_start"),
  exteriorCleanStart: boolean("exterior_clean_start"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type DriverShiftReport = typeof driverShiftReports.$inferSelect;
export type InsertDriverShiftReport = typeof driverShiftReports.$inferInsert;

// Zod schemas for inserts
export const insertSchoolSchema = createInsertSchema(schools).omit({ id: true, createdAt: true });
export const insertRouteSchema = createInsertSchema(routes).omit({ id: true, createdAt: true, updatedAt: true });
export const insertRouteStopSchema = createInsertSchema(routeStops).omit({ id: true, createdAt: true });
export const insertStudentSchema = createInsertSchema(students).omit({ id: true, createdAt: true, updatedAt: true });
export const insertAttendanceSchema = createInsertSchema(attendance).omit({ id: true, createdAt: true });
export const insertBusSchema = createInsertSchema(buses).omit({ id: true, createdAt: true, lastUpdated: true });
export const insertVehicleIssueSchema = createInsertSchema(vehicleIssues).omit({ id: true, createdAt: true, resolvedAt: true });
export const insertDriverTaskSchema = createInsertSchema(driverTasks).omit({ id: true, createdAt: true, completedAt: true });
export const insertEmergencyContactSchema = createInsertSchema(emergencyContacts).omit({ id: true, createdAt: true });
export const insertRouteSchoolSchema = createInsertSchema(routeSchools).omit({ id: true, createdAt: true });

// Inferred types  
export type InsertBusType = z.infer<typeof insertBusSchema>;

// Notification type enum
export const notificationTypeEnum = pgEnum('notification_type', ['delay', 'emergency', 'info', 'route_change']);

// Parent notifications table
export const parentNotifications = pgTable("parent_notifications", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").references(() => companies.id),
  type: notificationTypeEnum("type").notNull().default('info'),
  title: varchar("title").notNull(),
  message: text("message").notNull(),
  routeId: varchar("route_id").references(() => routes.id),
  busId: varchar("bus_id").references(() => buses.id),
  createdById: varchar("created_by_id").references(() => users.id).notNull(),
  isGlobal: boolean("is_global").default(false),
  targetParentId: varchar("target_parent_id").references(() => users.id), // For targeted notifications to specific parent
  estimatedDelay: integer("estimated_delay"),
  createdAt: timestamp("created_at").defaultNow(),
  expiresAt: timestamp("expires_at"),
});

// Parent notification reads (track which parents have seen notifications)
export const notificationReads = pgTable("notification_reads", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  notificationId: varchar("notification_id").references(() => parentNotifications.id, { onDelete: 'cascade' }).notNull(),
  parentId: varchar("parent_id").references(() => users.id).notNull(),
  readAt: timestamp("read_at").defaultNow(),
}, (table) => ({
  notificationParentUnique: unique().on(table.notificationId, table.parentId),
}));

export type ParentNotification = typeof parentNotifications.$inferSelect;
export type InsertParentNotification = typeof parentNotifications.$inferInsert;
export type NotificationRead = typeof notificationReads.$inferSelect;
export type InsertNotificationRead = typeof notificationReads.$inferInsert;

export const insertParentNotificationSchema = createInsertSchema(parentNotifications).omit({ 
  id: true, 
  createdAt: true 
});
export const insertNotificationReadSchema = createInsertSchema(notificationReads).omit({ 
  id: true, 
  readAt: true 
});

// ============================================
// PARENT-CHILD LINKING SYSTEM
// ============================================

// Link code status enum
export const linkCodeStatusEnum = pgEnum('link_code_status', ['active', 'used', 'expired', 'revoked']);

// Link codes table - admin generates these for parents to link to children
export const linkCodes = pgTable("link_codes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").references(() => companies.id),
  code: varchar("code").notNull().unique(), // e.g., "TNT-483921"
  studentId: varchar("student_id").references(() => students.id, { onDelete: 'cascade' }).notNull(),
  createdById: varchar("created_by_id").references(() => users.id).notNull(), // Admin who created
  status: linkCodeStatusEnum("status").default('active'),
  maxUses: integer("max_uses").default(2), // Default allows 2 parents/guardians
  usesCount: integer("uses_count").default(0),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

// Parent-child links - many-to-many relationship
export const parentChildLinks = pgTable("parent_child_links", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  parentId: varchar("parent_id").references(() => users.id, { onDelete: 'cascade' }).notNull(),
  studentId: varchar("student_id").references(() => students.id, { onDelete: 'cascade' }).notNull(),
  linkCodeId: varchar("link_code_id").references(() => linkCodes.id), // Which code was used
  linkedAt: timestamp("linked_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  parentStudentUnique: unique().on(table.parentId, table.studentId),
}));

// Relations for linking tables
export const linkCodesRelations = relations(linkCodes, ({ one, many }) => ({
  student: one(students, { fields: [linkCodes.studentId], references: [students.id] }),
  createdBy: one(users, { fields: [linkCodes.createdById], references: [users.id] }),
  usedLinks: many(parentChildLinks),
}));

export const parentChildLinksRelations = relations(parentChildLinks, ({ one }) => ({
  parent: one(users, { fields: [parentChildLinks.parentId], references: [users.id] }),
  student: one(students, { fields: [parentChildLinks.studentId], references: [students.id] }),
  linkCode: one(linkCodes, { fields: [parentChildLinks.linkCodeId], references: [linkCodes.id] }),
}));

// Types for linking system
export type LinkCode = typeof linkCodes.$inferSelect;
export type InsertLinkCode = typeof linkCodes.$inferInsert;
export type ParentChildLink = typeof parentChildLinks.$inferSelect;
export type InsertParentChildLink = typeof parentChildLinks.$inferInsert;

// Zod schemas for linking system
export const insertLinkCodeSchema = createInsertSchema(linkCodes).omit({ 
  id: true, 
  createdAt: true,
  usesCount: true,
  status: true,
});
export const insertParentChildLinkSchema = createInsertSchema(parentChildLinks).omit({ 
  id: true, 
  createdAt: true,
  linkedAt: true,
});

// ============================================
// PARENT-DRIVER MESSAGING SYSTEM
// ============================================

// Direct messages between parents and drivers
export const directMessages = pgTable("direct_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").references(() => companies.id),
  senderId: varchar("sender_id").references(() => users.id, { onDelete: 'cascade' }).notNull(),
  recipientId: varchar("recipient_id").references(() => users.id, { onDelete: 'cascade' }).notNull(),
  studentId: varchar("student_id").references(() => students.id), // Context: which student this is about
  content: text("content").notNull(),
  isRead: boolean("is_read").default(false),
  readAt: timestamp("read_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Relations for direct messages
export const directMessagesRelations = relations(directMessages, ({ one }) => ({
  sender: one(users, { fields: [directMessages.senderId], references: [users.id], relationName: 'sender' }),
  recipient: one(users, { fields: [directMessages.recipientId], references: [users.id], relationName: 'recipient' }),
  student: one(students, { fields: [directMessages.studentId], references: [students.id] }),
}));

// Types for messaging system
export type DirectMessage = typeof directMessages.$inferSelect;
export type InsertDirectMessage = typeof directMessages.$inferInsert;

// Zod schemas for messaging system
export const insertDirectMessageSchema = createInsertSchema(directMessages).omit({ 
  id: true, 
  createdAt: true,
  isRead: true,
  readAt: true,
});

// ============================================
// BLUETOOTH CHECK-IN SYSTEM
// ============================================

// Check-in status enum
export const checkInStatusEnum = pgEnum('check_in_status', [
  'waiting',      // Parent enabled check-in, waiting for driver
  'boarded',      // Student has boarded the bus
  'dropped_off',  // Student has been dropped off
]);

// Student check-ins table - tracks Bluetooth-based boarding
export const studentCheckIns = pgTable("student_check_ins", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").references(() => companies.id),
  studentId: varchar("student_id").references(() => students.id, { onDelete: 'cascade' }).notNull(),
  parentId: varchar("parent_id").references(() => users.id).notNull(), // Parent who enabled check-in
  driverId: varchar("driver_id").references(() => users.id), // Driver who confirmed boarding
  routeId: varchar("route_id").references(() => routes.id),
  busId: varchar("bus_id").references(() => buses.id),
  deviceId: varchar("device_id"), // Unique device identifier for Bluetooth
  status: checkInStatusEnum("status").default('waiting'),
  checkInDate: timestamp("check_in_date").defaultNow(),
  boardedAt: timestamp("boarded_at"),
  droppedOffAt: timestamp("dropped_off_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Relations for student check-ins
export const studentCheckInsRelations = relations(studentCheckIns, ({ one }) => ({
  student: one(students, { fields: [studentCheckIns.studentId], references: [students.id] }),
  parent: one(users, { fields: [studentCheckIns.parentId], references: [users.id], relationName: 'checkin_parent' }),
  driver: one(users, { fields: [studentCheckIns.driverId], references: [users.id], relationName: 'checkin_driver' }),
  route: one(routes, { fields: [studentCheckIns.routeId], references: [routes.id] }),
  bus: one(buses, { fields: [studentCheckIns.busId], references: [buses.id] }),
}));

// Types for check-in system
export type StudentCheckIn = typeof studentCheckIns.$inferSelect;
export type InsertStudentCheckIn = typeof studentCheckIns.$inferInsert;

// Zod schemas for check-in system
export const insertStudentCheckInSchema = createInsertSchema(studentCheckIns).omit({ 
  id: true, 
  createdAt: true,
  boardedAt: true,
  droppedOffAt: true,
});

// ============================================
// SYSTEM NOTIFICATIONS (Multi-role)
// ============================================

// Sender role enum
export const senderRoleEnum = pgEnum('sender_role', ['admin', 'driver', 'system']);

// Recipient role enum  
export const recipientRoleEnum = pgEnum('recipient_role', ['parent', 'driver', 'all_parents', 'all_drivers', 'route_parents']);

// System notifications table - supports admin/driver sending to parents/drivers
export const systemNotifications = pgTable("system_notifications", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").references(() => companies.id),
  senderId: varchar("sender_id").references(() => users.id).notNull(),
  senderRole: senderRoleEnum("sender_role").notNull(),
  recipientRole: recipientRoleEnum("recipient_role").notNull(),
  recipientId: varchar("recipient_id").references(() => users.id), // For direct notifications to specific user
  routeId: varchar("route_id").references(() => routes.id), // For route-specific notifications
  title: varchar("title").notNull(),
  message: text("message").notNull(),
  type: notificationTypeEnum("type").notNull().default('info'),
  isRead: boolean("is_read").default(false),
  readAt: timestamp("read_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Types for system notifications
export type SystemNotification = typeof systemNotifications.$inferSelect;
export type InsertSystemNotification = typeof systemNotifications.$inferInsert;

// Zod schema for system notifications
export const insertSystemNotificationSchema = createInsertSchema(systemNotifications).omit({ 
  id: true, 
  createdAt: true,
  readAt: true,
  isRead: true,
});

// ============================================
// BUS JOURNEY TRACKING (Admin Reports)
// ============================================

// Journey event type enum
export const journeyEventTypeEnum = pgEnum('journey_event_type', [
  'depart_homebase',
  'arrive_school', 
  'depart_school',
  'arrive_homebase'
]);

// Bus journeys table - tracks daily journey events for each bus
export const busJourneys = pgTable("bus_journeys", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").references(() => companies.id),
  busId: varchar("bus_id").notNull().references(() => buses.id),
  driverId: varchar("driver_id").references(() => users.id),
  routeId: varchar("route_id").references(() => routes.id),
  journeyDate: timestamp("journey_date").notNull(),
  departHomebaseAt: timestamp("depart_homebase_at"),
  arriveSchoolAt: timestamp("arrive_school_at"),
  departSchoolAt: timestamp("depart_school_at"),
  arriveHomebaseAt: timestamp("arrive_homebase_at"),
  homebaseAddress: varchar("homebase_address"),
  schoolId: varchar("school_id").references(() => schools.id),
  totalDurationMinutes: integer("total_duration_minutes"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Relations for bus journeys
export const busJourneysRelations = relations(busJourneys, ({ one }) => ({
  bus: one(buses, { fields: [busJourneys.busId], references: [buses.id] }),
  driver: one(users, { fields: [busJourneys.driverId], references: [users.id] }),
  route: one(routes, { fields: [busJourneys.routeId], references: [routes.id] }),
  school: one(schools, { fields: [busJourneys.schoolId], references: [schools.id] }),
}));

// Types for bus journey tracking
export type BusJourney = typeof busJourneys.$inferSelect;
export type InsertBusJourney = typeof busJourneys.$inferInsert;

// Zod schema for bus journey
export const insertBusJourneySchema = createInsertSchema(busJourneys).omit({ 
  id: true, 
  createdAt: true,
  updatedAt: true,
  totalDurationMinutes: true,
});

// ============================================
// ROUTE STOP COMPLETION TRACKING
// ============================================

// Route stop completions - tracks when drivers arrive at each stop
export const routeStopCompletions = pgTable("route_stop_completions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").references(() => companies.id),
  routeStopId: varchar("route_stop_id").notNull().references(() => routeStops.id),
  routeId: varchar("route_id").notNull().references(() => routes.id),
  busId: varchar("bus_id").references(() => buses.id),
  driverId: varchar("driver_id").references(() => users.id),
  completionDate: timestamp("completion_date").notNull(),
  arrivedAt: timestamp("arrived_at").notNull(),
  departedAt: timestamp("departed_at"),
  stopSequence: integer("stop_sequence"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Relations for route stop completions
export const routeStopCompletionsRelations = relations(routeStopCompletions, ({ one }) => ({
  routeStop: one(routeStops, { fields: [routeStopCompletions.routeStopId], references: [routeStops.id] }),
  route: one(routes, { fields: [routeStopCompletions.routeId], references: [routes.id] }),
  bus: one(buses, { fields: [routeStopCompletions.busId], references: [buses.id] }),
  driver: one(users, { fields: [routeStopCompletions.driverId], references: [users.id] }),
}));

// Types for route stop completions
export type RouteStopCompletion = typeof routeStopCompletions.$inferSelect;
export type InsertRouteStopCompletion = typeof routeStopCompletions.$inferInsert;
