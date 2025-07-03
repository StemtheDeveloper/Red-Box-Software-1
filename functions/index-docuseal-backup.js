/**
 * DocuSeal Firebase Functions Integration
 * Handles PDF templates, signer workflows, and document signing
 */

// Load environment variables
require("dotenv").config();

const { onCall, onRequest } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const axios = require("axios");
const jwt = require("jsonwebtoken");
const logger = require("firebase-functions/logger");

// Import custom document signing functions
const customDocumentSigning = require('./custom-document-signing');

// Initialize Firebase Admin
admin.initializeApp();

// Define secret for DocuSeal API key
const docusealApiKey = defineSecret("DOCUSEAL_API_KEY");

// DocuSeal API configuration
const DOCUSEAL_API_BASE = "https://api.docuseal.com";

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
 * Simplified document submission creation for basic upload and share workflow
 * This replaces the complex DocuSeal integration with a streamlined approach
 */
exports.createSimpleDocumentSubmission = onCall(
  {
    region: "us-central1",
    enforceAppCheck: false,
    secrets: [docusealApiKey],
  },
  async (request) => {
    try {
      // Verify authentication (no admin requirement for basic document sharing)
      const userInfo = verifyAuthentication(request, false);
      checkRateLimit(userInfo.uid, "createSimpleDocumentSubmission", 10, 60000);

      const {
        templateHtml,
        templateName,
        signers,
        fields = [],
        sendEmail = true,
      } = request.data;

      if (!templateHtml || !templateName || !signers || signers.length === 0) {
        throw new Error(
          "Template HTML, name, and at least one signer are required"
        );
      }

      logger.info("Creating simple document submission", {
        templateName,
        signersCount: signers?.length,
        userId: request.auth.uid,
      });

      // Get the API key from the secret
      const apiKey = docusealApiKey.value();

      // Create template from HTML (this is now the only supported method for simplicity)
      const templateResponse = await axios.post(
        `${DOCUSEAL_API_BASE}/templates/html`,
        {
          name: templateName,
          html: templateHtml,
          fields:
            fields.length > 0
              ? fields
              : [
                  { name: "signer_name", type: "text" },
                  { name: "date", type: "date" },
                  { name: "signature", type: "signature" },
                ],
        },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
        }
      );

      if (templateResponse.status !== 201) {
        throw new Error(`Failed to create template: ${templateResponse.data}`);
      }

      const newTemplateId = templateResponse.data.id;

      // Create submission
      const submissionData = {
        template_id: newTemplateId,
        submitters: signers.map((signer, index) => ({
          name: signer.name,
          email: signer.email,
          role: signer.role || `Signer ${index + 1}`,
          send_email: sendEmail,
        })),
        send_email: sendEmail,
      };

      const submissionResponse = await axios.post(
        `${DOCUSEAL_API_BASE}/submissions`,
        submissionData,
        {
          headers: {
            Authorization: `Bearer ${DOCUSEAL_API_KEY}`,
            "Content-Type": "application/json",
          },
        }
      );

      if (submissionResponse.status !== 201) {
        throw new Error(
          `Failed to create submission: ${submissionResponse.data}`
        );
      }

      const submission = submissionResponse.data;

      // Generate a simple access token for this submission
      const accessToken = generateSimpleAccessToken(
        submission.id,
        userInfo.uid
      );

      // Store submission metadata in Firestore with access control
      const submissionDoc = {
        submissionId: submission.id,
        templateId: submission.template?.id || newTemplateId,
        templateName: templateName,
        status: submission.status || "pending",
        signers: signers,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        createdBy: request.auth.uid,
        createdByEmail: userInfo.email,
        submissionUrl: submission.url,
        accessToken: accessToken,
        // Store allowed viewers (creator + all signers)
        allowedViewers: [userInfo.email, ...signers.map((s) => s.email)],
      };

      await admin
        .firestore()
        .collection("simple_document_submissions")
        .doc(submission.id.toString())
        .set(submissionDoc);

      logger.info("Simple document submission created successfully", {
        submissionId: submission.id,
        submissionUrl: submission.url,
      });

      return {
        success: true,
        submissionId: submission.id,
        submissionUrl: submission.url,
        accessToken: accessToken,
        viewUrl: `${
          process.env.FIREBASE_HOSTING_URL || "https://your-site.web.app"
        }/view-document.html?id=${submission.id}&token=${accessToken}`,
        signers: submission.submitters || [],
        status: submission.status || "pending",
      };
    } catch (error) {
      logger.error("Error creating simple document submission", {
        error: error.message,
        stack: error.stack,
        userId: request.auth?.uid,
      });

      if (error.response) {
        logger.error("DocuSeal API Error", {
          status: error.response.status,
          data: error.response.data,
        });
      }

      return {
        success: false,
        error: error.message || "Failed to create document submission",
      };
    }
  }
);

