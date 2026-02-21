import {
  users,
  students,
  routes,
  routeStops,
  routeSchools,
  schools,
  attendance,
  buses,
  vehicleIssues,
  driverTasks,
  emergencyContacts,
  schoolVisits,
  companies,
  companySettings,
  companyModules,
  companyRoles,
  invitations,
  passwordCredentials,
  departments,
  linkCodes,
  parentChildLinks,
  driverInvitations,
  type User,
  type UpsertUser,
  type Student,
  type InsertStudent,
  type Route,
  type InsertRoute,
  type RouteStop,
  type InsertRouteStop,
  type School,
  type InsertSchool,
  type Attendance,
  type InsertAttendance,
  type Bus,
  type InsertBus,
  type VehicleIssue,
  type InsertVehicleIssue,
  type DriverTask,
  type InsertDriverTask,
  type EmergencyContact,
  type InsertEmergencyContact,
  type RouteSchool,
  type InsertRouteSchool,
  type SchoolVisit,
  type InsertSchoolVisit,
  studentAttendance,
  type StudentAttendance,
  type InsertStudentAttendance,
  driverShiftReports,
  type DriverShiftReport,
  type InsertDriverShiftReport,
  adminRequests,
  type AdminRequest,
  type InsertAdminRequest,
  parentNotifications,
  notificationReads,
  type ParentNotification,
  type InsertParentNotification,
  type NotificationRead,
  type InsertNotificationRead,
  type Company,
  type InsertCompany,
  type CompanySetting,
  type InsertCompanySetting,
  type CompanyRole,
  type InsertCompanyRole,
  type Invitation,
  type InsertInvitation,
  type PasswordCredential,
  type InsertPasswordCredential,
  type Department,
  type InsertDepartment,
  type LinkCode,
  type InsertLinkCode,
  type ParentChildLink,
  type InsertParentChildLink,
  directMessages,
  type DirectMessage,
  type InsertDirectMessage,
  studentCheckIns,
  type StudentCheckIn,
  type InsertStudentCheckIn,
  type DriverInvitation,
  type InsertDriverInvitation,
  systemNotifications,
  type SystemNotification,
  type InsertSystemNotification,
  busJourneys,
  type BusJourney,
  type InsertBusJourney,
  routeStopCompletions,
  type RouteStopCompletion,
  type InsertRouteStopCompletion,
} from "@shared/schema";
import { db } from "./db";
import { eq, and, desc, asc, sql, or, inArray } from "drizzle-orm";

export interface IStorage {
  // User operations (required for Replit Auth)
  getUser(id: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;
  updateUserRole(id: string, role: string): Promise<User | undefined>;
  updateDriverProfile(id: string, updates: Partial<User>): Promise<User | undefined>;
  getAllDrivers(companyId: string): Promise<User[]>;
  getActiveDrivers(companyId: string): Promise<User[]>;
  getArchivedDrivers(companyId: string): Promise<User[]>;
  deactivateDriver(driverId: string, companyId: string): Promise<User | undefined>;
  reactivateDriver(driverId: string, companyId: string): Promise<User | undefined>;
  createDriver(driverData: UpsertUser): Promise<User>;
  
  // User count operations for plan limits
  getStaffUserCount(companyId: string): Promise<number>;
  getParentUserCount(companyId: string): Promise<number>;
  canCreateUser(companyId: string, role: string): Promise<{ allowed: boolean; reason?: string }>;
  
  // School operations
  getAllSchools(): Promise<School[]>;
  createSchool(school: InsertSchool): Promise<School>;
  
  // Route operations
  getAllRoutes(): Promise<Route[]>;
  getRouteById(id: string): Promise<Route | undefined>;
  getRoutesByDriverId(driverId: string): Promise<Route[]>;
  createRoute(route: InsertRoute): Promise<Route>;
  updateRoute(id: string, updates: Partial<InsertRoute>): Promise<Route | undefined>;
  deleteRoute(id: string): Promise<boolean>;
  assignDriverToRoute(driverId: string, routeId: string): Promise<boolean>;
  
  // Route stop operations
  getStopsByRouteId(routeId: string): Promise<RouteStop[]>;
  getRouteStopById(id: string): Promise<RouteStop | undefined>;
  createRouteStop(stop: InsertRouteStop): Promise<RouteStop>;
  updateRouteStop(id: string, updates: Partial<InsertRouteStop>): Promise<RouteStop | undefined>;
  deleteRouteStop(id: string): Promise<boolean>;

  // Route school operations
  getSchoolsByRouteId(routeId: string): Promise<School[]>;
  addSchoolToRoute(routeId: string, schoolId: string): Promise<RouteSchool>;
  removeSchoolFromRoute(routeId: string, schoolId: string): Promise<boolean>;
  removeStopsBySchoolFromRoute(routeId: string, schoolId: string): Promise<boolean>;
  reorderRouteSchool(routeId: string, schoolId: string, direction: 'up' | 'down'): Promise<School[]>;
  
  // Student operations
  getAllStudents(): Promise<Student[]>;
  getStudentById(id: string): Promise<Student | undefined>;
  getStudentsByParentId(parentId: string): Promise<Student[]>;
  getStudentsByRouteId(routeId: string): Promise<Student[]>;
  getStudentsByStopId(stopId: string): Promise<Student[]>;
  createStudent(student: InsertStudent): Promise<Student>;
  updateStudent(id: string, updates: Partial<InsertStudent>): Promise<Student | undefined>;
  deleteStudent(id: string): Promise<boolean>;
  
  // Attendance operations
  getAttendanceByDate(date: Date): Promise<Attendance[]>;
  getAttendanceByStudentAndDate(studentId: string, date: Date): Promise<Attendance | undefined>;
  createAttendance(attendance: InsertAttendance): Promise<Attendance>;
  updateAttendance(id: string, updates: Partial<InsertAttendance>): Promise<Attendance | undefined>;
  
  // Bus operations
  getAllBuses(): Promise<Bus[]>;
  getBusByDriverId(driverId: string): Promise<Bus | undefined>;
  getBusByNumber(busNumber: string): Promise<Bus | undefined>;
  getBusById(id: string): Promise<Bus | undefined>;
  getBusByRouteId(routeId: string): Promise<Bus | undefined>;
  createBus(bus: InsertBus): Promise<Bus>;
  updateBus(id: string, updates: Partial<InsertBus>): Promise<Bus | undefined>;
  updateBusFuelLevel(busId: string, fuelLevel: string): Promise<Bus | undefined>;
  assignDriverToBus(driverId: string, busId: string): Promise<boolean>;
  assignDriverToRoute(driverId: string, routeId: string): Promise<boolean>;
  unassignDriverFromBus(driverId: string): Promise<boolean>;
  unassignDriverFromRoute(driverId: string): Promise<boolean>;
  updateBusLocation(id: string, latitude: string, longitude: string, speed?: string): Promise<Bus | undefined>;
  updateBusStatus(id: string, status: string): Promise<Bus | undefined>;
  
  // Vehicle issue operations
  getIssuesByBusId(busId: string): Promise<VehicleIssue[]>;
  createVehicleIssue(issue: InsertVehicleIssue): Promise<VehicleIssue>;
  resolveVehicleIssue(id: string): Promise<VehicleIssue | undefined>;
  
  // Driver task operations
  getTasksByDriverId(driverId: string): Promise<DriverTask[]>;
  getAllActiveTasks(): Promise<DriverTask[]>;
  createDriverTask(task: InsertDriverTask): Promise<DriverTask>;
  updateTaskCompletion(id: string, isCompleted: boolean): Promise<DriverTask | undefined>;
  
  // Emergency contact operations
  getEmergencyContactsByStudentId(studentId: string): Promise<EmergencyContact[]>;
  createEmergencyContact(contact: InsertEmergencyContact): Promise<EmergencyContact>;
  
  // School visit operations for driver arrivals/departures
  getSchoolVisitsByDriverRoute(driverId: string, routeId: string): Promise<SchoolVisit[]>;
  recordSchoolArrival(driverId: string, schoolId: string, routeId: string): Promise<SchoolVisit>;
  recordSchoolDeparture(visitId: string): Promise<SchoolVisit | undefined>;
  getTodaysSchoolVisits(driverId: string): Promise<SchoolVisit[]>;

  // Student attendance operations
  getTodaysStudentAttendance(driverId: string, routeId: string): Promise<StudentAttendance[]>;
  markStudentAttendance(driverId: string, studentId: string, routeId: string, status: "present" | "absent"): Promise<StudentAttendance>;
  getAttendanceByRoute(routeId: string, date?: Date): Promise<StudentAttendance[]>;
  getAllAttendanceData(): Promise<StudentAttendance[]>;
  getTodaysAttendanceForStudents(studentIds: string[]): Promise<StudentAttendance[]>;

  // Driver shift report operations
  createDriverShiftReport(report: InsertDriverShiftReport): Promise<DriverShiftReport>;
  getDriverShiftReports(driverId?: string): Promise<DriverShiftReport[]>;
  getDriverShiftReportsByDateRange(startDate: Date, endDate: Date, driverId?: string): Promise<DriverShiftReport[]>;

  // Admin request operations
  getAllAdminRequests(): Promise<AdminRequest[]>;
  getAdminRequestById(id: string): Promise<AdminRequest | undefined>;
  createAdminRequest(request: InsertAdminRequest): Promise<AdminRequest>;
  acknowledgeAdminRequest(id: string): Promise<AdminRequest | undefined>;
  completeAdminRequest(id: string): Promise<AdminRequest | undefined>;

  // Parent notification operations
  createParentNotification(notification: InsertParentNotification): Promise<ParentNotification>;
  getAllNotifications(): Promise<ParentNotification[]>;
  getNotificationsByRouteId(routeId: string): Promise<ParentNotification[]>;
  getNotificationsForParent(parentId: string): Promise<ParentNotification[]>;
  markNotificationRead(notificationId: string, parentId: string): Promise<NotificationRead>;
  markAllNotificationsRead(parentId: string): Promise<void>;
  getUnreadCountForParent(parentId: string): Promise<number>;
  deleteNotification(id: string): Promise<boolean>;

  // Multi-tenant authentication operations
  getUserByEmail(email: string): Promise<User | undefined>;
  getPasswordCredentials(userId: string): Promise<PasswordCredential | undefined>;
  createPasswordCredentials(userId: string, passwordHash: string): Promise<PasswordCredential>;
  createUserWithPassword(userData: Partial<UpsertUser>, passwordHash: string): Promise<User>;
  
  // Company operations
  getCompanyBySlug(slug: string): Promise<Company | undefined>;
  getCompanyById(id: string): Promise<Company | undefined>;
  getCompanyByStripeCustomerId(customerId: string): Promise<Company | undefined>;
  getCompanyByStripeSubscriptionId(subscriptionId: string): Promise<Company | undefined>;
  createCompany(company: InsertCompany): Promise<Company>;
  updateCompany(id: string, updates: Partial<InsertCompany>): Promise<Company | undefined>;
  getAllCompanies(): Promise<Company[]>;
  getCompaniesByStatus(status: string): Promise<Company[]>;
  approveCompany(id: string, approvedBy: string): Promise<Company | undefined>;
  suspendCompany(id: string, suspendedBy: string, reason?: string): Promise<Company | undefined>;
  rejectCompany(id: string): Promise<Company | undefined>;
  
  // Invitation operations
  createInvitation(invitation: InsertInvitation): Promise<Invitation>;
  getInvitationByToken(token: string): Promise<Invitation | undefined>;
  acceptInvitation(token: string, userId: string): Promise<Invitation | undefined>;
  
  // Password reset operations
  setPasswordResetToken(userId: string, token: string, expiresAt: Date): Promise<void>;
  getCredentialsByResetToken(token: string): Promise<PasswordCredential | undefined>;
  updatePassword(userId: string, passwordHash: string): Promise<void>;
  clearPasswordResetToken(userId: string): Promise<void>;

  // Link code operations (Parent-Child linking system)
  generateLinkCode(studentId: string, createdById: string, maxUses?: number, expiresInDays?: number, companyId?: string): Promise<LinkCode>;
  getLinkCodeByCode(code: string): Promise<LinkCode | undefined>;
  getLinkCodesByStudentId(studentId: string): Promise<LinkCode[]>;
  useLinkCode(code: string, parentId: string): Promise<{ success: boolean; error?: string; link?: ParentChildLink }>;
  revokeLinkCode(codeId: string): Promise<LinkCode | undefined>;
  regenerateLinkCode(studentId: string, createdById: string): Promise<LinkCode>;
  
  // Parent-Child link operations
  getLinkedStudentsByParentId(parentId: string): Promise<Student[]>;
  getLinkedParentsByStudentId(studentId: string): Promise<User[]>;
  unlinkParentFromStudent(parentId: string, studentId: string): Promise<boolean>;
  getParentChildLink(parentId: string, studentId: string): Promise<ParentChildLink | undefined>;

  // Direct messaging operations
  sendDirectMessage(message: InsertDirectMessage): Promise<DirectMessage>;
  getConversation(userId1: string, userId2: string, studentId?: string, companyId?: string): Promise<DirectMessage[]>;
  getConversationsForUser(userId: string, companyId?: string): Promise<{ recipientId: string; recipientName: string; lastMessage: string; unreadCount: number; lastMessageAt: Date }[]>;
  markMessageAsRead(messageId: string): Promise<DirectMessage | undefined>;
  markConversationAsRead(userId: string, otherUserId: string, companyId?: string): Promise<void>;
  getUnreadMessageCount(userId: string, companyId?: string): Promise<number>;
  getDriversForParent(parentId: string, companyId?: string): Promise<User[]>;
  getParentsForDriver(driverId: string, companyId?: string): Promise<User[]>;

  // Student check-in operations (Bluetooth boarding)
  enableStudentCheckIn(studentId: string, parentId: string, deviceId: string, companyId?: string): Promise<StudentCheckIn>;
  disableStudentCheckIn(studentId: string): Promise<boolean>;
  getActiveCheckInsForRoute(routeId: string): Promise<StudentCheckIn[]>;
  getCheckInStatus(studentId: string): Promise<StudentCheckIn | undefined>;
  getCheckInById(checkInId: string): Promise<StudentCheckIn | undefined>;
  confirmStudentBoarded(checkInId: string, driverId: string, busId: string, routeId: string): Promise<StudentCheckIn | undefined>;
  confirmStudentDroppedOff(checkInId: string): Promise<StudentCheckIn | undefined>;
  getTodayCheckInsForParent(parentId: string): Promise<StudentCheckIn[]>;
  getTodayCheckInsForStudents(studentIds: string[]): Promise<StudentCheckIn[]>;

  // Driver invitation operations
  createDriverInvitation(driverId: string, email: string, companyId: string, tokenHash: string, expiresAt: Date): Promise<DriverInvitation>;
  getDriverInvitationByTokenHash(tokenHash: string): Promise<DriverInvitation | undefined>;
  getPendingInvitationByDriverId(driverId: string): Promise<DriverInvitation | undefined>;
  acceptDriverInvitation(invitationId: string): Promise<DriverInvitation | undefined>;
  hasDriverSetupPassword(driverId: string): Promise<boolean>;

  // System notification operations
  createSystemNotification(notification: InsertSystemNotification): Promise<SystemNotification>;
  getSystemNotificationsForAdmin(companyId: string): Promise<SystemNotification[]>;
  getSystemNotificationsForDriver(driverId: string, companyId: string): Promise<SystemNotification[]>;
  getSystemNotificationsForParent(parentId: string, companyId: string): Promise<SystemNotification[]>;
  markSystemNotificationAsRead(notificationId: string): Promise<SystemNotification | undefined>;
  getUnreadNotificationCountForAdmin(companyId: string): Promise<number>;
  getUnreadNotificationCountForDriver(driverId: string, companyId: string): Promise<number>;
  getUnreadNotificationCountForParent(parentId: string, companyId: string): Promise<number>;

  // Bus journey tracking operations
  createBusJourney(busId: string, driverId: string, routeId: string, companyId: string, homebaseAddress?: string): Promise<BusJourney>;
  getTodayBusJourney(busId: string): Promise<BusJourney | undefined>;
  updateJourneyEvent(journeyId: string, eventType: 'depart_homebase' | 'arrive_school' | 'depart_school' | 'arrive_homebase', schoolId?: string): Promise<BusJourney | undefined>;
  getBusJourneysForDateRange(companyId: string, startDate: Date, endDate: Date): Promise<BusJourney[]>;
  getBusJourneysByBus(busId: string, limit?: number): Promise<BusJourney[]>;

  // Route stop completion tracking
  markStopCompleted(data: { routeStopId: string; routeId: string; driverId: string; busId: string; companyId: string; stopSequence: number }): Promise<RouteStopCompletion>;
  getTodayCompletedStops(routeId: string): Promise<RouteStopCompletion[]>;
  getLastCompletedStop(routeId: string): Promise<RouteStopCompletion | undefined>;
  resetRouteStops(routeId: string): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  // User operations
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(userData)
      .onConflictDoUpdate({
        target: users.id,
        set: {
          ...userData,
          updatedAt: new Date(),
        },
      })
      .returning();
    return user;
  }

