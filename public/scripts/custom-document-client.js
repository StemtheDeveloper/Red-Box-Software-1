/**
 * Custom Document Signing Client Library
 * Replaces DocuSeal with custom self-hosted solution
 */

class CustomDocumentClient {
  constructor(firebase) {
    this.firebase = firebase;
    // Handle both formats: firebase.functions() or firebase.functions
    this.functions =
      typeof firebase.functions === "function"
        ? firebase.functions()
        : firebase.functions;
    this.auth = firebase.auth;
    this.storage = firebase.storage;
    this.firestore = firebase.firestore;
  }

  /**
   * Upload a document for signing
   * @param {Object} options - Upload options
   * @param {File} options.file - PDF file to upload
   * @param {string} options.title - Document title
   * @param {string} options.description - Optional description
   * @param {Array} options.signers - Array of signer objects {name, email, role}
   * @returns {Promise<Object>} Upload result
   */ async uploadDocument(options) {
    try {
      const { file, title, description = "", signers = [] } = options;

      if (!file || !title || signers.length === 0) {
        throw new Error("File, title, and signers are required");
      }

      if (file.type !== "application/pdf") {
        throw new Error("Only PDF files are supported");
      }

      if (file.size > 10 * 1024 * 1024) {
        throw new Error("File size must be under 10MB");
      }

      // Convert file to base64
      const base64Data = await this.fileToBase64(file);

      // Import httpsCallable dynamically and create the function
      const { httpsCallable } = await import(
        "https://www.gstatic.com/firebasejs/10.7.1/firebase-functions.js"
      );

      const uploadFunction = httpsCallable(this.functions, "uploadDocument");

      const payload = {
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type,
        base64Data: base64Data,
        title: title,
        description: description,
        signers: signers,
      };

      const result = await uploadFunction(payload);

      if (!result.data.success) {
        throw new Error(result.data.error || "Failed to upload document");
      }

      return result.data;
    } catch (error) {
      console.error("Error uploading document:", error);
      throw error;
    }
  }

  /**
   * Get document details
   * @param {string} documentId - Document ID
   * @param {string} accessToken - Optional access token for unauthenticated access
   * @returns {Promise<Object>} Document data
   */
  async getDocument(documentId, accessToken = null) {
    try {
      const { httpsCallable } = await import(
        "https://www.gstatic.com/firebasejs/10.7.1/firebase-functions.js"
      );

      const getDocumentFunction = httpsCallable(this.functions, "getDocument");

      const result = await getDocumentFunction({
        documentId: documentId,
        accessToken: accessToken,
      });

      if (!result.data.success) {
        throw new Error(result.data.error || "Failed to get document");
      }

      return result.data;
    } catch (error) {
      console.error("Error getting document:", error);
      throw error;
    }
  }

  /**
   * Add signature to document
   * @param {Object} options - Signature options
   * @param {string} options.documentId - Document ID
   * @param {string} options.signerId - Signer ID
   * @param {string} options.accessToken - Access token for unauthenticated signing
   * @param {string} options.signatureData - Base64 encoded signature image
   * @param {string} options.signatureType - "image" or "text"
   * @param {string} options.textSignature - Text signature if type is "text"
   * @returns {Promise<Object>} Signature result
   */
  async addSignature(options) {
    try {
      const {
        documentId,
        signerId,
        accessToken,
        signatureData,
        signatureType = "image",
        textSignature = "",
      } = options;

      if (!documentId || !signerId || (!signatureData && !textSignature)) {
        throw new Error(
          "Document ID, signer ID, and signature data are required"
        );
      }

      const { httpsCallable } = await import(
        "https://www.gstatic.com/firebasejs/10.7.1/firebase-functions.js"
      );

      const addSignatureFunction = httpsCallable(
        this.functions,
        "addSignature"
      );

      const result = await addSignatureFunction({
        documentId: documentId,
        signerId: signerId,
        accessToken: accessToken,
        signatureData: signatureData,
        signatureType: signatureType,
        textSignature: textSignature,
      });

      if (!result.data.success) {
        throw new Error(result.data.error || "Failed to add signature");
      }

      return result.data;
    } catch (error) {
      console.error("Error adding signature:", error);
      throw error;
    }
  }

  /**
   * Get user's documents
   * @param {Object} filters - Optional filters
   * @param {number} filters.limit - Maximum number of documents to return
   * @param {string} filters.status - Filter by status
   * @returns {Promise<Object>} Documents list
   */
  async getUserDocuments(filters = {}) {
    try {
      const { httpsCallable } = await import(
        "https://www.gstatic.com/firebasejs/10.7.1/firebase-functions.js"
      );

      const getUserDocumentsFunction = httpsCallable(
        this.functions,
        "getUserDocuments"
      );

      const result = await getUserDocumentsFunction(filters);

      if (!result.data.success) {
        throw new Error(result.data.error || "Failed to get documents");
      }

      return result.data;
    } catch (error) {
      console.error("Error getting user documents:", error);
      throw error;
    }
  }