/**
 * Generate a simple access token for document viewing
 */
function generateSimpleAccessToken(submissionId, userId) {
  const payload = {
    submissionId,
    userId,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60, // 30 days
  };
  return jwt.sign(payload, DOCUSEAL_API_KEY, { algorithm: "HS256" });
}

/**
 * Get document submission with access control
 */
exports.getDocumentSubmission = onCall(
  {
    region: "us-central1",
    enforceAppCheck: false,
  },
  async (request) => {
    try {
      const { submissionId, accessToken } = request.data;

      if (!submissionId) {
        throw new Error("Submission ID is required");
      }

      // Get submission from Firestore
      const submissionDoc = await admin
        .firestore()
        .collection("simple_document_submissions")
        .doc(submissionId)
        .get();

      if (!submissionDoc.exists) {
        throw new Error("Document not found");
      }

      const submissionData = submissionDoc.data();

      // Check access permissions
      let hasAccess = false;

      if (request.auth) {
        // Authenticated user - check if they're the creator or a signer
        const userEmail = request.auth.token.email;
        hasAccess = submissionData.allowedViewers.includes(userEmail);
      }

      if (!hasAccess && accessToken) {
        // Check access token
        try {
          const decoded = jwt.verify(accessToken, DOCUSEAL_API_KEY);
          hasAccess = decoded.submissionId === submissionId;
        } catch (err) {
          logger.warn("Invalid access token", {
            submissionId,
            error: err.message,
          });
        }
      }

      if (!hasAccess) {
        throw new Error("Access denied");
      }

      // Get latest status from DocuSeal if needed
      try {
        const statusResponse = await axios.get(
          `${DOCUSEAL_API_BASE}/submissions/${submissionId}`,
          {
            headers: {
              Authorization: `Bearer ${DOCUSEAL_API_KEY}`,
            },
          }
        );

        if (statusResponse.status === 200) {
          const latestData = statusResponse.data;
          // Update Firestore if status changed
          if (latestData.status !== submissionData.status) {
            await admin
              .firestore()
              .collection("simple_document_submissions")
              .doc(submissionId)
              .update({
                status: latestData.status,
                lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
              });
            submissionData.status = latestData.status;
          }
        }
      } catch (apiError) {
        logger.warn("Failed to fetch latest status from DocuSeal", {
          submissionId,
        });
      }

      return {
        success: true,
        submission: {
          id: submissionData.submissionId,
          templateName: submissionData.templateName,
          status: submissionData.status,
          signers: submissionData.signers,
          createdAt: submissionData.createdAt,
          submissionUrl: submissionData.submissionUrl,
          createdByEmail: submissionData.createdByEmail,
        },
      };
    } catch (error) {
      logger.error("Error getting document submission", {
        error: error.message,
        submissionId: request.data?.submissionId,
      });

      return {
        success: false,
        error: error.message || "Failed to get document submission",
      };
    }
  }
);

/**
 * List document submissions for the authenticated user
 */
