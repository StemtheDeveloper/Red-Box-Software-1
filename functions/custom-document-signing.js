/**
 * Custom Document Signing System - Firebase Functions
 * Replaces DocuSeal with self-hosted document signing solution
 */

const { onCall, onRequest } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const admin = require("firebase-admin");
const logger = require("firebase-functions/logger");
const crypto = require("crypto");
const PDFLib = require("pdf-lib");
const { StandardFonts, rgb } = PDFLib;

// Gmail API imports for email notifications
const { google } = require("googleapis");
const nodemailer = require("nodemailer");

// Firebase Admin is initialized in index.js, so we don't need to initialize it here
// if (!admin.apps || admin.apps.length === 0) {
//   admin.initializeApp();
// }

/**
 * Admin configuration
 */
const ADMIN_EMAILS = [
  "stiaan44@gmail.com", // Primary admin
];

/**
 * Enhanced authentication middleware
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
 * Generate secure token for document access
 */
function generateSecureToken(documentId, email, expiresInHours = 168) {
  // 7 days default
  const payload = {
    documentId,
    email,
    timestamp: Date.now(),
    expiresAt: Date.now() + expiresInHours * 60 * 60 * 1000,
  };

  const secret =
    process.env.DOCUMENT_SIGNING_SECRET ||
    crypto.randomBytes(32).toString("hex");
  return (
    crypto
      .createHmac("sha256", secret)
      .update(JSON.stringify(payload))
      .digest("hex") +
    "." +
    Buffer.from(JSON.stringify(payload)).toString("base64")
  );
}

/**
 * Verify secure token
 */
function verifySecureToken(token) {
  try {
    const [signature, payloadBase64] = token.split(".");
    const payload = JSON.parse(Buffer.from(payloadBase64, "base64").toString());

    const secret =
      process.env.DOCUMENT_SIGNING_SECRET ||
      crypto.randomBytes(32).toString("hex");
    const expectedSignature = crypto
      .createHmac("sha256", secret)
      .update(JSON.stringify(payload))
      .digest("hex");

    if (signature !== expectedSignature) {
      throw new Error("Invalid token signature");
    }

    if (Date.now() > payload.expiresAt) {
      throw new Error("Token expired");
    }

    return payload;
  } catch (error) {
    throw new Error("Invalid token: " + error.message);
  }
}

/**
 * Upload and create document for signing
 * Fixed timestamp handling for Firestore compatibility
 */
exports.uploadDocument = onCall(
  {
    region: "us-central1",
    enforceAppCheck: false,
  },
  async (request) => {
    try {
      const userInfo = verifyAuthentication(request, false);

      const {
        fileName,
        fileSize,
        fileType,
        base64Data,
        title,
        description = "",
        signers = [],
      } = request.data;

      if (!fileName || !base64Data || !title || signers.length === 0) {
        throw new Error(
          "fileName, base64Data, title, and signers are required"
        );
      }

      if (fileType !== "application/pdf") {
        throw new Error("Only PDF files are supported");
      }

      if (fileSize > 10 * 1024 * 1024) {
        // 10MB limit
        throw new Error("File size must be under 10MB");
      }

      // Generate unique document ID
      const documentId = crypto.randomUUID();

      // Validate and prepare signers
      const processedSigners = signers.map((signer, index) => ({
        id: crypto.randomUUID(),
        email: signer.email.toLowerCase().trim(),
        name: signer.name.trim(),
        role: signer.role || "Signer",
        order: index + 1,
        status: "pending",
        token: generateSecureToken(
          documentId,
          signer.email.toLowerCase().trim()
        ),
        signedAt: null,
        signatureData: null,
      }));

      // Store document metadata in Firestore
      const currentTimestamp = admin.firestore.Timestamp.now();

      const documentData = {
        id: documentId,
        title: title.trim(),
        description: description.trim(),
        fileName,
        fileSize,
        fileType,
        status: "pending",
        createdBy: userInfo.uid,
        createdByEmail: userInfo.email,
        createdByName: userInfo.name,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        signers: processedSigners,
        allowedViewers: [
          userInfo.email,
          ...processedSigners.map((s) => s.email),
        ],
        completedAt: null,
        signedDocumentPath: null,
        auditTrail: [
          {
            action: "document_created",
            timestamp: currentTimestamp,
            userId: userInfo.uid,
            userEmail: userInfo.email,
            details: { title, signersCount: signers.length },
          },
        ],
      };

      // Save document metadata
      await admin
        .firestore()
        .collection("documents")
        .doc(documentId)
        .set(documentData);

      // Store original document in Firebase Storage with encryption
      const fileBuffer = Buffer.from(base64Data, "base64");
      const encryptedBuffer = encryptDocument(fileBuffer);

      const bucket = admin.storage().bucket();
      const originalPath = `documents/original/${documentId}/${fileName}`;
      const file = bucket.file(originalPath);

      await file.save(encryptedBuffer, {
        metadata: {
          contentType: fileType,
          metadata: {
            documentId,
            uploadedBy: userInfo.email,
            encrypted: "true",
            originalSize: fileSize.toString(),
          },
        },
      });

      // Send email invitations to signers
      await sendSigningInvitations(documentId, documentData);

      logger.info("Document uploaded successfully", {
        documentId,
        title,
        createdBy: userInfo.email,
        signersCount: signers.length,
      });

      return {
        success: true,
        documentId,
        title,
        signers: processedSigners.map((s) => ({
          id: s.id,
          email: s.email,
          name: s.name,
          role: s.role,
          status: s.status,
        })),
        status: "pending",
      };
    } catch (error) {
      logger.error("Error uploading document", {
        error: error.message,
        stack: error.stack,
        userId: request.auth?.uid,
      });

      return {
        success: false,
        error: error.message || "Failed to upload document",
      };
    }
  }
);