  /**
   * Create signature canvas for drawing signatures
   * @param {string|HTMLElement} container - Container element or selector
   * @param {Object} options - Canvas options
   * @returns {Object} Signature pad instance
   */
  createSignatureCanvas(container, options = {}) {
    const containerElement =
      typeof container === "string"
        ? document.querySelector(container)
        : container;

    if (!containerElement) {
      throw new Error("Container element not found");
    }

    // Create canvas element
    const canvas = document.createElement("canvas");
    canvas.width = options.width || 400;
    canvas.height = options.height || 200;
    canvas.style.border = "1px solid #ccc";
    canvas.style.borderRadius = "4px";
    canvas.style.cursor = "crosshair";

    containerElement.appendChild(canvas);

    const ctx = canvas.getContext("2d");
    let drawing = false;
    let lastX = 0;
    let lastY = 0;

    // Set up drawing context
    ctx.strokeStyle = options.strokeColor || "#000";
    ctx.lineWidth = options.lineWidth || 2;
    ctx.lineCap = "round";

    function startDrawing(e) {
      drawing = true;
      const rect = canvas.getBoundingClientRect();
      [lastX, lastY] = [e.clientX - rect.left, e.clientY - rect.top];
    }

    function draw(e) {
      if (!drawing) return;

      const rect = canvas.getBoundingClientRect();
      const currentX = e.clientX - rect.left;
      const currentY = e.clientY - rect.top;

      ctx.beginPath();
      ctx.moveTo(lastX, lastY);
      ctx.lineTo(currentX, currentY);
      ctx.stroke();

      [lastX, lastY] = [currentX, currentY];
    }

    function stopDrawing() {
      drawing = false;
    }

    // Mouse events
    canvas.addEventListener("mousedown", startDrawing);
    canvas.addEventListener("mousemove", draw);
    canvas.addEventListener("mouseup", stopDrawing);

    // Touch events for mobile
    canvas.addEventListener("touchstart", (e) => {
      e.preventDefault();
      const touch = e.touches[0];
      const mouseEvent = new MouseEvent("mousedown", {
        clientX: touch.clientX,
        clientY: touch.clientY,
      });
      canvas.dispatchEvent(mouseEvent);
    });

    canvas.addEventListener("touchmove", (e) => {
      e.preventDefault();
      const touch = e.touches[0];
      const mouseEvent = new MouseEvent("mousemove", {
        clientX: touch.clientX,
        clientY: touch.clientY,
      });
      canvas.dispatchEvent(mouseEvent);
    });

    canvas.addEventListener("touchend", (e) => {
      e.preventDefault();
      const mouseEvent = new MouseEvent("mouseup", {});
      canvas.dispatchEvent(mouseEvent);
    });

    return {
      canvas: canvas,
      clear: () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      },
      isEmpty: () => {
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        return !imageData.data.some((channel) => channel !== 0);
      },
      getSignatureData: () => {
        if (this.isEmpty()) {
          throw new Error("Please provide a signature");
        }
        return canvas.toDataURL("image/png").split(",")[1]; // Return base64 without prefix
      },
    };
  }

  /**
   * Helper function to convert File to base64
   * @private
   */
  fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        // Remove the data:application/pdf;base64, prefix
        const base64 = reader.result.split(",")[1];
        resolve(base64);
      };
      reader.onerror = (error) => reject(error);
    });
  }

  /**
   * Format file size for display
   * @param {number} bytes - File size in bytes
   * @returns {string} Formatted file size
   */
  formatFileSize(bytes) {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  }

  /**
   * Validate email address
   * @param {string} email - Email to validate
   * @returns {boolean} Is valid email
   */
  isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  /**
   * Show notification message
   * @param {string} message - Message text
   * @param {string} type - Message type (success, error, info, warning)
   */
  showMessage(message, type = "info") {
    // Remove any existing messages
    const existingMessage = document.querySelector(".custom-message");
    if (existingMessage) {
      existingMessage.remove();
    }

    // Create message element
    const messageDiv = document.createElement("div");
    messageDiv.className = `custom-message custom-message-${type}`;
    messageDiv.innerHTML = `
      <div style="
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 15px 20px;
        border-radius: 4px;
        color: white;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 14px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        z-index: 10000;
        max-width: 400px;
        word-wrap: break-word;
        background-color: ${this.getMessageColor(type)};
      ">
        ${message}
        <button onclick="this.parentElement.parentElement.remove()" 
          style="background: none; border: none; color: white; float: right; 
                 font-size: 16px; cursor: pointer; margin-left: 10px;">&times;</button>
      </div>
    `;

    document.body.appendChild(messageDiv);

    // Auto-remove after 5 seconds
    setTimeout(() => {
      if (messageDiv.parentNode) {
        messageDiv.remove();
      }
    }, 5000);
  }

  /**
   * Get message background color based on type
   * @private
   */
  getMessageColor(type) {
    const colors = {
      success: "#4CAF50",
      error: "#f44336",
      warning: "#ff9800",
      info: "#2196F3",
    };
    return colors[type] || colors.info;
  }
}

// Make CustomDocumentClient available globally
if (typeof window !== "undefined") {
  window.CustomDocumentClient = CustomDocumentClient;
}

// Export for module systems
if (typeof module !== "undefined" && module.exports) {
  module.exports = CustomDocumentClient;
}