exports.getUserDocumentSubmissions = onCall(
  {
    region: "us-central1",
    enforceAppCheck: false,
  },
  async (request) => {
    try {
      const userInfo = verifyAuthentication(request, false);

      // Get submissions where user is creator or signer
      const submissionsQuery = await admin
        .firestore()
        .collection("simple_document_submissions")
        .where("allowedViewers", "array-contains", userInfo.email)
        .orderBy("createdAt", "desc")
        .limit(50)
        .get();

      const submissions = [];
      submissionsQuery.forEach((doc) => {
        const data = doc.data();
        submissions.push({
          id: data.submissionId,
          templateName: data.templateName,
          status: data.status,
          signers: data.signers,
          createdAt: data.createdAt,
          createdByEmail: data.createdByEmail,
          isCreator: data.createdBy === userInfo.uid,
        });
      });

      return {
        success: true,
        submissions: submissions,
      };
    } catch (error) {
      logger.error("Error getting user document submissions", {
        error: error.message,
        userId: request.auth?.uid,
      });

      return {
        success: false,
        error: error.message || "Failed to get document submissions",
      };
    }
  }
);

/**
 * Create a PDF template from HTML using DocuSeal API
 */
exports.createPdfTemplateFromHtml = onCall(
  {
    region: "us-central1",
    enforceAppCheck: false,
  },
  async (request) => {
    try {
      // Verify admin authentication and apply rate limiting
      const userInfo = verifyAuthentication(request, true);
      checkRateLimit(userInfo.uid, "createPdfTemplateFromHtml", 10, 60000);

      const { html, name, fields = [] } = request.data;

      if (!html || !name) {
        throw new Error("HTML content and template name are required");
      }

      logger.info("Creating PDF template from HTML", {
        templateName: name,
        userId: request.auth.uid,
      });

      const response = await axios.post(
        `${DOCUSEAL_API_BASE}/templates/html`,
        {
          name: name,
          html: html,
          fields: fields,
        },
        {
          headers: {
            Authorization: `Bearer ${DOCUSEAL_API_KEY}`,
            "Content-Type": "application/json",
          },
        }
      );

      if (response.status !== 201) {
        throw new Error(`Failed to create template: ${response.data}`);
      }

      const template = response.data;

      // Store template metadata in Firestore
      await admin
        .firestore()
        .collection("docuseal_templates")
        .doc(template.id.toString())
        .set({
          templateId: template.id,
          name: template.name,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          createdBy: request.auth.uid,
          fields: fields,
          status: "active",
        });

      logger.info("PDF template created successfully", {
        templateId: template.id,
        templateName: template.name,
      });

      return {
        success: true,
        templateId: template.id,
        templateName: template.name,
        downloadUrl: template.download_url,
      };
    } catch (error) {
      logger.error("Error creating PDF template", {
        error: error.message,
        stack: error.stack,
        userId: request.auth?.uid,
      });

      if (error.response) {
        logger.error("DocuSeal API Error", {
          status: error.response.status,
          data: error.response.data,
        });
      }

      return {
        success: false,
        error: error.message || "Failed to create template",
      };
    }
  }
);

/**
 * Generate a builder token for DocuSeal form builder embedding
 */
exports.getBuilderToken = onCall(
  {
    region: "us-central1",
    enforceAppCheck: false,
  },
  async (request) => {
    try {
      // Verify admin authentication and apply rate limiting
      const userInfo = verifyAuthentication(request, true); // Require admin access
      checkRateLimit(userInfo.uid, "getBuilderToken", 30, 60000); // 30 tokens per minute

      const { documentUrls = [], userEmail, userName } = request.data;

      logger.info("Generating builder token", {
        userId: userInfo.uid,
        userEmail: userEmail || userInfo.email,
      });

      // Create JWT token for DocuSeal builder
      const payload = {
        user_email: userEmail || request.auth.token.email || "",
        name: userName || request.auth.token.name || "User",
        allowed_document_urls: documentUrls,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 60 * 60, // 1 hour expiration
      };

      const builderToken = jwt.sign(payload, DOCUSEAL_API_KEY, {
        algorithm: "HS256",
      });

      logger.info("Builder token generated successfully", {
        userId: request.auth.uid,
        tokenExpiration: new Date(payload.exp * 1000),
      });

      return {
        success: true,
        builderToken: builderToken,
        expiresAt: payload.exp * 1000,
      };
    } catch (error) {
      logger.error("Error generating builder token", {
        error: error.message,
        stack: error.stack,
        userId: request.auth?.uid,
      });

      return {
        success: false,
        error: error.message || "Failed to generate builder token",
      };
    }
  }
);

