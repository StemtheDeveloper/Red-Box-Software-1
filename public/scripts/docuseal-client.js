/**
 * DocuSeal Integration Client Library
 * Provides functions to interact with DocuSeal Firebase Functions
 */

class DocuSealClient {
  constructor(firebase) {
    this.firebase = firebase;
    // Handle both formats: firebase.functions() or firebase.functions
    this.functions =
      typeof firebase.functions === "function"
        ? firebase.functions()
        : firebase.functions;
  }

  /**
   * Create a new DocuSeal submission
   * @param {Object} options - Submission options
   * @param {string} options.templateId - Existing template ID (optional)
   * @param {string} options.templateHtml - HTML content for new template (optional)
   * @param {string} options.templateName - Name for new template (required if using HTML)
   * @param {Array} options.signers - Array of signer objects with name, email, role
   * @param {Array} options.fields - Array of form fields (optional)
   * @param {boolean} options.sendEmail - Whether to send email to signers (default: true)
   * @param {string} options.redirectUrl - URL to redirect after signing (optional)
   * @returns {Promise<Object>} Submission result
   */
  async createSubmission(options) {
    try {
      const createSubmission = this.firebase.httpsCallable(
        this.functions,
        "createDocuSealSubmission"
      );
      const result = await createSubmission(options);

      if (!result.data.success) {
        throw new Error(result.data.error || "Failed to create submission");
      }

      return result.data;
    } catch (error) {
      console.error("Error creating DocuSeal submission:", error);
      throw error;
    }
  }

  /**
   * Create a PDF template from HTML
   * @param {string} html - HTML content
   * @param {string} name - Template name
   * @param {Array} fields - Form fields (optional)
   * @returns {Promise<Object>} Template result
   */
  async createTemplateFromHtml(html, name, fields = []) {
    try {
      const createTemplate = this.firebase.httpsCallable(
        this.functions,
        "createPdfTemplateFromHtml"
      );
      const result = await createTemplate({
        html: html,
        name: name,
        fields: fields,
      });

      if (!result.data.success) {
        throw new Error(result.data.error || "Failed to create template");
      }

      return result.data;
    } catch (error) {
      console.error("Error creating PDF template:", error);
      throw error;
    }
  }

  /**
   * Get a builder token for embedding DocuSeal form builder
   * @param {Object} options - Builder options
   * @param {Array} options.documentUrls - Allowed document URLs (optional)
   * @param {string} options.userEmail - User email (optional, uses auth user email if not provided)
   * @param {string} options.userName - User name (optional, uses auth user name if not provided)
   * @returns {Promise<Object>} Builder token result
   */
  async getBuilderToken(options = {}) {
    try {
      const getToken = this.firebase.httpsCallable(
        this.functions,
        "getBuilderToken"
      );
      const result = await getToken(options);

      if (!result.data.success) {
        throw new Error(result.data.error || "Failed to get builder token");
      }

      return result.data;
    } catch (error) {
      console.error("Error getting builder token:", error);
      throw error;
    }
  }

  /**
   * Embed DocuSeal form builder in a container element
   * @param {string|HTMLElement} container - Container element or selector
   * @param {Object} options - Builder options
   * @returns {Promise<void>}
   */
  async embedFormBuilder(container, options = {}) {
    try {
      const containerElement =
        typeof container === "string"
          ? document.querySelector(container)
          : container;

      if (!containerElement) {
        throw new Error("Container element not found");
      }

      // Get builder token
      const tokenResult = await this.getBuilderToken(options);

      // Create iframe for DocuSeal builder
      const iframe = document.createElement("iframe");
      iframe.src = `https://api.docuseal.com/embed/builder?token=${tokenResult.builderToken}`;
      iframe.style.width = "100%";
      iframe.style.height = "600px";
      iframe.style.border = "none";
      iframe.frameBorder = "0";

      containerElement.innerHTML = "";
      containerElement.appendChild(iframe);

      console.log("DocuSeal form builder embedded successfully");
    } catch (error) {
      console.error("Error embedding form builder:", error);
      throw error;
    }
  }