  async updateUserRole(id: string, role: string): Promise<User | undefined> {
    const [updatedUser] = await db
      .update(users)
      .set({ role: role as any, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    return updatedUser;
  }

  async updateDriverProfile(id: string, updates: Partial<User>): Promise<User | undefined> {
    const [user] = await db
      .update(users)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    return user;
  }

  async getAllDrivers(companyId: string): Promise<User[]> {
    return await db
      .select()
      .from(users)
      .where(
        and(
          eq(users.role, 'driver'),
          eq(users.companyId, companyId)
        )
      )
      .orderBy(asc(users.lastName), asc(users.firstName));
  }

  async getActiveDrivers(companyId: string): Promise<User[]> {
    return await db
      .select()
      .from(users)
      .where(
        and(
          eq(users.role, 'driver'),
          eq(users.companyId, companyId),
          eq(users.isActive, true)
        )
      )
      .orderBy(asc(users.lastName), asc(users.firstName));
  }

  async getArchivedDrivers(companyId: string): Promise<User[]> {
    return await db
      .select()
      .from(users)
      .where(
        and(
          eq(users.role, 'driver'),
          eq(users.companyId, companyId),
          eq(users.isActive, false)
        )
      )
      .orderBy(asc(users.lastName), asc(users.firstName));
  }

  async deactivateDriver(driverId: string, companyId: string): Promise<User | undefined> {
    // Verify driver belongs to company
    const driver = await this.getUser(driverId);
    if (!driver || driver.role !== 'driver' || driver.companyId !== companyId) {
      return undefined;
    }

    // Clear bus assignment if any
    await db
      .update(buses)
      .set({ driverId: null, lastUpdated: new Date() })
      .where(eq(buses.driverId, driverId));

    // Clear route driver assignment if any
    await db
      .update(routes)
      .set({ driverId: null, updatedAt: new Date() })
      .where(eq(routes.driverId, driverId));

    // Delete password credentials to allow email reuse
    await db
      .delete(passwordCredentials)
      .where(eq(passwordCredentials.userId, driverId));

    // Delete driver invitations
    await db
      .delete(driverInvitations)
      .where(eq(driverInvitations.driverId, driverId));

    // Clear email by appending deleted suffix so it can be reused
    const deletedEmail = driver.email ? `${driver.email}_deleted_${Date.now()}` : null;

    // Clear user route assignment, email, and set off duty
    const [updatedDriver] = await db
      .update(users)
      .set({ 
        isActive: false, 
        isOnDuty: false,
        assignedRouteId: null,
        email: deletedEmail,
        updatedAt: new Date() 
      })
      .where(eq(users.id, driverId))
      .returning();
    
    return updatedDriver;
  }

  async reactivateDriver(driverId: string, companyId: string): Promise<User | undefined> {
    // Verify driver belongs to company
    const driver = await this.getUser(driverId);
    if (!driver || driver.role !== 'driver' || driver.companyId !== companyId) {
      return undefined;
    }

    const [updatedDriver] = await db
      .update(users)
      .set({ 
        isActive: true,
        updatedAt: new Date() 
      })
      .where(eq(users.id, driverId))
      .returning();
    
    return updatedDriver;
  }

  async getOnDutyDrivers(companyId?: string): Promise<User[]> {
    const conditions = [eq(users.role, 'driver'), eq(users.isOnDuty, true)];
    if (companyId) {
      conditions.push(eq(users.companyId, companyId));
    }
    const onDutyDrivers = await db
      .select()
      .from(users)
      .where(and(...conditions))
      .orderBy(asc(users.lastName), asc(users.firstName));
    return onDutyDrivers;
  }

  async createDriver(driverData: UpsertUser): Promise<User> {
    const [driver] = await db
      .insert(users)
      .values({
        ...driverData,
        role: 'driver',
        isActive: true,
      })
      .returning();
    return driver;
  }

  // User count operations for plan limits
  async getStaffUserCount(companyId: string): Promise<number> {
    const result = await db
      .select({ count: sql<number>`count(*)` })
      .from(users)
      .where(
        and(
          eq(users.companyId, companyId),
          or(eq(users.role, 'admin'), eq(users.role, 'driver'))
        )
      );
    return Number(result[0]?.count) || 0;
  }

  async getParentUserCount(companyId: string): Promise<number> {
    const result = await db
      .select({ count: sql<number>`count(*)` })
      .from(users)
      .where(
        and(
          eq(users.companyId, companyId),
          eq(users.role, 'parent')
        )
      );
    return Number(result[0]?.count) || 0;
  }

  async canCreateUser(companyId: string, role: string): Promise<{ allowed: boolean; reason?: string }> {
    const company = await this.getCompanyById(companyId);
    if (!company) {
      return { allowed: false, reason: 'Company not found' };
    }

    const planType = company.planType || 'starter';
    const staffLimit = company.staffUserLimit;
    const parentLimit = company.parentUserLimit;

    // Check if this is a staff role (admin or driver)
    if (role === 'admin' || role === 'driver') {
      // Null means unlimited
      if (staffLimit === null) {
        return { allowed: true };
      }
      const currentStaffCount = await this.getStaffUserCount(companyId);
      if (currentStaffCount >= staffLimit) {
        return { 
          allowed: false, 
          reason: `Staff user limit reached (${staffLimit}). Upgrade your plan to add more staff users.` 
        };
      }
      return { allowed: true };
    }

    // Check if this is a parent role
    if (role === 'parent') {
      // parentLimit of 0 means parents are not allowed
      if (parentLimit === 0) {
        return { 
          allowed: false, 
          reason: 'Parent accounts are not available on the Starter plan. Upgrade to Professional or Enterprise.' 
        };
      }
      // Null means unlimited
      if (parentLimit === null) {
        return { allowed: true };
      }
      const currentParentCount = await this.getParentUserCount(companyId);
      if (currentParentCount >= parentLimit) {
        return { 
          allowed: false, 
          reason: `Parent user limit reached (${parentLimit}). Upgrade your plan to add more parent users.` 
        };
      }
      return { allowed: true };
    }

    // Unknown role, allow by default
    return { allowed: true };
  }

  // School operations
  async getAllSchools(): Promise<School[]> {
    return await db.select().from(schools).orderBy(asc(schools.name));
  }

  async createSchool(school: InsertSchool): Promise<School> {
    const [newSchool] = await db.insert(schools).values(school).returning();
    return newSchool;
  }

  async getSchoolById(id: string): Promise<School | undefined> {
    const [school] = await db.select().from(schools).where(eq(schools.id, id));
    return school;
  }

  // Route operations
  async getAllRoutes(): Promise<Route[]> {
    const routesWithStopCount = await db
      .select({
        id: routes.id,
        name: routes.name,
        description: routes.description,
        driverId: routes.driverId,
        busNumber: routes.busNumber,
        isActive: routes.isActive,
        estimatedDuration: routes.estimatedDuration,
        createdAt: routes.createdAt,
        updatedAt: routes.updatedAt,
        stopCount: sql<number>`COUNT(DISTINCT CASE WHEN ${routeStops.schoolId} IS NOT NULL THEN ${routeStops.schoolId} END)`.as('stopCount')
      })
      .from(routes)
      .leftJoin(routeStops, eq(routes.id, routeStops.routeId))
      .groupBy(routes.id, routes.name, routes.description, routes.driverId, routes.busNumber, routes.isActive, routes.estimatedDuration, routes.createdAt, routes.updatedAt)
      .orderBy(asc(routes.name));
    
    return routesWithStopCount.map(route => ({
      ...route,
      stopCount: Number(route.stopCount) || 0
    })) as any[];
  }

  async getRouteById(id: string): Promise<Route | undefined> {
    const [route] = await db.select().from(routes).where(eq(routes.id, id));
    return route;
  }

  async getRoutesByDriverId(driverId: string): Promise<Route[]> {
    return await db.select().from(routes).where(eq(routes.driverId, driverId));
  }

  async createRoute(route: InsertRoute): Promise<Route> {
    const [newRoute] = await db.insert(routes).values(route).returning();
    return newRoute;
  }

  async updateRoute(id: string, updates: Partial<InsertRoute>): Promise<Route | undefined> {
    const updateData = {
      ...updates,
      updatedAt: new Date(),
    };
    
    const [updatedRoute] = await db
      .update(routes)
      .set(updateData)
      .where(eq(routes.id, id))
      .returning();
    return updatedRoute;
  }

  async deleteRoute(id: string): Promise<boolean> {
    const result = await db.delete(routes).where(eq(routes.id, id));
    return result.rowCount !== null && result.rowCount > 0;
  }

  // Route stop operations
  async getStopsByRouteId(routeId: string): Promise<RouteStop[]> {
    return await db
      .select()
      .from(routeStops)
      .where(eq(routeStops.routeId, routeId))
      .orderBy(asc(routeStops.order));
  }

  async getRouteStopById(id: string): Promise<RouteStop | undefined> {
    const [stop] = await db.select().from(routeStops).where(eq(routeStops.id, id));
    return stop;
  }

  async createRouteStop(stop: InsertRouteStop): Promise<RouteStop> {
    const [newStop] = await db.insert(routeStops).values(stop).returning();
    return newStop;
  }

  async updateRouteStop(id: string, updates: Partial<InsertRouteStop>): Promise<RouteStop | undefined> {
    const [updatedStop] = await db
      .update(routeStops)
      .set(updates)
      .where(eq(routeStops.id, id))
      .returning();
    return updatedStop;
  }

  async deleteRouteStop(id: string): Promise<boolean> {
    const result = await db.delete(routeStops).where(eq(routeStops.id, id));
    return result.rowCount !== null && result.rowCount > 0;
  }

  // Route school operations
  async getSchoolsByRouteId(routeId: string): Promise<School[]> {
    const result = await db
      .select({
        id: schools.id,
        name: schools.name,
        address: schools.address,
        latitude: schools.latitude,
        longitude: schools.longitude,
        companyId: schools.companyId,
        createdAt: schools.createdAt,
      })
      .from(routeSchools)
      .innerJoin(schools, eq(routeSchools.schoolId, schools.id))
      .where(eq(routeSchools.routeId, routeId))
      .orderBy(asc(routeSchools.order));
    
    return result;
  }

  async addSchoolToRoute(routeId: string, schoolId: string): Promise<RouteSchool> {
    // Get the current max order for this route
    const [maxOrder] = await db
      .select({ maxOrder: sql<number>`COALESCE(MAX(${routeSchools.order}), -1)` })
      .from(routeSchools)
      .where(eq(routeSchools.routeId, routeId));

    const nextOrder = (maxOrder?.maxOrder ?? -1) + 1;

    const [routeSchool] = await db
      .insert(routeSchools)
      .values({ routeId, schoolId, order: nextOrder })
      .returning();
    return routeSchool;
  }

  async removeSchoolFromRoute(routeId: string, schoolId: string): Promise<boolean> {
    const result = await db
      .delete(routeSchools)
      .where(and(
        eq(routeSchools.routeId, routeId),
        eq(routeSchools.schoolId, schoolId)
      ));
    return result.rowCount !== null && result.rowCount > 0;
  }

  async removeStopsBySchoolFromRoute(routeId: string, schoolId: string): Promise<boolean> {
    const result = await db
      .delete(routeStops)
      .where(and(
        eq(routeStops.routeId, routeId),
        eq(routeStops.schoolId, schoolId)
      ));
    return result.rowCount !== null && result.rowCount > 0;
  }

  // Student operations
  async getAllStudents(): Promise<Student[]> {
    return await db
      .select()
      .from(students)
      .orderBy(asc(students.lastName), asc(students.firstName));
  }

  async getStudentById(id: string): Promise<Student | undefined> {
    const [student] = await db
      .select()
      .from(students)
      .where(eq(students.id, id));
    return student;
  }

  async getStudentsByParentId(parentId: string): Promise<Student[]> {
    return await db
      .select()
      .from(students)
      .where(eq(students.parentId, parentId))
      .orderBy(asc(students.firstName));
  }

  async getStudentsByRouteId(routeId: string): Promise<Student[]> {
    return await db
      .select()
      .from(students)
      .where(eq(students.routeId, routeId))
      .orderBy(asc(students.grade), asc(students.lastName));
  }

  async getStudentsByStopId(stopId: string): Promise<Student[]> {
    return await db
      .select()
      .from(students)
      .where(eq(students.stopId, stopId))
      .orderBy(asc(students.lastName));
  }

  async createStudent(student: InsertStudent): Promise<Student> {
    const [newStudent] = await db.insert(students).values(student).returning();
    return newStudent;
  }

  async updateStudent(id: string, updates: Partial<InsertStudent>): Promise<Student | undefined> {
    const [updatedStudent] = await db
      .update(students)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(students.id, id))
      .returning();
    return updatedStudent;
  }

  async deleteStudent(id: string): Promise<boolean> {
    const result = await db.delete(students).where(eq(students.id, id));
    return result.rowCount !== null && result.rowCount > 0;
  }

  // Attendance operations
  async getAttendanceByDate(date: Date): Promise<Attendance[]> {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    return await db
      .select()
      .from(attendance)
      .where(and(
        eq(attendance.date, startOfDay)
      ));
  }

  async getAttendanceByStudentAndDate(studentId: string, date: Date): Promise<Attendance | undefined> {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);

    const [record] = await db
      .select()
      .from(attendance)
      .where(and(
        eq(attendance.studentId, studentId),
        eq(attendance.date, startOfDay)
      ));
    return record;
  }