/**
 * Get document with access control
 */
exports.getDocument = onCall(
  {
    region: "us-central1",
    enforceAppCheck: false,
  },
  async (request) => {
    try {
      const { documentId, accessToken } = request.data;

      if (!documentId) {
        throw new Error("Document ID is required");
      }

      // Get document from Firestore
      const documentDoc = await admin
        .firestore()
        .collection("documents")
        .doc(documentId)
        .get();

      if (!documentDoc.exists) {
        throw new Error("Document not found");
      }

      const documentData = documentDoc.data();
      let hasAccess = false;
      let accessorEmail = null;

      // Check access permissions
      if (request.auth) {
        // Authenticated user - check if they're allowed to view
        const userEmail = request.auth.token.email;
        hasAccess = documentData.allowedViewers.includes(userEmail);
        accessorEmail = userEmail;
      }

      if (!hasAccess && accessToken) {
        // Check access token
        try {
          const tokenData = verifySecureToken(accessToken);
          if (tokenData.documentId === documentId) {
            hasAccess = true;
            accessorEmail = tokenData.email;
          }
        } catch (err) {
          logger.warn("Invalid access token", {
            documentId,
            error: err.message,
          });
        }
      }

      if (!hasAccess) {
        throw new Error("Access denied");
      }

      // Find current signer info if accessing via token
      let currentSigner = null;
      if (accessorEmail && accessorEmail !== documentData.createdByEmail) {
        currentSigner = documentData.signers.find(
          (s) => s.email === accessorEmail
        );
      }

      // Return document data (without sensitive info like other signers' tokens)
      const responseData = {
        success: true,
        document: {
          id: documentData.id,
          title: documentData.title,
          description: documentData.description,
          fileName: documentData.fileName,
          status: documentData.status,
          createdBy: documentData.createdByName,
          createdByEmail: documentData.createdByEmail,
          createdAt: documentData.createdAt,
          signers: documentData.signers.map((s) => ({
            id: s.id,
            email: s.email,
            name: s.name,
            role: s.role,
            status: s.status,
            signedAt: s.signedAt,
          })),
          isCreator: request.auth?.token.email === documentData.createdByEmail,
          currentSigner: currentSigner
            ? {
                id: currentSigner.id,
                email: currentSigner.email,
                name: currentSigner.name,
                role: currentSigner.role,
                status: currentSigner.status,
                canSign: currentSigner.status === "pending",
              }
            : null,
        },
      };

      return responseData;
    } catch (error) {
      logger.error("Error getting document", {
        error: error.message,
        documentId: request.data?.documentId,
        userId: request.auth?.uid,
      });

      return {
        success: false,
        error: error.message || "Failed to get document",
      };
    }
  }
);

/**
 * Add signature to document
 */
