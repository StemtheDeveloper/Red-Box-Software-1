// Test setup file for Firebase Functions tests

// Set test environment variables
process.env.DOCUSEAL_API_KEY = "test-api-key-for-jest";
process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.com/test-webhook";

// Mock Firebase Admin SDK
jest.mock("firebase-admin", () => ({
  initializeApp: jest.fn(),
  firestore: jest.fn(() => ({
    collection: jest.fn(() => ({
      doc: jest.fn(() => ({
        set: jest.fn(),
        update: jest.fn(),
        get: jest.fn(() =>
          Promise.resolve({
            exists: true,
            data: () => ({
              submissionId: "test-123",
              status: "pending",
              templateName: "Test Template",
              createdAt: new Date(),
              signers: [{ name: "Test User", email: "test@example.com" }],
            }),
          })
        ),
      })),
      where: jest.fn(() => ({
        where: jest.fn(() => ({
          get: jest.fn(() =>
            Promise.resolve({
              size: 2,
              docs: [
                {
                  id: "test-1",
                  data: () => ({
                    submissionId: "test-1",
                    status: "pending",
                    templateName: "Test Template 1",
                    createdAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000), // 8 days ago
                    signers: [{ name: "User 1", email: "user1@example.com" }],
                  }),
                },
                {
                  id: "test-2",
                  data: () => ({
                    submissionId: "test-2",
                    status: "pending",
                    templateName: "Test Template 2",
                    createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000), // 5 days ago
                    signers: [{ name: "User 2", email: "user2@example.com" }],
                  }),
                },
              ],
            })
          ),
        })),
        get: jest.fn(() =>
          Promise.resolve({
            size: 3,
            docs: [],
          })
        ),
      })),
      add: jest.fn(() => Promise.resolve({ id: "new-doc-id" })),
    })),
  })),
  storage: jest.fn(() => ({
    bucket: jest.fn(() => ({
      file: jest.fn(() => ({
        save: jest.fn(() => Promise.resolve()),
      })),
    })),
  })),
  FieldValue: {
    serverTimestamp: jest.fn(() => new Date()),
    arrayUnion: jest.fn((value) => ({ arrayUnion: value })),
  },
}));

// Mock Firebase Functions SDK
jest.mock("firebase-functions/v2/https", () => ({
  onCall: jest.fn((config, handler) => ({
    run: handler,
    config,
  })),
  onRequest: jest.fn((config, handler) => ({
    run: handler,
    config,
  })),
}));

jest.mock("firebase-functions/v2/scheduler", () => ({
  onSchedule: jest.fn((config, handler) => ({
    run: handler,
    config,
  })),
}));

jest.mock("firebase-functions/v2/firestore", () => ({
  onDocumentCreated: jest.fn((config, handler) => ({
    run: handler,
    config,
  })),
}));

jest.mock("firebase-functions/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

// Global test timeout
jest.setTimeout(30000);
