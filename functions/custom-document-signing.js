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

      // Store original document data directly in Firestore (base64)
      // Note: For large documents, consider using a different approach
      const documentFileData = {
        originalData: base64Data,
        fileName: fileName,
        fileType: fileType,
        fileSize: fileSize,
        uploadedBy: userInfo.email,
        uploadedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

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
        signedDocumentData: null, // Will store final signed document data
        fileData: documentFileData, // Store document data directly
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
 * Get document PDF for viewing
 */
exports.getDocumentPdf = onCall(
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

      // Check access permissions (same as getDocument)
      if (request.auth) {
        const userEmail = request.auth.token.email;
        hasAccess = documentData.allowedViewers.includes(userEmail);
        accessorEmail = userEmail;
      }

      if (!hasAccess && accessToken) {
        try {
          const tokenData = verifySecureToken(accessToken);
          if (tokenData.documentId === documentId) {
            hasAccess = true;
            accessorEmail = tokenData.email;
          }
        } catch (err) {
          logger.warn("Invalid access token for PDF access", {
            documentId,
            error: err.message,
          });
        }
      }

      if (!hasAccess) {
        throw new Error("Access denied to view PDF");
      }

      // Get the PDF data from Firestore document
      try {
        // Check if there's a signed version available first
        let pdfData, fileName;

        if (
          documentData.signedDocumentData &&
          documentData.signedDocumentData.data
        ) {
          // Return the signed PDF if available
          pdfData = documentData.signedDocumentData.data;
          fileName = documentData.signedDocumentData.fileName;

          logger.info("Signed PDF retrieved successfully", {
            documentId,
            fileName: fileName,
            accessorEmail,
            fileSize: documentData.signedDocumentData.fileSize,
          });
        } else {
          // Fall back to original PDF
          const fileData = documentData.fileData;
          if (!fileData || !fileData.originalData) {
            throw new Error("PDF data not found in document");
          }

          pdfData = fileData.originalData;
          fileName = documentData.fileName;

          logger.info("Original PDF retrieved successfully", {
            documentId,
            fileName: fileName,
            accessorEmail,
            fileSize: fileData.fileSize,
          });
        }

        return {
          success: true,
          pdfData: pdfData,
          fileName: fileName,
          contentType: "application/pdf",
        };
      } catch (dataError) {
        logger.error("Error retrieving PDF data from document", {
          documentId,
          fileName: documentData.fileName,
          error: dataError.message,
        });
        throw new Error("Failed to retrieve PDF data");
      }
    } catch (error) {
      logger.error("Error getting document PDF", {
        error: error.message,
        documentId: request.data?.documentId,
        userId: request.auth?.uid,
      });

      return {
        success: false,
        error: error.message || "Failed to get PDF",
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

      logger.info("Signature submission data received", {
        documentId,
        signerId,
        hasSignatureData: !!signatureData,
        signatureType,
        annotationsCount: request.data.annotations
          ? request.data.annotations.length
          : 0,
        documentMetadata: request.data.documentMetadata,
        annotations: request.data.annotations,
      });

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
        // Store positioned annotations for PDF generation
        annotations: request.data.annotations || [],
        documentMetadata: request.data.documentMetadata || {},
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

      // Always regenerate the PDF with current signatures to show progress
      await generateSignedPDF(
        documentId,
        documentData.fileName,
        updatedSigners
      );

      // If all signatures collected, send completion notifications
      if (allCompleted) {
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

// Note: Encryption functions removed since we're storing documents directly in Firestore
// For production use, consider implementing client-side encryption before storing in Firestore

// Generate final signed PDF with all signatures
async function generateSignedPDF(documentId, originalFileName, signers) {
  try {
    // Get original document data from Firestore
    const documentRef = admin
      .firestore()
      .collection("documents")
      .doc(documentId);
    const documentDoc = await documentRef.get();

    if (!documentDoc.exists) {
      throw new Error("Document not found");
    }

    const documentData = documentDoc.data();
    const fileData = documentData.fileData;

    if (!fileData || !fileData.originalData) {
      throw new Error("Original document data not found");
    }

    // Convert base64 back to buffer
    const pdfBuffer = Buffer.from(fileData.originalData, "base64");

    // Load PDF with pdf-lib
    const pdfDoc = await PDFLib.PDFDocument.load(pdfBuffer);
    const pages = pdfDoc.getPages();
    const firstPage = pages[0];
    const { width, height } = firstPage.getSize();

    // Add signatures and annotations to the document
    for (let i = 0; i < signers.length; i++) {
      const signer = signers[i];
      if (signer.status === "completed") {
        logger.info("Processing completed signer for PDF generation", {
          signerEmail: signer.email,
          hasAnnotations: !!(
            signer.annotations && signer.annotations.length > 0
          ),
          annotationCount: signer.annotations ? signer.annotations.length : 0,
        });

        // Use positioned annotations if available, otherwise fallback to old method
        if (signer.annotations && signer.annotations.length > 0) {
          await addPositionedAnnotations(
            pdfDoc,
            pages,
            signer.annotations,
            signer.documentMetadata
          );
        } else if (signer.signatureData) {
          // Fallback to old positioning method
          logger.info("Using legacy signature positioning for signer", {
            signerEmail: signer.email,
          });
          await addLegacySignature(pdfDoc, firstPage, signer, i, height);
        }
      }
    }

    // Save signed document data back to Firestore
    const signedPdfBytes = await pdfDoc.save();
    const signedBase64 = Buffer.from(signedPdfBytes).toString("base64");

    // Update document with signed data
    await documentRef.update({
      signedDocumentData: {
        data: signedBase64,
        fileName: `signed_${originalFileName}`,
        generatedAt: admin.firestore.FieldValue.serverTimestamp(),
        fileSize: signedPdfBytes.length,
      },
      auditTrail: admin.firestore.FieldValue.arrayUnion({
        action: "final_pdf_generated",
        timestamp: admin.firestore.Timestamp.now(),
        details: { signedFileName: `signed_${originalFileName}` },
      }),
    });

    logger.info("Signed PDF generated successfully", {
      documentId,
      signedFileName: `signed_${originalFileName}`,
    });
  } catch (error) {
    logger.error("Error generating signed PDF", {
      error: error.message,
      documentId,
    });
  }
}

/**
 * Helper function to add positioned annotations to PDF
 */
async function addPositionedAnnotations(
  pdfDoc,
  pages,
  annotations,
  documentMetadata
) {
  const { StandardFonts, rgb } = PDFLib;

  try {
    logger.info("Starting addPositionedAnnotations", {
      annotationsCount: annotations.length,
      documentMetadata: documentMetadata,
    });

    // Group annotations by page
    const annotationsByPage = {};
    annotations.forEach((annotation) => {
      const pageIndex = (annotation.page || 1) - 1; // Convert to 0-based index
      if (!annotationsByPage[pageIndex]) {
        annotationsByPage[pageIndex] = [];
      }
      annotationsByPage[pageIndex].push(annotation);
    });

    logger.info("Annotations grouped by page", {
      pageGroups: Object.keys(annotationsByPage),
      totalPages: pages.length,
    });

    // Process each page
    for (const [pageIndex, pageAnnotations] of Object.entries(
      annotationsByPage
    )) {
      const pageNum = parseInt(pageIndex);
      if (pageNum >= 0 && pageNum < pages.length) {
        const page = pages[pageNum];
        const { width, height } = page.getSize();

        // Calculate scaling factors from the original PDF dimensions to browser display
        // The frontend now provides both canvas dimensions (for display) and original PDF dimensions
        const firstAnnotation = pageAnnotations[0];

        // Use original PDF dimensions if available, otherwise fall back to canvas dimensions
        const originalPdfWidth = firstAnnotation.originalPdfWidth || width;
        const originalPdfHeight = firstAnnotation.originalPdfHeight || height;
        const canvasWidth =
          firstAnnotation.canvasWidth || documentMetadata?.canvasWidth || 600;
        const canvasHeight =
          firstAnnotation.canvasHeight || documentMetadata?.canvasHeight || 800;

        // For coordinate conversion, we need to convert from the canvas display coordinates
        // to the original PDF coordinate space, then scale to the current PDF size if different

        // Step 1: Convert from canvas display coordinates to original PDF coordinates
        const canvasToOriginalScaleX = originalPdfWidth / canvasWidth;
        const canvasToOriginalScaleY = originalPdfHeight / canvasHeight;

        // Step 2: If the current PDF page size differs from original, scale accordingly
        const finalScaleX = width / originalPdfWidth;
        const finalScaleY = height / originalPdfHeight;

        logger.info("PDF annotation coordinate conversion", {
          pageIndex,
          currentPdfSize: { width, height },
          originalPdfSize: {
            width: originalPdfWidth,
            height: originalPdfHeight,
          },
          canvasSize: { width: canvasWidth, height: canvasHeight },
          canvasToOriginalScale: {
            x: canvasToOriginalScaleX,
            y: canvasToOriginalScaleY,
          },
          finalScale: { x: finalScaleX, y: finalScaleY },
        });

        for (const annotation of pageAnnotations) {
          // Convert coordinates from canvas display space to PDF space
          // Step 1: Scale from canvas coordinates to original PDF coordinates
          const originalPdfX = annotation.x * canvasToOriginalScaleX;
          const originalPdfY = annotation.y * canvasToOriginalScaleY;

          // Step 2: Scale to current PDF size if different from original
          const scaledX = originalPdfX * finalScaleX;
          const scaledY = originalPdfY * finalScaleY;

          // Step 3: Convert from canvas coordinate system (top-left origin, Y down)
          //         to PDF coordinate system (bottom-left origin, Y up)
          const pdfX = scaledX;
          const pdfY = height - scaledY; // Flip Y coordinate

          logger.info("Enhanced coordinate conversion", {
            annotationType: annotation.type,
            canvasCoords: { x: annotation.x, y: annotation.y },
            originalPdfCoords: { x: originalPdfX, y: originalPdfY },
            scaledCoords: { x: scaledX, y: scaledY },
            finalPdfCoords: { x: pdfX, y: pdfY },
            dimensions: {
              canvas: { width: canvasWidth, height: canvasHeight },
              originalPdf: {
                width: originalPdfWidth,
                height: originalPdfHeight,
              },
              currentPdf: { width, height },
            },
          });

          try {
            switch (annotation.type) {
              case "signature":
                await addSignatureAnnotation(
                  pdfDoc,
                  page,
                  annotation,
                  pdfX,
                  pdfY,
                  canvasToOriginalScaleX * finalScaleX,
                  canvasToOriginalScaleY * finalScaleY
                );
                break;
              case "text":
                await addTextAnnotation(pdfDoc, page, annotation, pdfX, pdfY);
                break;
              case "date":
                await addDateAnnotation(pdfDoc, page, annotation, pdfX, pdfY);
                break;
              default:
                logger.warn(`Unknown annotation type: ${annotation.type}`);
            }
          } catch (annotationError) {
            logger.warn("Failed to add annotation", {
              type: annotation.type,
              error: annotationError.message,
              coordinates: { x: pdfX, y: pdfY },
            });
          }
        }
      }
    }
  } catch (error) {
    logger.error("Error adding positioned annotations", {
      error: error.message,
    });
    throw error;
  }
}

/**
 * Helper function to add signature annotation
 */
async function addSignatureAnnotation(
  pdfDoc,
  page,
  annotation,
  x,
  y,
  scaleX,
  scaleY
) {
  try {
    const signatureImageData = annotation.data;
    // Remove data URL prefix if present
    const base64Data = signatureImageData.replace(
      /^data:image\/[a-z]+;base64,/,
      ""
    );
    const signatureImageBuffer = Buffer.from(base64Data, "base64");

    let signatureImage;
    try {
      signatureImage = await pdfDoc.embedPng(signatureImageBuffer);
    } catch (pngError) {
      // Try as JPEG if PNG fails
      try {
        signatureImage = await pdfDoc.embedJpg(signatureImageBuffer);
      } catch (jpgError) {
        logger.warn("Failed to embed signature as PNG or JPG", {
          pngError: pngError.message,
          jpgError: jpgError.message,
        });
        throw new Error("Unable to embed signature image");
      }
    }

    // Calculate appropriate signature dimensions
    // Use proportional sizing based on the scale factors
    const baseWidth = 120;
    const baseHeight = 60;
    const signatureWidth = baseWidth * Math.min(scaleX, scaleY); // Use minimum scale to maintain aspect ratio
    const signatureHeight = baseHeight * Math.min(scaleX, scaleY);

    // Position signature so the click point is at the center-left of the signature
    // This provides intuitive placement for most signature scenarios
    const adjustedX = x - signatureWidth * 0.1; // Slightly left of click point
    const adjustedY = y - signatureHeight * 0.5; // Center vertically around click point

    page.drawImage(signatureImage, {
      x: adjustedX,
      y: adjustedY,
      width: signatureWidth,
      height: signatureHeight,
    });

    logger.info("Signature annotation added", {
      originalCoords: { x, y },
      adjustedCoords: { x: adjustedX, y: adjustedY },
      dimensions: { width: signatureWidth, height: signatureHeight },
      scaleFactors: { scaleX, scaleY },
    });
  } catch (error) {
    logger.warn("Failed to embed signature image", { error: error.message });
    throw error;
  }
}

/**
 * Helper function to add text annotation
 */
async function addTextAnnotation(pdfDoc, page, annotation, x, y) {
  const { StandardFonts, rgb } = PDFLib;

  try {
    const fontSize = annotation.fontSize ? parseInt(annotation.fontSize) : 14;
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

    // Position text so click point is at the beginning of the text baseline
    // This provides intuitive text placement
    const adjustedX = x;
    const adjustedY = y - fontSize * 0.2; // Slight adjustment for better visual alignment

    page.drawText(annotation.data, {
      x: adjustedX,
      y: adjustedY,
      size: fontSize,
      font: font,
      color: rgb(0, 0, 0),
    });

    logger.info("Text annotation added", {
      text: annotation.data,
      originalCoords: { x, y },
      adjustedCoords: { x: adjustedX, y: adjustedY },
      fontSize: fontSize,
    });
  } catch (error) {
    logger.warn("Failed to add text annotation", { error: error.message });
    throw error;
  }
}

/**
 * Helper function to add date annotation
 */
async function addDateAnnotation(pdfDoc, page, annotation, x, y) {
  const { StandardFonts, rgb } = PDFLib;

  try {
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontSize = 12;

    // Position date so click point is at the beginning of the text baseline
    const adjustedX = x;
    const adjustedY = y - fontSize * 0.2; // Slight adjustment for better visual alignment

    page.drawText(annotation.data, {
      x: adjustedX,
      y: adjustedY,
      size: fontSize,
      font: font,
      color: rgb(0, 0, 0),
    });

    logger.info("Date annotation added", {
      date: annotation.data,
      originalCoords: { x, y },
      adjustedCoords: { x: adjustedX, y: adjustedY },
      fontSize: fontSize,
    });
  } catch (error) {
    logger.warn("Failed to add date annotation", { error: error.message });
    throw error;
  }
}

/**
 * Helper function for legacy signature positioning (fallback)
 */
async function addLegacySignature(
  pdfDoc,
  page,
  signer,
  signerIndex,
  pageHeight
) {
  const { StandardFonts, rgb } = PDFLib;

  try {
    const yPosition = pageHeight - 100 - signerIndex * 60; // Stack signatures vertically

    if (signer.signatureData.type === "image") {
      try {
        // Embed signature image
        const signatureImageData = signer.signatureData.data;
        // Remove data URL prefix if present
        const base64Data = signatureImageData.replace(
          /^data:image\/[a-z]+;base64,/,
          ""
        );
        const signatureImageBuffer = Buffer.from(base64Data, "base64");

        let signatureImage;
        try {
          signatureImage = await pdfDoc.embedPng(signatureImageBuffer);
        } catch (pngError) {
          signatureImage = await pdfDoc.embedJpg(signatureImageBuffer);
        }

        page.drawImage(signatureImage, {
          x: 50,
          y: yPosition,
          width: 150,
          height: 40,
        });
      } catch (imageError) {
        logger.warn("Failed to embed signature image, using text", {
          signerId: signer.id,
          error: imageError.message,
        });

        // Fallback to text signature
        const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
        page.drawText(`Signed by: ${signer.name}`, {
          x: 50,
          y: yPosition,
          size: 12,
          font: font,
          color: rgb(0, 0, 0),
        });
      }
    } else {
      // Text signature
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
      page.drawText(`Signed by: ${signer.name}`, {
        x: 50,
        y: yPosition,
        size: 12,
        font: font,
        color: rgb(0, 0, 0),
      });
    }

    // Add signature details
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const detailsY = yPosition - 15;
    page.drawText(
      `Signed by: ${signer.name} | Date: ${signer.signedAt
        .toDate()
        .toLocaleDateString()}`,
      {
        x: 50,
        y: detailsY,
        size: 8,
        font: font,
        color: rgb(0.5, 0.5, 0.5),
      }
    );
  } catch (error) {
    logger.warn("Failed to add legacy signature", {
      signerId: signer.id,
      error: error.message,
    });
    throw error;
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
  getDocumentPdf: exports.getDocumentPdf,
  addSignature: exports.addSignature,
  getUserDocuments: exports.getUserDocuments,
};
