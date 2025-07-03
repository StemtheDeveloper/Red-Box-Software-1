/**
 * Custom Document Signing System - Firebase Functions
 * Replaces DocuSeal with self-hosted document signing solution
 */

// Load environment variables
require("dotenv").config();

const { onCall, onRequest } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const admin = require("firebase-admin");
const logger = require("firebase-functions/logger");

// Import custom document signing functions
const customDocumentSigning = require("./custom-document-signing");

// Initialize Firebase Admin
admin.initializeApp();

/**
 * Admin configuration
 */
const ADMIN_EMAILS = [
  "stiaan44@gmail.com", // Primary admin
];

/**
 * Enhanced authentication middleware
 * @param {Object} request - Firebase function request object
 * @param {boolean} requireAdmin - Whether admin access is required
 * @returns {Object} User info object
 */
function verifyAuthentication(request, requireAdmin = false) {
  if (!request.auth) {
    throw new Error("Authentication required");
  }

  const userInfo = {
    uid: request.auth.uid,
    email: request.auth.token.email,
    name: request.auth.token.name,
    isAdmin: ADMIN_EMAILS.includes(request.auth.token.email),
  };

  if (requireAdmin && !userInfo.isAdmin) {
    throw new Error("Admin access required");
  }

  logger.info("User authenticated", {
    userId: userInfo.uid,
    email: userInfo.email,
    isAdmin: userInfo.isAdmin,
    requireAdmin: requireAdmin,
  });

  return userInfo;
}

/**
 * Rate limiting helper
 */
const rateLimitMap = new Map();

function checkRateLimit(userId, functionName, maxCalls = 10, windowMs = 60000) {
  const key = `${userId}_${functionName}`;
  const now = Date.now();

  if (!rateLimitMap.has(key)) {
    rateLimitMap.set(key, { count: 1, resetTime: now + windowMs });
    return true;
  }

  const rateData = rateLimitMap.get(key);

  if (now > rateData.resetTime) {
    rateLimitMap.set(key, { count: 1, resetTime: now + windowMs });
    return true;
  }

  if (rateData.count >= maxCalls) {
    throw new Error(
      `Rate limit exceeded. Maximum ${maxCalls} calls per minute.`
    );
  }

  rateData.count++;
  return true;
}

/**
 * Add security headers to responses
 */
function addSecurityHeaders(res) {
  res.set({
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "X-XSS-Protection": "1; mode=block",
    "Referrer-Policy": "strict-origin-when-cross-origin",
  });
}

/**
 * Health check endpoint
 */
exports.healthCheck = onRequest(
  {
    region: "us-central1",
  },
  async (req, res) => {
    addSecurityHeaders(res);
    res.status(200).json({
      status: "healthy",
      timestamp: new Date().toISOString(),
      version: "2.0.0",
      system: "custom-document-signing",
    });
  }
);

/**
 * System monitoring and alerts
 */
exports.monitoringAndAlerts = onSchedule(
  {
    schedule: "0 */6 * * *", // Every 6 hours
    region: "us-central1",
    timeZone: "UTC",
  },
  async (event) => {
    try {
      logger.info("Starting system monitoring check");

      // Check pending documents older than 7 days
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const pendingDocuments = await admin
        .firestore()
        .collection("documents")
        .where("status", "==", "pending")
        .where("createdAt", "<", sevenDaysAgo)
        .limit(100)
        .get();

      if (!pendingDocuments.empty) {
        logger.warn("Found old pending documents", {
          count: pendingDocuments.size,
          documents: pendingDocuments.docs.map((doc) => ({
            id: doc.id,
            title: doc.data().title,
            createdAt: doc.data().createdAt,
            createdBy: doc.data().createdByEmail,
          })),
        });
      }

      // Check for failed email logs in the last 24 hours
      const oneDayAgo = new Date();
      oneDayAgo.setDate(oneDayAgo.getDate() - 1);

      const failedEmails = await admin
        .firestore()
        .collection("email_logs")
        .where("status", "==", "failed")
        .where("sentAt", ">", oneDayAgo)
        .limit(50)
        .get();

      if (!failedEmails.empty) {
        logger.error("Found failed email deliveries", {
          count: failedEmails.size,
          failures: failedEmails.docs.map((doc) => ({
            id: doc.id,
            to: doc.data().to,
            error: doc.data().error,
            sentAt: doc.data().sentAt,
          })),
        });
      }

      logger.info("System monitoring check completed", {
        pendingDocuments: pendingDocuments.size,
        failedEmails: failedEmails.size,
      });
    } catch (error) {
      logger.error("Error in monitoring and alerts", {
        error: error.message,
        stack: error.stack,
      });
    }
  }
);

