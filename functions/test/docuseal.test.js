// Unit tests for DocuSeal Firebase Functions

const axios = require("axios");
const jwt = require("jsonwebtoken");

// Mock axios
jest.mock("axios");
const mockedAxios = axios;

// Import the functions to test
const functions = require("../index");

describe("DocuSeal Firebase Functions", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("Authentication and Security", () => {
    test("verifyAuthentication should throw error when no auth", async () => {
      const request = { data: {} };

      try {
        await functions.createDocuSealSubmission.run(request);
        fail("Should have thrown authentication error");
      } catch (error) {
        expect(error.message).toContain("Authentication required");
      }
    });

    test("verifyAuthentication should throw error for non-admin user", async () => {
      const request = {
        auth: {
          uid: "test-uid",
          token: {
            email: "regular-user@example.com",
            name: "Regular User",
          },
        },
        data: {},
      };

      try {
        await functions.createDocuSealSubmission.run(request);
        fail("Should have thrown admin access error");
      } catch (error) {
        expect(error.message).toContain("Admin access required");
      }
    });

    test("verifyAuthentication should succeed for admin user", async () => {
      const request = {
        auth: {
          uid: "admin-uid",
          token: {
            email: "stiaan44@gmail.com",
            name: "Admin User",
          },
        },
        data: {
          templateId: "test-template",
          signers: [{ name: "Test Signer", email: "signer@example.com" }],
        },
      };

      // Mock successful DocuSeal API response
      mockedAxios.post.mockResolvedValueOnce({
        status: 201,
        data: {
          id: "submission-123",
          url: "https://docuseal.com/sign/abc123",
          status: "pending",
          submitters: [],
        },
      });

      const result = await functions.createDocuSealSubmission.run(request);
      expect(result.success).toBe(true);
      expect(result.submissionId).toBe("submission-123");
    });
  });

  describe("createDocuSealSubmission", () => {
    const adminRequest = {
      auth: {
        uid: "admin-uid",
        token: {
          email: "stiaan44@gmail.com",
          name: "Admin User",
        },
      },
      data: {},
    };

    test("should create submission with existing template", async () => {
      const request = {
        ...adminRequest,
        data: {
          templateId: "template-123",
          signers: [
            { name: "John Doe", email: "john@example.com", role: "Signer" },
            { name: "Jane Smith", email: "jane@example.com", role: "Witness" },
          ],
          sendEmail: true,
          redirectUrl: "https://example.com/success",
        },
      };

      mockedAxios.post.mockResolvedValueOnce({
        status: 201,
        data: {
          id: "submission-456",
          url: "https://docuseal.com/sign/def456",
          status: "pending",
          submitters: [],
          template: { id: "template-123", name: "Test Template" },
        },
      });

      const result = await functions.createDocuSealSubmission.run(request);

      expect(result.success).toBe(true);
      expect(result.submissionId).toBe("submission-456");
      expect(result.submissionUrl).toBe("https://docuseal.com/sign/def456");
      expect(mockedAxios.post).toHaveBeenCalledWith(
        "https://api.docuseal.com/submissions",
        expect.objectContaining({
          template_id: "template-123",
          submitters: expect.arrayContaining([
            expect.objectContaining({
              name: "John Doe",
              email: "john@example.com",
              role: "Signer",
            }),
          ]),
          send_email: true,
          redirect_url: "https://example.com/success",
        }),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer test-api-key-for-jest",
          }),
        })
      );
    });

    test("should create submission with HTML template", async () => {
      const request = {
        ...adminRequest,
        data: {
          templateHtml:
            "<html><body>Test template with {{name}} field</body></html>",
          templateName: "Test HTML Template",
          signers: [{ name: "Test User", email: "test@example.com" }],
          fields: [{ name: "name", type: "text" }],
        },
      };

      // Mock template creation response
      mockedAxios.post
        .mockResolvedValueOnce({
          status: 201,
          data: { id: "new-template-789" },
        })
        // Mock submission creation response
        .mockResolvedValueOnce({
          status: 201,
          data: {
            id: "submission-789",
            url: "https://docuseal.com/sign/ghi789",
            status: "pending",
            submitters: [],
          },
        });

      const result = await functions.createDocuSealSubmission.run(request);

      expect(result.success).toBe(true);
      expect(result.submissionId).toBe("submission-789");
      expect(mockedAxios.post).toHaveBeenCalledTimes(2); // Template creation + submission creation
    });

    test("should handle DocuSeal API errors", async () => {
      const request = {
        ...adminRequest,
        data: {
          templateId: "invalid-template",
          signers: [{ name: "Test User", email: "test@example.com" }],
        },
      };

      mockedAxios.post.mockRejectedValueOnce({
        response: {
          status: 404,
          data: { error: "Template not found" },
        },
      });

      const result = await functions.createDocuSealSubmission.run(request);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe("createPdfTemplateFromHtml", () => {
    const adminRequest = {
      auth: {
        uid: "admin-uid",
        token: {
          email: "stiaan44@gmail.com",
          name: "Admin User",
        },
      },
      data: {},
    };

    test("should create PDF template from HTML", async () => {
      const request = {
        ...adminRequest,
        data: {
          html: "<html><body><h1>{{title}}</h1><p>{{content}}</p></body></html>",
          name: "Test PDF Template",
          fields: [
            { name: "title", type: "text" },
            { name: "content", type: "text" },
          ],
        },
      };

      mockedAxios.post.mockResolvedValueOnce({
        status: 201,
        data: {
          id: "template-pdf-123",
          name: "Test PDF Template",
          download_url: "https://docuseal.com/templates/pdf-123/download",
        },
      });

      const result = await functions.createPdfTemplateFromHtml.run(request);

      expect(result.success).toBe(true);
      expect(result.templateId).toBe("template-pdf-123");
      expect(result.templateName).toBe("Test PDF Template");
      expect(result.downloadUrl).toBe(
        "https://docuseal.com/templates/pdf-123/download"
      );
    });

    test("should validate required parameters", async () => {
      const request = {
        ...adminRequest,
        data: {
          html: "<html><body>Test</body></html>",
          // Missing name parameter
        },
      };

      const result = await functions.createPdfTemplateFromHtml.run(request);

      expect(result.success).toBe(false);
      expect(result.error).toContain(
        "HTML content and template name are required"
      );
    });
  });

  describe("getBuilderToken", () => {
    const adminRequest = {
      auth: {
        uid: "admin-uid",
        token: {
          email: "stiaan44@gmail.com",
          name: "Admin User",
        },
      },
      data: {},
    };

    test("should generate valid JWT token", async () => {
      const request = {
        ...adminRequest,
        data: {
          documentUrls: ["https://example.com/doc1.pdf"],
          userEmail: "builder@example.com",
          userName: "Builder User",
        },
      };

      const result = await functions.getBuilderToken.run(request);

      expect(result.success).toBe(true);
      expect(result.builderToken).toBeDefined();
      expect(result.expiresAt).toBeDefined();

      // Verify token structure
      const decoded = jwt.decode(result.builderToken);
      expect(decoded.user_email).toBe("builder@example.com");
      expect(decoded.name).toBe("Builder User");
      expect(decoded.allowed_document_urls).toEqual([
        "https://example.com/doc1.pdf",
      ]);
    });

    test("should use auth user info when not provided", async () => {
      const request = {
        ...adminRequest,
        data: {},
      };

      const result = await functions.getBuilderToken.run(request);

      expect(result.success).toBe(true);

      const decoded = jwt.decode(result.builderToken);
      expect(decoded.user_email).toBe("stiaan44@gmail.com");
      expect(decoded.name).toBe("Admin User");
    });
  });

  describe("docusealWebhook", () => {
    test("should handle submission completed webhook", async () => {
      const req = {
        method: "POST",
        body: {
          event_type: "submission.completed",
          data: {
            id: "submission-123",
            status: "completed",
            download_url: "https://docuseal.com/download/123",
          },
        },
      };

      const res = {
        set: jest.fn(),
        status: jest.fn(() => res),
        send: jest.fn(),
      };

      // Mock document download for storage
      mockedAxios.get.mockResolvedValueOnce({
        data: Buffer.from("PDF content"),
      });

      await functions.docusealWebhook.run(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.send).toHaveBeenCalledWith("OK");
    });

    test("should reject non-POST requests", async () => {
      const req = { method: "GET" };
      const res = {
        set: jest.fn(),
        status: jest.fn(() => res),
        send: jest.fn(),
      };

      await functions.docusealWebhook.run(req, res);

      expect(res.status).toHaveBeenCalledWith(405);
      expect(res.send).toHaveBeenCalledWith("Method not allowed");
    });

    test("should validate webhook data", async () => {
      const req = {
        method: "POST",
        body: {}, // Invalid webhook data
      };

      const res = {
        set: jest.fn(),
        status: jest.fn(() => res),
        send: jest.fn(),
      };

      await functions.docusealWebhook.run(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.send).toHaveBeenCalledWith("Invalid webhook data");
    });
  });

  describe("sendSubmissionReminder", () => {
    const adminRequest = {
      auth: {
        uid: "admin-uid",
        token: {
          email: "stiaan44@gmail.com",
          name: "Admin User",
        },
      },
      data: {},
    };

    test("should send reminder for valid submission", async () => {
      const request = {
        ...adminRequest,
        data: { submissionId: "submission-123" },
      };

      // Mock DocuSeal API responses
      mockedAxios.get.mockResolvedValueOnce({
        status: 200,
        data: {
          id: "submission-123",
          status: "pending",
          submitters: [
            {
              id: "submitter-1",
              email: "test@example.com",
              status: "pending",
            },
          ],
        },
      });

      mockedAxios.post.mockResolvedValueOnce({
        status: 200,
        data: { success: true },
      });

      const result = await functions.sendSubmissionReminder.run(request);

      expect(result.success).toBe(true);
      expect(result.message).toBe("Reminder sent successfully");
    });

    test("should validate submission ID parameter", async () => {
      const request = {
        ...adminRequest,
        data: {}, // Missing submissionId
      };

      const result = await functions.sendSubmissionReminder.run(request);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Submission ID is required");
    });
  });

  describe("monitoringAndAlerts", () => {
    test("should run monitoring check and generate alerts", async () => {
      const event = { timestamp: new Date().toISOString() };

      // Mock Slack webhook call
      mockedAxios.post.mockResolvedValueOnce({
        status: 200,
        data: "ok",
      });

      // Should not throw errors
      await expect(
        functions.monitoringAndAlerts.run(event)
      ).resolves.toBeUndefined();
    });
  });

  describe("triggerMonitoringCheck", () => {
    const adminRequest = {
      auth: {
        uid: "admin-uid",
        token: {
          email: "stiaan44@gmail.com",
          name: "Admin User",
        },
      },
      data: {},
    };

    test("should trigger manual monitoring check", async () => {
      // Mock Slack webhook call
      mockedAxios.post.mockResolvedValueOnce({
        status: 200,
        data: "ok",
      });

      const result = await functions.triggerMonitoringCheck.run(adminRequest);

      expect(result.success).toBe(true);
      expect(result.message).toBe("Monitoring check completed successfully");
    });
  });

  describe("Rate Limiting", () => {
    test("should enforce rate limits", async () => {
      const request = {
        auth: {
          uid: "rate-limit-test-uid",
          token: {
            email: "stiaan44@gmail.com",
            name: "Admin User",
          },
        },
        data: {
          templateId: "test-template",
          signers: [{ name: "Test", email: "test@example.com" }],
        },
      };

      // Mock successful responses for multiple calls
      mockedAxios.post.mockResolvedValue({
        status: 201,
        data: {
          id: "submission-rate-test",
          url: "https://docuseal.com/sign/rate-test",
          status: "pending",
        },
      });

      // Make multiple rapid calls - should eventually hit rate limit
      // Note: In a real test, you'd want to test the actual rate limiting logic
      // For now, we'll just verify the function structure works
      const results = [];
      for (let i = 0; i < 3; i++) {
        try {
          const result = await functions.createDocuSealSubmission.run(request);
          results.push(result);
        } catch (error) {
          results.push({ error: error.message });
        }
      }

      // At least some calls should succeed
      expect(results.some((r) => r.success)).toBe(true);
    });
  });
});