  async createAttendance(attendanceRecord: InsertAttendance): Promise<Attendance> {
    const [newAttendance] = await db.insert(attendance).values(attendanceRecord).returning();
    return newAttendance;
  }

  async updateAttendance(id: string, updates: Partial<InsertAttendance>): Promise<Attendance | undefined> {
    const [updatedAttendance] = await db
      .update(attendance)
      .set(updates)
      .where(eq(attendance.id, id))
      .returning();
    return updatedAttendance;
  }

  // Bus operations
  async getAllBuses(): Promise<Bus[]> {
    return await db.select().from(buses).orderBy(asc(buses.busNumber));
  }

  async getBusByDriverId(driverId: string): Promise<Bus | undefined> {
    const [bus] = await db.select().from(buses).where(eq(buses.driverId, driverId));
    return bus;
  }

  async getBusByNumber(busNumber: string): Promise<Bus | undefined> {
    const [bus] = await db.select().from(buses).where(eq(buses.busNumber, busNumber));
    return bus;
  }

  async getBusById(id: string): Promise<Bus | undefined> {
    const [bus] = await db.select().from(buses).where(eq(buses.id, id));
    return bus;
  }

  async getBusByRouteId(routeId: string): Promise<Bus | undefined> {
    const [bus] = await db.select().from(buses).where(eq(buses.currentRouteId, routeId));
    return bus;
  }