/**
 * Manual function to trigger monitoring check (for testing/immediate alerts)
 */
exports.triggerMonitoringCheck = onCall(
  {
    region: "us-central1",
    enforceAppCheck: false,
  },
  async (request) => {
    try {
      // Verify admin authentication
      const userInfo = verifyAuthentication(request, true);

      logger.info("Manual monitoring check triggered", {
        userId: userInfo.uid,
      });

      // Trigger the monitoring function manually
      const event = { timestamp: new Date().toISOString() };
      await exports.monitoringAndAlerts.run(event);

      return {
        success: true,
        message: "Monitoring check completed successfully",
      };
    } catch (error) {
      logger.error("Error in manual monitoring check", {
        error: error.message,
        userId: request.auth?.uid,
      });

      return {
        success: false,
        error: error.message || "Failed to run monitoring check",
      };
    }
  }
);

/**
 * Cleanup old documents and logs (runs weekly)
 */
exports.weeklyCleanup = onSchedule(
  {
    schedule: "0 2 * * 0", // Every Sunday at 2 AM UTC
    region: "us-central1",
    timeZone: "UTC",
  },
  async (event) => {
    try {
      logger.info("Starting weekly cleanup");

      // Delete email logs older than 90 days
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

      const oldEmailLogs = await admin
        .firestore()
        .collection("email_logs")
        .where("sentAt", "<", ninetyDaysAgo)
        .limit(500)
        .get();

      const batch = admin.firestore().batch();
      oldEmailLogs.docs.forEach((doc) => {
        batch.delete(doc.ref);
      });

      if (!oldEmailLogs.empty) {
        await batch.commit();
        logger.info("Deleted old email logs", {
          count: oldEmailLogs.size,
        });
      }

      // Clean up expired document access tokens
      // This would be implemented if we stored token metadata in Firestore

      logger.info("Weekly cleanup completed successfully");
    } catch (error) {
      logger.error("Error in weekly cleanup", {
        error: error.message,
        stack: error.stack,
      });
    }
  }
);

/**
 * Send reminder emails for pending signatures (daily)
 */
exports.dailyReminderCheck = onSchedule(
  {
    schedule: "0 9 * * *", // Daily at 9 AM UTC
    region: "us-central1",
    timeZone: "UTC",
  },
  async (event) => {
    try {
      logger.info("Starting daily reminder check");

      // Find documents with pending signatures older than 3 days
      const threeDaysAgo = new Date();
      threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

      const pendingDocuments = await admin
        .firestore()
        .collection("documents")
        .where("status", "in", ["pending", "partial"])
        .where("createdAt", "<", threeDaysAgo)
        .limit(100)
        .get();

      let remindersSent = 0;

      for (const doc of pendingDocuments.docs) {
        const docData = doc.data();

        // Find signers who haven't signed yet
        const pendingSigners = docData.signers.filter(
          (s) => s.status === "pending"
        );

        for (const signer of pendingSigners) {
          // Check if we've sent a reminder in the last 24 hours
          const recentReminders = await admin
            .firestore()
            .collection("email_logs")
            .where("documentId", "==", doc.id)
            .where("to", "==", signer.email)
            .where("type", "==", "reminder")
            .where("sentAt", ">", new Date(Date.now() - 24 * 60 * 60 * 1000))
            .limit(1)
            .get();

          if (recentReminders.empty) {
            // Send reminder (this would call the email service)
            logger.info("Would send reminder email", {
              documentId: doc.id,
              documentTitle: docData.title,
              signerEmail: signer.email,
              signerName: signer.name,
            });

            // Here you would integrate with the email service
            // await sendReminderEmail(doc.id, docData, signer);

            remindersSent++;
          }
        }
      }

      logger.info("Daily reminder check completed", {
        documentsChecked: pendingDocuments.size,
        remindersSent: remindersSent,
      });
    } catch (error) {
      logger.error("Error in daily reminder check", {
        error: error.message,
        stack: error.stack,
      });
    }
  }
);

// ===== CUSTOM DOCUMENT SIGNING SYSTEM =====
// Export custom document signing functions

exports.uploadDocument = customDocumentSigning.uploadDocument;
exports.getDocument = customDocumentSigning.getDocument;
exports.addSignature = customDocumentSigning.addSignature;
exports.getUserDocuments = customDocumentSigning.getUserDocuments;

// Legacy function aliases for backward compatibility (can be removed later)
exports.createSimpleDocumentSubmission = customDocumentSigning.uploadDocument;

// Export utility functions
exports.verifyAuthentication = verifyAuthentication;
exports.checkRateLimit = checkRateLimit;
exports.addSecurityHeaders = addSecurityHeaders;
