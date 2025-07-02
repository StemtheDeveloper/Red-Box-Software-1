// Test utilities and helpers for DocuSeal Firebase Functions tests

/**
 * Create a mock admin auth object
 */
function createAdminAuth(
  uid = "admin-uid",
  email = "stiaan44@gmail.com",
  name = "Admin User"
) {
  return {
    uid,
    token: {email, name}
  };
}

/**
 * Create a mock regular user auth object
 */
function createUserAuth(
  uid = "user-uid",
  email = "user@example.com",
  name = "Regular User"
) {
  return {
    uid,
    token: {email, name}
  };
}

/**
 * Create a mock DocuSeal submission response
 */
function createMockSubmission(id = "test-submission", overrides = {}) {
  return {
    id,
    url: `https://docuseal.com/sign/${id}`,
    status: "pending",
    submitters: [],
    template: {id: "test-template", name: "Test Template"},
    ...overrides
  };
}

/**
 * Create a mock DocuSeal template response
 */
function createMockTemplate(id = "test-template", overrides = {}) {
  return {
    id,
    name: "Test Template",
    download_url: `https://docuseal.com/templates/${id}/download`,
    ...overrides
  };
}

/**
 * Create a mock webhook request
 */
function createWebhookRequest(
  eventType = "submission.completed",
  data = {},
  overrides = {}
) {
  return {
    method: "POST",
    body: {
      event_type: eventType,
      data: {
        id: "test-submission",
        status: eventType.includes("completed") ? "completed" : "pending",
        ...data
      },
      ...overrides
    }
  };
}

/**
 * Create a mock HTTP response object
 */
function createMockResponse() {
  const res = {
    set: jest.fn(() => res),
    status: jest.fn(() => res),
    send: jest.fn(() => res),
    json: jest.fn(() => res)
  };
  return res;
}

/**
 * Wait for a specified amount of time
 */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Generate random test data
 */
function generateTestData() {
  const timestamp = Date.now();
  return {
    submissionId: `test-submission-${timestamp}`,
    templateId: `test-template-${timestamp}`,
    email: `test-${timestamp}@example.com`,
    name: `Test User ${timestamp}`
  };
}

/**
 * Validate JWT token structure
 */
function validateJWT(token) {
  const parts = token.split(".");
  expect(parts).toHaveLength(3);

  const header = JSON.parse(Buffer.from(parts[0], "base64").toString());
  const payload = JSON.parse(Buffer.from(parts[1], "base64").toString());

  expect(header.alg).toBe("HS256");
  expect(payload.exp).toBeGreaterThan(payload.iat);

  return {header, payload};
}

/**
 * Mock Firestore operations
 */
function setupFirestoreMocks() {
  const mockDoc = {
    set: jest.fn(() => Promise.resolve()),
    update: jest.fn(() => Promise.resolve()),
    get: jest.fn(() =>
      Promise.resolve({
        exists: true,
        data: () => ({
          submissionId: "test-123",
          status: "pending",
          templateName: "Test Template",
          createdAt: new Date(),
          signers: [{name: "Test User", email: "test@example.com"}]
        })
      })
    )
  };

  const mockCollection = {
    doc: jest.fn(() => mockDoc),
    add: jest.fn(() => Promise.resolve({id: "new-doc-id"})),
    where: jest.fn(() => mockCollection),
    orderBy: jest.fn(() => mockCollection),
    get: jest.fn(() =>
      Promise.resolve({
        size: 2,
        docs: [
          {
            id: "doc-1",
            data: () => ({id: "doc-1", status: "pending"})
          },
          {
            id: "doc-2",
            data: () => ({id: "doc-2", status: "pending"})
          }
        ]
      })
    )
  };

  return {mockDoc, mockCollection};
}

/**
 * Assert that a function throws with specific message
 */
async function expectToThrow(fn, expectedMessage) {
  try {
    await fn();
    throw new Error("Expected function to throw, but it did not");
  } catch (error) {
    expect(error.message).toContain(expectedMessage);
  }
}

module.exports = {
  createAdminAuth,
  createUserAuth,
  createMockSubmission,
  createMockTemplate,
  createWebhookRequest,
  createMockResponse,
  delay,
  generateTestData,
  validateJWT,
  setupFirestoreMocks,
  expectToThrow
};
