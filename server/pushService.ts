import jwt from "jsonwebtoken";
import https from "https";
import { storage } from "./storage";

// APNs Configuration - set these in Railway environment variables:
// APNS_KEY_ID        - Your Apple Key ID (10 characters)
// APNS_TEAM_ID       - Your Apple Developer Team ID
// APNS_PRIVATE_KEY   - Contents of your .p8 key file
// APNS_BUNDLE_ID     - Your app bundle ID (e.g., com.yourcompany.SchoolBusTracker)

interface APNsPayload {
  title: string;
  body: string;
  badge?: number;
  sound?: string;
  data?: Record<string, unknown>;
  category?: string;
}

class PushService {
  private apnsToken: string | null = null;
  private tokenExpiry = 0;

  private get isConfigured(): boolean {
    return !!(
      process.env.APNS_KEY_ID &&
      process.env.APNS_TEAM_ID &&
      process.env.APNS_PRIVATE_KEY &&
      process.env.APNS_BUNDLE_ID
    );
  }

  private get apnsHost(): string {
    return process.env.NODE_ENV === "production"
      ? "api.push.apple.com"
      : "api.sandbox.push.apple.com";
  }

  // Generate JWT for APNs authentication
  private getAPNsToken(): string {
    const now = Math.floor(Date.now() / 1000);

    // Reuse token if not expired (tokens valid for 1 hour, refresh at 50 min)
    if (this.apnsToken && now < this.tokenExpiry) {
      return this.apnsToken;
    }

    const privateKey = process.env.APNS_PRIVATE_KEY!.replace(/\\n/g, "\n");

    this.apnsToken = jwt.sign({}, privateKey, {
      algorithm: "ES256",
      keyid: process.env.APNS_KEY_ID!,
      issuer: process.env.APNS_TEAM_ID!,
      expiresIn: "1h",
      header: {
        alg: "ES256",
        kid: process.env.APNS_KEY_ID!,
      },
    });

    this.tokenExpiry = now + 3000; // Refresh after 50 minutes
    return this.apnsToken;
  }

  // Send a push notification to a single APNs device token
  private async sendToAPNs(
    deviceToken: string,
    payload: APNsPayload
  ): Promise<boolean> {
    if (!this.isConfigured) {
      console.log("APNs not configured, skipping push notification");
      return false;
    }

    const apnsPayload = {
      aps: {
        alert: {
          title: payload.title,
          body: payload.body,
        },
        badge: payload.badge ?? 1,
        sound: payload.sound ?? "default",
        "mutable-content": 1,
        category: payload.category,
      },
      ...payload.data,
    };

    const body = JSON.stringify(apnsPayload);
    const token = this.getAPNsToken();

    return new Promise((resolve) => {
      const options: https.RequestOptions = {
        hostname: this.apnsHost,
        port: 443,
        path: `/3/device/${deviceToken}`,
        method: "POST",
        headers: {
          authorization: `bearer ${token}`,
          "apns-topic": process.env.APNS_BUNDLE_ID!,
          "apns-push-type": "alert",
          "apns-priority": "10",
          "apns-expiration": "0",
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
        },
      };

      const req = https.request(options, (res) => {
        let responseBody = "";
        res.on("data", (chunk) => (responseBody += chunk));
        res.on("end", () => {
          if (res.statusCode === 200) {
            resolve(true);
          } else {
            console.error(
              `APNs error (${res.statusCode}):`,
              responseBody,
              "Token:",
              deviceToken.substring(0, 10) + "..."
            );
            // Remove invalid tokens
            if (res.statusCode === 410 || res.statusCode === 400) {
              storage.removeDeviceToken(deviceToken).catch(() => {});
            }
            resolve(false);
          }
        });
      });

      req.on("error", (err) => {
        console.error("APNs request error:", err.message);
        resolve(false);
      });

      req.write(body);
      req.end();
    });
  }

  // Send push notification to a specific user (all their devices)
  async sendToUser(userId: string, payload: APNsPayload): Promise<void> {
    const tokens = await storage.getDeviceTokensForUser(userId);
    const iosTokens = tokens.filter((t) => t.platform === "ios");

    await Promise.allSettled(
      iosTokens.map((t) => this.sendToAPNs(t.token, payload))
    );
  }

  // Send push notification to multiple users
  async sendToUsers(userIds: string[], payload: APNsPayload): Promise<void> {
    if (userIds.length === 0) return;

    const tokens = await storage.getDeviceTokensForUsers(userIds);
    const iosTokens = tokens.filter((t) => t.platform === "ios");

    await Promise.allSettled(
      iosTokens.map((t) => this.sendToAPNs(t.token, payload))
    );
  }

  // Convenience: Send notification when admin creates a parent notification
  async notifyParentsOfAlert(
    companyId: string,
    title: string,
    message: string,
    type: string
  ): Promise<void> {
    try {
      // Get all parents in this company
      const companyUsers = await storage.getUsersByCompanyId(companyId);
      const parentIds = companyUsers
        .filter((u) => u.role === "parent")
        .map((u) => u.id);

      let category = "ALERT";
      if (type === "emergency") category = "EMERGENCY";
      if (type === "delay") category = "DELAY";

      await this.sendToUsers(parentIds, {
        title,
        body: message,
        sound: type === "emergency" ? "critical" : "default",
        category,
        data: { type, companyId },
      });
    } catch (err) {
      console.error("Error sending push to parents:", err);
    }
  }

  // Convenience: Send message notification
  async notifyNewMessage(
    recipientId: string,
    senderName: string,
    preview: string
  ): Promise<void> {
    await this.sendToUser(recipientId, {
      title: `Message from ${senderName}`,
      body: preview.length > 100 ? preview.substring(0, 100) + "..." : preview,
      category: "MESSAGE",
      data: { type: "message", senderId: recipientId },
    });
  }
}

export const pushService = new PushService();