/**
 * Webhook handler for DocuSeal events
 */
exports.docusealWebhook = onRequest(
  {
    region: "us-central1",
    cors: true,
  },
  async (req, res) => {
    try {
      // Add security headers
      addSecurityHeaders(res);

      if (req.method !== "POST") {
        res.status(405).send("Method not allowed");
        return;
      }

      // Basic webhook validation
      const webhookData = req.body;
      if (!webhookData || !webhookData.event_type) {
        res.status(400).send("Invalid webhook data");
        return;
      }

      logger.info("Received DocuSeal webhook", {
        eventType: webhookData.event_type,
        submissionId: webhookData.data?.id,
      });

      // Process different webhook events
      switch (webhookData.event_type) {
        case "submission.completed":
          await handleSubmissionCompleted(webhookData.data);
          break;
        case "submission.expired":
          await handleSubmissionExpired(webhookData.data);
          break;
        case "submitter.completed":
          await handleSubmitterCompleted(webhookData.data);
          break;
        default:
          logger.info("Unhandled webhook event type", {
            eventType: webhookData.event_type,
          });
      }

      res.status(200).send("OK");
    } catch (error) {
      logger.error("Error processing DocuSeal webhook", {
        error: error.message,
        stack: error.stack,
      });
      res.status(500).send("Internal server error");
    }
  }
);

/**
 * Handle submission completion
 */
async function handleSubmissionCompleted(submissionData) {
  try {
    const submissionId = submissionData.id.toString();

    // Update submission status in Firestore
    await admin
      .firestore()
      .collection("docuseal_submissions")
      .doc(submissionId)
      .update({
        status: "completed",
        completedAt: admin.firestore.FieldValue.serverTimestamp(),
        finalDocumentUrl: submissionData.download_url,
      });

    // Optionally download and store the signed document
    if (submissionData.download_url) {
      await saveSignedDocument(submissionId, submissionData.download_url);
    }

    logger.info("Submission completed successfully", {
      submissionId: submissionId,
    });
  } catch (error) {
    logger.error("Error handling submission completion", {
      error: error.message,
      submissionId: submissionData.id,
    });
  }
}

/**
 * Handle submission expiration
 */
async function handleSubmissionExpired(submissionData) {
  try {
    const submissionId = submissionData.id.toString();

    await admin
      .firestore()
      .collection("docuseal_submissions")
      .doc(submissionId)
      .update({
        status: "expired",
        expiredAt: admin.firestore.FieldValue.serverTimestamp(),
      });

    logger.info("Submission expired", {
      submissionId: submissionId,
    });
  } catch (error) {
    logger.error("Error handling submission expiration", {
      error: error.message,
      submissionId: submissionData.id,
    });
  }
}

/**
 * Handle individual submitter completion
 */
async function handleSubmitterCompleted(submitterData) {
  try {
    logger.info("Submitter completed signing", {
      submitterId: submitterData.id,
      submissionId: submitterData.submission_id,
    });

    // Update submission with submitter completion info
    const submissionId = submitterData.submission_id.toString();
    const submissionRef = admin
      .firestore()
      .collection("docuseal_submissions")
      .doc(submissionId);

    await submissionRef.update({
      [`signers.${submitterData.email}.completedAt`]:
        admin.firestore.FieldValue.serverTimestamp(),
      [`signers.${submitterData.email}.status`]: "completed",
    });
  } catch (error) {
    logger.error("Error handling submitter completion", {
      error: error.message,
      submitterId: submitterData.id,
    });
  }
}

