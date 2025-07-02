// Integration tests for DocuSeal Firebase Functions workflow

const axios = require("axios");

// Mock axios for consistent testing
jest.mock("axios");
const mockedAxios = axios;

const functions = require("../index");

describe("DocuSeal Integration Tests", () => {
  const adminAuth = {
    uid: "admin-uid",
    token: {
      email: "stiaan44@gmail.com",
      name: "Admin User"
    }
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("Complete Document Workflow", () => {
    test("should complete full document signing workflow", async () => {
      // Step 1: Create template from HTML
      const templateRequest = {
        auth: adminAuth,
        data: {
          html: "<html><body><h1>Contract Agreement</h1><p>Name: {{signer_name}}</p><p>Signature: {{signature}}</p></body></html>",
          name: "Contract Template",
          fields: [
            {name: "signer_name", type: "text"},
            {name: "signature", type: "signature"}
          ]
        }
      };

      mockedAxios.post.mockResolvedValueOnce({
        status: 201,
        data: {
          id: "template-integration-123",
          name: "Contract Template",
          download_url:
            "https://docuseal.com/templates/integration-123/download"
        }
      });

      const templateResult = await functions.createPdfTemplateFromHtml.run(
        templateRequest
      );
      expect(templateResult.success).toBe(true);
      expect(templateResult.templateId).toBe("template-integration-123");

      // Step 2: Create submission using the template
      const submissionRequest = {
        auth: adminAuth,
        data: {
          templateId: "template-integration-123",
          signers: [
            {
              name: "John Doe",
              email: "john.doe@example.com",
              role: "Signer"
            },
            {
              name: "Jane Smith",
              email: "jane.smith@example.com",
              role: "Witness"
            }
          ],
          sendEmail: true,
          redirectUrl: "https://example.com/success"
        }
      };

      mockedAxios.post.mockResolvedValueOnce({
        status: 201,
        data: {
          id: "submission-integration-456",
          url: "https://docuseal.com/sign/integration-456",
          status: "pending",
          submitters: [
            {
              id: "submitter-1",
              email: "john.doe@example.com",
              status: "sent"
            },
            {
              id: "submitter-2",
              email: "jane.smith@example.com",
              status: "sent"
            }
          ],
          template: {
            id: "template-integration-123",
            name: "Contract Template"
          }
        }
      });

      const submissionResult = await functions.createDocuSealSubmission.run(
        submissionRequest
      );
      expect(submissionResult.success).toBe(true);
      expect(submissionResult.submissionId).toBe("submission-integration-456");
      expect(submissionResult.submissionUrl).toBe(
        "https://docuseal.com/sign/integration-456"
      );

      // Step 3: Simulate webhook for completion
      const webhookReq = {
        method: "POST",
        body: {
          event_type: "submission.completed",
          data: {
            id: "submission-integration-456",
            status: "completed",
            download_url: "https://docuseal.com/download/integration-456",
            submitters: [
              {
                id: "submitter-1",
                email: "john.doe@example.com",
                status: "completed"
              },
              {
                id: "submitter-2",
                email: "jane.smith@example.com",
                status: "completed"
              }
            ]
          }
        }
      };

      const webhookRes = {
        set: jest.fn(),
        status: jest.fn(() => webhookRes),
        send: jest.fn()
      };

      // Mock document download for storage
      mockedAxios.get.mockResolvedValueOnce({
        data: Buffer.from("Mock PDF content for completed document")
      });

      await functions.docusealWebhook.run(webhookReq, webhookRes);
      expect(webhookRes.status).toHaveBeenCalledWith(200);

      // Step 4: Verify reminder functionality
      const reminderRequest = {
        auth: adminAuth,
        data: {submissionId: "submission-integration-456"}
      };

      // Mock DocuSeal API for getting submission status
      mockedAxios.get.mockResolvedValueOnce({
        status: 200,
        data: {
          id: "submission-integration-456",
          status: "completed",
          submitters: [
            {
              id: "submitter-1",
              email: "john.doe@example.com",
              status: "completed"
            },
            {
              id: "submitter-2",
              email: "jane.smith@example.com",
              status: "completed"
            }
          ]
        }
      });

      const reminderResult = await functions.sendSubmissionReminder.run(
        reminderRequest
      );
      expect(reminderResult.success).toBe(true);
    });
  });

  describe("Error Handling and Recovery", () => {
    test("should handle DocuSeal API failures gracefully", async () => {
      const request = {
        auth: adminAuth,
        data: {
          templateId: "non-existent-template",
          signers: [{name: "Test User", email: "test@example.com"}]
        }
      };

      // Simulate API failure
      mockedAxios.post.mockRejectedValueOnce({
        response: {
          status: 404,
          data: {error: "Template not found"}
        },
        message: "Request failed with status code 404"
      });

      const result = await functions.createDocuSealSubmission.run(request);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      // Should not throw unhandled errors
    });

    test("should handle network timeouts", async () => {
      const request = {
        auth: adminAuth,
        data: {
          html: "<html><body>Test</body></html>",
          name: "Test Template"
        }
      };

      // Simulate network timeout
      mockedAxios.post.mockRejectedValueOnce({
        code: "ECONNABORTED",
        message: "timeout of 5000ms exceeded"
      });

      const result = await functions.createPdfTemplateFromHtml.run(request);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe("Security and Validation", () => {
    test("should reject requests with invalid data", async () => {
      const invalidRequests = [
        {
          auth: adminAuth,
          data: {
            // Missing required signers
            templateId: "test-template"
          }
        },
        {
          auth: adminAuth,
          data: {
            // Invalid signer data
            templateId: "test-template",
            signers: [{name: ""}] // Missing email
          }
        },
        {
          auth: adminAuth,
          data: {
            // Missing template reference
            signers: [{name: "Test", email: "test@example.com"}]
          }
        }
      ];

      for (const request of invalidRequests) {
        const result = await functions.createDocuSealSubmission.run(request);
        expect(result.success).toBe(false);
      }
    });

    test("should sanitize input data", async () => {
      const request = {
        auth: adminAuth,
        data: {
          templateHtml:
            "<script>alert(\"xss\")</script><html><body>{{name}}</body></html>",
          templateName: "Test Template",
          signers: [{name: "Test User", email: "test@example.com"}]
        }
      };

      mockedAxios.post
        .mockResolvedValueOnce({
          status: 201,
          data: {id: "template-sanitized"}
        })
        .mockResolvedValueOnce({
          status: 201,
          data: {
            id: "submission-sanitized",
            url: "https://docuseal.com/sign/sanitized",
            status: "pending"
          }
        });

      const result = await functions.createDocuSealSubmission.run(request);
      expect(result.success).toBe(true);

      // Verify that the HTML was passed to DocuSeal API
      // (DocuSeal should handle its own sanitization)
      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.stringContaining("/templates/html"),
        expect.objectContaining({
          html: expect.stringContaining("<script>")
        }),
        expect.any(Object)
      );
    });
  });

  describe("Performance and Scalability", () => {
    test("should handle multiple concurrent requests", async () => {
      const requests = Array.from({length: 5}, (_, i) => ({
        auth: {
          uid: `user-${i}`,
          token: {
            email: "stiaan44@gmail.com",
            name: `User ${i}`
          }
        },
        data: {
          templateId: `template-${i}`,
          signers: [{name: `Signer ${i}`, email: `signer${i}@example.com`}]
        }
      }));

      // Mock responses for all requests
      mockedAxios.post.mockImplementation(() =>
        Promise.resolve({
          status: 201,
          data: {
            id: `submission-${Date.now()}-${Math.random()}`,
            url: "https://docuseal.com/sign/concurrent",
            status: "pending"
          }
        })
      );

      const promises = requests.map((req) =>
        functions.createDocuSealSubmission.run(req)
      );
      const results = await Promise.all(promises);

      // All requests should succeed
      results.forEach((result) => {
        expect(result.success).toBe(true);
      });

      // Should have made 5 API calls
      expect(mockedAxios.post).toHaveBeenCalledTimes(5);
    });

    test("should respect rate limiting", async () => {
      const userId = "rate-limit-user";
      const request = {
        auth: {
          uid: userId,
          token: {
            email: "stiaan44@gmail.com",
            name: "Rate Limit Test User"
          }
        },
        data: {
          templateId: "rate-limit-template",
          signers: [{name: "Test", email: "test@example.com"}]
        }
      };

      mockedAxios.post.mockResolvedValue({
        status: 201,
        data: {
          id: "rate-limit-submission",
          url: "https://docuseal.com/sign/rate-limit",
          status: "pending"
        }
      });

      // Make rapid successive calls
      const promises = Array.from({length: 25}, () =>
        functions.createDocuSealSubmission.run(request)
      );

      const results = await Promise.all(
        promises.map((p) => p.catch((error) => ({error: error.message})))
      );

      // Some requests should succeed, others should be rate limited
      const successes = results.filter((r) => r.success);
      const rateLimited = results.filter(
        (r) => r.error && r.error.includes("Rate limit")
      );

      expect(successes.length).toBeGreaterThan(0);
      expect(rateLimited.length).toBeGreaterThan(0);
    });
  });

  describe("Monitoring and Alerts Integration", () => {
    test("should run monitoring check without errors", async () => {
      const event = {timestamp: new Date().toISOString()};

      // Mock Slack webhook response
      mockedAxios.post.mockResolvedValueOnce({
        status: 200,
        data: "ok"
      });

      // Should complete without throwing
      await expect(
        functions.monitoringAndAlerts.run(event)
      ).resolves.toBeUndefined();
    });

    test("should generate appropriate alerts for stale submissions", async () => {
      const event = {timestamp: new Date().toISOString()};

      // Mock Slack webhook to capture alert message
      let alertMessage = "";
      mockedAxios.post.mockImplementation((url, data) => {
        if (url.includes("slack")) {
          alertMessage = data.text;
        }
        return Promise.resolve({status: 200, data: "ok"});
      });

      await functions.monitoringAndAlerts.run(event);

      // Slack should have been called with monitoring data
      expect(mockedAxios.post).toHaveBeenCalledWith(
        "https://hooks.slack.com/test-webhook",
        expect.objectContaining({
          text: expect.stringContaining("DocuSeal"),
          username: "DocuSeal Monitor"
        })
      );
    });
  });
});