exports.addSignature = onCall(
  {
    region: "us-central1",
    enforceAppCheck: false,
  },
  async (request) => {
    try {
      const {
        documentId,
        signerId,
        accessToken,
        signatureData, // Base64 encoded signature image
        signatureType = "image", // "image" or "text"
        textSignature = "", // For typed signatures
      } = request.data;

      if (!documentId || !signerId || (!signatureData && !textSignature)) {
        throw new Error(
          "documentId, signerId, and signature data are required"
        );
      }

      // Get document
      const documentRef = admin
        .firestore()
        .collection("documents")
        .doc(documentId);
      const documentDoc = await documentRef.get();

      if (!documentDoc.exists) {
        throw new Error("Document not found");
      }

      const documentData = documentDoc.data();

      // Find the signer
      const signerIndex = documentData.signers.findIndex(
        (s) => s.id === signerId
      );
      if (signerIndex === -1) {
        throw new Error("Signer not found");
      }

      const signer = documentData.signers[signerIndex];

      // Verify access
      let hasAccess = false;
      if (request.auth?.token.email === signer.email) {
        hasAccess = true;
      } else if (accessToken) {
        try {
          const tokenData = verifySecureToken(accessToken);
          hasAccess =
            tokenData.documentId === documentId &&
            tokenData.email === signer.email;
        } catch (err) {
          logger.warn("Invalid access token for signing", {
            documentId,
            signerId,
            error: err.message,
          });
        }
      }

      if (!hasAccess) {
        throw new Error("Access denied");
      }

      if (signer.status !== "pending") {
        throw new Error("Document already signed by this signer");
      }

      // Update signer data
      const updatedSigners = [...documentData.signers];
      const currentTimestamp = admin.firestore.Timestamp.now();

      updatedSigners[signerIndex] = {
        ...signer,
        status: "completed",
        signedAt: currentTimestamp,
        signatureData: {
          type: signatureType,
          data: signatureData || textSignature,
          ipAddress: request.rawRequest?.ip || "unknown",
          userAgent: request.rawRequest?.get("user-agent") || "unknown",
        },
      };

      // Check if all signers have completed
      const allCompleted = updatedSigners.every(
        (s) => s.status === "completed"
      );
      const newStatus = allCompleted ? "completed" : "partial";

      // Update document
      const updateData = {
        signers: updatedSigners,
        status: newStatus,
        auditTrail: admin.firestore.FieldValue.arrayUnion({
          action: "document_signed",
          timestamp: currentTimestamp,
          signerEmail: signer.email,
          signerName: signer.name,
          signerId: signerId,
          signatureType: signatureType,
        }),
      };

      if (allCompleted) {
        updateData.completedAt = admin.firestore.FieldValue.serverTimestamp();
      }

      await documentRef.update(updateData);

      // If all signatures collected, generate final signed PDF
      if (allCompleted) {
        await generateSignedPDF(
          documentId,
          documentData.fileName,
          updatedSigners
        );

        // Send completion notifications
        await sendCompletionNotifications(documentId, {
          ...documentData,
          signers: updatedSigners,
          status: "completed",
        });
      }

      logger.info("Signature added successfully", {
        documentId,
        signerId,
        signerEmail: signer.email,
        allCompleted,
      });

      return {
        success: true,
        status: newStatus,
        allCompleted,
        message: allCompleted
          ? "Document fully signed! All parties will be notified."
          : "Signature added successfully.",
      };
    } catch (error) {
      logger.error("Error adding signature", {
        error: error.message,
        documentId: request.data?.documentId,
        signerId: request.data?.signerId,
      });

      return {
        success: false,
        error: error.message || "Failed to add signature",
      };
    }
  }
);

/**
 * Get user's documents (sent and received)
 */
exports.getUserDocuments = onCall(
  {
    region: "us-central1",
    enforceAppCheck: false,
  },
  async (request) => {
    try {
      const userInfo = verifyAuthentication(request, false);

      const { limit = 50, status = null } = request.data;

      // Build query for documents the user can access
      let query = admin
        .firestore()
        .collection("documents")
        .where("allowedViewers", "array-contains", userInfo.email)
        .orderBy("createdAt", "desc")
        .limit(Math.min(limit, 100));

      if (status) {
        query = query.where("status", "==", status);
      }

      const snapshot = await query.get();
      const documents = [];

      snapshot.forEach((doc) => {
        const data = doc.data();
        const isCreator = data.createdByEmail === userInfo.email;
        const signerInfo = data.signers.find((s) => s.email === userInfo.email);

        documents.push({
          id: data.id,
          title: data.title,
          status: data.status,
          createdAt: data.createdAt,
          createdBy: data.createdByName,
          isCreator,
          role: isCreator ? "creator" : signerInfo?.role || "viewer",
          signerStatus: signerInfo?.status || null,
          signersCount: data.signers.length,
          completedSigners: data.signers.filter((s) => s.status === "completed")
            .length,
        });
      });

      return {
        success: true,
        documents,
        total: documents.length,
      };
    } catch (error) {
      logger.error("Error getting user documents", {
        error: error.message,
        userId: request.auth?.uid,
      });

      return {
        success: false,
        error: error.message || "Failed to get documents",
      };
    }
  }
);