/**
 * Save signed document to Firebase Storage
 */
async function saveSignedDocument(submissionId, downloadUrl) {
  try {
    // Download the document
    const response = await axios.get(downloadUrl, {
      responseType: "arraybuffer",
      headers: {
        Authorization: `Bearer ${DOCUSEAL_API_KEY}`,
      },
    });

    // Save to Firebase Storage
    const bucket = admin.storage().bucket();
    const fileName = `signed/${submissionId}/document.pdf`;
    const file = bucket.file(fileName);

    await file.save(Buffer.from(response.data), {
      metadata: {
        contentType: "application/pdf",
        metadata: {
          submissionId: submissionId,
          uploadedAt: new Date().toISOString(),
        },
      },
    });

    // Update Firestore with storage path
    await admin
      .firestore()
      .collection("docuseal_submissions")
      .doc(submissionId)
      .update({
        storagePath: fileName,
        documentSavedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

    logger.info("Signed document saved to storage", {
      submissionId: submissionId,
      storagePath: fileName,
    });
  } catch (error) {
    logger.error("Error saving signed document", {
      error: error.message,
      submissionId: submissionId,
    });
  }
}

/**
 * Scheduled function to check for incomplete submissions and send email reminders
 * Runs every day at 9 AM UTC
 */
exports.emailReminderScheduler = onSchedule(
  {
    schedule: "0 9 * * *", // Daily at 9 AM UTC
    region: "us-central1",
    timeZone: "UTC",
  },
  async (_event) => {
    try {
      logger.info("Starting email reminder scheduler");

      // Get all pending submissions older than 2 days
      const twoDaysAgo = new Date();
      twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

      const submissionsSnapshot = await admin
        .firestore()
        .collection("docuseal_submissions")
        .where("status", "==", "pending")
        .where("createdAt", "<", twoDaysAgo)
        .get();

      logger.info(
        `Found ${submissionsSnapshot.size} pending submissions to check`
      );

      for (const doc of submissionsSnapshot.docs) {
        const submission = doc.data();
        await checkAndSendReminders(submission.submissionId, submission);
      }

      logger.info("Email reminder scheduler completed successfully");
    } catch (error) {
      logger.error("Error in email reminder scheduler", {
        error: error.message,
        stack: error.stack,
      });
    }
  }
);

/**
 * Check submission status and send reminders to incomplete signers
 */
async function checkAndSendReminders(submissionId, submissionData) {
  try {
    // Get latest submission status from DocuSeal
    const response = await axios.get(
      `${DOCUSEAL_API_BASE}/submissions/${submissionId}`,
      {
        headers: {
          Authorization: `Bearer ${DOCUSEAL_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (response.status !== 200) {
      logger.error(
        `Failed to get submission ${submissionId}: ${response.status}`
      );
      return;
    }

    const submission = response.data;

    // Check if submission is still pending
    if (submission.status !== "pending") {
      // Update our Firestore record
      await admin
        .firestore()
        .collection("docuseal_submissions")
        .doc(submissionId.toString())
        .update({
          status: submission.status,
          lastChecked: admin.firestore.FieldValue.serverTimestamp(),
        });
      return;
    }

    // Find incomplete submitters
    const incompleteSigners =
      submission.submitters?.filter(
        (submitter) =>
          submitter.status === "pending" || submitter.status === "sent"
      ) || [];

    logger.info(
      `Found ${incompleteSigners.length} incomplete signers for submission ${submissionId}`
    );

    // Send reminders to incomplete signers
    for (const signer of incompleteSigners) {
      await sendEmailReminder(submissionId, signer, submissionData);
    }

    // Update last reminder sent timestamp
    await admin
      .firestore()
      .collection("docuseal_submissions")
      .doc(submissionId.toString())
      .update({
        lastReminderSent: admin.firestore.FieldValue.serverTimestamp(),
        lastChecked: admin.firestore.FieldValue.serverTimestamp(),
      });
  } catch (error) {
    logger.error("Error checking submission reminders", {
      error: error.message,
      submissionId: submissionId,
    });
  }
}

/**
 * Send email reminder to individual signer
 */
async function sendEmailReminder(submissionId, signer, submissionData) {
  try {
    // Use DocuSeal's reminder API if available, or custom email logic
    const reminderResponse = await axios.post(
      `${DOCUSEAL_API_BASE}/submitters/${signer.id}/remind`,
      {},
      {
        headers: {
          Authorization: `Bearer ${DOCUSEAL_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (reminderResponse.status === 200) {
      logger.info("Email reminder sent successfully", {
        submissionId: submissionId,
        signerEmail: signer.email,
        signerId: signer.id,
      });

      // Update Firestore with reminder info
      await admin
        .firestore()
        .collection("docuseal_submissions")
        .doc(submissionId.toString())
        .update({
          [`remindersSent.${signer.email}`]:
            admin.firestore.FieldValue.arrayUnion({
              sentAt: admin.firestore.FieldValue.serverTimestamp(),
              signerId: signer.id,
            }),
        });
    }
  } catch (error) {
    // If DocuSeal reminder API fails, log error but continue
    logger.error("Error sending email reminder", {
      error: error.message,
      submissionId: submissionId,
      signerEmail: signer.email,
    });

    // Could implement custom email sending here using SendGrid, Nodemailer, etc.
    // For now, just log the attempt
    logger.info("Would send custom reminder email", {
      to: signer.email,
      subject: `Reminder: Please sign document - ${submissionData.templateName}`,
      submissionUrl: submissionData.submissionUrl,
    });
  }
}

/**
 * Manual function to send reminder for specific submission
 */
exports.sendSubmissionReminder = onCall(
  {
    region: "us-central1",
    enforceAppCheck: false,
  },
  async (request) => {
    try {
      // Verify admin authentication and apply rate limiting
      const userInfo = verifyAuthentication(request, true); // Require admin access
      checkRateLimit(userInfo.uid, "sendSubmissionReminder", 10, 60000); // 10 reminders per minute

      const { submissionId } = request.data;

      if (!submissionId) {
        throw new Error("Submission ID is required");
      }

      logger.info("Manual reminder requested", {
        submissionId: submissionId,
        userId: userInfo.uid,
      });

      // Get submission data from Firestore
      const submissionDoc = await admin
        .firestore()
        .collection("docuseal_submissions")
        .doc(submissionId.toString())
        .get();

      if (!submissionDoc.exists) {
        throw new Error("Submission not found");
      }

      const submissionData = submissionDoc.data();
      await checkAndSendReminders(submissionId, submissionData);

      return {
        success: true,
        message: "Reminder sent successfully",
      };
    } catch (error) {
      logger.error("Error sending manual reminder", {
        error: error.message,
        stack: error.stack,
        userId: request.auth?.uid,
      });

      return {
        success: false,
        error: error.message || "Failed to send reminder",
      };
    }
  }
);

/**
 * Validate environment variables and security configuration
 */
function validateEnvironment() {
  const requiredEnvVars = ["DOCUSEAL_API_KEY"];
  const missingVars = requiredEnvVars.filter(
    (varName) => !process.env[varName]
  );

  if (missingVars.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missingVars.join(", ")}`
    );
  }

  // Check API key strength
  const apiKey = process.env.DOCUSEAL_API_KEY;
  if (apiKey && apiKey.length < 20) {
    logger.warn("DocuSeal API key appears to be weak or incomplete");
  }

  // Ensure we're not using default/example values
  if (apiKey === "your-docuseal-api-key") {
    throw new Error(
      "DocuSeal API key is not configured. Please set DOCUSEAL_API_KEY environment variable."
    );
  }

  logger.info("Environment validation completed successfully");
}

// Validate environment on startup
try {
  validateEnvironment();
} catch (error) {
  logger.error("Environment validation failed", { error: error.message });
}

/**
 * Security headers middleware for HTTP functions
 */
function addSecurityHeaders(res) {
  res.set({
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "X-XSS-Protection": "1; mode=block",
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    "Referrer-Policy": "strict-origin-when-cross-origin",
  });
}

/**
 * Monitoring and alerts functionality
 */

// Slack webhook URL (should be set as environment variable)
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;

/**
 * Scheduled monitoring function that runs daily to check for stale submissions
 * Runs every day at 10 AM UTC to check for submissions that need attention
 */
exports.monitoringAndAlerts = onSchedule(
  {
    schedule: "0 10 * * *", // Daily at 10 AM UTC
    region: "us-central1",
    timeZone: "UTC",
  },
  async (_event) => {
    try {
      logger.info("Starting monitoring and alerts check");

      // Check for submissions older than 7 days that are still pending
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const staleSubmissionsSnapshot = await admin
        .firestore()
        .collection("docuseal_submissions")
        .where("status", "==", "pending")
        .where("createdAt", "<", sevenDaysAgo)
        .get();

      // Check for submissions older than 3 days without any reminders sent
      const threeDaysAgo = new Date();
      threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

      const noReminderSubmissionsSnapshot = await admin
        .firestore()
        .collection("docuseal_submissions")
        .where("status", "==", "pending")
        .where("createdAt", "<", threeDaysAgo)
        .where("lastReminderSent", "==", null)
        .get();

      const alerts = [];

      // Process stale submissions (7+ days old)
      if (staleSubmissionsSnapshot.size > 0) {
        alerts.push({
          type: "stale_submissions",
          count: staleSubmissionsSnapshot.size,
          submissions: staleSubmissionsSnapshot.docs.map((doc) => ({
            id: doc.id,
            templateName: doc.data().templateName,
            createdAt: doc.data().createdAt?.toDate(),
            signers: doc.data().signers?.length || 0,
          })),
        });
      }

      // Process submissions without reminders (3+ days old)
      if (noReminderSubmissionsSnapshot.size > 0) {
        alerts.push({
          type: "no_reminders",
          count: noReminderSubmissionsSnapshot.size,
          submissions: noReminderSubmissionsSnapshot.docs.map((doc) => ({
            id: doc.id,
            templateName: doc.data().templateName,
            createdAt: doc.data().createdAt?.toDate(),
            signers: doc.data().signers?.length || 0,
          })),
        });
      }

      // Get summary statistics
      const totalPendingSnapshot = await admin
        .firestore()
        .collection("docuseal_submissions")
        .where("status", "==", "pending")
        .get();

      const completedTodaySnapshot = await admin
        .firestore()
        .collection("docuseal_submissions")
        .where("status", "==", "completed")
        .where("completedAt", ">=", new Date(new Date().setHours(0, 0, 0, 0)))
        .get();

      const stats = {
        totalPending: totalPendingSnapshot.size,
        completedToday: completedTodaySnapshot.size,
        staleSubmissions: staleSubmissionsSnapshot.size,
        needingReminders: noReminderSubmissionsSnapshot.size,
      };

      logger.info("Monitoring check completed", stats);

      // Send alerts if any issues found or if it's Monday (weekly summary)
      const now = new Date();
      const isMonday = now.getDay() === 1;

      if (alerts.length > 0 || isMonday) {
        await sendMonitoringAlert(alerts, stats, isMonday);
      }

      // Store monitoring data in Firestore for tracking
      await admin
        .firestore()
        .collection("monitoring_reports")
        .add({
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
          stats: stats,
          alerts: alerts,
          type: alerts.length > 0 ? "alert" : "routine",
        });
    } catch (error) {
      logger.error("Error in monitoring and alerts", {
        error: error.message,
        stack: error.stack,
      });

      // Send error alert
      await sendErrorAlert(error);
    }
  }
);

/**
 * Send monitoring alert to Slack
 */
async function sendMonitoringAlert(alerts, stats, isWeeklySummary = false) {
  try {
    if (!SLACK_WEBHOOK_URL) {
      logger.warn(
        "Slack webhook URL not configured, skipping Slack notification"
      );
      return;
    }

    let message = isWeeklySummary
      ? "📊 *Weekly DocuSeal Summary*\n"
      : "🚨 *DocuSeal Monitoring Alert*\n";

    message += `\n📈 *Current Statistics:*
• Total Pending: ${stats.totalPending}
• Completed Today: ${stats.completedToday}
• Stale Submissions (7+ days): ${stats.staleSubmissions}
• Needing Reminders (3+ days): ${stats.needingReminders}\n`;

    if (alerts.length > 0) {
      message += "\n⚠️ *Issues Requiring Attention:*\n";

      for (const alert of alerts) {
        if (alert.type === "stale_submissions") {
          message += `\n🕐 *${alert.count} Stale Submissions (7+ days old):*\n`;
          alert.submissions.slice(0, 5).forEach((sub) => {
            const daysOld = Math.floor(
              (new Date() - sub.createdAt) / (1000 * 60 * 60 * 24)
            );
            message += `• ${sub.templateName} (${daysOld} days old) - ${sub.signers} signers\n`;
          });
          if (alert.submissions.length > 5) {
            message += `• ... and ${alert.submissions.length - 5} more\n`;
          }
        }

        if (alert.type === "no_reminders") {
          message += `\n📧 *${alert.count} Submissions Without Reminders (3+ days old):*\n`;
          alert.submissions.slice(0, 5).forEach((sub) => {
            const daysOld = Math.floor(
              (new Date() - sub.createdAt) / (1000 * 60 * 60 * 24)
            );
            message += `• ${sub.templateName} (${daysOld} days old) - ${sub.signers} signers\n`;
          });
          if (alert.submissions.length > 5) {
            message += `• ... and ${alert.submissions.length - 5} more\n`;
          }
        }
      }

      message += "\n💡 *Recommended Actions:*\n";
      message += "• Review stale submissions for follow-up\n";
      message += "• Send manual reminders for pending signatures\n";
      message += "• Contact signers directly if needed\n";
    }

    message += `\n🕐 Generated at: ${new Date().toLocaleString()}`;

    await sendSlackMessage(message);

    logger.info("Monitoring alert sent to Slack", {
      alertCount: alerts.length,
      isWeeklySummary: isWeeklySummary,
    });
  } catch (error) {
    logger.error("Error sending monitoring alert", {
      error: error.message,
    });
  }
}

/**
 * Send error alert to Slack
 */
async function sendErrorAlert(error) {
  try {
    if (!SLACK_WEBHOOK_URL) {
      return;
    }

    const message = `🔥 *DocuSeal Monitoring Error*

⚠️ An error occurred during monitoring:
\`\`\`
${error.message}
\`\`\`

🕐 Time: ${new Date().toLocaleString()}
🔍 Please check the Firebase Functions logs for more details.`;

    await sendSlackMessage(message);
  } catch (slackError) {
    logger.error("Failed to send error alert to Slack", {
      originalError: error.message,
      slackError: slackError.message,
    });
  }
}

/**
 * Send message to Slack webhook
 */
async function sendSlackMessage(message) {
  if (!SLACK_WEBHOOK_URL) {
    logger.info("Slack message (webhook not configured):", { message });
    return;
  }

  const response = await axios.post(SLACK_WEBHOOK_URL, {
    text: message,
    username: "DocuSeal Monitor",
    icon_emoji: ":clipboard:",
  });

  if (response.status !== 200) {
    throw new Error(`Slack API returned status ${response.status}`);
  }
}

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

// ===== CUSTOM DOCUMENT SIGNING SYSTEM =====
// Export custom document signing functions to replace DocuSeal

// Document management functions
exports.uploadDocument = customDocumentSigning.uploadDocument;
exports.getDocument = customDocumentSigning.getDocument;
exports.addSignature = customDocumentSigning.addSignature;
exports.getUserDocuments = customDocumentSigning.getUserDocuments;