  async createBus(bus: InsertBus): Promise<Bus> {
    try {
      console.log('=== STORAGE CREATE BUS ===');
      console.log('Input data:', JSON.stringify(bus, null, 2));
      
      // First validate the bus data
      if (!bus.busNumber) {
        throw new Error('Bus number is required');
      }
      
      // Check for duplicate bus number before insertion
      const existing = await this.getBusByNumber(bus.busNumber);
      if (existing) {
        console.error('Duplicate bus number found:', existing);
        throw new Error(`Bus number ${bus.busNumber} already exists`);
      }
      
      // Perform the database insertion with transaction
      console.log('Attempting database insertion...');
      console.log('Database connection status: Connected');
      console.log('Values to insert:', JSON.stringify(bus, null, 2));
      
      try {
        const insertResult = await db.insert(buses).values(bus).returning();
        console.log('Raw insert result:', insertResult);
        console.log('Insert result length:', insertResult.length);
        
        const [newBus] = insertResult;
        console.log('Database insert result:', JSON.stringify(newBus, null, 2));
        
        if (!newBus) {
          console.error('CRITICAL: Insert returned empty result array');
          throw new Error('Database insert failed - no result returned');
        }
        
        // Immediate verification by ID
        const immediateVerify = await db.select().from(buses).where(eq(buses.id, newBus.id));
        console.log('Immediate verification by ID:', immediateVerify.length > 0 ? 'SUCCESS' : 'FAILED');
        
        return newBus;
      } catch (dbError: any) {
        console.error('DATABASE INSERTION ERROR:', dbError);
        console.error('Error code:', dbError.code);
        console.error('Error detail:', dbError.detail);
        console.error('Error constraint:', dbError.constraint);
        throw dbError;
      }
      
      // This code is now handled in the try block above
    } catch (error: any) {
      console.error('=== STORAGE CREATE BUS ERROR ===');
      console.error('Error:', error);
      console.error('Error details:', {
        message: error.message,
        code: error.code,
        detail: error.detail,
        stack: error.stack
      });
      throw new Error(`Failed to create bus: ${error.message}`);
    }
  }

  async updateBus(id: string, updates: Partial<InsertBus>): Promise<Bus | undefined> {
    const [updatedBus] = await db
      .update(buses)
      .set({ ...updates, lastUpdated: new Date() })
      .where(eq(buses.id, id))
      .returning();
    return updatedBus;
  }

  async deleteBus(id: string): Promise<boolean> {
    // First get the bus to check its bus number
    const bus = await this.getBusById(id);
    if (!bus) {
      throw new Error("Bus not found");
    }

    // Check if bus is associated with any active routes
    const activeRoutes = await db
      .select()
      .from(routes)
      .where(and(
        eq(routes.busNumber, bus.busNumber),
        eq(routes.isActive, true)
      ));

    if (activeRoutes.length > 0) {
      throw new Error("Bus is associated with active route and cannot be deleted");
    }

    const result = await db.delete(buses).where(eq(buses.id, id));
    return result.rowCount !== null && result.rowCount > 0;
  }

  async updateBusLocation(id: string, latitude: string, longitude: string, speed?: string): Promise<Bus | undefined> {
    const updates: any = {
      currentLatitude: latitude,
      currentLongitude: longitude,
      lastUpdated: new Date(),
    };
    if (speed) updates.speed = speed;

    const [updatedBus] = await db
      .update(buses)
      .set(updates)
      .where(eq(buses.id, id))
      .returning();
    return updatedBus;
  }

  async updateBusStatus(id: string, status: string): Promise<Bus | undefined> {
    const [updatedBus] = await db
      .update(buses)
      .set({ status: status as any, lastUpdated: new Date() })
      .where(eq(buses.id, id))
      .returning();
    return updatedBus;
  }

  async updateBusFuelLevel(busId: string, fuelLevel: string): Promise<Bus | undefined> {
    const [updatedBus] = await db
      .update(buses)
      .set({ fuelLevel: fuelLevel as any, lastUpdated: new Date() })
      .where(eq(buses.id, busId))
      .returning();
    return updatedBus;
  }

  async assignDriverToBus(driverId: string, busId: string): Promise<boolean> {
    try {
      // First, unassign this driver from ALL other buses (enforce one bus per driver)
      await db
        .update(buses)
        .set({ driverId: null, status: 'idle', lastUpdated: new Date() })
        .where(eq(buses.driverId, driverId));
      
      // Now assign the driver to the new bus
      const [updatedBus] = await db
        .update(buses)
        .set({ driverId: driverId, lastUpdated: new Date() })
        .where(eq(buses.id, busId))
        .returning();
      return !!updatedBus;
    } catch (error) {
      console.error("Error assigning driver to bus:", error);
      return false;
    }
  }

  async assignDriverToRoute(driverId: string, routeId: string): Promise<boolean> {
    try {
      const [updatedRoute] = await db
        .update(routes)
        .set({ driverId: driverId, updatedAt: new Date() })
        .where(eq(routes.id, routeId))
        .returning();
      return !!updatedRoute;
    } catch (error) {
      console.error("Error assigning driver to route:", error);
      return false;
    }
  }

  async unassignDriverFromBus(driverId: string): Promise<boolean> {
    try {
      // Unassign driver from ALL buses they might be assigned to
      const result = await db
        .update(buses)
        .set({ driverId: null, status: 'idle', lastUpdated: new Date() })
        .where(eq(buses.driverId, driverId));
      return result.rowCount !== null && result.rowCount >= 0;
    } catch (error) {
      console.error("Error unassigning driver from bus:", error);
      return false;
    }
  }

  async unassignDriverFromRoute(driverId: string): Promise<boolean> {
    try {
      const [updatedRoute] = await db
        .update(routes)
        .set({ driverId: null, updatedAt: new Date() })
        .where(eq(routes.driverId, driverId))
        .returning();
      return !!updatedRoute;
    } catch (error) {
      console.error("Error unassigning driver from route:", error);
      return false;
    }
  }

  // Vehicle issue operations
  async getIssuesByBusId(busId: string): Promise<VehicleIssue[]> {
    return await db
      .select()
      .from(vehicleIssues)
      .where(eq(vehicleIssues.busId, busId))
      .orderBy(desc(vehicleIssues.createdAt));
  }

  async createVehicleIssue(issue: InsertVehicleIssue): Promise<VehicleIssue> {
    const [newIssue] = await db.insert(vehicleIssues).values(issue).returning();
    return newIssue;
  }

  async resolveVehicleIssue(id: string): Promise<VehicleIssue | undefined> {
    const [resolvedIssue] = await db
      .update(vehicleIssues)
      .set({ isResolved: true, resolvedAt: new Date() })
      .where(eq(vehicleIssues.id, id))
      .returning();
    return resolvedIssue;
  }

  // Driver task operations
  async getTasksByDriverId(driverId: string): Promise<DriverTask[]> {
    return await db
      .select()
      .from(driverTasks)
      .where(eq(driverTasks.assignedToId, driverId))
      .orderBy(desc(driverTasks.createdAt));
  }

  async getAllActiveTasks(): Promise<DriverTask[]> {
    return await db
      .select()
      .from(driverTasks)
      .where(eq(driverTasks.isCompleted, false))
      .orderBy(desc(driverTasks.createdAt));
  }

  async createDriverTask(task: InsertDriverTask): Promise<DriverTask> {
    const [newTask] = await db.insert(driverTasks).values(task).returning();
    return newTask;
  }

  async updateTaskCompletion(id: string, isCompleted: boolean): Promise<DriverTask | undefined> {
    const updates: any = { isCompleted };
    if (isCompleted) updates.completedAt = new Date();

    const [updatedTask] = await db
      .update(driverTasks)
      .set(updates)
      .where(eq(driverTasks.id, id))
      .returning();
    return updatedTask;
  }

  // Emergency contact operations
  async getEmergencyContactsByStudentId(studentId: string): Promise<EmergencyContact[]> {
    return await db
      .select()
      .from(emergencyContacts)
      .where(eq(emergencyContacts.studentId, studentId))
      .orderBy(desc(emergencyContacts.isPrimary), asc(emergencyContacts.name));
  }

  async createEmergencyContact(contact: InsertEmergencyContact): Promise<EmergencyContact> {
    const [newContact] = await db.insert(emergencyContacts).values(contact).returning();
    return newContact;
  }

  async reorderRouteSchool(routeId: string, schoolId: string, direction: 'up' | 'down'): Promise<School[]> {
    // Get all schools for this route with their current order
    const routeSchoolsData = await db
      .select()
      .from(routeSchools)
      .where(eq(routeSchools.routeId, routeId))
      .orderBy(asc(routeSchools.order));

    // Check if we need to initialize order values
    const hasInvalidOrders = routeSchoolsData.some((rs, index) => rs.order !== index);
    if (hasInvalidOrders) {
      // Initialize proper order values
      for (let i = 0; i < routeSchoolsData.length; i++) {
        await db
          .update(routeSchools)
          .set({ order: i })
          .where(eq(routeSchools.id, routeSchoolsData[i].id));
      }
      
      // Re-fetch with proper order
      const updatedRouteSchoolsData = await db
        .select()
        .from(routeSchools)
        .where(eq(routeSchools.routeId, routeId))
        .orderBy(asc(routeSchools.order));
      
      routeSchoolsData.length = 0;
      routeSchoolsData.push(...updatedRouteSchoolsData);
    }

    // Find the school to move
    const schoolIndex = routeSchoolsData.findIndex(rs => rs.schoolId === schoolId);
    if (schoolIndex === -1) {
      throw new Error("School not found in route");
    }

    const currentSchool = routeSchoolsData[schoolIndex];
    let targetIndex: number;

    if (direction === 'up') {
      if (schoolIndex === 0) {
        throw new Error("School is already at the top");
      }
      targetIndex = schoolIndex - 1;
    } else {
      if (schoolIndex === routeSchoolsData.length - 1) {
        throw new Error("School is already at the bottom");
      }
      targetIndex = schoolIndex + 1;
    }

    const targetSchool = routeSchoolsData[targetIndex];

    // Swap the order values
    await db
      .update(routeSchools)
      .set({ order: targetSchool.order })
      .where(eq(routeSchools.id, currentSchool.id));

    await db
      .update(routeSchools)
      .set({ order: currentSchool.order })
      .where(eq(routeSchools.id, targetSchool.id));

    // Return the updated schools list
    return await this.getSchoolsByRouteId(routeId);
  }

  // School visit operations for driver arrivals/departures
  async getSchoolVisitsByDriverRoute(driverId: string, routeId: string): Promise<SchoolVisit[]> {
    const visits = await db
      .select()
      .from(schoolVisits)
      .where(and(eq(schoolVisits.driverId, driverId), eq(schoolVisits.routeId, routeId)))
      .orderBy(desc(schoolVisits.visitDate));
    return visits;
  }