/**
 * Helper functions
 */

// Simple encryption for document storage (replace with proper encryption in production)
function encryptDocument(buffer) {
  const algorithm = "aes-256-cbc";
  const key = crypto.scryptSync(
    process.env.DOCUMENT_ENCRYPTION_KEY || "default-key-change-in-production",
    "salt",
    32
  );
  const iv = crypto.randomBytes(16);

  const cipher = crypto.createCipher(algorithm, key);
  let encrypted = cipher.update(buffer);
  encrypted = Buffer.concat([encrypted, cipher.final()]);

  return Buffer.concat([iv, encrypted]);
}

function decryptDocument(encryptedBuffer) {
  const algorithm = "aes-256-cbc";
  const key = crypto.scryptSync(
    process.env.DOCUMENT_ENCRYPTION_KEY || "default-key-change-in-production",
    "salt",
    32
  );

  const iv = encryptedBuffer.slice(0, 16);
  const encrypted = encryptedBuffer.slice(16);

  const decipher = crypto.createDecipher(algorithm, key);
  let decrypted = decipher.update(encrypted);
  decrypted = Buffer.concat([decrypted, decipher.final()]);

  return decrypted;
}

// Generate final signed PDF with all signatures
async function generateSignedPDF(documentId, originalFileName, signers) {
  try {
    // Get original document from storage
    const bucket = admin.storage().bucket();
    const originalPath = `documents/original/${documentId}/${originalFileName}`;
    const originalFile = bucket.file(originalPath);

    const [encryptedBuffer] = await originalFile.download();
    const pdfBuffer = decryptDocument(encryptedBuffer);

    // Load PDF with pdf-lib
    const pdfDoc = await PDFLib.PDFDocument.load(pdfBuffer);
    const pages = pdfDoc.getPages();
    const firstPage = pages[0];
    const { width, height } = firstPage.getSize();

    // Add signatures to the document
    for (let i = 0; i < signers.length; i++) {
      const signer = signers[i];
      if (signer.status === "completed" && signer.signatureData) {
        const yPosition = height - 100 - i * 60; // Stack signatures vertically

        if (signer.signatureData.type === "image") {
          try {
            // Embed signature image
            const signatureImageBuffer = Buffer.from(
              signer.signatureData.data,
              "base64"
            );
            const signatureImage = await pdfDoc.embedPng(signatureImageBuffer);

            firstPage.drawImage(signatureImage, {
              x: 50,
              y: yPosition,
              width: 150,
              height: 40,
            });
          } catch (imageError) {
            logger.warn("Failed to embed signature image, using text", {
              documentId,
              signerId: signer.id,
              error: imageError.message,
            });

            // Fallback to text signature
            firstPage.drawText(`Signed by: ${signer.name}`, {
              x: 50,
              y: yPosition,
              size: 12,
              font: await pdfDoc.embedFont(StandardFonts.Helvetica),
              color: rgb(0, 0, 0),
            });
          }
        } else {
          // Text signature
          firstPage.drawText(`Signed by: ${signer.name}`, {
            x: 50,
            y: yPosition,
            size: 12,
            font: await pdfDoc.embedFont(StandardFonts.Helvetica),
            color: rgb(0, 0, 0),
          });
        }

        // Add signature details
        firstPage.drawText(`Date: ${new Date().toLocaleDateString()}`, {
          x: 50,
          y: yPosition - 15,
          size: 10,
          font: await pdfDoc.embedFont(StandardFonts.Helvetica),
          color: rgb(0.5, 0.5, 0.5),
        });
      }
    }

    // Save signed document
    const signedPdfBytes = await pdfDoc.save();
    const signedPath = `documents/signed/${documentId}/signed_${originalFileName}`;
    const signedFile = bucket.file(signedPath);

    await signedFile.save(Buffer.from(signedPdfBytes), {
      metadata: {
        contentType: "application/pdf",
        metadata: {
          documentId,
          signersCount: signers.length.toString(),
          completedAt: new Date().toISOString(),
        },
      },
    });

    // Update document with signed PDF path
    await admin
      .firestore()
      .collection("documents")
      .doc(documentId)
      .update({
        signedDocumentPath: signedPath,
        auditTrail: admin.firestore.FieldValue.arrayUnion({
          action: "final_pdf_generated",
          timestamp: admin.firestore.Timestamp.now(),
          details: { signedPath },
        }),
      });

    logger.info("Signed PDF generated successfully", {
      documentId,
      signedPath,
    });
  } catch (error) {
    logger.error("Error generating signed PDF", {
      error: error.message,
      documentId,
    });
  }
}