  /**
   * Embed DocuSeal signing form in a container element
   * @param {string|HTMLElement} container - Container element or selector
   * @param {string} submissionUrl - DocuSeal submission URL
   * @param {Object} options - Signing options
   * @param {string} options.signerEmail - Signer email (optional)
   * @returns {void}
   */
  embedSigningForm(container, submissionUrl, options = {}) {
    try {
      const containerElement =
        typeof container === "string"
          ? document.querySelector(container)
          : container;

      if (!containerElement) {
        throw new Error("Container element not found");
      }

      if (!submissionUrl) {
        throw new Error("Submission URL is required");
      }

      // Append signer email as query parameter if provided
      let iframeSrc = submissionUrl;
      if (options.signerEmail) {
        const separator = submissionUrl.includes("?") ? "&" : "?";
        iframeSrc += `${separator}email=${encodeURIComponent(
          options.signerEmail
        )}`;
      }

      // Create iframe for DocuSeal signing form
      const iframe = document.createElement("iframe");
      iframe.src = iframeSrc;
      iframe.style.width = "100%";
      iframe.style.height = "600px";
      iframe.style.border = "none";
      iframe.frameBorder = "0";

      containerElement.innerHTML = "";
      containerElement.appendChild(iframe);

      console.log("DocuSeal signing form embedded successfully");
    } catch (error) {
      console.error("Error embedding signing form:", error);
      throw error;
    }
  }

  /**
   * Get submissions from Firestore
   * @param {Object} filters - Query filters (optional)
   * @returns {Promise<Array>} Array of submissions
   */
  async getSubmissions(filters = {}) {
    try {
      const db = this.firebase.firestore();
      let query = db.collection("docuseal_submissions");

      // Apply filters
      if (filters.status) {
        query = query.where("status", "==", filters.status);
      }
      if (filters.createdBy) {
        query = query.where("createdBy", "==", filters.createdBy);
      }

      // Order by creation date (newest first)
      query = query.orderBy("createdAt", "desc");

      const snapshot = await query.get();
      const submissions = [];

      snapshot.forEach((doc) => {
        submissions.push({
          id: doc.id,
          ...doc.data(),
          createdAt: doc.data().createdAt?.toDate(),
          completedAt: doc.data().completedAt?.toDate(),
          expiredAt: doc.data().expiredAt?.toDate(),
        });
      });

      return submissions;
    } catch (error) {
      console.error("Error getting submissions:", error);
      throw error;
    }
  }

  /**
   * Get templates from Firestore
   * @param {Object} filters - Query filters (optional)
   * @returns {Promise<Array>} Array of templates
   */
  async getTemplates(filters = {}) {
    try {
      const db = this.firebase.firestore();
      let query = db.collection("docuseal_templates");

      // Apply filters
      if (filters.status) {
        query = query.where("status", "==", filters.status);
      }
      if (filters.createdBy) {
        query = query.where("createdBy", "==", filters.createdBy);
      }

      // Order by creation date (newest first)
      query = query.orderBy("createdAt", "desc");

      const snapshot = await query.get();
      const templates = [];

      snapshot.forEach((doc) => {
        templates.push({
          id: doc.id,
          ...doc.data(),
          createdAt: doc.data().createdAt?.toDate(),
        });
      });

      return templates;
    } catch (error) {
      console.error("Error getting templates:", error);
      throw error;
    }
  }

  /**
   * Send manual reminder for a submission
   * @param {string} submissionId - Submission ID
   * @returns {Promise<Object>} Reminder result
   */
  async sendReminder(submissionId) {
    try {
      const sendReminder = this.firebase.httpsCallable(
        this.functions,
        "sendSubmissionReminder"
      );
      const result = await sendReminder({ submissionId });

      if (!result.data.success) {
        throw new Error(result.data.error || "Failed to send reminder");
      }

      return result.data;
    } catch (error) {
      console.error("Error sending reminder:", error);
      throw error;
    }
  }

  /**
   * Trigger manual monitoring check
   * @returns {Promise<Object>} Monitoring result
   */
  async triggerMonitoring() {
    try {
      const triggerMonitoring = this.firebase.httpsCallable(
        this.functions,
        "triggerMonitoringCheck"
      );
      const result = await triggerMonitoring();

      if (!result.data.success) {
        throw new Error(result.data.error || "Failed to trigger monitoring");
      }

      return result.data;
    } catch (error) {
      console.error("Error triggering monitoring:", error);
      throw error;
    }
  }
}

// Make DocuSealClient available globally
if (typeof window !== "undefined") {
  window.DocuSealClient = DocuSealClient;
}
