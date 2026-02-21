import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { setupCustomAuth, isAuthenticated } from "./customAuth";
import { 
  insertStudentSchema,
  insertRouteSchema,
  insertRouteStopSchema,
  insertSchoolSchema,
  insertAttendanceSchema,
  insertBusSchema,
  insertVehicleIssueSchema,
  insertDriverTaskSchema,
  insertEmergencyContactSchema,
  updateDriverProfileSchema
} from "@shared/schema";
import { z } from "zod";
import crypto from "crypto";
import { sendDriverInvitationEmail } from "./emailService";

export async function registerRoutes(app: Express): Promise<Server> {
  // Setup custom email/password authentication
  await setupCustomAuth(app);

  // Note: /api/auth/login, /api/auth/register, /api/auth/logout, /api/auth/user 
  // are defined in customAuth.ts

  // Update user role
  app.patch('/api/users/:id/role', isAuthenticated, async (req: any, res) => {
    try {
      const { id } = req.params;
      const { role } = req.body;
      const userId = req.user?.id;
      
      console.log("Role update request:", { id, role, userId, user: req.user });
      
      // Only allow users to update their own role
      if (id !== userId) {
        console.log("Unauthorized role update attempt:", { id, userId });
        return res.status(403).json({ message: "Unauthorized: Can only update your own role" });
      }
      
      // Validate role
      if (!['parent', 'driver', 'admin'].includes(role)) {
        console.log("Invalid role:", role);
        return res.status(400).json({ message: "Invalid role" });
      }
      
      // Check if user exists first
      const existingUser = await storage.getUser(id);
      if (!existingUser) {
        console.log("User not found:", id);
        return res.status(404).json({ message: "User not found" });
      }

      // Prevent changing master_admin role
      if (existingUser.role === 'master_admin') {
        console.log("Cannot change master_admin role:", id);
        return res.status(403).json({ message: "Cannot change master admin role" });
      }
      
      console.log("Updating role for user:", { id, role, existingRole: existingUser.role });
      const updatedUser = await storage.updateUserRole(id, role);
      if (!updatedUser) {
        console.log("Role update failed for user:", id);
        return res.status(404).json({ message: "User not found" });
      }
      
      console.log("Role updated successfully:", { id, newRole: updatedUser.role });
      res.json(updatedUser);
    } catch (error) {
      console.error("Error updating user role:", error);
      res.status(500).json({ message: "Failed to update user role" });
    }
  });

  // Driver Management Routes
  
  // Get all drivers for company (scoped by companyId for multi-tenant isolation)
  app.get('/api/drivers', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized - no user ID" });
      }
      
      const user = await storage.getUser(userId);
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ message: "Unauthorized - admin required" });
      }

      if (!user.companyId) {
        return res.status(400).json({ message: "No company associated with user" });
      }

      // Return all drivers for company (both active and archived)
      const activeDrivers = await storage.getActiveDrivers(user.companyId);
      const archivedDrivers = await storage.getArchivedDrivers(user.companyId);
      const drivers = [...activeDrivers, ...archivedDrivers];
      res.json(drivers);
    } catch (error) {
      console.error("Error fetching drivers:", error);
      res.status(500).json({ message: "Failed to fetch drivers" });
    }
  });

  // Get active drivers for company
  app.get('/api/drivers/active', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized - no user ID" });
      }
      
      const user = await storage.getUser(userId);
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ message: "Unauthorized - admin required" });
      }

      if (!user.companyId) {
        return res.status(400).json({ message: "No company associated with user" });
      }

      const drivers = await storage.getActiveDrivers(user.companyId);
      res.json(drivers);
    } catch (error) {
      console.error("Error fetching active drivers:", error);
      res.status(500).json({ message: "Failed to fetch active drivers" });
    }
  });

  // Get archived drivers for company
  app.get('/api/drivers/archived', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized - no user ID" });
      }
      
      const user = await storage.getUser(userId);
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ message: "Unauthorized - admin required" });
      }

      if (!user.companyId) {
        return res.status(400).json({ message: "No company associated with user" });
      }

      const drivers = await storage.getArchivedDrivers(user.companyId);
      res.json(drivers);
    } catch (error) {
      console.error("Error fetching archived drivers:", error);
      res.status(500).json({ message: "Failed to fetch archived drivers" });
    }
  });

  // Deactivate driver (archive)
  app.post('/api/drivers/:id/deactivate', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized - no user ID" });
      }
      
      const user = await storage.getUser(userId);
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ message: "Unauthorized - admin required" });
      }

      if (!user.companyId) {
        return res.status(400).json({ message: "No company associated with user" });
      }

      const { id } = req.params;
      const deactivatedDriver = await storage.deactivateDriver(id, user.companyId);
      
      if (!deactivatedDriver) {
        return res.status(404).json({ message: "Driver not found or does not belong to your company" });
      }

      res.json(deactivatedDriver);
    } catch (error) {
      console.error("Error deactivating driver:", error);
      res.status(500).json({ message: "Failed to deactivate driver" });
    }
  });

  // Reactivate driver (restore from archive)
  app.post('/api/drivers/:id/reactivate', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized - no user ID" });
      }
      
      const user = await storage.getUser(userId);
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ message: "Unauthorized - admin required" });
      }

      if (!user.companyId) {
        return res.status(400).json({ message: "No company associated with user" });
      }

      const { id } = req.params;
      const reactivatedDriver = await storage.reactivateDriver(id, user.companyId);
      
      if (!reactivatedDriver) {
        return res.status(404).json({ message: "Driver not found or does not belong to your company" });
      }

      res.json(reactivatedDriver);
    } catch (error) {
      console.error("Error reactivating driver:", error);
      res.status(500).json({ message: "Failed to reactivate driver" });
    }
  });

  // Driver names endpoint - accessible by all authenticated users for duty selection (scoped by company)
  app.get('/api/driver-names', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized - no user ID" });
      }
      
      const user = await storage.getUser(userId);
      if (!user || !user.companyId) {
        return res.status(400).json({ message: "No company associated with user" });
      }

      const drivers = await storage.getActiveDrivers(user.companyId);
      
      // Return only basic info needed for driver selection
      const driverNames = drivers.map(driver => ({
        id: driver.id,
        firstName: driver.firstName,
        lastName: driver.lastName
      }));
      
      res.json(driverNames);
    } catch (error) {
      console.error("Error fetching driver names:", error);
      res.status(500).json({ message: "Failed to fetch driver names" });
    }
  });

  // Driver profiles for check-in (accessible by drivers during check-in process, scoped by company)
  app.get('/api/driver-profiles-checkin', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized - no user ID" });
      }
      
      const user = await storage.getUser(userId);
      if (!user || user.role !== 'driver') {
        return res.status(403).json({ message: "Unauthorized - driver access required" });
      }

      if (!user.companyId) {
        return res.status(400).json({ message: "No company associated with user" });
      }

      const drivers = await storage.getActiveDrivers(user.companyId);
      
      // Return driver profiles with necessary info for check-in selection
      const driverProfiles = drivers.map(driver => ({
        id: driver.id,
        firstName: driver.firstName,
        lastName: driver.lastName,
        email: driver.email,
        phone: driver.phone,
        licenseNumber: driver.licenseNumber,
        licenseState: driver.licenseState,
        isOnDuty: driver.isOnDuty || false,
      }));
      
      res.json(driverProfiles);
    } catch (error) {
      console.error("Error fetching driver profiles for check-in:", error);
      res.status(500).json({ message: "Failed to fetch driver profiles" });
    }
  });

  // Create driver
  app.post('/api/drivers', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized - no user ID" });
      }
      
      const user = await storage.getUser(userId);
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ message: "Unauthorized - admin required" });
      }

      // Check plan limits before creating driver
      if (user.companyId) {
        const canCreate = await storage.canCreateUser(user.companyId, 'driver');
        if (!canCreate.allowed) {
          return res.status(403).json({ message: canCreate.reason });
        }
      }

      const validatedData = updateDriverProfileSchema.parse(req.body);
      
      // Convert date strings to Date objects for database storage
      const processedData = {
        ...validatedData,
        role: 'driver' as const,
        companyId: user.companyId,
        licenseExpiryDate: validatedData.licenseExpiryDate ? new Date(validatedData.licenseExpiryDate) : null,
        hireDate: validatedData.hireDate ? new Date(validatedData.hireDate) : null,
        dateOfBirth: validatedData.dateOfBirth ? new Date(validatedData.dateOfBirth) : null,
      };
      
      const driver = await storage.createDriver(processedData);

      // Automatically send invitation email if driver has an email address
      if (driver.email && user.companyId) {
        try {
          const company = await storage.getCompanyById(user.companyId);
          const companyName = company?.name || "School Bus Service";

          // Generate secure token
          const token = crypto.randomBytes(32).toString('hex');
          const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
          const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

          // Create invitation record
          await storage.createDriverInvitation(driver.id, driver.email, user.companyId, tokenHash, expiresAt);

          // Send invitation email
          await sendDriverInvitationEmail(
            driver.email,
            `${driver.firstName || ''} ${driver.lastName || ''}`.trim() || 'Driver',
            token,
            companyName
          );

          console.log(`Driver invitation email sent to ${driver.email}`);
        } catch (emailError) {
          console.error("Error sending driver invitation email:", emailError);
          // Don't fail the request if email sending fails - driver was still created
        }
      }

      res.json(driver);
    } catch (error) {
      console.error("Error creating driver:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid driver data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to create driver" });
    }
  });

  // Update driver profile
  app.patch('/api/drivers/:id', isAuthenticated, async (req: any, res) => {
    try {
      const { id } = req.params;
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized - no user ID" });
      }
      
      const user = await storage.getUser(userId);
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ message: "Unauthorized - admin required" });
      }

      const validatedData = updateDriverProfileSchema.partial().parse(req.body);
      
      // Convert date strings to Date objects for database storage
      const processedData = {
        ...validatedData,
        licenseExpiryDate: validatedData.licenseExpiryDate ? new Date(validatedData.licenseExpiryDate) : undefined,
        hireDate: validatedData.hireDate ? new Date(validatedData.hireDate) : undefined,
        dateOfBirth: validatedData.dateOfBirth ? new Date(validatedData.dateOfBirth) : undefined,
      };
      
      const updatedDriver = await storage.updateDriverProfile(id, processedData);
      
      if (!updatedDriver) {
        return res.status(404).json({ message: "Driver not found" });
      }
      
      res.json(updatedDriver);
    } catch (error: any) {
      console.error("Error updating driver:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid driver data", errors: error.errors });
      }
      // Handle duplicate email constraint violation
      if (error?.code === '23505' && error?.constraint === 'users_email_unique') {
        return res.status(400).json({ message: "This email address is already in use by another user" });
      }
      res.status(500).json({ message: "Failed to update driver" });
    }
  });

  // Send driver invitation email (admin only)
  app.post('/api/drivers/:id/send-invitation', isAuthenticated, async (req: any, res) => {
    try {
      const { id } = req.params;
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized - no user ID" });
      }
      
      const user = await storage.getUser(userId);
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ message: "Unauthorized - admin required" });
      }

      const driver = await storage.getUser(id);
      if (!driver || driver.role !== 'driver') {
        return res.status(404).json({ message: "Driver not found" });
      }

      if (!driver.email) {
        return res.status(400).json({ message: "Driver does not have an email address" });
      }

      // Check if driver belongs to same company
      if (driver.companyId !== user.companyId) {
        return res.status(403).json({ message: "Cannot send invitation to driver from different company" });
      }

      // Check if driver already has password set up
      const hasPassword = await storage.hasDriverSetupPassword(id);
      if (hasPassword) {
        return res.status(400).json({ message: "Driver has already set up their password" });
      }

      // Get company name for the invitation email
      const company = user.companyId ? await storage.getCompanyById(user.companyId) : null;
      const companyName = company?.name || "School Bus Service";

      // Generate secure token
      const token = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

      // Create invitation record
      await storage.createDriverInvitation(id, driver.email, user.companyId!, tokenHash, expiresAt);

      // Send invitation email
      await sendDriverInvitationEmail(
        driver.email,
        `${driver.firstName || ''} ${driver.lastName || ''}`.trim() || 'Driver',
        token,
        companyName
      );

      res.json({ message: "Invitation sent successfully" });
    } catch (error) {
      console.error("Error sending driver invitation:", error);
      res.status(500).json({ message: "Failed to send invitation" });
    }
  });

  // Verify driver invitation token (public endpoint for password setup page)
  app.get('/api/driver-invitation/verify', async (req, res) => {
    try {
      const { token } = req.query;
      if (!token || typeof token !== 'string') {
        return res.status(400).json({ message: "Token is required" });
      }

      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      const invitation = await storage.getDriverInvitationByTokenHash(tokenHash);

      if (!invitation) {
        return res.status(404).json({ message: "Invalid or expired invitation" });
      }

      if (new Date() > invitation.expiresAt) {
        return res.status(400).json({ message: "Invitation has expired" });
      }

      // Get driver info to show on the setup page
      const driver = await storage.getUser(invitation.driverId);
      if (!driver) {
        return res.status(404).json({ message: "Driver account not found" });
      }

      res.json({
        valid: true,
        email: invitation.email,
        firstName: driver.firstName,
        lastName: driver.lastName,
      });
    } catch (error) {
      console.error("Error verifying driver invitation:", error);
      res.status(500).json({ message: "Failed to verify invitation" });
    }
  });

  // Complete driver password setup (public endpoint)
  app.post('/api/driver-invitation/complete', async (req, res) => {
    try {
      const { token, password } = req.body;
      if (!token || !password) {
        return res.status(400).json({ message: "Token and password are required" });
      }

      if (password.length < 8) {
        return res.status(400).json({ message: "Password must be at least 8 characters" });
      }

      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      const invitation = await storage.getDriverInvitationByTokenHash(tokenHash);

      if (!invitation) {
        return res.status(404).json({ message: "Invalid or expired invitation" });
      }

      if (new Date() > invitation.expiresAt) {
        return res.status(400).json({ message: "Invitation has expired" });
      }

      // Check if password is already set
      const hasPassword = await storage.hasDriverSetupPassword(invitation.driverId);
      if (hasPassword) {
        return res.status(400).json({ message: "Password has already been set up" });
      }

      // Hash password and create credentials
      const bcrypt = await import('bcryptjs');
      const passwordHash = await bcrypt.hash(password, 10);
      await storage.createPasswordCredentials(invitation.driverId, passwordHash);

      // Mark invitation as accepted
      await storage.acceptDriverInvitation(invitation.id);

      res.json({ message: "Password set up successfully. You can now log in." });
    } catch (error) {
      console.error("Error completing driver invitation:", error);
      res.status(500).json({ message: "Failed to complete password setup" });
    }
  });

  // Check driver invitation status (admin only)
  app.get('/api/drivers/:id/invitation-status', isAuthenticated, async (req: any, res) => {
    try {
      const { id } = req.params;
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized - no user ID" });
      }
      
      const user = await storage.getUser(userId);
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ message: "Unauthorized - admin required" });
      }

      const hasPassword = await storage.hasDriverSetupPassword(id);
      const pendingInvitation = await storage.getPendingInvitationByDriverId(id);

      res.json({
        hasSetupPassword: hasPassword,
        hasPendingInvitation: !!pendingInvitation,
        invitationExpiresAt: pendingInvitation?.expiresAt,
      });
    } catch (error) {
      console.error("Error checking invitation status:", error);
      res.status(500).json({ message: "Failed to check invitation status" });
    }
  });

  // Admin-Driver Communication Routes
  
  // Admin requests for drivers
  app.get('/api/admin-requests', isAuthenticated, async (req, res) => {
    try {
      const requests = await storage.getAllAdminRequests();
      res.json(requests);
    } catch (error) {
      console.error("Error fetching admin requests:", error);
      res.status(500).json({ message: "Failed to fetch admin requests" });
    }
  });

  // Driver assignments
  app.get('/api/driver-assignments', isAuthenticated, async (req, res) => {
    try {
      // Mock driver assignments
      const mockAssignments = [
        {
          id: '1',
          routeName: 'Route A3 - Morning',
          busNumber: '42',
          startTime: '7:30 AM',
          endTime: '9:00 AM',
          studentCount: 23,
          status: 'active',
        },
        {
          id: '2',
          routeName: 'Route A3 - Afternoon',
          busNumber: '42',
          startTime: '3:00 PM',
          endTime: '4:30 PM',
          studentCount: 23,
          status: 'scheduled',
        }
      ];
      res.json(mockAssignments);
    } catch (error) {
      console.error("Error fetching driver assignments:", error);
      res.status(500).json({ message: "Failed to fetch driver assignments" });
    }
  });

  // Maintenance requests
  app.get('/api/maintenance-requests', isAuthenticated, async (req, res) => {
    try {
      // Mock maintenance requests
      const mockMaintenanceRequests = [
        {
          id: '1',
          busNumber: '42',
          issue: 'Brake inspection needed',
          status: 'approved',
          requestedAt: new Date(Date.now() - 86400000).toISOString(),
        },
        {
          id: '2',
          busNumber: '38',
          issue: 'Air conditioning repair',
          status: 'pending',
          requestedAt: new Date(Date.now() - 172800000).toISOString(),
        }
      ];
      res.json(mockMaintenanceRequests);
    } catch (error) {
      console.error("Error fetching maintenance requests:", error);
      res.status(500).json({ message: "Failed to fetch maintenance requests" });
    }
  });

  // Create maintenance request
  app.post('/api/maintenance-requests', isAuthenticated, async (req, res) => {
    try {
      const { busNumber, issue, description } = req.body;
      
      // Mock creating maintenance request
      const newRequest = {
        id: Date.now().toString(),
        busNumber,
        issue,
        description,
        status: 'pending',
        requestedAt: new Date().toISOString(),
        requestedBy: (req.user as any)?.claims?.sub,
      };
      
      res.status(201).json(newRequest);
    } catch (error) {
      console.error("Error creating maintenance request:", error);
      res.status(500).json({ message: "Failed to create maintenance request" });
    }
  });

  // Acknowledge admin request
  app.patch('/api/admin-requests/:id/acknowledge', isAuthenticated, async (req, res) => {
    try {
      const { id } = req.params;
      const updatedRequest = await storage.acknowledgeAdminRequest(id);
      
      if (!updatedRequest) {
        return res.status(404).json({ message: "Request not found" });
      }
      
      res.json(updatedRequest);
    } catch (error) {
      console.error("Error acknowledging admin request:", error);
      res.status(500).json({ message: "Failed to acknowledge request" });
    }
  });

  // Complete admin request
  app.patch('/api/admin-requests/:id/complete', isAuthenticated, async (req, res) => {
    try {
      const { id } = req.params;
      const updatedRequest = await storage.completeAdminRequest(id);
      
      if (!updatedRequest) {
        return res.status(404).json({ message: "Request not found" });
      }
      
      res.json(updatedRequest);
    } catch (error) {
      console.error("Error completing admin request:", error);
      res.status(500).json({ message: "Failed to complete request" });
    }
  });

  // Create admin request (for admins)
  app.post('/api/admin-requests', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      const user = await storage.getUser(userId);
      
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ message: "Unauthorized - admin required" });
      }
      
      const { title, description, priority, driverId } = req.body;
      
      const newRequest = await storage.createAdminRequest({
        title,
        description,
        priority: priority || 'medium',
        status: 'pending',
        driverId: driverId || null,
      });
      
      res.status(201).json(newRequest);
    } catch (error) {
      console.error("Error creating admin request:", error);
      res.status(500).json({ message: "Failed to create admin request" });
    }
  });

  // Fleet Management Routes - REMOVED DUPLICATE MOCK ENDPOINT

  // Update bus
  app.patch('/api/buses/:id', isAuthenticated, async (req: any, res) => {
    try {
      const { id } = req.params;
      const updateData = req.body;
      const userId = req.user?.id;
      
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized - no user ID" });
      }
      
      const user = await storage.getUser(userId);
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ message: "Unauthorized - admin required" });
      }

      console.log('=== BUS UPDATE REQUEST ===');
      console.log('Bus ID:', id);
      console.log('Update data:', JSON.stringify(updateData, null, 2));
      
      // Get the current bus to check if it exists
      const existingBus = await storage.getBusById(id);
      if (!existingBus) {
        return res.status(404).json({ message: "Bus not found" });
      }
      
      // Check for duplicate driver assignment if driverId is being updated
      if (updateData.driverId && updateData.driverId !== existingBus.driverId) {
        // Check if the driver is already assigned to another bus
        const driverExistingBus = await storage.getBusByDriverId(updateData.driverId);
        if (driverExistingBus && driverExistingBus.id !== id) {
          return res.status(400).json({ 
            message: `Driver is already assigned to Bus #${driverExistingBus.busNumber}. Please unassign from that bus first.`,
            conflictingBus: {
              id: driverExistingBus.id,
              busNumber: driverExistingBus.busNumber
            }
          });
        }
      }
      
      // Special handling for status changes to maintenance
      if (updateData.status === 'maintenance' && existingBus.status !== 'maintenance') {
        console.log('Moving bus to maintenance mode');
        updateData.maintenanceDate = new Date();
        
        // If the bus was assigned to a driver and going into maintenance, 
        // we might want to notify them, but we'll keep the assignment for now
      }
      
      if (updateData.status === 'inactive' && existingBus.status !== 'inactive') {
        console.log('Moving bus to inactive status');
        // Remove driver assignment when making bus inactive
        updateData.driverId = null;
      }
      
      // Update the bus in the database
      const updatedBus = await storage.updateBus(id, {
        ...updateData,
        lastUpdated: new Date(),
      });
      
      if (!updatedBus) {
        return res.status(500).json({ message: "Failed to update bus" });
      }
      
      console.log('Bus updated successfully:', updatedBus.id);
      res.json(updatedBus);
      
    } catch (error) {
      console.error("Error updating bus:", error);
      res.status(500).json({ message: "Failed to update bus" });
    }
  });

  // Delete bus
  app.delete('/api/buses/:id', isAuthenticated, async (req: any, res) => {
    try {
      const { id } = req.params;
      const userId = req.user?.id;
      
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized - no user ID" });
      }
      
      const user = await storage.getUser(userId);
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ message: "Unauthorized - admin required" });
      }

      console.log('=== BUS DELETE REQUEST ===');
      console.log('Bus ID:', id);
      
      const deleted = await storage.deleteBus(id);
      if (!deleted) {
        return res.status(404).json({ message: 'Bus not found' });
      }
      
      console.log('Bus deleted successfully:', id);
      res.json({ message: 'Bus deleted successfully' });
    } catch (error: any) {
      console.error('Error deleting bus:', error);
      if (error.message && error.message.includes('active route')) {
        return res.status(400).json({ message: error.message });
      }
      res.status(500).json({ message: 'Failed to delete bus' });
    }
  });

  // Driver selects their bus and activates it
  app.post('/api/driver/select-bus/:busId', isAuthenticated, async (req: any, res) => {
    try {
      const { busId } = req.params;
      const userId = req.user?.id;
      
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized - no user ID" });
      }
      
      const user = await storage.getUser(userId);
      if (!user || user.role !== 'driver') {
        return res.status(403).json({ message: "Unauthorized - driver required" });
      }

      console.log('=== DRIVER BUS SELECTION ===');
      console.log('Driver ID:', userId);
      console.log('Bus ID:', busId);
      
      // Get the bus to ensure it exists and is available
      const bus = await storage.getBusById(busId);
      if (!bus) {
        return res.status(404).json({ message: "Bus not found" });
      }
      
      // Check if bus is available for assignment (not under maintenance or assigned to another driver)
      if (bus.status === 'maintenance') {
        return res.status(400).json({ message: "Bus is under maintenance and cannot be selected" });
      }
      
      if (bus.driverId && bus.driverId !== userId) {
        return res.status(400).json({ message: "Bus is already assigned to another driver" });
      }
      
      // Assign the bus to the driver and set it to active mode
      const updatedBus = await storage.updateBus(busId, {
        driverId: userId,
        status: 'on_route', // Set to active mode
        lastUpdated: new Date(),
      });
      
      console.log('Bus assigned and activated:', updatedBus);
      
      res.json({
        message: "Bus selected and activated successfully",
        bus: updatedBus,
        status: "active"
      });
      
    } catch (error) {
      console.error("Error selecting bus:", error);
      res.status(500).json({ message: "Failed to select bus" });
    }
  });

  // Driver ends their shift and deactivates bus
  app.post('/api/driver/deactivate-bus', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized - no user ID" });
      }
      
      const user = await storage.getUser(userId);
      if (!user || user.role !== 'driver') {
        return res.status(403).json({ message: "Unauthorized - driver required" });
      }

      // Find the driver's current bus
      const bus = await storage.getBusByDriverId(userId);
      if (!bus) {
        return res.status(404).json({ message: "No assigned bus found" });
      }
      
      // Deactivate the bus (set to idle)
      const updatedBus = await storage.updateBus(bus.id, {
        status: 'idle',
        lastUpdated: new Date(),
      });
      
      res.json({
        message: "Bus deactivated successfully",
        bus: updatedBus,
        status: "inactive"
      });
      
    } catch (error) {
      console.error("Error deactivating bus:", error);
      res.status(500).json({ message: "Failed to deactivate bus" });
    }
  });

  // Delete bus from fleet
  app.delete('/api/buses/:id', isAuthenticated, async (req, res) => {
    try {
      const { id } = req.params;
      
      // Mock deleting bus
      res.json({ 
        id, 
        deleted: true, 
        deletedAt: new Date().toISOString() 
      });
    } catch (error) {
      console.error("Error deleting bus:", error);
      res.status(500).json({ message: "Failed to delete bus" });
    }
  });

  // Student routes
  app.get('/api/students', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      const user = await storage.getUser(userId);
      
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      let students;
      if (user.role === 'parent') {
        // Use the linking system - only return students linked via parentChildLinks
        const linkedStudents = await storage.getLinkedStudentsByParentId(userId);
        
        // Enrich students with school, route, bus, and stop info
        students = await Promise.all(linkedStudents.map(async (student: any) => {
          const school = student.schoolId ? await storage.getSchoolById(student.schoolId) : null;
          const route = student.routeId ? await storage.getRouteById(student.routeId) : null;
          const stop = student.stopId ? await storage.getRouteStopById(student.stopId) : null;
          const bus = student.routeId ? await storage.getBusByRouteId(student.routeId) : null;
          
          return {
            ...student,
            school: school ? { id: school.id, name: school.name } : null,
            route: route ? { id: route.id, name: route.name } : null,
            stop: stop ? { id: stop.id, name: stop.name } : null,
            bus: bus ? { id: bus.id, busNumber: bus.busNumber, status: bus.status } : null,
          };
        }));
      } else if (user.role === 'admin') {
        students = await storage.getAllStudents();
      } else {
        return res.status(403).json({ message: "Unauthorized" });
      }

      res.json(students);
    } catch (error) {
      console.error("Error fetching students:", error);
      res.status(500).json({ message: "Failed to fetch students" });
    }
  });

  app.post('/api/students', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      const user = await storage.getUser(userId);
      
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ message: "Unauthorized" });
      }

      const validatedData = insertStudentSchema.parse(req.body);
      const student = await storage.createStudent(validatedData);
      res.json(student);
    } catch (error) {
      console.error("Error creating student:", error);
      res.status(500).json({ message: "Failed to create student" });
    }
  });

  // Route management
  app.get('/api/routes', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      const user = await storage.getUser(userId);
      
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      let routes;
      if (user.role === 'driver') {
        routes = await storage.getRoutesByDriverId(userId);
      } else {
        routes = await storage.getAllRoutes();
      }

      res.json(routes);
    } catch (error) {
      console.error("Error fetching routes:", error);
      res.status(500).json({ message: "Failed to fetch routes" });
    }
  });

  // Get all available routes for driver check-in
  app.get('/api/available-routes', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      const user = await storage.getUser(userId);
      
      if (!user || user.role !== 'driver') {
        return res.status(403).json({ message: "Unauthorized - drivers only" });
      }

      // For check-in, drivers should see all available routes
      const routes = await storage.getAllRoutes();
      res.json(routes);
    } catch (error) {
      console.error("Error fetching available routes:", error);
      res.status(500).json({ message: "Failed to fetch available routes" });
    }
  });

  // Get all available buses for driver check-in
  app.get('/api/available-buses', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      const user = await storage.getUser(userId);
      
      if (!user || user.role !== 'driver') {
        return res.status(403).json({ message: "Unauthorized - drivers only" });
      }

      // For check-in, drivers should see all buses from admin fleet that are available for assignment
      const buses = await storage.getAllBuses();
      console.log("Total buses in fleet:", buses.length);
      console.log("Bus statuses:", buses.map(b => ({id: b.id, number: b.busNumber, status: b.status, driverId: b.driverId})));
      
      // Get all on-duty drivers to check if assigned buses are actively being used
      const onDutyDrivers = await storage.getOnDutyDrivers();
      const onDutyDriverIds = onDutyDrivers.map(d => d.id);
      
      const availableBuses = buses.filter((bus: any) => 
        // Include buses that are:
        // 1. Not in maintenance status and not inactive
        // 2. Either unassigned OR assigned to current driver OR assigned to driver who is not on duty
        bus.status !== 'maintenance' && 
        bus.status !== 'inactive' &&
        (!bus.driverId || bus.driverId === userId || !onDutyDriverIds.includes(bus.driverId))
      );
      console.log("On-duty drivers:", onDutyDriverIds.length);
      console.log("Available buses for driver check-in:", availableBuses.length, "buses");
      res.json(availableBuses);
    } catch (error) {
      console.error("Error fetching available buses:", error);
      res.status(500).json({ message: "Failed to fetch available buses" });
    }
  });

  // Get students for driver's assigned route
  app.get('/api/driver-route-students', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      const user = await storage.getUser(userId);
      
      if (!user || user.role !== 'driver') {
        return res.status(403).json({ message: "Unauthorized - drivers only" });
      }

      if (!user.assignedRouteId) {
        return res.json([]);
      }

      const students = await storage.getStudentsByRouteId(user.assignedRouteId);
      
      // Enrich students with school and route info (individually looked up for tenant isolation)
      const enrichedStudents = await Promise.all((students || []).map(async (student: any) => {
        const school = student.schoolId ? await storage.getSchoolById(student.schoolId) : null;
        const route = student.routeId ? await storage.getRouteById(student.routeId) : null;
        return {
          ...student,
          school: school || null,
          route: route || null,
        };
      }));
      
      res.json(enrichedStudents);
    } catch (error) {
      console.error("Error fetching driver route students:", error);
      res.status(500).json({ message: "Failed to fetch driver route students" });
    }
  });

  // Get route stops for driver's assigned route
  app.get('/api/driver-route-stops', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      const user = await storage.getUser(userId);
      
      if (!user || user.role !== 'driver') {
        return res.status(403).json({ message: "Unauthorized - drivers only" });
      }

      if (!user.assignedRouteId) {
        return res.json([]);
      }

      const stops = await storage.getStopsByRouteId(user.assignedRouteId);
      res.json(stops);
    } catch (error) {
      console.error("Error fetching driver route stops:", error);
      res.status(500).json({ message: "Failed to fetch driver route stops" });
    }
  });

  // Get route schools for driver's assigned route
  app.get('/api/driver-route-schools', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      const user = await storage.getUser(userId);
      
      if (!user || user.role !== 'driver') {
        return res.status(403).json({ message: "Unauthorized - drivers only" });
      }

      if (!user.assignedRouteId) {
        return res.json([]);
      }

      const schools = await storage.getSchoolsByRouteId(user.assignedRouteId);
      res.json(schools);
    } catch (error) {
      console.error("Error fetching driver route schools:", error);
      res.status(500).json({ message: "Failed to fetch driver route schools" });
    }
  });

  app.post('/api/routes', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      const user = await storage.getUser(userId);
      
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ message: "Unauthorized" });
      }

      console.log('=== ROUTE CREATION REQUEST ===');
      console.log('Raw request body:', JSON.stringify(req.body, null, 2));
      
      try {
        const validatedData = insertRouteSchema.parse(req.body);
        console.log('Validated route data:', JSON.stringify(validatedData, null, 2));
        
        const route = await storage.createRoute(validatedData);
        console.log('Created route successfully:', route.id);
        
        // If a school is assigned to this route, create a route stop for it
        if (req.body.schoolId) {
          try {
            const school = await storage.getSchoolById(req.body.schoolId);
            if (school) {
              const routeStop = {
                routeId: route.id,
                schoolId: school.id,
                name: school.name,
                address: school.address,
                latitude: school.latitude,
                longitude: school.longitude,
                order: 1,
                scheduledTime: '08:00', // Default pickup time
              };
              
              await storage.createRouteStop(routeStop);
              console.log('Created route stop for school:', school.name);
            }
          } catch (stopError) {
            console.error('Error creating route stop for school:', stopError);
            // Don't fail the route creation if stop creation fails
          }
        }
        
        res.json(route);
      } catch (validationError) {
        console.error('Route validation error:', validationError);
        return res.status(400).json({ 
          message: "Invalid route data", 
          details: validationError instanceof Error ? validationError.message : validationError 
        });
      }
      
    } catch (error) {
      console.error("Error creating route:", error);
      res.status(500).json({ message: "Failed to create route" });
    }
  });

  // Update route
  app.patch('/api/routes/:id', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      const user = await storage.getUser(userId);
      
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ message: "Unauthorized" });
      }

      const { id } = req.params;
      
      console.log('=== ROUTE UPDATE REQUEST ===');
      console.log('Route ID:', id);
      console.log('Raw request body:', JSON.stringify(req.body, null, 2));
      
      // Check if route exists
      const existingRoute = await storage.getRouteById(id);
      if (!existingRoute) {
        return res.status(404).json({ message: "Route not found" });
      }

      try {
        // For partial updates, make all fields optional except the ones being updated
        const partialRouteSchema = insertRouteSchema.partial();
        const validatedData = partialRouteSchema.parse(req.body);
        console.log('Validated update data:', JSON.stringify(validatedData, null, 2));
        
        const updatedRoute = await storage.updateRoute(id, validatedData);
        if (!updatedRoute) {
          return res.status(500).json({ message: "Failed to update route" });
        }
        
        // Handle school assignment/reassignment
        if (req.body.schoolId && req.body.schoolId !== existingRoute.schoolId) {
          try {
            // Remove old school stops if they exist
            if (existingRoute.schoolId) {
              const existingStops = await storage.getStopsByRouteId(id);
              const schoolStops = existingStops.filter(stop => stop.schoolId === existingRoute.schoolId);
              for (const stop of schoolStops) {
                await storage.deleteRouteStop(stop.id);
              }
            }
            
            // Add new school stop
            const school = await storage.getSchoolById(req.body.schoolId);
            if (school) {
              const routeStop = {
                routeId: id,
                schoolId: school.id,
                name: school.name,
                address: school.address,
                latitude: school.latitude,
                longitude: school.longitude,
                order: 1,
                scheduledTime: '08:00',
              };
              
              await storage.createRouteStop(routeStop);
              console.log('Updated route stops for school:', school.name);
            }
          } catch (stopError) {
            console.error('Error updating route stops for school:', stopError);
          }
        }
        // Handle school removal
        else if (req.body.schoolId === "" && existingRoute.schoolId) {
          try {
            const existingStops = await storage.getStopsByRouteId(id);
            const schoolStops = existingStops.filter(stop => stop.schoolId === existingRoute.schoolId);
            for (const stop of schoolStops) {
              await storage.deleteRouteStop(stop.id);
            }
            console.log('Removed school stops from route');
          } catch (stopError) {
            console.error('Error removing school stops:', stopError);
          }
        }
        
        console.log('Route updated successfully:', updatedRoute.id);
        res.json(updatedRoute);
        
      } catch (validationError) {
        console.error('Route validation error:', validationError);
        return res.status(400).json({ 
          message: "Invalid route data", 
          details: validationError instanceof Error ? validationError.message : validationError 
        });
      }
      
    } catch (error) {
      console.error("Error updating route:", error);
      res.status(500).json({ message: "Failed to update route" });
    }
  });

  // Route stops
  app.get('/api/routes/:routeId/stops', isAuthenticated, async (req: any, res) => {
    try {
      const { routeId } = req.params;
      const stops = await storage.getStopsByRouteId(routeId);
      res.json(stops);
    } catch (error) {
      console.error("Error fetching route stops:", error);
      res.status(500).json({ message: "Failed to fetch route stops" });
    }
  });

  app.post('/api/routes/:routeId/stops', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      const user = await storage.getUser(userId);
      
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ message: "Unauthorized" });
      }

      const { routeId } = req.params;
      const validatedData = insertRouteStopSchema.parse({ ...req.body, routeId });
      const stop = await storage.createRouteStop(validatedData);
      res.json(stop);
    } catch (error) {
      console.error("Error creating route stop:", error);
      res.status(500).json({ message: "Failed to create route stop" });
    }
  });

  // Schools
  app.get('/api/schools', isAuthenticated, async (req: any, res) => {
    try {
      const schools = await storage.getAllSchools();
      res.json(schools);
    } catch (error) {
      console.error("Error fetching schools:", error);
      res.status(500).json({ message: "Failed to fetch schools" });
    }
  });

  app.post('/api/schools', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      const user = await storage.getUser(userId);
      
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ message: "Unauthorized" });
      }

      const validatedData = insertSchoolSchema.parse(req.body);
      const school = await storage.createSchool(validatedData);
      res.json(school);
    } catch (error) {
      console.error("Error creating school:", error);
      res.status(500).json({ message: "Failed to create school" });
    }
  });

  // Attendance
  app.get('/api/attendance', isAuthenticated, async (req: any, res) => {
    try {
      const { date } = req.query;
      const attendanceDate = date ? new Date(date as string) : new Date();
      const attendance = await storage.getAttendanceByDate(attendanceDate);
      res.json(attendance);
    } catch (error) {
      console.error("Error fetching attendance:", error);
      res.status(500).json({ message: "Failed to fetch attendance" });
    }
  });

  app.post('/api/attendance', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      const user = await storage.getUser(userId);
      
      if (!user || user.role !== 'driver') {
        return res.status(403).json({ message: "Unauthorized" });
      }

      const validatedData = insertAttendanceSchema.parse(req.body);
      const attendance = await storage.createAttendance(validatedData);
      res.json(attendance);
    } catch (error) {
      console.error("Error creating attendance:", error);
      res.status(500).json({ message: "Failed to create attendance" });
    }
  });

  // Buses
  app.get('/api/buses', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized - no user ID" });
      }
      
      const user = await storage.getUser(userId);
      
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      let buses;
      if (user.role === 'driver') {
        const bus = await storage.getBusByDriverId(userId);
        buses = bus ? [bus] : [];
      } else {
        buses = await storage.getAllBuses();
      }

      res.json(buses);
    } catch (error) {
      console.error("Error fetching buses:", error);
      res.status(500).json({ message: "Failed to fetch buses" });
    }
  });

  app.post('/api/buses', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        console.error('No user ID found in request');
        return res.status(401).json({ message: "Unauthorized - no user ID" });
      }
      
      const user = await storage.getUser(userId);
      if (!user) {
        console.error('User not found:', userId);
        return res.status(401).json({ message: "User not found" });
      }
      
      if (user.role !== 'admin') {
        console.error('User is not admin:', user.role);
        return res.status(403).json({ message: "Unauthorized - admin required" });
      }

      console.log('=== BUS CREATION REQUEST ===');
      console.log('Request body:', JSON.stringify(req.body, null, 2));
      console.log('User:', userId, 'Role:', user.role);
      
      // Validate required fields
      if (!req.body.busNumber) {
        console.error('Missing bus number in request');
        return res.status(400).json({ message: "Bus number is required" });
      }
      
      // Validate with Zod schema
      let validatedData;
      try {
        validatedData = insertBusSchema.parse(req.body);
        console.log('Validated data:', JSON.stringify(validatedData, null, 2));
      } catch (zodError: any) {
        console.error('Validation error:', zodError.errors);
        return res.status(400).json({ 
          message: "Invalid bus data", 
          errors: zodError.errors,
          receivedData: req.body 
        });
      }
      
      // Create the bus with comprehensive error handling
      let createdBus;
      try {
        console.log('Calling storage.createBus with:', JSON.stringify(validatedData, null, 2));
        createdBus = await storage.createBus(validatedData);
        console.log('=== BUS CREATION SUCCESS ===');
        console.log('Created bus:', JSON.stringify(createdBus, null, 2));
        
        // Immediately verify the bus exists in database
        const verifyBus = await storage.getBusByNumber(validatedData.busNumber);
        if (!verifyBus) {
          console.error('CRITICAL: Bus not found in database immediately after creation');
          throw new Error('Database verification failed - bus not found after creation');
        }
        console.log('Database verification SUCCESS - bus found:', verifyBus.id);
        
      } catch (createError: any) {
        console.error('=== BUS CREATION FAILED ===');
        console.error('Creation error:', createError.message);
        console.error('Error stack:', createError.stack);
        
        if (createError.message.includes('already exists')) {
          return res.status(409).json({ 
            message: "Bus number already exists",
            busNumber: validatedData.busNumber 
          });
        }
        
        return res.status(500).json({ 
          message: "Failed to create bus", 
          error: createError.message,
          requestData: validatedData
        });
      }
      
      // Final verification - fetch all buses to confirm addition
      try {
        const allBuses = await storage.getAllBuses();
        const busExists = allBuses.find(b => b.id === createdBus.id);
        if (!busExists) {
          console.error('CRITICAL: Bus not found in database after creation!');
          return res.status(500).json({ 
            message: "Bus creation verification failed - bus not found after insert" 
          });
        }
        console.log('Bus verified in database. Total buses:', allBuses.length);
      } catch (verifyError: any) {
        console.error('Bus verification failed:', verifyError.message);
      }
      
      res.status(201).json(createdBus);
      
    } catch (error: any) {
      console.error("=== CRITICAL ERROR IN BUS CREATION ===");
      console.error("Error:", error);
      console.error("Error stack:", error.stack);
      console.error("Request body:", req.body);
      
      res.status(500).json({ 
        message: "Internal server error during bus creation", 
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  });

  app.put('/api/buses/:id', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized - no user ID" });
      }
      
      const user = await storage.getUser(userId);
      
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ message: "Unauthorized - admin required" });
      }

      const { id } = req.params;
      const validatedData = insertBusSchema.parse(req.body);
      const bus = await storage.updateBus(id, validatedData);
      
      if (!bus) {
        return res.status(404).json({ message: "Bus not found" });
      }
      
      res.json(bus);
    } catch (error: any) {
      console.error("Error updating bus:", error);
      if (error?.name === 'ZodError') {
        return res.status(400).json({ message: "Invalid bus data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to update bus" });
    }
  });

  // Driver activates their route (updates bus to on_route status)
  app.post('/api/driver/activate-route', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({ message: "Unauthorized - no user ID" });
      }

      const user = await storage.getUser(userId);
      if (!user || user.role !== 'driver') {
        return res.status(403).json({ message: "Unauthorized - driver access required" });
      }

      // Find the bus assigned to this driver
      const driverBus = await storage.getBusByDriverId(userId);
      if (!driverBus) {
        return res.status(404).json({ message: "No bus assigned to driver" });
      }

      // Update bus status to on_route
      const updatedBus = await storage.updateBus(driverBus.id, {
        status: 'on_route',
        lastUpdated: new Date(),
      });

      if (!updatedBus) {
        return res.status(500).json({ message: "Failed to activate route" });
      }

      console.log(`Driver ${userId} activated route for bus ${driverBus.busNumber}`);
      
      res.json({
        message: "Route activated successfully",
        busId: driverBus.id,
        busNumber: driverBus.busNumber,
        driverId: userId,
        activatedAt: new Date().toISOString(),
        status: 'on_route'
      });
      
    } catch (error) {
      console.error("Error activating route:", error);
      res.status(500).json({ message: "Failed to activate route" });
    }
  });

  // Driver deactivates their route (updates bus to idle status)  
  app.post('/api/driver/deactivate-route', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({ message: "Unauthorized - no user ID" });
      }

      const user = await storage.getUser(userId);
      if (!user || user.role !== 'driver') {
        return res.status(403).json({ message: "Unauthorized - driver access required" });
      }

      // Find the bus assigned to this driver
      const driverBus = await storage.getBusByDriverId(userId);
      if (!driverBus) {
        return res.status(404).json({ message: "No bus assigned to driver" });
      }

      // Update bus status to idle
      const updatedBus = await storage.updateBus(driverBus.id, {
        status: 'idle',
        lastUpdated: new Date(),
      });

      if (!updatedBus) {
        return res.status(500).json({ message: "Failed to deactivate route" });
      }

      console.log(`Driver ${userId} deactivated route for bus ${driverBus.busNumber}`);
      
      res.json({
        message: "Route deactivated successfully",
        busId: driverBus.id,
        busNumber: driverBus.busNumber,
        driverId: userId,
        deactivatedAt: new Date().toISOString(),
        status: 'idle'
      });
      
    } catch (error) {
      console.error("Error deactivating route:", error);
      res.status(500).json({ message: "Failed to deactivate route" });
    }
  });

  // Bus location updates (for GPS simulation)
  app.put('/api/buses/:busId/location', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      const user = await storage.getUser(userId);
      
      // Allow both drivers and admins to update location (admins for testing)
      if (!user || (user.role !== 'driver' && user.role !== 'admin')) {
        return res.status(403).json({ message: "Unauthorized" });
      }

      const { busId } = req.params;
      const { latitude, longitude, speed } = req.body;

      const bus = await storage.updateBusLocation(busId, latitude, longitude, speed);
      res.json(bus);
    } catch (error) {
      console.error("Error updating bus location:", error);
      res.status(500).json({ message: "Failed to update bus location" });
    }
  });

  // Vehicle issues
  app.get('/api/buses/:busId/issues', isAuthenticated, async (req: any, res) => {
    try {
      const { busId } = req.params;
      const issues = await storage.getIssuesByBusId(busId);
      res.json(issues);
    } catch (error) {
      console.error("Error fetching vehicle issues:", error);
      res.status(500).json({ message: "Failed to fetch vehicle issues" });
    }
  });

  app.post('/api/vehicle-issues', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      const user = await storage.getUser(userId);
      
      if (!user || user.role !== 'driver') {
        return res.status(403).json({ message: "Unauthorized" });
      }

      const validatedData = insertVehicleIssueSchema.parse({ ...req.body, driverId: userId });
      const issue = await storage.createVehicleIssue(validatedData);
      res.json(issue);
    } catch (error) {
      console.error("Error creating vehicle issue:", error);
      res.status(500).json({ message: "Failed to create vehicle issue" });
    }
  });

  // Driver tasks
  app.get('/api/driver-tasks', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      const user = await storage.getUser(userId);
      
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      let tasks;
      if (user.role === 'driver') {
        tasks = await storage.getTasksByDriverId(userId);
      } else if (user.role === 'admin') {
        tasks = await storage.getAllActiveTasks();
      } else {
        return res.status(403).json({ message: "Unauthorized" });
      }

      res.json(tasks);
    } catch (error) {
      console.error("Error fetching driver tasks:", error);
      res.status(500).json({ message: "Failed to fetch driver tasks" });
    }
  });

  app.post('/api/driver-tasks', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      const user = await storage.getUser(userId);
      
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ message: "Unauthorized" });
      }

      const validatedData = insertDriverTaskSchema.parse({ ...req.body, assignedById: userId });
      const task = await storage.createDriverTask(validatedData);
      res.json(task);
    } catch (error) {
      console.error("Error creating driver task:", error);
      res.status(500).json({ message: "Failed to create driver task" });
    }
  });

  app.put('/api/driver-tasks/:taskId/complete', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      const user = await storage.getUser(userId);
      
      if (!user || user.role !== 'driver') {
        return res.status(403).json({ message: "Unauthorized" });
      }

      const { taskId } = req.params;
      const { isCompleted } = req.body;

      const task = await storage.updateTaskCompletion(taskId, isCompleted);
      res.json(task);
    } catch (error) {
      console.error("Error updating task completion:", error);
      res.status(500).json({ message: "Failed to update task completion" });
    }
  });

  // Report student absence
  app.post('/api/students/:studentId/absence', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      const user = await storage.getUser(userId);
      
      if (!user || user.role !== 'parent') {
        return res.status(403).json({ message: "Unauthorized" });
      }

      const { studentId } = req.params;
      const { date, notes } = req.body;

      // Verify parent owns this student
      const students = await storage.getStudentsByParentId(userId);
      const student = students.find(s => s.id === studentId);
      
      if (!student) {
        return res.status(403).json({ message: "Unauthorized - not your student" });
      }

      const attendanceDate = new Date(date);
      const attendanceData = {
        studentId,
        routeId: student.routeId!,
        date: attendanceDate,
        isAbsent: true,
        notes: notes || "Parent reported absence"
      };

      const attendance = await storage.createAttendance(attendanceData);
      res.json(attendance);
    } catch (error) {
      console.error("Error reporting absence:", error);
      res.status(500).json({ message: "Failed to report absence" });
    }
  });

  // Driver profile update route
  app.put('/api/driver/profile', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      const user = await storage.getUser(userId);
      
      if (!user || user.role !== 'driver') {
        return res.status(403).json({ message: "Unauthorized - drivers only" });
      }

      const validatedData = updateDriverProfileSchema.parse(req.body);
      
      // Convert date strings to Date objects if they exist
      const processedData = {
        ...validatedData,
        licenseExpiryDate: validatedData.licenseExpiryDate ? new Date(validatedData.licenseExpiryDate) : undefined,
        dateOfBirth: validatedData.dateOfBirth ? new Date(validatedData.dateOfBirth) : undefined,
        hireDate: validatedData.hireDate ? new Date(validatedData.hireDate) : undefined,
      };

      const updatedUser = await storage.updateDriverProfile(userId, processedData);
      res.json(updatedUser);
    } catch (error) {
      console.error("Error updating driver profile:", error);
      res.status(500).json({ message: "Failed to update driver profile" });
    }
  });

  // Driver duty status toggle
  app.patch('/api/driver/duty-status', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      const user = await storage.getUser(userId);
      
      if (!user || user.role !== 'driver') {
        return res.status(403).json({ message: "Unauthorized - drivers only" });
      }

      const { isOnDuty } = req.body;
      
      // If driver is going off duty, create shift report
      if (!isOnDuty && user.isOnDuty && user.dutyStartTime) {
        try {
          const shiftEndTime = new Date();
          const shiftStartTime = user.dutyStartTime;
          const totalDurationMinutes = Math.floor((shiftEndTime.getTime() - shiftStartTime.getTime()) / (1000 * 60));
          
          // Get driver's assigned bus and route data
          const assignedBus = await storage.getBusByDriverId(userId);
          const assignedRoute = user.assignedRouteId ? await storage.getRouteById(user.assignedRouteId) : null;
          
          // Count today's school visits and student attendance
          const schoolVisits = await storage.getTodaysSchoolVisits(userId);
          const studentAttendance = user.assignedRouteId ? await storage.getTodaysStudentAttendance(userId, user.assignedRouteId) : [];
          
          const shiftReport = {
            driverId: userId,
            driverName: `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'Unknown Driver',
            busId: assignedBus?.id || null,
            busNumber: assignedBus?.busNumber || null,
            routeId: user.assignedRouteId || null,
            routeName: assignedRoute?.name || null,
            shiftStartTime,
            shiftEndTime,
            totalDurationMinutes,
            startingFuelLevel: user.lastCheckInFuelLevel || null,
            endingFuelLevel: assignedBus?.fuelLevel || null,
            startingMileage: assignedBus?.mileage || null,
            endingMileage: assignedBus?.mileage || null,
            milesDriven: 0, // Could be calculated if we track mileage changes
            schoolsVisited: schoolVisits.length,
            studentsPickedUp: studentAttendance.filter(a => a.status === 'present').length,
            studentsDroppedOff: studentAttendance.filter(a => a.status === 'present').length,
            issuesReported: 0, // Could be integrated with vehicle issues
            interiorCleanStart: user.lastCheckInInteriorClean,
            exteriorCleanStart: user.lastCheckInExteriorClean,
            notes: `Shift completed. Bus status: ${assignedBus?.status || 'unknown'}`,
          };

          await storage.createDriverShiftReport(shiftReport);
          console.log(`Created shift report for driver ${userId}, duration: ${totalDurationMinutes} minutes`);
        } catch (reportError) {
          console.error("Error creating shift report:", reportError);
          // Continue with duty status update even if report creation fails
        }

        // Complete bus journey tracking (driver returning to homebase)
        try {
          if (assignedBus) {
            const todayJourney = await storage.getTodayBusJourney(assignedBus.id);
            if (todayJourney) {
              await storage.updateJourneyEvent(todayJourney.id, 'arrive_homebase');
              console.log(`Completed journey for bus ${assignedBus.busNumber}`);
            }
          }
        } catch (journeyError) {
          console.error("Error completing journey:", journeyError);
        }

        // Reset everything when driver logs off
        try {
          // Get current bus assignment
          const currentBus = await storage.getBusByDriverId(userId);
          
          // Unassign driver from bus
          if (currentBus) {
            await storage.unassignDriverFromBus(userId);
            console.log(`Unassigned driver ${userId} from bus ${currentBus.busNumber}`);
          }

          // Unassign driver from route
          if (user.assignedRouteId) {
            await storage.unassignDriverFromRoute(userId);
            console.log(`Unassigned driver ${userId} from route ${user.assignedRouteId}`);
          }

          // Clear all check-in data
          const resetData = {
            assignedRouteId: null,
            lastCheckInFuelLevel: null,
            lastCheckInInteriorClean: null,
            lastCheckInExteriorClean: null,
            lastCheckInTime: null,
          };
          await storage.updateDriverProfile(userId, resetData);
          console.log(`Reset check-in data for driver ${userId}`);

        } catch (resetError) {
          console.error("Error resetting driver data on log-off:", resetError);
          // Continue with duty status update even if reset fails
        }
      }
      
      const updatedData = {
        isOnDuty: Boolean(isOnDuty),
        dutyStartTime: isOnDuty ? new Date() : null,
      };

      const updatedUser = await storage.updateDriverProfile(userId, updatedData);
      res.json(updatedUser);
    } catch (error) {
      console.error("Error updating driver duty status:", error);
      res.status(500).json({ message: "Failed to update duty status" });
    }
  });

  // Driver check-in endpoint
  app.post('/api/driver-check-in', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      const user = await storage.getUser(userId);
      
      if (!user || user.role !== 'driver') {
        return res.status(403).json({ message: "Unauthorized - drivers only" });
      }

      const { driverId, fuelLevel, interiorClean, exteriorClean, routeId, busId } = req.body;
      
      // Validate that driverId is provided
      if (!driverId) {
        return res.status(400).json({ message: "Driver selection is required" });
      }
      
      // Verify the selected driver exists and is a driver
      const selectedDriver = await storage.getUser(driverId);
      if (!selectedDriver || selectedDriver.role !== 'driver') {
        return res.status(400).json({ message: "Invalid driver selection" });
      }
      
      // Update the selected driver's profile with check-in data
      const updatedData = {
        isOnDuty: true,
        dutyStartTime: new Date(),
        lastCheckInFuelLevel: fuelLevel,
        lastCheckInInteriorClean: Boolean(interiorClean),
        lastCheckInExteriorClean: Boolean(exteriorClean),
        lastCheckInTime: new Date(),
        assignedRouteId: routeId,
      };

      const updatedDriver = await storage.updateDriverProfile(driverId, updatedData);
      
      // Assign the driver to the selected route (update route's driverId)
      try {
        await storage.assignDriverToRoute(driverId, routeId);
        console.log(`Assigned driver ${driverId} to route ${routeId}`);
      } catch (routeError) {
        console.error("Error assigning driver to route:", routeError);
        // Continue with check-in even if route assignment fails
      }
      
      // Assign the selected bus to the selected driver
      try {
        await storage.assignDriverToBus(driverId, busId);
        console.log(`Assigned driver ${driverId} to bus ${busId}`);
      } catch (busError) {
        console.error("Error assigning bus to driver:", busError);
        // Continue with check-in even if bus assignment fails
      }
      
      // Update the selected bus fuel level
      try {
        await storage.updateBusFuelLevel(busId, fuelLevel);
        console.log(`Updated fuel level for bus ${busId} to ${fuelLevel}`);
      } catch (busError) {
        console.error("Error updating bus fuel level:", busError);
        // Continue with check-in even if bus update fails
      }
      
      // Set the bus's currentRouteId so parent tracking can find it
      try {
        await storage.updateBus(busId, { currentRouteId: routeId, status: 'on_route' });
        console.log(`Set bus ${busId} currentRouteId to ${routeId}`);
      } catch (busError) {
        console.error("Error setting bus currentRouteId:", busError);
      }

      // Start bus journey tracking for admin reports
      try {
        if (user.companyId) {
          const existingJourney = await storage.getTodayBusJourney(busId);
          if (!existingJourney) {
            await storage.createBusJourney(busId, driverId, routeId, user.companyId);
            console.log(`Started journey for bus ${busId} on route ${routeId}`);
          }
        }
      } catch (journeyError) {
        console.error("Error starting journey:", journeyError);
      }
      
      res.json(updatedDriver);
    } catch (error) {
      console.error("Error during driver check-in:", error);
      res.status(500).json({ message: "Failed to complete check-in" });
    }
  });

  // Driver shift reports endpoints
  app.get('/api/driver-shift-reports', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized - no user ID" });
      }
      
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      // Drivers can only see their own reports, admins can see all
      let reports;
      if (user.role === 'admin') {
        reports = await storage.getDriverShiftReports();
      } else if (user.role === 'driver') {
        reports = await storage.getDriverShiftReports(userId);
      } else {
        return res.status(403).json({ message: "Unauthorized - admin or driver access required" });
      }

      res.json(reports);
    } catch (error) {
      console.error("Error fetching driver shift reports:", error);
      res.status(500).json({ message: "Failed to fetch shift reports" });
    }
  });

  app.get('/api/driver-shift-reports/:driverId', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized - no user ID" });
      }
      
      const user = await storage.getUser(userId);
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ message: "Unauthorized - admin access required" });
      }

      const { driverId } = req.params;
      const reports = await storage.getDriverShiftReports(driverId);
      res.json(reports);
    } catch (error) {
      console.error("Error fetching driver shift reports by ID:", error);
      res.status(500).json({ message: "Failed to fetch shift reports" });
    }
  });

  // Get on-duty drivers for admin dashboard
  app.get('/api/on-duty-drivers', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      const user = await storage.getUser(userId);
      
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ message: "Unauthorized - admins only" });
      }

      // Filter by admin's company for multi-tenant isolation
      const onDutyDrivers = await storage.getOnDutyDrivers(user.companyId || undefined);
      res.json(onDutyDrivers);
    } catch (error) {
      console.error("Error fetching on-duty drivers:", error);
      res.status(500).json({ message: "Failed to fetch on-duty drivers" });
    }
  });

  // Student management routes
  app.get('/api/students', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized - no user ID" });
      }

      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      let students;
      if (user.role === 'admin') {
        students = await storage.getAllStudents();
      } else if (user.role === 'parent') {
        students = await storage.getStudentsByParentId(userId);
      } else {
        return res.status(403).json({ message: "Unauthorized access" });
      }

      // Enrich students with school and route info (individually looked up for tenant isolation)
      const enrichedStudents = await Promise.all((students || []).map(async (student: any) => {
        const school = student.schoolId ? await storage.getSchoolById(student.schoolId) : null;
        const route = student.routeId ? await storage.getRouteById(student.routeId) : null;
        return {
          ...student,
          school: school || null,
          route: route || null,
        };
      }));

      res.json(enrichedStudents);
    } catch (error) {
      console.error("Error fetching students:", error);
      res.status(500).json({ message: "Failed to fetch students" });
    }
  });

  app.post('/api/students', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized - no user ID" });
      }

      const user = await storage.getUser(userId);
      if (!user || (user.role !== 'admin' && user.role !== 'parent')) {
        return res.status(403).json({ message: "Unauthorized - admin or parent access required" });
      }

      const validatedData = insertStudentSchema.parse(req.body);
      
      // If parent is creating, ensure they're creating for themselves
      if (user.role === 'parent') {
        validatedData.parentId = userId;
      }

      const student = await storage.createStudent(validatedData);
      console.log("Student created successfully:", student.id);
      
      res.status(201).json(student);
    } catch (error: any) {
      console.error("Error creating student:", error);
      if (error?.name === 'ZodError') {
        return res.status(400).json({ message: "Invalid student data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to create student" });
    }
  });

  app.put('/api/students/:id', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized - no user ID" });
      }

      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      const { id } = req.params;
      
      // For parents, verify they own the student
      if (user.role === 'parent') {
        const student = await storage.getStudentById(id);
        if (!student || student.parentId !== userId) {
          return res.status(403).json({ message: "Unauthorized - can only update your own students" });
        }
      } else if (user.role !== 'admin') {
        return res.status(403).json({ message: "Unauthorized access" });
      }

      const validatedData = insertStudentSchema.partial().parse(req.body);
      const updatedStudent = await storage.updateStudent(id, validatedData);
      
      if (!updatedStudent) {
        return res.status(404).json({ message: "Student not found" });
      }
      
      res.json(updatedStudent);
    } catch (error: any) {
      console.error("Error updating student:", error);
      if (error?.name === 'ZodError') {
        return res.status(400).json({ message: "Invalid student data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to update student" });
    }
  });

  app.delete('/api/students/:id', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized - no user ID" });
      }

      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      const { id } = req.params;
      
      // For parents, verify they are linked to the student
      if (user.role === 'parent') {
        const link = await storage.getParentChildLink(userId, id);
        if (!link) {
          return res.status(403).json({ message: "Unauthorized - can only delete your linked students" });
        }
      } else if (user.role !== 'admin') {
        return res.status(403).json({ message: "Unauthorized - admin access required" });
      }

      const deleted = await storage.deleteStudent(id);
      if (!deleted) {
        return res.status(404).json({ message: "Student not found" });
      }
      
      console.log("Student deleted successfully:", id);
      res.json({ message: "Student deleted successfully" });
    } catch (error) {
      console.error("Error deleting student:", error);
      res.status(500).json({ message: "Failed to delete student" });
    }
  });

  app.get('/api/students/:id', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized - no user ID" });
      }

      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      const { id } = req.params;
      const student = await storage.getStudentById(id);
      
      if (!student) {
        return res.status(404).json({ message: "Student not found" });
      }

      // Check authorization using linking system
      if (user.role === 'parent') {
        const link = await storage.getParentChildLink(userId, id);
        if (!link) {
          return res.status(403).json({ message: "Unauthorized - can only view your linked students" });
        }
      } else if (user.role !== 'admin') {
        return res.status(403).json({ message: "Unauthorized access" });
      }
      
      res.json(student);
    } catch (error) {
      console.error("Error fetching student:", error);
      res.status(500).json({ message: "Failed to fetch student" });
    }
  });

  // Get students by route
  app.get('/api/routes/:routeId/students', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized - no user ID" });
      }

      const user = await storage.getUser(userId);
      if (!user || (user.role !== 'admin' && user.role !== 'driver')) {
        return res.status(403).json({ message: "Unauthorized - admin or driver access required" });
      }

      const { routeId } = req.params;
      const students = await storage.getStudentsByRouteId(routeId);
      
      // Enrich students with school and route info (individually looked up for tenant isolation)
      const enrichedStudents = await Promise.all((students || []).map(async (student: any) => {
        const school = student.schoolId ? await storage.getSchoolById(student.schoolId) : null;
        const route = student.routeId ? await storage.getRouteById(student.routeId) : null;
        return {
          ...student,
          school: school || null,
          route: route || null,
        };
      }));
      
      res.json(enrichedStudents);
    } catch (error) {
      console.error("Error fetching students by route:", error);
      res.status(500).json({ message: "Failed to fetch students by route" });
    }
  });

  // Get stops for a route
  app.get('/api/routes/:routeId/stops', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized - no user ID" });
      }

      const user = await storage.getUser(userId);
      if (!user || (user.role !== 'admin' && user.role !== 'driver')) {
        return res.status(403).json({ message: "Unauthorized - admin or driver access required" });
      }

      const { routeId } = req.params;
      const stops = await storage.getStopsByRouteId(routeId);
      
      res.json(stops);
    } catch (error) {
      console.error("Error fetching stops by route:", error);
      res.status(500).json({ message: "Failed to fetch stops by route" });
    }
  });

  // Route-school relationship endpoints
  // Reorder schools in a route
  app.put('/api/routes/:routeId/schools/reorder', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      const user = await storage.getUser(userId);
      
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ message: "Unauthorized" });
      }

      const { routeId } = req.params;
      const { schoolId, direction } = req.body; // direction: 'up' or 'down'
      
      const result = await storage.reorderRouteSchool(routeId, schoolId, direction);
      res.json(result);
    } catch (error) {
      console.error("Error reordering route schools:", error);
      res.status(500).json({ message: "Failed to reorder schools" });
    }
  });

  app.get('/api/routes/:routeId/schools', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized - no user ID" });
      }

      const user = await storage.getUser(userId);
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ message: "Unauthorized - admin access required" });
      }

      const { routeId } = req.params;
      const schools = await storage.getSchoolsByRouteId(routeId);
      
      res.json(schools);
    } catch (error) {
      console.error("Error fetching schools by route:", error);
      res.status(500).json({ message: "Failed to fetch schools by route" });
    }
  });

  app.post('/api/routes/:routeId/schools/:schoolId', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized - no user ID" });
      }

      const user = await storage.getUser(userId);
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ message: "Unauthorized - admin access required" });
      }

      const { routeId, schoolId } = req.params;
      
      // Add school to route
      const routeSchool = await storage.addSchoolToRoute(routeId, schoolId);
      
      // Get the school details to create a stop for it
      const school = await storage.getSchoolById(schoolId);
      if (school) {
        // Check if there's already a stop for this school on this route
        const existingStops = await storage.getStopsByRouteId(routeId);
        const schoolStopExists = existingStops.some(stop => stop.schoolId === schoolId);
        
        if (!schoolStopExists) {
          // Create a stop for the school
          const nextOrder = existingStops.length + 1;
          await storage.createRouteStop({
            routeId: routeId,
            schoolId: schoolId,
            name: `${school.name} Stop`,
            address: school.address,
            order: nextOrder,
            scheduledTime: '', // Can be set later
          });
        }
      }
      
      res.status(201).json(routeSchool);
    } catch (error: any) {
      console.error("Error adding school to route:", error);
      if (error?.code === '23505') { // Unique constraint violation
        return res.status(409).json({ message: "School already assigned to this route" });
      }
      res.status(500).json({ message: "Failed to add school to route" });
    }
  });

  app.delete('/api/routes/:routeId/schools/:schoolId', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized - no user ID" });
      }

      const user = await storage.getUser(userId);
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ message: "Unauthorized - admin access required" });
      }

      const { routeId, schoolId } = req.params;
      
      // Remove school from route
      const deleted = await storage.removeSchoolFromRoute(routeId, schoolId);
      
      if (!deleted) {
        return res.status(404).json({ message: "School not found on this route" });
      }
      
      // Also remove any stops associated with this school on this route
      await storage.removeStopsBySchoolFromRoute(routeId, schoolId);
      
      res.json({ message: "School and associated stops removed from route successfully" });
    } catch (error) {
      console.error("Error removing school from route:", error);
      res.status(500).json({ message: "Failed to remove school from route" });
    }
  });

  // School visit tracking endpoints for driver arrivals/departures
  app.get('/api/driver-school-visits', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized - no user ID" });
      }
      
      const user = await storage.getUser(userId);
      if (!user || user.role !== 'driver') {
        return res.status(403).json({ message: "Unauthorized - driver required" });
      }

      const routeId = user.assignedRouteId;
      if (!routeId) {
        return res.json([]);
      }

      const visits = await storage.getTodaysSchoolVisits(userId);
      res.json(visits);
    } catch (error) {
      console.error("Error fetching school visits:", error);
      res.status(500).json({ message: "Failed to fetch school visits" });
    }
  });

  app.post('/api/driver-school-arrival', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized - no user ID" });
      }
      
      const user = await storage.getUser(userId);
      if (!user || user.role !== 'driver') {
        return res.status(403).json({ message: "Unauthorized - driver required" });
      }

      const { schoolId } = req.body;
      const routeId = user.assignedRouteId;
      
      if (!routeId) {
        return res.status(400).json({ message: "No route assigned to driver" });
      }

      if (!schoolId) {
        return res.status(400).json({ message: "School ID is required" });
      }

      const visit = await storage.recordSchoolArrival(userId, schoolId, routeId);
      res.json(visit);
    } catch (error) {
      console.error("Error recording school arrival:", error);
      res.status(500).json({ message: "Failed to record school arrival" });
    }
  });

  app.post('/api/driver-school-departure', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized - no user ID" });
      }
      
      const user = await storage.getUser(userId);
      if (!user || user.role !== 'driver') {
        return res.status(403).json({ message: "Unauthorized - driver required" });
      }

      const { visitId } = req.body;
      
      if (!visitId) {
        return res.status(400).json({ message: "Visit ID is required" });
      }

      const visit = await storage.recordSchoolDeparture(visitId);
      if (!visit) {
        return res.status(404).json({ message: "Visit not found" });
      }

      res.json(visit);
    } catch (error) {
      console.error("Error recording school departure:", error);
      res.status(500).json({ message: "Failed to record school departure" });
    }
  });

  // Student attendance endpoints
  app.get('/api/student-attendance', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized - no user ID" });
      }
      
      const user = await storage.getUser(userId);
      if (!user || (user.role !== 'driver' && user.role !== 'admin')) {
        return res.status(403).json({ message: "Unauthorized - driver or admin required" });
      }

      if (user.role === 'driver') {
        const routeId = user.assignedRouteId;
        if (!routeId) {
          return res.json([]);
        }
        const attendance = await storage.getTodaysStudentAttendance(userId, routeId);
        res.json(attendance);
      } else {
        // Admin can see all attendance data
        const attendance = await storage.getAllAttendanceData();
        res.json(attendance);
      }
    } catch (error) {
      console.error("Error fetching student attendance:", error);
      res.status(500).json({ message: "Failed to fetch student attendance" });
    }
  });

  app.post('/api/student-attendance', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized - no user ID" });
      }
      
      const user = await storage.getUser(userId);
      if (!user || user.role !== 'driver') {
        return res.status(403).json({ message: "Unauthorized - driver required" });
      }

      const { studentId, status } = req.body;
      const routeId = user.assignedRouteId;
      
      if (!routeId) {
        return res.status(400).json({ message: "No route assigned to driver" });
      }

      if (!studentId || !status) {
        return res.status(400).json({ message: "Student ID and status are required" });
      }

      if (!['present', 'absent'].includes(status)) {
        return res.status(400).json({ message: "Status must be 'present' or 'absent'" });
      }

      const attendance = await storage.markStudentAttendance(userId, studentId, routeId, status);
      res.json(attendance);
    } catch (error) {
      console.error("Error marking student attendance:", error);
      res.status(500).json({ message: "Failed to mark student attendance" });
    }
  });

  app.get('/api/attendance/route/:routeId', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized - no user ID" });
      }
      
      const user = await storage.getUser(userId);
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ message: "Unauthorized - admin required" });
      }

      const { routeId } = req.params;
      const { date } = req.query;
      
      const targetDate = date ? new Date(date as string) : new Date();
      const attendance = await storage.getAttendanceByRoute(routeId, targetDate);
      res.json(attendance);
    } catch (error) {
      console.error("Error fetching route attendance:", error);
      res.status(500).json({ message: "Failed to fetch route attendance" });
    }
  });

  // Parent Notifications API
  
  // Get all notifications (admin)
  app.get('/api/notifications', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized - no user ID" });
      }
      
      const user = await storage.getUser(userId);
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ message: "Unauthorized - admin required" });
      }

      const notifications = await storage.getAllNotifications();
      res.json(notifications);
    } catch (error) {
      console.error("Error fetching notifications:", error);
      res.status(500).json({ message: "Failed to fetch notifications" });
    }
  });

  // Get notifications for a specific parent
  app.get('/api/parent-notifications', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized - no user ID" });
      }
      
      const user = await storage.getUser(userId);
      if (!user || user.role !== 'parent') {
        return res.status(403).json({ message: "Unauthorized - parent required" });
      }

      const notifications = await storage.getNotificationsForParent(userId);
      res.json(notifications);
    } catch (error) {
      console.error("Error fetching parent notifications:", error);
      res.status(500).json({ message: "Failed to fetch notifications" });
    }
  });

  // Get unread count for parent
  app.get('/api/parent-notifications/unread-count', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized - no user ID" });
      }
      
      const user = await storage.getUser(userId);
      if (!user || user.role !== 'parent') {
        return res.status(403).json({ message: "Unauthorized - parent required" });
      }

      const unreadCount = await storage.getUnreadCountForParent(userId);
      res.json({ unreadCount });
    } catch (error) {
      console.error("Error fetching unread count:", error);
      res.status(500).json({ message: "Failed to fetch unread count" });
    }
  });

  // Get bus tracking data for parent's children
  app.get('/api/parent/children-buses', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized - no user ID" });
      }
      
      const user = await storage.getUser(userId);
      if (!user || user.role !== 'parent') {
        return res.status(403).json({ message: "Unauthorized - parent required" });
      }

      // Get all children for this parent (both direct and linked via link codes)
      const directChildren = await storage.getStudentsByParentId(userId);
      const linkedChildren = await storage.getLinkedStudentsByParentId(userId);
      
      // Combine and deduplicate children
      const childrenMap = new Map();
      for (const child of directChildren) {
        childrenMap.set(child.id, child);
      }
      for (const child of linkedChildren) {
        childrenMap.set(child.id, child);
      }
      const children = Array.from(childrenMap.values());
      
      // For each child, get their route and bus info
      const childrenWithBuses = await Promise.all(children.map(async (child) => {
        let bus = null;
        let route = null;
        let stop = null;
        
        if (child.routeId) {
          route = await storage.getRouteById(child.routeId);
          bus = await storage.getBusByRouteId(child.routeId);
        }
        
        if (child.stopId) {
          stop = await storage.getRouteStopById(child.stopId);
        }
        
        return {
          student: {
            id: child.id,
            firstName: child.firstName,
            lastName: child.lastName,
            grade: child.grade,
          },
          bus: bus ? {
            id: bus.id,
            busNumber: bus.busNumber,
            status: bus.status,
            latitude: bus.currentLatitude,
            longitude: bus.currentLongitude,
            speed: bus.speed,
            lastUpdated: bus.lastUpdated,
          } : null,
          route: route ? {
            id: route.id,
            name: route.name,
          } : null,
          stop: stop ? {
            id: stop.id,
            name: stop.name,
            estimatedTime: stop.scheduledTime,
          } : null,
        };
      }));

      res.json(childrenWithBuses);
    } catch (error) {
      console.error("Error fetching children buses:", error);
      res.status(500).json({ message: "Failed to fetch children buses" });
    }
  });

  // Create notification (admin only)
  app.post('/api/notifications', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized - no user ID" });
      }
      
      const user = await storage.getUser(userId);
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ message: "Unauthorized - admin required" });
      }

      const { type, title, message, routeId, busId, isGlobal, estimatedDelay, expiresAt } = req.body;
      
      if (!title || !message || !type) {
        return res.status(400).json({ message: "Title, message, and type are required" });
      }

      // If no specific route is selected (routeId is null, empty, or "all"), mark as global
      const effectiveRouteId = routeId && routeId !== "all" ? routeId : null;
      const shouldBeGlobal = isGlobal || !effectiveRouteId;

      const notification = await storage.createParentNotification({
        type,
        title,
        message,
        routeId: effectiveRouteId,
        busId: busId || null,
        createdById: userId,
        companyId: user.companyId,
        isGlobal: shouldBeGlobal,
        estimatedDelay: estimatedDelay || null,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
      });
      
      res.json(notification);
    } catch (error) {
      console.error("Error creating notification:", error);
      res.status(500).json({ message: "Failed to create notification" });
    }
  });

  // Mark notification as read
  app.post('/api/notifications/:id/read', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized - no user ID" });
      }
      
      const user = await storage.getUser(userId);
      if (!user || user.role !== 'parent') {
        return res.status(403).json({ message: "Unauthorized - parent required" });
      }

      const { id } = req.params;
      const read = await storage.markNotificationRead(id, userId);
      res.json(read);
    } catch (error) {
      console.error("Error marking notification as read:", error);
      res.status(500).json({ message: "Failed to mark notification as read" });
    }
  });

  // Mark all notifications as read for parent
  app.post('/api/notifications/mark-all-read', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized - no user ID" });
      }
      
      const user = await storage.getUser(userId);
      if (!user || user.role !== 'parent') {
        return res.status(403).json({ message: "Unauthorized - parent required" });
      }

      await storage.markAllNotificationsRead(userId);
      res.json({ success: true });
    } catch (error) {
      console.error("Error marking all notifications as read:", error);
      res.status(500).json({ message: "Failed to mark all notifications as read" });
    }
  });

  // Delete notification (admin only)
  app.delete('/api/notifications/:id', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized - no user ID" });
      }
      
      const user = await storage.getUser(userId);
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ message: "Unauthorized - admin required" });
      }

      const { id } = req.params;
      const deleted = await storage.deleteNotification(id);
      
      if (!deleted) {
        return res.status(404).json({ message: "Notification not found" });
      }
      
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting notification:", error);
      res.status(500).json({ message: "Failed to delete notification" });
    }
  });

  // ============================================
  // SYSTEM NOTIFICATIONS (Multi-role)
  // ============================================

  // Admin: Send system notification to parents/drivers
  app.post('/api/system-notifications', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized - no user ID" });
      }
      
      const user = await storage.getUser(userId);
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ message: "Unauthorized - admin required" });
      }

      const { title, message, recipientRole, recipientId, routeId, type = 'info' } = req.body;

      if (!title || !message || !recipientRole) {
        return res.status(400).json({ message: "Title, message, and recipientRole are required" });
      }

      const notification = await storage.createSystemNotification({
        companyId: user.companyId,
        senderId: userId,
        senderRole: 'admin',
        recipientRole,
        recipientId: recipientId || null,
        routeId: routeId || null,
        title,
        message,
        type,
      });

      res.json(notification);
    } catch (error) {
      console.error("Error creating system notification:", error);
      res.status(500).json({ message: "Failed to create system notification" });
    }
  });

  // Driver: Send notification to route parents
  app.post('/api/driver/system-notifications', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized - no user ID" });
      }
      
      const user = await storage.getUser(userId);
      if (!user || user.role !== 'driver') {
        return res.status(403).json({ message: "Unauthorized - driver required" });
      }

      const { title, message, routeId, type = 'info' } = req.body;

      if (!title || !message) {
        return res.status(400).json({ message: "Title and message are required" });
      }

      // Drivers can only send to route_parents
      const notification = await storage.createSystemNotification({
        companyId: user.companyId,
        senderId: userId,
        senderRole: 'driver',
        recipientRole: 'route_parents',
        recipientId: null,
        routeId: routeId || user.assignedRouteId || null,
        title,
        message,
        type,
      });

      res.json(notification);
    } catch (error) {
      console.error("Error creating driver notification:", error);
      res.status(500).json({ message: "Failed to create notification" });
    }
  });

  // Get system notifications for current user (role-based)
  app.get('/api/system-notifications', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized - no user ID" });
      }
      
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      let notifications: any[] = [];
      const companyId = user.companyId || '';

      if (user.role === 'admin') {
        notifications = await storage.getSystemNotificationsForAdmin(companyId);
      } else if (user.role === 'driver') {
        notifications = await storage.getSystemNotificationsForDriver(userId, companyId);
      } else if (user.role === 'parent') {
        notifications = await storage.getSystemNotificationsForParent(userId, companyId);
      }

      res.json(notifications);
    } catch (error) {
      console.error("Error fetching system notifications:", error);
      res.status(500).json({ message: "Failed to fetch system notifications" });
    }
  });

  // Mark system notification as read
  app.patch('/api/system-notifications/:id/read', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized - no user ID" });
      }

      const { id } = req.params;
      const updated = await storage.markSystemNotificationAsRead(id);

      if (!updated) {
        return res.status(404).json({ message: "Notification not found" });
      }

      res.json(updated);
    } catch (error) {
      console.error("Error marking notification as read:", error);
      res.status(500).json({ message: "Failed to mark notification as read" });
    }
  });

  // Get unread system notification count for current user
  app.get('/api/system-notifications/unread-count', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized - no user ID" });
      }
      
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      let count = 0;
      const companyId = user.companyId || '';

      if (user.role === 'admin') {
        count = await storage.getUnreadNotificationCountForAdmin(companyId);
      } else if (user.role === 'driver') {
        count = await storage.getUnreadNotificationCountForDriver(userId, companyId);
      } else if (user.role === 'parent') {
        count = await storage.getUnreadNotificationCountForParent(userId, companyId);
      }

      res.json({ count });
    } catch (error) {
      console.error("Error fetching unread count:", error);
      res.status(500).json({ message: "Failed to fetch unread count" });
    }
  });

  // ============================================
  // PARENT-CHILD LINKING SYSTEM ROUTES
  // ============================================

  // Admin: Generate a link code for a student
  app.post('/api/link-codes', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized - no user ID" });
      }

      const user = await storage.getUser(userId);
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ message: "Unauthorized - admin required" });
      }

      // Check if parent portal is enabled (link codes are only useful with parent portal)
      if (user.companyId) {
        const company = await storage.getCompanyById(user.companyId);
        if (!company?.parentPortalEnabled) {
          return res.status(403).json({ message: "Link codes require the Parent Portal feature. Upgrade to Professional or Enterprise." });
        }
      }

      const { studentId, maxUses = 2, expiresInDays = 7 } = req.body;

      if (!studentId) {
        return res.status(400).json({ message: "Student ID is required" });
      }

      const student = await storage.getStudentById(studentId);
      if (!student) {
        return res.status(404).json({ message: "Student not found" });
      }

      const linkCode = await storage.generateLinkCode(
        studentId, 
        userId, 
        maxUses, 
        expiresInDays,
        user.companyId || undefined
      );

      res.json(linkCode);
    } catch (error) {
      console.error("Error generating link code:", error);
      res.status(500).json({ message: "Failed to generate link code" });
    }
  });

  // Admin: Get link codes for a student
  app.get('/api/students/:studentId/link-codes', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized - no user ID" });
      }

      const user = await storage.getUser(userId);
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ message: "Unauthorized - admin required" });
      }

      const { studentId } = req.params;
      const linkCodes = await storage.getLinkCodesByStudentId(studentId);

      res.json(linkCodes);
    } catch (error) {
      console.error("Error fetching link codes:", error);
      res.status(500).json({ message: "Failed to fetch link codes" });
    }
  });

  // Admin: Revoke a link code
  app.delete('/api/link-codes/:id', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized - no user ID" });
      }

      const user = await storage.getUser(userId);
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ message: "Unauthorized - admin required" });
      }

      const { id } = req.params;
      const revoked = await storage.revokeLinkCode(id);

      if (!revoked) {
        return res.status(404).json({ message: "Link code not found" });
      }

      res.json(revoked);
    } catch (error) {
      console.error("Error revoking link code:", error);
      res.status(500).json({ message: "Failed to revoke link code" });
    }
  });

  // Admin: Regenerate link code for a student (revokes old and creates new)
  app.post('/api/students/:studentId/regenerate-code', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized - no user ID" });
      }

      const user = await storage.getUser(userId);
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ message: "Unauthorized - admin required" });
      }

      const { studentId } = req.params;
      const student = await storage.getStudentById(studentId);
      if (!student) {
        return res.status(404).json({ message: "Student not found" });
      }

      const linkCode = await storage.regenerateLinkCode(studentId, userId);
      res.json(linkCode);
    } catch (error) {
      console.error("Error regenerating link code:", error);
      res.status(500).json({ message: "Failed to regenerate link code" });
    }
  });

  // Admin: Get linked parents for a student
  app.get('/api/students/:studentId/linked-parents', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized - no user ID" });
      }

      const user = await storage.getUser(userId);
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ message: "Unauthorized - admin required" });
      }

      const { studentId } = req.params;
      const parents = await storage.getLinkedParentsByStudentId(studentId);

      res.json(parents);
    } catch (error) {
      console.error("Error fetching linked parents:", error);
      res.status(500).json({ message: "Failed to fetch linked parents" });
    }
  });

  // Admin: Unlink a parent from a student
  app.delete('/api/students/:studentId/parents/:parentId', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized - no user ID" });
      }

      const user = await storage.getUser(userId);
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ message: "Unauthorized - admin required" });
      }

      const { studentId, parentId } = req.params;
      const unlinked = await storage.unlinkParentFromStudent(parentId, studentId);

      if (!unlinked) {
        return res.status(404).json({ message: "Link not found" });
      }

      res.json({ success: true, message: "Parent unlinked successfully" });
    } catch (error) {
      console.error("Error unlinking parent:", error);
      res.status(500).json({ message: "Failed to unlink parent" });
    }
  });

  // Parent: Use a link code to link to a child
  app.post('/api/link-child', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized - no user ID" });
      }

      const user = await storage.getUser(userId);
      if (!user || user.role !== 'parent') {
        return res.status(403).json({ message: "Unauthorized - parent role required" });
      }

      // Check if parent portal is enabled - must have company and portal enabled
      if (!user.companyId) {
        return res.status(403).json({ message: "Parent accounts must be linked to a company." });
      }
      const company = await storage.getCompanyById(user.companyId);
      if (!company?.parentPortalEnabled) {
        return res.status(403).json({ message: "Parent portal is not available on your plan." });
      }

      const { code } = req.body;
      if (!code) {
        return res.status(400).json({ message: "Link code is required" });
      }

      const result = await storage.useLinkCode(code.toUpperCase().trim(), userId);

      if (!result.success) {
        return res.status(400).json({ message: result.error });
      }

      const student = await storage.getStudentById(result.link!.studentId);
      res.json({ 
        success: true, 
        message: "Successfully linked to child",
        student
      });
    } catch (error) {
      console.error("Error linking child:", error);
      res.status(500).json({ message: "Failed to link child" });
    }
  });

  // Parent: Get linked children
  app.get('/api/my-children', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized - no user ID" });
      }

      const user = await storage.getUser(userId);
      if (!user || user.role !== 'parent') {
        return res.status(403).json({ message: "Unauthorized - parent role required" });
      }

      const linkedStudents = await storage.getLinkedStudentsByParentId(userId);
      res.json(linkedStudents);
    } catch (error) {
      console.error("Error fetching linked children:", error);
      res.status(500).json({ message: "Failed to fetch linked children" });
    }
  });

  // ============ DIRECT MESSAGING ROUTES ============

  // Get list of available contacts for messaging
  app.get('/api/messages/contacts', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      if (user.role !== 'parent' && user.role !== 'driver') {
        return res.status(403).json({ message: "Only parents and drivers can access messaging" });
      }

      // Check if parent portal is enabled for parent users
      let effectiveCompanyId = user.companyId;
      if (user.role === 'parent') {
        // If parent has no companyId, try to infer from linked children
        if (!effectiveCompanyId) {
          const linkedStudents = await storage.getLinkedStudentsByParentId(userId);
          if (linkedStudents.length > 0 && linkedStudents[0].companyId) {
            effectiveCompanyId = linkedStudents[0].companyId;
          }
        }
        if (!effectiveCompanyId) {
          return res.status(403).json({ message: "Please link a child to your account first to access messaging." });
        }
        const company = await storage.getCompanyById(effectiveCompanyId);
        if (!company?.parentPortalEnabled) {
          return res.status(403).json({ message: "Parent portal is not available on your plan. Upgrade to Professional or Enterprise." });
        }
      }

      let contacts: { id: string; name: string; role: string }[] = [];

      if (user.role === 'parent') {
        const drivers = await storage.getDriversForParent(userId, effectiveCompanyId || undefined);
        contacts = drivers.map(d => ({
          id: d.id,
          name: `${d.firstName || ''} ${d.lastName || ''}`.trim() || d.email || 'Driver',
          role: 'driver'
        }));
      } else if (user.role === 'driver') {
        const parents = await storage.getParentsForDriver(userId, user.companyId || undefined);
        contacts = parents.map(p => ({
          id: p.id,
          name: `${p.firstName || ''} ${p.lastName || ''}`.trim() || p.email || 'Parent',
          role: 'parent'
        }));
      }

      res.json(contacts);
    } catch (error) {
      console.error("Error fetching contacts:", error);
      res.status(500).json({ message: "Failed to fetch contacts" });
    }
  });

  // Get all conversations for current user
  app.get('/api/messages/conversations', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      if (user.role !== 'parent' && user.role !== 'driver') {
        return res.status(403).json({ message: "Only parents and drivers can access messaging" });
      }

      // Infer company from linked children for parents without direct companyId
      let effectiveCompanyId = user.companyId;
      if (user.role === 'parent' && !effectiveCompanyId) {
        const linkedStudents = await storage.getLinkedStudentsByParentId(userId);
        if (linkedStudents.length > 0 && linkedStudents[0].companyId) {
          effectiveCompanyId = linkedStudents[0].companyId;
        }
      }

      const conversations = await storage.getConversationsForUser(userId, effectiveCompanyId || undefined);
      res.json(conversations);
    } catch (error) {
      console.error("Error fetching conversations:", error);
      res.status(500).json({ message: "Failed to fetch conversations" });
    }
  });

  // Get conversation with a specific user
  app.get('/api/messages/conversation/:recipientId', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      if (user.role !== 'parent' && user.role !== 'driver') {
        return res.status(403).json({ message: "Only parents and drivers can access messaging" });
      }

      // Infer company from linked children for parents without direct companyId
      let effectiveCompanyId = user.companyId;
      if (user.role === 'parent' && !effectiveCompanyId) {
        const linkedStudents = await storage.getLinkedStudentsByParentId(userId);
        if (linkedStudents.length > 0 && linkedStudents[0].companyId) {
          effectiveCompanyId = linkedStudents[0].companyId;
        }
      }

      const { recipientId } = req.params;
      const { studentId } = req.query;

      const messages = await storage.getConversation(userId, recipientId, studentId as string, effectiveCompanyId || undefined);
      
      // Mark messages as read
      await storage.markConversationAsRead(userId, recipientId, effectiveCompanyId || undefined);

      res.json(messages);
    } catch (error) {
      console.error("Error fetching conversation:", error);
      res.status(500).json({ message: "Failed to fetch conversation" });
    }
  });

  // Send a new message
  app.post('/api/messages', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      if (user.role !== 'parent' && user.role !== 'driver') {
        return res.status(403).json({ message: "Only parents and drivers can send messages" });
      }

      // Infer company from linked children for parents without direct companyId
      let effectiveCompanyId = user.companyId;
      if (user.role === 'parent' && !effectiveCompanyId) {
        const linkedStudents = await storage.getLinkedStudentsByParentId(userId);
        if (linkedStudents.length > 0 && linkedStudents[0].companyId) {
          effectiveCompanyId = linkedStudents[0].companyId;
        }
      }

      const { recipientId, content, studentId } = req.body;

      if (!recipientId || !content) {
        return res.status(400).json({ message: "Recipient and content are required" });
      }

      // Verify recipient is in the same company
      const recipient = await storage.getUser(recipientId);
      if (!recipient) {
        return res.status(404).json({ message: "Recipient not found" });
      }
      
      // Infer recipient's effective company if they're a parent without direct companyId
      let recipientEffectiveCompanyId = recipient.companyId;
      if (recipient.role === 'parent' && !recipientEffectiveCompanyId) {
        const recipientLinkedStudents = await storage.getLinkedStudentsByParentId(recipientId);
        if (recipientLinkedStudents.length > 0 && recipientLinkedStudents[0].companyId) {
          recipientEffectiveCompanyId = recipientLinkedStudents[0].companyId;
        }
      }
      
      if (recipientEffectiveCompanyId !== effectiveCompanyId) {
        return res.status(403).json({ message: "Cannot message users outside your organization" });
      }

      const message = await storage.sendDirectMessage({
        senderId: userId,
        recipientId,
        content,
        studentId: studentId || null,
        companyId: effectiveCompanyId,
      });

      res.json(message);
    } catch (error) {
      console.error("Error sending message:", error);
      res.status(500).json({ message: "Failed to send message" });
    }
  });

  // Get unread message count
  app.get('/api/messages/unread-count', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      // Infer company from linked children for parents without direct companyId
      let effectiveCompanyId = user.companyId;
      if (user.role === 'parent' && !effectiveCompanyId) {
        const linkedStudents = await storage.getLinkedStudentsByParentId(userId);
        if (linkedStudents.length > 0 && linkedStudents[0].companyId) {
          effectiveCompanyId = linkedStudents[0].companyId;
        }
      }

      const count = await storage.getUnreadMessageCount(userId, effectiveCompanyId || undefined);
      res.json({ count });
    } catch (error) {
      console.error("Error fetching unread count:", error);
      res.status(500).json({ message: "Failed to fetch unread count" });
    }
  });

  // Mark a specific message as read
  app.patch('/api/messages/:messageId/read', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const { messageId } = req.params;
      const updated = await storage.markMessageAsRead(messageId);

      if (!updated) {
        return res.status(404).json({ message: "Message not found" });
      }

      res.json(updated);
    } catch (error) {
      console.error("Error marking message as read:", error);
      res.status(500).json({ message: "Failed to mark message as read" });
    }
  });

  // ============ DRIVER LOCATION UPDATE ROUTES ============

  // Driver updates their bus location (GPS coordinates)
  app.post('/api/driver/update-location', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const user = await storage.getUser(userId);
      if (!user || user.role !== 'driver') {
        return res.status(403).json({ message: "Only drivers can update location" });
      }

      const { latitude, longitude, speed } = req.body;
      if (!latitude || !longitude) {
        return res.status(400).json({ message: "Latitude and longitude are required" });
      }

      // Find the bus assigned to this driver
      const buses = await storage.getAllBuses();
      const driverBus = buses.find(bus => bus.driverId === userId);
      
      if (!driverBus) {
        return res.status(400).json({ message: "No bus assigned to you. Please check in first." });
      }

      // Update the bus location
      const updatedBus = await storage.updateBusLocation(
        driverBus.id,
        latitude.toString(),
        longitude.toString(),
        speed ? speed.toString() : undefined
      );

      if (!updatedBus) {
        return res.status(500).json({ message: "Failed to update location" });
      }

      // Also update bus status to on_route if not already
      if (updatedBus.status !== 'on_route' && updatedBus.status !== 'emergency' && updatedBus.status !== 'maintenance') {
        await storage.updateBusStatus(driverBus.id, 'on_route');
      }

      res.json({ success: true, bus: updatedBus });
    } catch (error) {
      console.error("Error updating driver location:", error);
      res.status(500).json({ message: "Failed to update location" });
    }
  });

  // Get current driver's assigned bus with location
  app.get('/api/driver/my-bus', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const user = await storage.getUser(userId);
      if (!user || user.role !== 'driver') {
        return res.status(403).json({ message: "Only drivers can access this" });
      }

      // Find the bus assigned to this driver
      const buses = await storage.getAllBuses();
      const driverBus = buses.find(bus => bus.driverId === userId);
      
      res.json(driverBus || null);
    } catch (error) {
      console.error("Error fetching driver's bus:", error);
      res.status(500).json({ message: "Failed to fetch bus" });
    }
  });

  // ============ ROUTE STOP COMPLETION ROUTES ============

  // Driver marks a stop as completed (arrived)
  app.post('/api/driver/mark-stop-completed', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const user = await storage.getUser(userId);
      if (!user || user.role !== 'driver') {
        return res.status(403).json({ message: "Only drivers can mark stops" });
      }

      const { routeStopId, routeId, stopSequence } = req.body;
      if (!routeStopId || !routeId) {
        return res.status(400).json({ message: "Route stop ID and route ID are required" });
      }

      // Find the bus assigned to this driver
      const buses = await storage.getAllBuses();
      const driverBus = buses.find(bus => bus.driverId === userId);
      
      if (!driverBus) {
        return res.status(400).json({ message: "No bus assigned. Please check in first." });
      }

      const companyId = user.companyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company assigned" });
      }

      // Mark the stop as completed
      const completion = await storage.markStopCompleted({
        routeStopId,
        routeId,
        driverId: userId,
        busId: driverBus.id,
        companyId,
        stopSequence: stopSequence || 0
      });

      // Get the stop details to find students at this stop
      const routeStop = await storage.getRouteStopById(routeStopId);
      
      // Find students at this stop and notify their parents
      if (routeStop) {
        const students = await storage.getStudentsByStopId(routeStopId);
        for (const student of students) {
          // Get linked parents
          const parents = await storage.getLinkedParentsByStudentId(student.id);
          for (const parent of parents) {
            // Create notification for parent
            await storage.createSystemNotification({
              companyId,
              senderId: userId,
              senderRole: 'driver',
              recipientRole: 'parent',
              recipientId: parent.id,
              title: 'Bus Arrived at Stop',
              message: `The bus has arrived at ${routeStop.address || 'the stop'} for ${student.firstName}`,
              type: 'info',
            });
          }
        }
      }

      res.json({ success: true, completion });
    } catch (error) {
      console.error("Error marking stop as completed:", error);
      res.status(500).json({ message: "Failed to mark stop" });
    }
  });

  // Get today's completed stops for a route
  app.get('/api/routes/:routeId/completed-stops', isAuthenticated, async (req: any, res) => {
    try {
      const { routeId } = req.params;
      const completedStops = await storage.getTodayCompletedStops(routeId);
      res.json(completedStops);
    } catch (error) {
      console.error("Error fetching completed stops:", error);
      res.status(500).json({ message: "Failed to fetch completed stops" });
    }
  });

  // Get stop progress for parent's child (how many stops away)
  app.get('/api/parent/stop-progress/:studentId', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const user = await storage.getUser(userId);
      if (!user || user.role !== 'parent') {
        return res.status(403).json({ message: "Only parents can access this" });
      }

      const { studentId } = req.params;
      
      // Verify parent has access to this student
      const linkedStudents = await storage.getLinkedStudentsByParentId(userId);
      const student = linkedStudents.find(s => s.id === studentId);
      if (!student) {
        return res.status(403).json({ message: "You don't have access to this student" });
      }

      // Get student's route
      if (!student.routeId) {
        return res.json({ hasRoute: false, message: "Student not assigned to a route" });
      }

      // Get all route stops
      const routeStops = await storage.getStopsByRouteId(student.routeId);
      
      // Find the student's stop
      const studentStop = routeStops.find((stop: any) => stop.id === student.stopId);
      if (!studentStop) {
        return res.json({ hasRoute: true, hasStop: false, message: "Student not assigned to a stop" });
      }

      // Get completed stops today
      const completedStops = await storage.getTodayCompletedStops(student.routeId);
      const lastCompleted = await storage.getLastCompletedStop(student.routeId);

      // Find student's stop sequence
      const studentStopIndex = routeStops.findIndex((s: any) => s.id === student.stopId);
      const lastCompletedIndex = lastCompleted 
        ? routeStops.findIndex((s: any) => s.id === lastCompleted.routeStopId)
        : -1;

      // Check if bus has arrived at this stop
      const hasArrived = completedStops.some(cs => cs.routeStopId === student.stopId);
      
      // Calculate stops away
      const stopsAway = hasArrived ? 0 : Math.max(0, studentStopIndex - lastCompletedIndex - 1);

      res.json({
        hasRoute: true,
        hasStop: true,
        studentStopId: student.stopId,
        studentStopAddress: studentStop.address,
        studentStopSequence: studentStopIndex + 1,
        totalStops: routeStops.length,
        completedStopsCount: completedStops.length,
        stopsAway,
        hasArrived,
        lastCompletedStopId: lastCompleted?.routeStopId,
      });
    } catch (error) {
      console.error("Error fetching stop progress:", error);
      res.status(500).json({ message: "Failed to fetch stop progress" });
    }
  });

  // Reset route stops (called when driver starts a new run)
  app.post('/api/driver/reset-route-stops', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const user = await storage.getUser(userId);
      if (!user || user.role !== 'driver') {
        return res.status(403).json({ message: "Only drivers can reset stops" });
      }

      const { routeId } = req.body;
      if (!routeId) {
        return res.status(400).json({ message: "Route ID is required" });
      }

      await storage.resetRouteStops(routeId);
      res.json({ success: true, message: "Route stops reset" });
    } catch (error) {
      console.error("Error resetting route stops:", error);
      res.status(500).json({ message: "Failed to reset stops" });
    }
  });

  // ============ BLUETOOTH CHECK-IN ROUTES ============

  // Parent enables check-in for a student (broadcasts student ID)
  app.post('/api/check-in/enable', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const user = await storage.getUser(userId);
      if (!user || user.role !== 'parent') {
        return res.status(403).json({ message: "Only parents can enable check-in" });
      }

      const { studentId, deviceId } = req.body;
      if (!studentId || !deviceId) {
        return res.status(400).json({ message: "Student ID and device ID are required" });
      }

      // Verify parent has access to this student
      const linkedStudents = await storage.getLinkedStudentsByParentId(userId);
      const hasAccess = linkedStudents.some(s => s.id === studentId);
      if (!hasAccess) {
        return res.status(403).json({ message: "You don't have access to this student" });
      }

      const effectiveCompanyId = linkedStudents[0]?.companyId || user.companyId;
      const checkIn = await storage.enableStudentCheckIn(studentId, userId, deviceId, effectiveCompanyId || undefined);
      res.json(checkIn);
    } catch (error) {
      console.error("Error enabling check-in:", error);
      res.status(500).json({ message: "Failed to enable check-in" });
    }
  });

  // Parent disables/resets check-in for a student
  app.post('/api/check-in/disable', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const user = await storage.getUser(userId);
      if (!user || user.role !== 'parent') {
        return res.status(403).json({ message: "Only parents can disable check-in" });
      }

      const { studentId } = req.body;
      if (!studentId) {
        return res.status(400).json({ message: "Student ID is required" });
      }

      // Verify parent has access to this student
      const linkedStudents = await storage.getLinkedStudentsByParentId(userId);
      const hasAccess = linkedStudents.some(s => s.id === studentId);
      if (!hasAccess) {
        return res.status(403).json({ message: "You don't have access to this student" });
      }

      await storage.disableStudentCheckIn(studentId);
      res.json({ success: true, message: "Check-in disabled" });
    } catch (error) {
      console.error("Error disabling check-in:", error);
      res.status(500).json({ message: "Failed to disable check-in" });
    }
  });

  // Get check-in status for parent's children
  app.get('/api/check-in/status', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const user = await storage.getUser(userId);
      if (!user || user.role !== 'parent') {
        return res.status(403).json({ message: "Only parents can view check-in status" });
      }

      try {
        // Get all children for this parent (both direct and linked via link codes)
        const directChildren = await storage.getStudentsByParentId(userId);
        const linkedChildren = await storage.getLinkedStudentsByParentId(userId);
        
        // Combine and deduplicate children
        const childrenMap = new Map();
        for (const child of directChildren) {
          childrenMap.set(child.id, child);
        }
        for (const child of linkedChildren) {
          childrenMap.set(child.id, child);
        }
        const allChildrenIds = Array.from(childrenMap.keys());
        
        // Get check-ins for all children (by studentId, not just parentId)
        const allCheckIns = await storage.getTodayCheckInsForStudents(allChildrenIds);
        
        res.json(allCheckIns);
        return;
      } catch {
        // If no check-ins or error, return empty array
        res.json([]);
        return;
      }
    } catch (error) {
      console.error("Error fetching check-in status:", error);
      res.status(500).json({ message: "Failed to fetch check-in status" });
    }
  });

  // Parent endpoint to get driver-marked attendance for their children
  app.get('/api/parent/children-attendance', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const user = await storage.getUser(userId);
      if (!user || user.role !== 'parent') {
        return res.status(403).json({ message: "Only parents can view attendance" });
      }

      // Get all children for this parent (both direct and linked via link codes)
      const directChildren = await storage.getStudentsByParentId(userId);
      const linkedChildren = await storage.getLinkedStudentsByParentId(userId);
      
      // Combine and deduplicate children
      const childrenMap = new Map();
      for (const child of directChildren) {
        childrenMap.set(child.id, child);
      }
      for (const child of linkedChildren) {
        childrenMap.set(child.id, child);
      }
      const allChildrenIds = Array.from(childrenMap.keys());
      
      // Get driver-marked attendance for all children
      const attendance = await storage.getTodaysAttendanceForStudents(allChildrenIds);
      
      res.json(attendance);
    } catch (error) {
      console.error("Error fetching children attendance:", error);
      res.status(500).json({ message: "Failed to fetch attendance" });
    }
  });

  // Parent sets check-in status for their child
  app.post('/api/parent/set-check-in', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const user = await storage.getUser(userId);
      if (!user || user.role !== 'parent') {
        return res.status(403).json({ message: "Only parents can set check-in status" });
      }

      const { studentId, status } = req.body;
      if (!studentId || !status) {
        return res.status(400).json({ message: "Student ID and status are required" });
      }

      if (!['riding', 'not_riding'].includes(status)) {
        return res.status(400).json({ message: "Invalid status. Must be 'riding' or 'not_riding'" });
      }

      // Verify parent has access to this student
      const directChildren = await storage.getStudentsByParentId(userId);
      const linkedChildren = await storage.getLinkedStudentsByParentId(userId);
      const allChildren = [...directChildren, ...linkedChildren];
      const hasAccess = allChildren.some(child => child.id === studentId);
      
      if (!hasAccess) {
        return res.status(403).json({ message: "You don't have access to this student" });
      }

      const student = allChildren.find(c => c.id === studentId);
      const effectiveCompanyId = student?.companyId || user.companyId;

      if (status === 'riding') {
        // Create or update check-in to 'waiting' status
        const checkIn = await storage.enableStudentCheckIn(
          studentId, 
          userId, 
          'parent-web', 
          effectiveCompanyId || undefined
        );
        res.json({ success: true, checkIn, message: "Student marked as riding today" });
      } else {
        // Mark as not riding - disable any existing check-in
        await storage.disableStudentCheckIn(studentId);
        res.json({ success: true, message: "Student marked as not riding today" });
      }
    } catch (error) {
      console.error("Error setting parent check-in:", error);
      res.status(500).json({ message: "Failed to set check-in status" });
    }
  });

  // Driver confirms student boarded (via Bluetooth detection)
  app.post('/api/check-in/confirm-boarded', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const user = await storage.getUser(userId);
      if (!user || user.role !== 'driver') {
        return res.status(403).json({ message: "Only drivers can confirm boarding" });
      }

      const { checkInId, busId, routeId } = req.body;
      if (!checkInId || !busId || !routeId) {
        return res.status(400).json({ message: "Check-in ID, bus ID, and route ID are required" });
      }

      // Verify driver is assigned to this route
      const driverRoutes = await storage.getRoutesByDriverId(userId);
      const isAssignedToRoute = driverRoutes.some(r => r.id === routeId);
      if (!isAssignedToRoute) {
        return res.status(403).json({ message: "You are not assigned to this route" });
      }

      // Verify bus belongs to same company
      const bus = await storage.getBusById(busId);
      if (!bus || (user.companyId && bus.companyId !== user.companyId)) {
        return res.status(403).json({ message: "Invalid bus for this operation" });
      }

      // Verify the check-in exists and belongs to driver's route/company
      const existingCheckIn = await storage.getCheckInById(checkInId);
      if (!existingCheckIn) {
        return res.status(404).json({ message: "Check-in not found" });
      }

      // Verify check-in is for a student on driver's route
      if (existingCheckIn.routeId && existingCheckIn.routeId !== routeId) {
        return res.status(403).json({ message: "This student is not on your route" });
      }

      // Verify check-in belongs to same company
      if (existingCheckIn.companyId && user.companyId && existingCheckIn.companyId !== user.companyId) {
        return res.status(403).json({ message: "Unauthorized access to this check-in" });
      }

      // Verify check-in is in waiting status
      if (existingCheckIn.status !== 'waiting') {
        return res.status(400).json({ message: "Student is not waiting to be checked in" });
      }

      const checkIn = await storage.confirmStudentBoarded(checkInId, userId, busId, routeId);
      if (!checkIn) {
        return res.status(404).json({ message: "Check-in not found" });
      }

      // Create notification for parent
      const student = await storage.getStudentById(checkIn.studentId);
      if (student) {
        await storage.createParentNotification({
          companyId: checkIn.companyId,
          title: "Child Boarded Bus",
          message: `${student.firstName} ${student.lastName} has boarded the bus safely.`,
          type: "info",
          targetParentId: checkIn.parentId,
          createdById: userId,
        });
      }

      res.json(checkIn);
    } catch (error) {
      console.error("Error confirming boarding:", error);
      res.status(500).json({ message: "Failed to confirm boarding" });
    }
  });

  // Driver confirms student dropped off
  app.post('/api/check-in/confirm-dropoff', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const user = await storage.getUser(userId);
      if (!user || user.role !== 'driver') {
        return res.status(403).json({ message: "Only drivers can confirm drop-off" });
      }

      const { checkInId } = req.body;
      if (!checkInId) {
        return res.status(400).json({ message: "Check-in ID is required" });
      }

      // Verify the check-in belongs to a route the driver is assigned to
      const existingCheckIn = await storage.getCheckInById(checkInId);
      if (!existingCheckIn) {
        return res.status(404).json({ message: "Check-in not found" });
      }

      if (existingCheckIn.driverId !== userId) {
        return res.status(403).json({ message: "You did not confirm this student's boarding" });
      }

      const checkIn = await storage.confirmStudentDroppedOff(checkInId);
      if (!checkIn) {
        return res.status(404).json({ message: "Check-in not found" });
      }

      // Create notification for parent
      const student = await storage.getStudentById(checkIn.studentId);
      if (student) {
        await storage.createParentNotification({
          companyId: checkIn.companyId,
          title: "Child Arrived Safely",
          message: `${student.firstName} ${student.lastName} has been dropped off safely.`,
          type: "info",
          targetParentId: checkIn.parentId,
          createdById: userId,
        });
      }

      res.json(checkIn);
    } catch (error) {
      console.error("Error confirming drop-off:", error);
      res.status(500).json({ message: "Failed to confirm drop-off" });
    }
  });

  // Get waiting check-ins for driver's route
  app.get('/api/check-in/waiting/:routeId', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const user = await storage.getUser(userId);
      if (!user || user.role !== 'driver') {
        return res.status(403).json({ message: "Only drivers can view waiting check-ins" });
      }

      const { routeId } = req.params;
      const checkIns = await storage.getActiveCheckInsForRoute(routeId);
      
      // Get student details for each check-in
      const checkInsWithStudents = await Promise.all(
        checkIns.map(async (checkIn) => {
          const student = await storage.getStudentById(checkIn.studentId);
          return { ...checkIn, student };
        })
      );

      res.json(checkInsWithStudents);
    } catch (error) {
      console.error("Error fetching waiting check-ins:", error);
      res.status(500).json({ message: "Failed to fetch waiting check-ins" });
    }
  });

  // ============ MASTER ADMIN ROUTES ============

  // Middleware to check if user is master admin
  const isMasterAdmin = async (req: any, res: any, next: any) => {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ message: "Unauthorized - no user ID" });
    }
    const user = await storage.getUser(userId);
    if (!user || user.role !== 'master_admin') {
      return res.status(403).json({ message: "Forbidden - master admin access required" });
    }
    req.masterAdmin = user;
    next();
  };

  // Get all companies (for master admin dashboard)
  app.get('/api/master-admin/companies', isAuthenticated, isMasterAdmin, async (req: any, res) => {
    try {
      const companies = await storage.getAllCompanies();
      res.json(companies);
    } catch (error) {
      console.error("Error fetching companies:", error);
      res.status(500).json({ message: "Failed to fetch companies" });
    }
  });

  // Get companies by status
  app.get('/api/master-admin/companies/status/:status', isAuthenticated, isMasterAdmin, async (req: any, res) => {
    try {
      const { status } = req.params;
      const companies = await storage.getCompaniesByStatus(status);
      res.json(companies);
    } catch (error) {
      console.error("Error fetching companies by status:", error);
      res.status(500).json({ message: "Failed to fetch companies" });
    }
  });

  // Approve a company
  app.post('/api/master-admin/companies/:id/approve', isAuthenticated, isMasterAdmin, async (req: any, res) => {
    try {
      const { id } = req.params;
      const masterAdmin = req.masterAdmin;

      const company = await storage.approveCompany(id, masterAdmin.id);
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }

      res.json({ success: true, company });
    } catch (error) {
      console.error("Error approving company:", error);
      res.status(500).json({ message: "Failed to approve company" });
    }
  });

  // Suspend a company
  app.post('/api/master-admin/companies/:id/suspend', isAuthenticated, isMasterAdmin, async (req: any, res) => {
    try {
      const { id } = req.params;
      const { reason } = req.body;
      const masterAdmin = req.masterAdmin;

      const company = await storage.suspendCompany(id, masterAdmin.id, reason);
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }

      res.json({ success: true, company });
    } catch (error) {
      console.error("Error suspending company:", error);
      res.status(500).json({ message: "Failed to suspend company" });
    }
  });

  // Reject a company
  app.post('/api/master-admin/companies/:id/reject', isAuthenticated, isMasterAdmin, async (req: any, res) => {
    try {
      const { id } = req.params;

      const company = await storage.rejectCompany(id);
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }

      res.json({ success: true, company });
    } catch (error) {
      console.error("Error rejecting company:", error);
      res.status(500).json({ message: "Failed to reject company" });
    }
  });

  // Get a single company details
  app.get('/api/master-admin/companies/:id', isAuthenticated, isMasterAdmin, async (req: any, res) => {
    try {
      const { id } = req.params;
      const company = await storage.getCompanyById(id);
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }
      res.json(company);
    } catch (error) {
      console.error("Error fetching company:", error);
      res.status(500).json({ message: "Failed to fetch company" });
    }
  });

  // ============ COMPANY FEATURES/PLAN API ============

  // Get company plan features (for feature gating in frontend)
  app.get('/api/company/features', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const user = await storage.getUser(userId);
      if (!user || !user.companyId) {
        return res.status(404).json({ message: "Company not found" });
      }

      const company = await storage.getCompanyById(user.companyId);
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }

      // Return plan features
      res.json({
        planType: company.planType || 'starter',
        parentPortalEnabled: company.parentPortalEnabled ?? false,
        gpsEnabled: company.gpsEnabled ?? false,
        staffUserLimit: company.staffUserLimit,
        parentUserLimit: company.parentUserLimit,
      });
    } catch (error) {
      console.error("Error fetching company features:", error);
      res.status(500).json({ message: "Failed to fetch company features" });
    }
  });

  // Get current user counts for the company
  app.get('/api/company/user-counts', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const user = await storage.getUser(userId);
      if (!user || !user.companyId) {
        return res.status(404).json({ message: "Company not found" });
      }

      const [staffCount, parentCount] = await Promise.all([
        storage.getStaffUserCount(user.companyId),
        storage.getParentUserCount(user.companyId),
      ]);

      const company = await storage.getCompanyById(user.companyId);

      res.json({
        staffCount,
        parentCount,
        staffLimit: company?.staffUserLimit,
        parentLimit: company?.parentUserLimit,
      });
    } catch (error) {
      console.error("Error fetching user counts:", error);
      res.status(500).json({ message: "Failed to fetch user counts" });
    }
  });

  // ============ BUSINESS ONBOARDING ROUTES ============

  // Register a new business (signup)
  app.post('/api/business/register', async (req, res) => {
    try {
      const { companyName, companySlug, email, password, firstName, lastName, phone } = req.body;

      // Validate required fields
      if (!companyName || !companySlug || !email || !password) {
        return res.status(400).json({ message: "Company name, slug, email, and password are required" });
      }

      // Check if company slug already exists
      const existingCompany = await storage.getCompanyBySlug(companySlug);
      if (existingCompany) {
        return res.status(400).json({ message: "Company slug already in use" });
      }

      // Check if email already exists
      const existingUser = await storage.getUserByEmail(email);
      if (existingUser) {
        return res.status(400).json({ message: "Email already registered" });
      }

      // Create company with pending status (plan will be selected later)
      const bcrypt = await import('bcryptjs');
      const companyId = crypto.randomUUID();
      const company = await storage.createCompany({
        id: companyId,
        name: companyName,
        slug: companySlug,
        contactEmail: email,
        contactPhone: phone || null,
        status: 'pending_approval',
        billingStatus: 'none',
        isActive: false,
      });

      // Create admin user for this company
      const passwordHash = await bcrypt.hash(password, 10);
      const user = await storage.createUserWithPassword({
        email,
        firstName: firstName || null,
        lastName: lastName || null,
        role: 'admin',
        companyId: company.id,
      }, passwordHash);

      // Send email notification to master admin
      const { sendNewBusinessSignupNotification } = await import('./emailService');
      const contactName = `${firstName || ''} ${lastName || ''}`.trim() || 'Not provided';
      sendNewBusinessSignupNotification(companyName, email, contactName, 'pending_selection', phone).catch(err => {
        console.error('Failed to send signup notification email:', err);
      });

      res.status(201).json({
        success: true,
        company,
        user: { id: user.id, email: user.email, role: user.role },
      });
    } catch (error) {
      console.error("Error registering business:", error);
      res.status(500).json({ message: "Failed to register business" });
    }
  });

  // Create Stripe checkout session for business subscription
  app.post('/api/business/create-checkout-session', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const user = await storage.getUser(userId);
      if (!user || user.role !== 'admin' || !user.companyId) {
        return res.status(403).json({ message: "Only company admins can create checkout sessions" });
      }

      const company = await storage.getCompanyById(user.companyId);
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }

      const { priceId, successUrl, cancelUrl } = req.body;
      if (!priceId) {
        return res.status(400).json({ message: "Price ID is required" });
      }

      const { getUncachableStripeClient } = await import('./stripeClient');
      const stripe = await getUncachableStripeClient();

      // Create or get Stripe customer
      let customerId = company.stripeCustomerId;
      if (!customerId) {
        const customer = await stripe.customers.create({
          email: company.contactEmail || user.email || undefined,
          name: company.name,
          metadata: {
            companyId: company.id,
          },
        });
        customerId = customer.id;

        // Save customer ID to company
        await storage.updateCompany(company.id, { stripeCustomerId: customerId });
      }

      // Create checkout session with 30-day free trial
      const baseUrl = `https://${process.env.REPLIT_DOMAINS?.split(',')[0]}`;
      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        mode: 'subscription',
        payment_method_types: ['card'],
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: successUrl || `${baseUrl}/onboarding/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: cancelUrl || `${baseUrl}/onboarding/plans`,
        subscription_data: {
          trial_period_days: 30,
        },
        metadata: {
          companyId: company.id,
        },
      });

      res.json({ url: session.url, sessionId: session.id });
    } catch (error) {
      console.error("Error creating checkout session:", error);
      res.status(500).json({ message: "Failed to create checkout session" });
    }
  });

  // Get Stripe publishable key
  app.get('/api/stripe/publishable-key', async (req, res) => {
    try {
      const { getStripePublishableKey } = await import('./stripeClient');
      const publishableKey = await getStripePublishableKey();
      res.json({ publishableKey });
    } catch (error) {
      console.error("Error getting Stripe publishable key:", error);
      res.status(500).json({ message: "Failed to get Stripe publishable key" });
    }
  });

  // Get available subscription plans (prices from Stripe)
  app.get('/api/subscription-plans', async (req, res) => {
    try {
      const { getUncachableStripeClient } = await import('./stripeClient');
      const stripe = await getUncachableStripeClient();

      const prices = await stripe.prices.list({
        active: true,
        type: 'recurring',
        expand: ['data.product'],
      });

      const plans = prices.data
        .filter((price: any) => price.product && typeof price.product === 'object' && price.product.active)
        .map((price: any) => ({
          id: price.id,
          productId: price.product.id,
          name: price.product.name,
          description: price.product.description,
          amount: price.unit_amount,
          currency: price.currency,
          interval: price.recurring?.interval,
          intervalCount: price.recurring?.interval_count,
          features: price.product.metadata?.features?.split(',') || [],
        }));

      res.json(plans);
    } catch (error) {
      console.error("Error fetching subscription plans:", error);
      res.status(500).json({ message: "Failed to fetch subscription plans" });
    }
  });

  // Get company status for onboarding flow
  app.get('/api/business/status', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const user = await storage.getUser(userId);
      if (!user || !user.companyId) {
        return res.status(404).json({ message: "No company associated with user" });
      }

      const company = await storage.getCompanyById(user.companyId);
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }

      res.json({
        status: company.status,
        billingStatus: company.billingStatus,
        isActive: company.isActive,
        hasPayment: !!company.stripeSubscriptionId,
      });
    } catch (error) {
      console.error("Error fetching business status:", error);
      res.status(500).json({ message: "Failed to fetch business status" });
    }
  });

  // ============================================
  // BUS JOURNEY TRACKING ENDPOINTS
  // ============================================

  // Driver starts a journey (called when driver checks in)
  app.post('/api/journey/start', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const user = await storage.getUser(userId);
      if (!user || user.role !== 'driver') {
        return res.status(403).json({ message: "Only drivers can start journeys" });
      }

      if (!user.companyId) {
        return res.status(400).json({ message: "Driver must be associated with a company" });
      }

      const { busId, routeId, homebaseAddress } = req.body;
      if (!busId || !routeId) {
        return res.status(400).json({ message: "Bus ID and route ID are required" });
      }

      // Verify bus belongs to driver's company
      const bus = await storage.getBusById(busId);
      if (!bus || bus.companyId !== user.companyId) {
        return res.status(403).json({ message: "Bus not found or not in your company" });
      }

      // Check if there's already a journey for this bus today
      const existingJourney = await storage.getTodayBusJourney(busId);
      if (existingJourney) {
        return res.json({ journey: existingJourney, message: "Journey already started today" });
      }

      const journey = await storage.createBusJourney(
        busId, 
        userId, 
        routeId, 
        user.companyId, 
        homebaseAddress
      );

      res.json({ journey, message: "Journey started" });
    } catch (error) {
      console.error("Error starting journey:", error);
      res.status(500).json({ message: "Failed to start journey" });
    }
  });

  // Driver updates journey event (arrive/depart school, arrive homebase)
  app.post('/api/journey/event', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const user = await storage.getUser(userId);
      if (!user || user.role !== 'driver') {
        return res.status(403).json({ message: "Only drivers can update journey events" });
      }

      const { busId, eventType, schoolId } = req.body;
      if (!busId || !eventType) {
        return res.status(400).json({ message: "Bus ID and event type are required" });
      }

      const validEvents = ['depart_homebase', 'arrive_school', 'depart_school', 'arrive_homebase'];
      if (!validEvents.includes(eventType)) {
        return res.status(400).json({ message: "Invalid event type" });
      }

      const journey = await storage.getTodayBusJourney(busId);
      if (!journey) {
        return res.status(404).json({ message: "No active journey found for this bus today" });
      }

      const updated = await storage.updateJourneyEvent(journey.id, eventType, schoolId);
      res.json({ journey: updated, message: `Journey event '${eventType}' recorded` });
    } catch (error) {
      console.error("Error updating journey event:", error);
      res.status(500).json({ message: "Failed to update journey event" });
    }
  });

  // Get today's journey for a bus
  app.get('/api/journey/today/:busId', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const { busId } = req.params;
      const journey = await storage.getTodayBusJourney(busId);
      res.json(journey || null);
    } catch (error) {
      console.error("Error fetching today's journey:", error);
      res.status(500).json({ message: "Failed to fetch journey" });
    }
  });

  // Admin: Get journey reports for date range
  app.get('/api/reports/journeys', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const user = await storage.getUser(userId);
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ message: "Only admins can view journey reports" });
      }

      if (!user.companyId) {
        return res.status(400).json({ message: "Company ID not found" });
      }

      const { startDate, endDate } = req.query;
      const start = startDate ? new Date(startDate as string) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const end = endDate ? new Date(endDate as string) : new Date();

      const journeys = await storage.getBusJourneysForDateRange(user.companyId, start, end);

      // Fetch bus and driver details for each journey (with company scoping)
      const enrichedJourneys = await Promise.all(
        journeys.map(async (journey) => {
          // Only include related entities that belong to the same company
          const bus = journey.busId ? await storage.getBusById(journey.busId) : null;
          const driver = journey.driverId ? await storage.getUser(journey.driverId) : null;
          const school = journey.schoolId ? await storage.getSchoolById(journey.schoolId) : null;
          const route = journey.routeId ? await storage.getRouteById(journey.routeId) : null;

          // Verify entities belong to the admin's company (tenant isolation)
          const validBus = bus && bus.companyId === user.companyId ? bus : null;
          const validDriver = driver && driver.companyId === user.companyId ? driver : null;
          const validSchool = school && school.companyId === user.companyId ? school : null;
          const validRoute = route && route.companyId === user.companyId ? route : null;

          return {
            ...journey,
            bus: validBus ? { id: validBus.id, busNumber: validBus.busNumber } : null,
            driver: validDriver ? { id: validDriver.id, firstName: validDriver.firstName, lastName: validDriver.lastName } : null,
            school: validSchool ? { id: validSchool.id, name: validSchool.name } : null,
            route: validRoute ? { id: validRoute.id, name: validRoute.name } : null,
          };
        })
      );

      res.json(enrichedJourneys);
    } catch (error) {
      console.error("Error fetching journey reports:", error);
      res.status(500).json({ message: "Failed to fetch journey reports" });
    }
  });

  // Admin: Get journey history for a specific bus
  app.get('/api/reports/journeys/bus/:busId', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const user = await storage.getUser(userId);
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ message: "Only admins can view journey reports" });
      }

      const { busId } = req.params;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 30;

      const journeys = await storage.getBusJourneysByBus(busId, limit);
      res.json(journeys);
    } catch (error) {
      console.error("Error fetching bus journey history:", error);
      res.status(500).json({ message: "Failed to fetch bus journey history" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