  async recordSchoolArrival(driverId: string, schoolId: string, routeId: string): Promise<SchoolVisit> {
    const now = new Date();
    
    // Check if there's already an active visit for this school today
    const existingVisit = await db
      .select()
      .from(schoolVisits)
      .where(and(
        eq(schoolVisits.driverId, driverId),
        eq(schoolVisits.schoolId, schoolId),
        eq(schoolVisits.routeId, routeId),
        sql`DATE(${schoolVisits.visitDate}) = DATE(${now})`
      ))
      .limit(1);

    if (existingVisit.length > 0) {
      // Update existing visit with arrival time
      const [updatedVisit] = await db
        .update(schoolVisits)
        .set({ arrivedAt: now, updatedAt: now })
        .where(eq(schoolVisits.id, existingVisit[0].id))
        .returning();
      return updatedVisit;
    } else {
      // Create new visit record
      const [newVisit] = await db
        .insert(schoolVisits)
        .values({
          driverId,
          schoolId,
          routeId,
          arrivedAt: now,
          visitDate: now,
        })
        .returning();
      return newVisit;
    }
  }

  async recordSchoolDeparture(visitId: string): Promise<SchoolVisit | undefined> {
    const [updatedVisit] = await db
      .update(schoolVisits)
      .set({ departedAt: new Date(), updatedAt: new Date() })
      .where(eq(schoolVisits.id, visitId))
      .returning();
    return updatedVisit;
  }

  async getTodaysSchoolVisits(driverId: string): Promise<SchoolVisit[]> {
    const today = new Date();
    const visits = await db
      .select()
      .from(schoolVisits)
      .where(and(
        eq(schoolVisits.driverId, driverId),
        sql`DATE(${schoolVisits.visitDate}) = DATE(${today})`
      ))
      .orderBy(asc(schoolVisits.visitDate));
    return visits;
  }

  // Student attendance operations
  async getTodaysStudentAttendance(driverId: string, routeId: string): Promise<StudentAttendance[]> {
    const today = new Date();
    const attendance = await db
      .select()
      .from(studentAttendance)
      .where(and(
        eq(studentAttendance.driverId, driverId),
        eq(studentAttendance.routeId, routeId),
        sql`DATE(${studentAttendance.attendanceDate}) = DATE(${today})`
      ))
      .orderBy(asc(studentAttendance.createdAt));
    return attendance;
  }

  async markStudentAttendance(driverId: string, studentId: string, routeId: string, status: "present" | "absent"): Promise<StudentAttendance> {
    const today = new Date();
    
    // Check if attendance already exists for today
    const existingAttendance = await db
      .select()
      .from(studentAttendance)
      .where(and(
        eq(studentAttendance.studentId, studentId),
        eq(studentAttendance.driverId, driverId),
        eq(studentAttendance.routeId, routeId),
        sql`DATE(${studentAttendance.attendanceDate}) = DATE(${today})`
      ))
      .limit(1);

    if (existingAttendance.length > 0) {
      // Update existing attendance
      const [updatedAttendance] = await db
        .update(studentAttendance)
        .set({ 
          status, 
          updatedAt: today 
        })
        .where(eq(studentAttendance.id, existingAttendance[0].id))
        .returning();
      return updatedAttendance;
    } else {
      // Create new attendance record
      const [newAttendance] = await db
        .insert(studentAttendance)
        .values({
          studentId,
          driverId,
          routeId,
          status,
          attendanceDate: today,
        })
        .returning();
      return newAttendance;
    }
  }

  async getAttendanceByRoute(routeId: string, date?: Date): Promise<StudentAttendance[]> {
    const targetDate = date || new Date();
    const attendance = await db
      .select()
      .from(studentAttendance)
      .where(and(
        eq(studentAttendance.routeId, routeId),
        sql`DATE(${studentAttendance.attendanceDate}) = DATE(${targetDate})`
      ))
      .orderBy(asc(studentAttendance.createdAt));
    return attendance;
  }

  async getAllAttendanceData(): Promise<StudentAttendance[]> {
    const today = new Date();
    const attendance = await db
      .select()
      .from(studentAttendance)
      .where(sql`DATE(${studentAttendance.attendanceDate}) = DATE(${today})`)
      .orderBy(desc(studentAttendance.createdAt));
    return attendance;
  }

  async getTodaysAttendanceForStudents(studentIds: string[]): Promise<StudentAttendance[]> {
    if (studentIds.length === 0) {
      return [];
    }
    
    const today = new Date();
    const attendance = await db
      .select()
      .from(studentAttendance)
      .where(
        and(
          inArray(studentAttendance.studentId, studentIds),
          sql`DATE(${studentAttendance.attendanceDate}) = DATE(${today})`
        )
      )
      .orderBy(desc(studentAttendance.createdAt));
    return attendance;
  }

  // Driver shift report operations
  async createDriverShiftReport(report: InsertDriverShiftReport): Promise<DriverShiftReport> {
    const [newReport] = await db.insert(driverShiftReports).values(report).returning();
    return newReport;
  }

  async getDriverShiftReports(driverId?: string): Promise<DriverShiftReport[]> {
    let query = db.select().from(driverShiftReports);
    
    if (driverId) {
      query = query.where(eq(driverShiftReports.driverId, driverId));
    }
    
    return await query.orderBy(desc(driverShiftReports.shiftEndTime));
  }

  async getDriverShiftReportsByDateRange(startDate: Date, endDate: Date, driverId?: string): Promise<DriverShiftReport[]> {
    let query = db
      .select()
      .from(driverShiftReports)
      .where(and(
        sql`${driverShiftReports.shiftEndTime} >= ${startDate}`,
        sql`${driverShiftReports.shiftEndTime} <= ${endDate}`
      ));
    
    if (driverId) {
      query = query.where(and(
        eq(driverShiftReports.driverId, driverId),
        sql`${driverShiftReports.shiftEndTime} >= ${startDate}`,
        sql`${driverShiftReports.shiftEndTime} <= ${endDate}`
      ));
    }
    
    return await query.orderBy(desc(driverShiftReports.shiftEndTime));
  }

  // Admin request operations
  async getAllAdminRequests(): Promise<AdminRequest[]> {
    return await db.select().from(adminRequests).orderBy(desc(adminRequests.createdAt));
  }

  async getAdminRequestById(id: string): Promise<AdminRequest | undefined> {
    const [request] = await db.select().from(adminRequests).where(eq(adminRequests.id, id));
    return request;
  }

  async createAdminRequest(request: InsertAdminRequest): Promise<AdminRequest> {
    const [newRequest] = await db.insert(adminRequests).values(request).returning();
    return newRequest;
  }

  async acknowledgeAdminRequest(id: string): Promise<AdminRequest | undefined> {
    const [updatedRequest] = await db
      .update(adminRequests)
      .set({ 
        status: 'acknowledged',
        acknowledgedAt: new Date()
      })
      .where(eq(adminRequests.id, id))
      .returning();
    return updatedRequest;
  }

  async completeAdminRequest(id: string): Promise<AdminRequest | undefined> {
    const [updatedRequest] = await db
      .update(adminRequests)
      .set({ 
        status: 'completed',
        completedAt: new Date()
      })
      .where(eq(adminRequests.id, id))
      .returning();
    return updatedRequest;
  }

  // Parent notification operations
  async createParentNotification(notification: InsertParentNotification): Promise<ParentNotification> {
    const [newNotification] = await db.insert(parentNotifications).values(notification).returning();
    return newNotification;
  }

  async getAllNotifications(): Promise<ParentNotification[]> {
    return await db.select().from(parentNotifications).orderBy(desc(parentNotifications.createdAt));
  }

  async getNotificationsByRouteId(routeId: string): Promise<ParentNotification[]> {
    return await db
      .select()
      .from(parentNotifications)
      .where(eq(parentNotifications.routeId, routeId))
      .orderBy(desc(parentNotifications.createdAt));
  }

  async getNotificationsForParent(parentId: string): Promise<ParentNotification[]> {
    // Get the parent's companyId for multi-tenancy filtering
    const parent = await this.getUser(parentId);
    const parentCompanyId = parent?.companyId;
    
    // Get parent's children's routes (direct children via parentId)
    const directStudents = await db
      .select({ routeId: students.routeId })
      .from(students)
      .where(eq(students.parentId, parentId));
    
    // Get linked children's routes (via parentChildLinks table - link code system)
    const linkedStudents = await this.getLinkedStudentsByParentId(parentId);
    
    // Combine and deduplicate route IDs from both sources
    const routeIdsSet = new Set<string>();
    for (const s of directStudents) {
      if (s.routeId) routeIdsSet.add(s.routeId);
    }
    for (const s of linkedStudents) {
      if (s.routeId) routeIdsSet.add(s.routeId);
    }
    const routeIds = Array.from(routeIdsSet);
    
    if (routeIds.length === 0) {
      // Only return global notifications for this company
      return await db
        .select()
        .from(parentNotifications)
        .where(
          and(
            eq(parentNotifications.isGlobal, true),
            parentCompanyId ? eq(parentNotifications.companyId, parentCompanyId) : sql`1=1`
          )
        )
        .orderBy(desc(parentNotifications.createdAt));
    }
    
    // Return global notifications OR notifications for the parent's children's routes (filtered by company)
    return await db
      .select()
      .from(parentNotifications)
      .where(
        and(
          sql`(${parentNotifications.isGlobal} = true OR ${parentNotifications.routeId} IN (${sql.join(routeIds.map(id => sql`${id}`), sql`, `)}))`,
          parentCompanyId ? eq(parentNotifications.companyId, parentCompanyId) : sql`1=1`
        )
      )
      .orderBy(desc(parentNotifications.createdAt));
  }

  async markNotificationRead(notificationId: string, parentId: string): Promise<NotificationRead> {
    const [read] = await db
      .insert(notificationReads)
      .values({ notificationId, parentId })
      .onConflictDoUpdate({
        target: [notificationReads.notificationId, notificationReads.parentId],
        set: { readAt: new Date() }
      })
      .returning();
    return read;
  }

  async markAllNotificationsRead(parentId: string): Promise<void> {
    const notifications = await this.getNotificationsForParent(parentId);
    for (const notification of notifications) {
      await db
        .insert(notificationReads)
        .values({ notificationId: notification.id, parentId })
        .onConflictDoUpdate({
          target: [notificationReads.notificationId, notificationReads.parentId],
          set: { readAt: new Date() }
        });
    }
  }

  async getUnreadCountForParent(parentId: string): Promise<number> {
    const notifications = await this.getNotificationsForParent(parentId);
    const notificationIds = notifications.map(n => n.id);
    
    if (notificationIds.length === 0) return 0;
    
    const readNotifications = await db
      .select({ notificationId: notificationReads.notificationId })
      .from(notificationReads)
      .where(
        and(
          eq(notificationReads.parentId, parentId),
          sql`${notificationReads.notificationId} IN (${sql.join(notificationIds.map(id => sql`${id}`), sql`, `)})`
        )
      );
    
    const readIds = new Set(readNotifications.map(r => r.notificationId));
    return notificationIds.filter(id => !readIds.has(id)).length;
  }