// Email notification functions
async function sendSigningInvitations(documentId, documentData) {
  try {
    for (const signer of documentData.signers) {
      const signingLink = `${
        process.env.FIREBASE_HOSTING_URL || "https://red-box-software.web.app"
      }/sign-document.html?id=${documentId}&token=${signer.token}`;

      const emailContent = {
        to: signer.email,
        subject: `Document Signing Request: ${documentData.title}`,
        html: `
          <h2>Document Signing Request</h2>
          <p>Hello ${signer.name},</p>
          <p>You have been requested to sign the document: <strong>${
            documentData.title
          }</strong></p>
          <p>Sent by: ${documentData.createdByName} (${
          documentData.createdByEmail
        })</p>
          ${
            documentData.description
              ? `<p>Description: ${documentData.description}</p>`
              : ""
          }
          <p><a href="${signingLink}" style="background: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px;">Sign Document</a></p>
          <p>Or copy this link to your browser: ${signingLink}</p>
          <hr>
          <p><small>This link is secure and only accessible by you. It will expire in 7 days.</small></p>
        `,
      };

      await sendEmail(emailContent);
    }

    logger.info("Signing invitations sent", {
      documentId,
      signersCount: documentData.signers.length,
    });
  } catch (error) {
    logger.error("Error sending signing invitations", {
      error: error.message,
      documentId,
    });
  }
}

async function sendCompletionNotifications(documentId, documentData) {
  try {
    // Notify creator
    const creatorEmailContent = {
      to: documentData.createdByEmail,
      subject: `Document Completed: ${documentData.title}`,
      html: `
        <h2>Document Signing Completed</h2>
        <p>Great news! Your document <strong>${
          documentData.title
        }</strong> has been fully signed by all parties.</p>
        <p>Signers:</p>
        <ul>
          ${documentData.signers
            .map(
              (s) =>
                `<li>${s.name} (${s.email}) - Signed on ${new Date(
                  s.signedAt
                ).toLocaleDateString()}</li>`
            )
            .join("")}
        </ul>
        <p><a href="${
          process.env.FIREBASE_HOSTING_URL || "https://red-box-software.web.app"
        }/view-document.html?id=${documentId}">View Completed Document</a></p>
      `,
    };

    await sendEmail(creatorEmailContent);

    // Notify all signers
    for (const signer of documentData.signers) {
      const signerEmailContent = {
        to: signer.email,
        subject: `Document Completed: ${documentData.title}`,
        html: `
          <h2>Document Signing Completed</h2>
          <p>Hello ${signer.name},</p>
          <p>The document <strong>${
            documentData.title
          }</strong> has been fully signed by all parties.</p>
          <p><a href="${
            process.env.FIREBASE_HOSTING_URL ||
            "https://red-box-software.web.app"
          }/view-document.html?id=${documentId}&token=${
          signer.token
        }">View Completed Document</a></p>
        `,
      };

      await sendEmail(signerEmailContent);
    }
  } catch (error) {
    logger.error("Error sending completion notifications", {
      error: error.message,
      documentId,
    });
  }
}

// Simple email sending (replace with Gmail API implementation)
async function sendEmail(emailContent) {
  try {
    // For now, just log the email content
    // In production, implement Gmail API or another email service
    logger.info("Email to be sent", {
      to: emailContent.to,
      subject: emailContent.subject,
    });

    // TODO: Implement actual email sending with Gmail API
  } catch (error) {
    logger.error("Error sending email", {
      error: error.message,
      recipient: emailContent.to,
    });
  }
}

// Export all functions for use in index.js
module.exports = {
  uploadDocument: exports.uploadDocument,
  getDocument: exports.getDocument,
  addSignature: exports.addSignature,
  getUserDocuments: exports.getUserDocuments,
};