  async deleteNotification(id: string): Promise<boolean> {
    const result = await db.delete(parentNotifications).where(eq(parentNotifications.id, id));
    return result.rowCount !== null && result.rowCount > 0;
  }

  // Multi-tenant authentication operations
  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  }

  async getPasswordCredentials(userId: string): Promise<PasswordCredential | undefined> {
    const [credentials] = await db.select().from(passwordCredentials).where(eq(passwordCredentials.userId, userId));
    return credentials;
  }

  async createPasswordCredentials(userId: string, passwordHash: string): Promise<PasswordCredential> {
    const [credentials] = await db.insert(passwordCredentials).values({
      userId,
      passwordHash,
    }).returning();
    return credentials;
  }

  async createUserWithPassword(userData: Partial<UpsertUser>, passwordHash: string): Promise<User> {
    const userId = crypto.randomUUID();
    
    const [newUser] = await db
      .insert(users)
      .values({
        id: userId,
        email: userData.email || null,
        firstName: userData.firstName || null,
        lastName: userData.lastName || null,
        role: userData.role || 'parent',
        companyId: userData.companyId || null,
        companyRoleId: userData.companyRoleId || null,
      })
      .returning();

    await db.insert(passwordCredentials).values({
      userId: userId,
      passwordHash: passwordHash,
    });

    return newUser;
  }

  // Company operations
  async getCompanyBySlug(slug: string): Promise<Company | undefined> {
    const [company] = await db.select().from(companies).where(eq(companies.slug, slug));
    return company;
  }

  async getCompanyById(id: string): Promise<Company | undefined> {
    const [company] = await db.select().from(companies).where(eq(companies.id, id));
    return company;
  }

  async getCompanyByStripeCustomerId(customerId: string): Promise<Company | undefined> {
    const [company] = await db.select().from(companies).where(eq(companies.stripeCustomerId, customerId));
    return company;
  }

  async getCompanyByStripeSubscriptionId(subscriptionId: string): Promise<Company | undefined> {
    const [company] = await db.select().from(companies).where(eq(companies.stripeSubscriptionId, subscriptionId));
    return company;
  }

  async createCompany(company: InsertCompany): Promise<Company> {
    const [newCompany] = await db.insert(companies).values(company).returning();
    return newCompany;
  }

  async updateCompany(id: string, updates: Partial<InsertCompany>): Promise<Company | undefined> {
    const [updated] = await db
      .update(companies)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(companies.id, id))
      .returning();
    return updated;
  }

  async getAllCompanies(): Promise<Company[]> {
    return await db.select().from(companies).orderBy(desc(companies.createdAt));
  }

  async getCompaniesByStatus(status: string): Promise<Company[]> {
    return await db.select().from(companies).where(eq(companies.status, status as any)).orderBy(desc(companies.createdAt));
  }

  async approveCompany(id: string, approvedBy: string): Promise<Company | undefined> {
    const [updated] = await db
      .update(companies)
      .set({ 
        status: 'approved',
        isActive: true,
        approvedAt: new Date(),
        approvedBy,
        updatedAt: new Date()
      })
      .where(eq(companies.id, id))
      .returning();
    return updated;
  }

  async suspendCompany(id: string, suspendedBy: string, reason?: string): Promise<Company | undefined> {
    const [updated] = await db
      .update(companies)
      .set({ 
        status: 'suspended',
        isActive: false,
        suspendedAt: new Date(),
        suspendedBy,
        suspensionReason: reason || null,
        updatedAt: new Date()
      })
      .where(eq(companies.id, id))
      .returning();
    return updated;
  }

  async rejectCompany(id: string): Promise<Company | undefined> {
    const [updated] = await db
      .update(companies)
      .set({ 
        status: 'rejected',
        isActive: false,
        updatedAt: new Date()
      })
      .where(eq(companies.id, id))
      .returning();
    return updated;
  }

  // Invitation operations
  async createInvitation(invitation: InsertInvitation): Promise<Invitation> {
    const [newInvitation] = await db.insert(invitations).values(invitation).returning();
    return newInvitation;
  }

  async getInvitationByToken(token: string): Promise<Invitation | undefined> {
    const [invitation] = await db
      .select()
      .from(invitations)
      .where(eq(invitations.token, token));
    return invitation;
  }

  async acceptInvitation(token: string, userId: string): Promise<Invitation | undefined> {
    const [updated] = await db
      .update(invitations)
      .set({ 
        status: 'accepted',
        acceptedAt: new Date(),
        acceptedByUserId: userId 
      })
      .where(eq(invitations.token, token))
      .returning();
    return updated;
  }

  // Password reset operations
  async setPasswordResetToken(userId: string, token: string, expiresAt: Date): Promise<void> {
    await db
      .update(passwordCredentials)
      .set({ passwordResetToken: token, passwordResetExpires: expiresAt })
      .where(eq(passwordCredentials.userId, userId));
  }

  async getCredentialsByResetToken(token: string): Promise<PasswordCredential | undefined> {
    const [credential] = await db
      .select()
      .from(passwordCredentials)
      .where(eq(passwordCredentials.passwordResetToken, token));
    return credential;
  }

  async updatePassword(userId: string, passwordHash: string): Promise<void> {
    await db
      .update(passwordCredentials)
      .set({ 
        passwordHash, 
        lastPasswordChange: new Date(),
        passwordResetToken: null,
        passwordResetExpires: null
      })
      .where(eq(passwordCredentials.userId, userId));
  }

  async clearPasswordResetToken(userId: string): Promise<void> {
    await db
      .update(passwordCredentials)
      .set({ passwordResetToken: null, passwordResetExpires: null })
      .where(eq(passwordCredentials.userId, userId));
  }

  // Link code operations (Parent-Child linking system)
  private generateUniqueCode(prefix: string = 'TNT'): string {
    const randomPart = Math.random().toString(36).substring(2, 8).toUpperCase();
    return `${prefix}-${randomPart}`;
  }

  async generateLinkCode(
    studentId: string, 
    createdById: string, 
    maxUses: number = 2, 
    expiresInDays: number = 7,
    companyId?: string
  ): Promise<LinkCode> {
    const code = this.generateUniqueCode();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + expiresInDays);

    const [linkCode] = await db.insert(linkCodes).values({
      code,
      studentId,
      createdById,
      maxUses,
      expiresAt,
      companyId: companyId || null,
      status: 'active',
    }).returning();

    return linkCode;
  }

  async getLinkCodeByCode(code: string): Promise<LinkCode | undefined> {
    const [linkCode] = await db.select().from(linkCodes).where(eq(linkCodes.code, code));
    return linkCode;
  }

  async getLinkCodesByStudentId(studentId: string): Promise<LinkCode[]> {
    return await db
      .select()
      .from(linkCodes)
      .where(eq(linkCodes.studentId, studentId))
      .orderBy(desc(linkCodes.createdAt));
  }

  async useLinkCode(code: string, parentId: string): Promise<{ success: boolean; error?: string; link?: ParentChildLink }> {
    const linkCode = await this.getLinkCodeByCode(code);

    if (!linkCode) {
      return { success: false, error: 'Invalid code' };
    }

    if (linkCode.status === 'revoked') {
      return { success: false, error: 'This code has been revoked' };
    }

    if (linkCode.status === 'expired' || linkCode.expiresAt < new Date()) {
      if (linkCode.status !== 'expired') {
        await db.update(linkCodes)
          .set({ status: 'expired' })
          .where(eq(linkCodes.id, linkCode.id));
      }
      return { success: false, error: 'This code has expired' };
    }

    if (linkCode.usesCount !== null && linkCode.maxUses !== null && linkCode.usesCount >= linkCode.maxUses) {
      await db.update(linkCodes)
        .set({ status: 'used' })
        .where(eq(linkCodes.id, linkCode.id));
      return { success: false, error: 'This code has reached its maximum uses' };
    }

    const existingLink = await this.getParentChildLink(parentId, linkCode.studentId);
    if (existingLink) {
      return { success: false, error: 'You are already linked to this child' };
    }

    const [link] = await db.insert(parentChildLinks).values({
      parentId,
      studentId: linkCode.studentId,
      linkCodeId: linkCode.id,
    }).returning();

    const newUsesCount = (linkCode.usesCount || 0) + 1;
    const newStatus = linkCode.maxUses !== null && newUsesCount >= linkCode.maxUses ? 'used' : 'active';

    await db.update(linkCodes)
      .set({ usesCount: newUsesCount, status: newStatus as any })
      .where(eq(linkCodes.id, linkCode.id));

    return { success: true, link };
  }

  async revokeLinkCode(codeId: string): Promise<LinkCode | undefined> {
    const [updated] = await db.update(linkCodes)
      .set({ status: 'revoked' })
      .where(eq(linkCodes.id, codeId))
      .returning();
    return updated;
  }

  async regenerateLinkCode(studentId: string, createdById: string): Promise<LinkCode> {
    await db.update(linkCodes)
      .set({ status: 'revoked' })
      .where(and(
        eq(linkCodes.studentId, studentId),
        eq(linkCodes.status, 'active')
      ));

    return await this.generateLinkCode(studentId, createdById);
  }

  // Parent-Child link operations
  async getLinkedStudentsByParentId(parentId: string): Promise<Student[]> {
    const links = await db
      .select({ studentId: parentChildLinks.studentId })
      .from(parentChildLinks)
      .where(eq(parentChildLinks.parentId, parentId));

    if (links.length === 0) {
      return [];
    }

    const studentIds = links.map(l => l.studentId);
    const linkedStudents = await db
      .select()
      .from(students)
      .where(sql`${students.id} IN (${sql.join(studentIds.map(id => sql`${id}`), sql`, `)})`);

    return linkedStudents;
  }

  async getLinkedParentsByStudentId(studentId: string): Promise<User[]> {
    const links = await db
      .select({ parentId: parentChildLinks.parentId })
      .from(parentChildLinks)
      .where(eq(parentChildLinks.studentId, studentId));

    if (links.length === 0) {
      return [];
    }

    const parentIds = links.map(l => l.parentId);
    const linkedParents = await db
      .select()
      .from(users)
      .where(sql`${users.id} IN (${sql.join(parentIds.map(id => sql`${id}`), sql`, `)})`);

    return linkedParents;
  }

  async unlinkParentFromStudent(parentId: string, studentId: string): Promise<boolean> {
    const result = await db.delete(parentChildLinks)
      .where(and(
        eq(parentChildLinks.parentId, parentId),
        eq(parentChildLinks.studentId, studentId)
      ));
    return result.rowCount !== null && result.rowCount > 0;
  }

  async getParentChildLink(parentId: string, studentId: string): Promise<ParentChildLink | undefined> {
    const [link] = await db
      .select()
      .from(parentChildLinks)
      .where(and(
        eq(parentChildLinks.parentId, parentId),
        eq(parentChildLinks.studentId, studentId)
      ));
    return link;
  }

  // Direct messaging operations
  async sendDirectMessage(message: InsertDirectMessage): Promise<DirectMessage> {
    const [newMessage] = await db.insert(directMessages).values(message).returning();
    return newMessage;
  }

  async getConversation(userId1: string, userId2: string, studentId?: string, companyId?: string): Promise<DirectMessage[]> {
    const conditions = [
      or(
        and(eq(directMessages.senderId, userId1), eq(directMessages.recipientId, userId2)),
        and(eq(directMessages.senderId, userId2), eq(directMessages.recipientId, userId1))
      )
    ];

    if (studentId) {
      conditions.push(eq(directMessages.studentId, studentId));
    }

    if (companyId) {
      conditions.push(eq(directMessages.companyId, companyId));
    }

    return await db
      .select()
      .from(directMessages)
      .where(and(...conditions))
      .orderBy(asc(directMessages.createdAt));
  }

  async getConversationsForUser(userId: string, companyId?: string): Promise<{ recipientId: string; recipientName: string; lastMessage: string; unreadCount: number; lastMessageAt: Date }[]> {
    const conditions = [
      or(
        eq(directMessages.senderId, userId),
        eq(directMessages.recipientId, userId)
      )
    ];

    if (companyId) {
      conditions.push(eq(directMessages.companyId, companyId));
    }

    const allMessages = await db
      .select()
      .from(directMessages)
      .where(and(...conditions))
      .orderBy(desc(directMessages.createdAt));

    const conversationsMap = new Map<string, { messages: DirectMessage[]; otherUserId: string }>();

    for (const msg of allMessages) {
      const otherUserId = msg.senderId === userId ? msg.recipientId : msg.senderId;
      if (!conversationsMap.has(otherUserId)) {
        conversationsMap.set(otherUserId, { messages: [], otherUserId });
      }
      conversationsMap.get(otherUserId)!.messages.push(msg);
    }

    const conversations: { recipientId: string; recipientName: string; lastMessage: string; unreadCount: number; lastMessageAt: Date }[] = [];

    for (const [otherUserId, data] of conversationsMap) {
      const lastMsg = data.messages[0];
      const unreadCount = data.messages.filter(m => m.recipientId === userId && !m.isRead).length;
      
      const otherUser = await this.getUser(otherUserId);
      const recipientName = otherUser ? `${otherUser.firstName || ''} ${otherUser.lastName || ''}`.trim() || otherUser.email || 'Unknown' : 'Unknown';

      conversations.push({
        recipientId: otherUserId,
        recipientName,
        lastMessage: lastMsg.content.substring(0, 100),
        unreadCount,
        lastMessageAt: lastMsg.createdAt || new Date(),
      });
    }

    return conversations.sort((a, b) => b.lastMessageAt.getTime() - a.lastMessageAt.getTime());
  }

  async markMessageAsRead(messageId: string): Promise<DirectMessage | undefined> {
    const [updated] = await db
      .update(directMessages)
      .set({ isRead: true, readAt: new Date() })
      .where(eq(directMessages.id, messageId))
      .returning();
    return updated;
  }

  async markConversationAsRead(userId: string, otherUserId: string, companyId?: string): Promise<void> {
    const conditions = [
      eq(directMessages.senderId, otherUserId),
      eq(directMessages.recipientId, userId),
      eq(directMessages.isRead, false)
    ];
    
    if (companyId) {
      conditions.push(eq(directMessages.companyId, companyId));
    }
    
    await db
      .update(directMessages)
      .set({ isRead: true, readAt: new Date() })
      .where(and(...conditions));
  }

  async getUnreadMessageCount(userId: string, companyId?: string): Promise<number> {
    const conditions = [
      eq(directMessages.recipientId, userId),
      eq(directMessages.isRead, false)
    ];
    
    if (companyId) {
      conditions.push(eq(directMessages.companyId, companyId));
    }
    
    const result = await db
      .select({ count: sql<number>`count(*)` })
      .from(directMessages)
      .where(and(...conditions));
    return Number(result[0]?.count) || 0;
  }

  async getDriversForParent(parentId: string, companyId?: string): Promise<User[]> {
    const linkedStudents = await this.getLinkedStudentsByParentId(parentId);
    if (linkedStudents.length === 0) return [];

    // Filter students by company if specified
    const filteredStudents = companyId 
      ? linkedStudents.filter(s => s.companyId === companyId)
      : linkedStudents;
    if (filteredStudents.length === 0) return [];

    const routeIds = [...new Set(filteredStudents.map(s => s.routeId).filter(Boolean))];
    if (routeIds.length === 0) return [];

    const routesData = await db
      .select()
      .from(routes)
      .where(sql`${routes.id} IN (${sql.join(routeIds.map(id => sql`${id}`), sql`, `)})`);

    // Filter routes by company if specified
    const filteredRoutes = companyId 
      ? routesData.filter(r => r.companyId === companyId)
      : routesData;

    const driverIds = [...new Set(filteredRoutes.map(r => r.driverId).filter(Boolean))];
    if (driverIds.length === 0) return [];

    const drivers = await db
      .select()
      .from(users)
      .where(sql`${users.id} IN (${sql.join(driverIds.map(id => sql`${id}`), sql`, `)})`);

    // Filter drivers by company if specified
    return companyId ? drivers.filter(d => d.companyId === companyId) : drivers;
  }

  async getParentsForDriver(driverId: string, companyId?: string): Promise<User[]> {
    const driverRoutes = await this.getRoutesByDriverId(driverId);
    if (driverRoutes.length === 0) return [];

    // Filter routes by company if specified
    const filteredRoutes = companyId 
      ? driverRoutes.filter(r => r.companyId === companyId)
      : driverRoutes;
    if (filteredRoutes.length === 0) return [];

    const routeIds = filteredRoutes.map(r => r.id);

    const studentsOnRoutes = await db
      .select()
      .from(students)
      .where(sql`${students.routeId} IN (${sql.join(routeIds.map(id => sql`${id}`), sql`, `)})`);

    // Filter students by company if specified
    const filteredStudents = companyId 
      ? studentsOnRoutes.filter(s => s.companyId === companyId)
      : studentsOnRoutes;
    if (filteredStudents.length === 0) return [];

    const studentIds = filteredStudents.map(s => s.id);

    const parentLinks = await db
      .select()
      .from(parentChildLinks)
      .where(sql`${parentChildLinks.studentId} IN (${sql.join(studentIds.map(id => sql`${id}`), sql`, `)})`);

    if (parentLinks.length === 0) return [];

    const parentIds = [...new Set(parentLinks.map(l => l.parentId))];

    const parents = await db
      .select()
      .from(users)
      .where(sql`${users.id} IN (${sql.join(parentIds.map(id => sql`${id}`), sql`, `)})`);

    // Filter parents by company if specified
    return companyId ? parents.filter(p => p.companyId === companyId) : parents;
  }

  // Student check-in operations (Bluetooth boarding)
  async enableStudentCheckIn(studentId: string, parentId: string, deviceId: string, companyId?: string): Promise<StudentCheckIn> {
    // Get student's route
    const student = await this.getStudentById(studentId);
    
    // Check if there's already an active check-in for today
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const existing = await db
      .select()
      .from(studentCheckIns)
      .where(
        and(
          eq(studentCheckIns.studentId, studentId),
          sql`${studentCheckIns.checkInDate} >= ${today}`
        )
      );
    
    if (existing.length > 0 && existing[0].status !== 'dropped_off') {
      // Update existing check-in
      const [updated] = await db
        .update(studentCheckIns)
        .set({ deviceId, status: 'waiting' })
        .where(eq(studentCheckIns.id, existing[0].id))
        .returning();
      return updated;
    }
    
    // Create new check-in
    const [checkIn] = await db
      .insert(studentCheckIns)
      .values({
        studentId,
        parentId,
        deviceId,
        routeId: student?.routeId || null,
        companyId: companyId || student?.companyId || null,
        status: 'waiting',
        checkInDate: new Date(),
      })
      .returning();
    return checkIn;
  }

  async disableStudentCheckIn(studentId: string): Promise<boolean> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const result = await db
      .delete(studentCheckIns)
      .where(
        and(
          eq(studentCheckIns.studentId, studentId),
          sql`${studentCheckIns.checkInDate} >= ${today}`
        )
      );
    
    return true;
  }

  async getActiveCheckInsForRoute(routeId: string): Promise<StudentCheckIn[]> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    return db
      .select()
      .from(studentCheckIns)
      .where(
        and(
          eq(studentCheckIns.routeId, routeId),
          eq(studentCheckIns.status, 'waiting'),
          sql`${studentCheckIns.checkInDate} >= ${today}`
        )
      );
  }

  async getCheckInStatus(studentId: string): Promise<StudentCheckIn | undefined> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const [checkIn] = await db
      .select()
      .from(studentCheckIns)
      .where(
        and(
          eq(studentCheckIns.studentId, studentId),
          sql`${studentCheckIns.checkInDate} >= ${today}`
        )
      )
      .orderBy(desc(studentCheckIns.createdAt))
      .limit(1);
    
    return checkIn;
  }

  async getCheckInById(checkInId: string): Promise<StudentCheckIn | undefined> {
    const [checkIn] = await db
      .select()
      .from(studentCheckIns)
      .where(eq(studentCheckIns.id, checkInId));
    return checkIn;
  }

  async confirmStudentBoarded(checkInId: string, driverId: string, busId: string, routeId: string): Promise<StudentCheckIn | undefined> {
    const [updated] = await db
      .update(studentCheckIns)
      .set({
        status: 'boarded',
        driverId,
        busId,
        routeId,
        boardedAt: new Date(),
      })
      .where(eq(studentCheckIns.id, checkInId))
      .returning();
    return updated;
  }

  async confirmStudentDroppedOff(checkInId: string): Promise<StudentCheckIn | undefined> {
    const [updated] = await db
      .update(studentCheckIns)
      .set({
        status: 'dropped_off',
        droppedOffAt: new Date(),
      })
      .where(eq(studentCheckIns.id, checkInId))
      .returning();
    return updated;
  }

  async getTodayCheckInsForParent(parentId: string): Promise<StudentCheckIn[]> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    return db
      .select()
      .from(studentCheckIns)
      .where(
        and(
          eq(studentCheckIns.parentId, parentId),
          sql`${studentCheckIns.checkInDate} >= ${today}`
        )
      )
      .orderBy(desc(studentCheckIns.createdAt));
  }

  async getTodayCheckInsForStudents(studentIds: string[]): Promise<StudentCheckIn[]> {
    if (studentIds.length === 0) {
      return [];
    }
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    return db
      .select()
      .from(studentCheckIns)
      .where(
        and(
          inArray(studentCheckIns.studentId, studentIds),
          sql`${studentCheckIns.checkInDate} >= ${today}`
        )
      )
      .orderBy(desc(studentCheckIns.createdAt));
  }

  // Driver invitation operations
  async createDriverInvitation(driverId: string, email: string, companyId: string, tokenHash: string, expiresAt: Date): Promise<DriverInvitation> {
    // Invalidate any existing pending invitations for this driver
    await db
      .update(driverInvitations)
      .set({ status: 'expired' })
      .where(
        and(
          eq(driverInvitations.driverId, driverId),
          eq(driverInvitations.status, 'pending')
        )
      );

    const [invitation] = await db
      .insert(driverInvitations)
      .values({
        driverId,
        email,
        companyId,
        tokenHash,
        expiresAt,
        status: 'pending',
      })
      .returning();
    return invitation;
  }

  async getDriverInvitationByTokenHash(tokenHash: string): Promise<DriverInvitation | undefined> {
    const [invitation] = await db
      .select()
      .from(driverInvitations)
      .where(
        and(
          eq(driverInvitations.tokenHash, tokenHash),
          eq(driverInvitations.status, 'pending')
        )
      );
    return invitation;
  }

  async getPendingInvitationByDriverId(driverId: string): Promise<DriverInvitation | undefined> {
    const [invitation] = await db
      .select()
      .from(driverInvitations)
      .where(
        and(
          eq(driverInvitations.driverId, driverId),
          eq(driverInvitations.status, 'pending')
        )
      );
    return invitation;
  }

  async acceptDriverInvitation(invitationId: string): Promise<DriverInvitation | undefined> {
    const [updated] = await db
      .update(driverInvitations)
      .set({
        status: 'accepted',
        acceptedAt: new Date(),
      })
      .where(eq(driverInvitations.id, invitationId))
      .returning();
    return updated;
  }

  async hasDriverSetupPassword(driverId: string): Promise<boolean> {
    const credentials = await this.getPasswordCredentials(driverId);
    return !!credentials;
  }

  // System notification operations
  async createSystemNotification(notification: InsertSystemNotification): Promise<SystemNotification> {
    const [created] = await db
      .insert(systemNotifications)
      .values(notification)
      .returning();
    return created;
  }

  async getSystemNotificationsForAdmin(companyId: string): Promise<SystemNotification[]> {
    return await db
      .select()
      .from(systemNotifications)
      .where(eq(systemNotifications.companyId, companyId))
      .orderBy(desc(systemNotifications.createdAt));
  }

  async getSystemNotificationsForDriver(driverId: string, companyId: string): Promise<SystemNotification[]> {
    return await db
      .select()
      .from(systemNotifications)
      .where(
        and(
          eq(systemNotifications.companyId, companyId),
          or(
            eq(systemNotifications.recipientRole, 'driver'),
            eq(systemNotifications.recipientRole, 'all_drivers'),
            eq(systemNotifications.recipientId, driverId)
          )
        )
      )
      .orderBy(desc(systemNotifications.createdAt));
  }

  async getSystemNotificationsForParent(parentId: string, companyId: string): Promise<SystemNotification[]> {
    const parent = await this.getUser(parentId);
    const routeIds: string[] = [];
    
    if (parent) {
      const linkedStudents = await this.getLinkedStudentsByParentId(parentId);
      for (const student of linkedStudents) {
        if (student.routeId) {
          routeIds.push(student.routeId);
        }
      }
    }

    return await db
      .select()
      .from(systemNotifications)
      .where(
        and(
          eq(systemNotifications.companyId, companyId),
          or(
            eq(systemNotifications.recipientRole, 'parent'),
            eq(systemNotifications.recipientRole, 'all_parents'),
            eq(systemNotifications.recipientId, parentId),
            routeIds.length > 0 
              ? and(
                  eq(systemNotifications.recipientRole, 'route_parents'),
                  inArray(systemNotifications.routeId, routeIds)
                )
              : sql`false`
          )
        )
      )
      .orderBy(desc(systemNotifications.createdAt));
  }

  async markSystemNotificationAsRead(notificationId: string): Promise<SystemNotification | undefined> {
    const [updated] = await db
      .update(systemNotifications)
      .set({ isRead: true, readAt: new Date() })
      .where(eq(systemNotifications.id, notificationId))
      .returning();
    return updated;
  }

  async getUnreadNotificationCountForAdmin(companyId: string): Promise<number> {
    const result = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(systemNotifications)
      .where(
        and(
          eq(systemNotifications.companyId, companyId),
          eq(systemNotifications.isRead, false)
        )
      );
    return result[0]?.count ?? 0;
  }

  async getUnreadNotificationCountForDriver(driverId: string, companyId: string): Promise<number> {
    const result = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(systemNotifications)
      .where(
        and(
          eq(systemNotifications.companyId, companyId),
          eq(systemNotifications.isRead, false),
          or(
            eq(systemNotifications.recipientRole, 'driver'),
            eq(systemNotifications.recipientRole, 'all_drivers'),
            eq(systemNotifications.recipientId, driverId)
          )
        )
      );
    return result[0]?.count ?? 0;
  }

  async getUnreadNotificationCountForParent(parentId: string, companyId: string): Promise<number> {
    const linkedStudents = await this.getLinkedStudentsByParentId(parentId);
    const routeIds = linkedStudents
      .filter(s => s.routeId)
      .map(s => s.routeId as string);

    const result = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(systemNotifications)
      .where(
        and(
          eq(systemNotifications.companyId, companyId),
          eq(systemNotifications.isRead, false),
          or(
            eq(systemNotifications.recipientRole, 'parent'),
            eq(systemNotifications.recipientRole, 'all_parents'),
            eq(systemNotifications.recipientId, parentId),
            routeIds.length > 0 
              ? and(
                  eq(systemNotifications.recipientRole, 'route_parents'),
                  inArray(systemNotifications.routeId, routeIds)
                )
              : sql`false`
          )
        )
      );
    return result[0]?.count ?? 0;
  }

  // Bus journey tracking operations
  async createBusJourney(busId: string, driverId: string, routeId: string, companyId: string, homebaseAddress?: string): Promise<BusJourney> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const [journey] = await db
      .insert(busJourneys)
      .values({
        busId,
        driverId,
        routeId,
        companyId,
        journeyDate: today,
        homebaseAddress,
        departHomebaseAt: new Date(),
      })
      .returning();
    return journey;
  }

  async getTodayBusJourney(busId: string): Promise<BusJourney | undefined> {
    const today = new Date();
    const [journey] = await db
      .select()
      .from(busJourneys)
      .where(
        and(
          eq(busJourneys.busId, busId),
          sql`DATE(${busJourneys.journeyDate}) = DATE(${today})`
        )
      )
      .orderBy(desc(busJourneys.createdAt))
      .limit(1);
    return journey;
  }

  async updateJourneyEvent(
    journeyId: string, 
    eventType: 'depart_homebase' | 'arrive_school' | 'depart_school' | 'arrive_homebase',
    schoolId?: string
  ): Promise<BusJourney | undefined> {
    const now = new Date();
    const updates: Partial<InsertBusJourney> = { updatedAt: now };
    
    switch (eventType) {
      case 'depart_homebase':
        updates.departHomebaseAt = now;
        break;
      case 'arrive_school':
        updates.arriveSchoolAt = now;
        if (schoolId) updates.schoolId = schoolId;
        break;
      case 'depart_school':
        updates.departSchoolAt = now;
        break;
      case 'arrive_homebase':
        updates.arriveHomebaseAt = now;
        // Calculate total duration if we have departure time
        const [existingJourney] = await db
          .select()
          .from(busJourneys)
          .where(eq(busJourneys.id, journeyId));
        if (existingJourney?.departHomebaseAt) {
          const durationMs = now.getTime() - new Date(existingJourney.departHomebaseAt).getTime();
          updates.totalDurationMinutes = Math.round(durationMs / 60000);
        }
        break;
    }
    
    const [updated] = await db
      .update(busJourneys)
      .set(updates)
      .where(eq(busJourneys.id, journeyId))
      .returning();
    return updated;
  }

  async getBusJourneysForDateRange(companyId: string, startDate: Date, endDate: Date): Promise<BusJourney[]> {
    return await db
      .select()
      .from(busJourneys)
      .where(
        and(
          eq(busJourneys.companyId, companyId),
          sql`${busJourneys.journeyDate} >= ${startDate}`,
          sql`${busJourneys.journeyDate} <= ${endDate}`
        )
      )
      .orderBy(desc(busJourneys.journeyDate));
  }

  async getBusJourneysByBus(busId: string, limit: number = 30): Promise<BusJourney[]> {
    return await db
      .select()
      .from(busJourneys)
      .where(eq(busJourneys.busId, busId))
      .orderBy(desc(busJourneys.journeyDate))
      .limit(limit);
  }

  // Route stop completion tracking
  async markStopCompleted(data: { 
    routeStopId: string; 
    routeId: string; 
    driverId: string; 
    busId: string; 
    companyId: string; 
    stopSequence: number 
  }): Promise<RouteStopCompletion> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const now = new Date();
    
    const [completion] = await db
      .insert(routeStopCompletions)
      .values({
        routeStopId: data.routeStopId,
        routeId: data.routeId,
        driverId: data.driverId,
        busId: data.busId,
        companyId: data.companyId,
        stopSequence: data.stopSequence,
        completionDate: today,
        arrivedAt: now,
      })
      .returning();
    return completion;
  }

  async getTodayCompletedStops(routeId: string): Promise<RouteStopCompletion[]> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    return await db
      .select()
      .from(routeStopCompletions)
      .where(
        and(
          eq(routeStopCompletions.routeId, routeId),
          sql`DATE(${routeStopCompletions.completionDate}) = DATE(${today})`
        )
      )
      .orderBy(asc(routeStopCompletions.stopSequence));
  }

  async getLastCompletedStop(routeId: string): Promise<RouteStopCompletion | undefined> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const [lastStop] = await db
      .select()
      .from(routeStopCompletions)
      .where(
        and(
          eq(routeStopCompletions.routeId, routeId),
          sql`DATE(${routeStopCompletions.completionDate}) = DATE(${today})`
        )
      )
      .orderBy(desc(routeStopCompletions.stopSequence))
      .limit(1);
    return lastStop;
  }

  async resetRouteStops(routeId: string): Promise<void> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    await db
      .delete(routeStopCompletions)
      .where(
        and(
          eq(routeStopCompletions.routeId, routeId),
          sql`DATE(${routeStopCompletions.completionDate}) = DATE(${today})`
        )
      );
  }
}

export const storage = new DatabaseStorage();
