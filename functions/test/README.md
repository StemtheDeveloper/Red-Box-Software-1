# DocuSeal Firebase Functions Test Suite

This directory contains comprehensive unit and integration tests for the DocuSeal Firebase Functions.

## Test Structure

### Setup

- `setup.js` - Jest configuration and global mocks
- `helpers.js` - Test utilities and helper functions

### Test Files

- `docuseal.test.js` - Unit tests for individual functions
- `integration.test.js` - Integration tests for complete workflows

## Running Tests

### Install Dependencies

```bash
npm install
```

### Run All Tests

```bash
npm test
```

### Run Tests in Watch Mode

```bash
npm run test:watch
```

### Run Tests with Coverage

```bash
npm run test:coverage
```

## Test Coverage

The test suite covers:

### Authentication & Security

- ✅ Admin authentication verification
- ✅ Rate limiting functionality
- ✅ Input validation and sanitization
- ✅ Error handling for unauthorized access

### Core Functions

- ✅ `createDocuSealSubmission` - Document submission creation
- ✅ `createPdfTemplateFromHtml` - Template creation from HTML
- ✅ `getBuilderToken` - JWT token generation for form builder
- ✅ `docusealWebhook` - Webhook event processing
- ✅ `sendSubmissionReminder` - Manual reminder functionality
- ✅ `monitoringAndAlerts` - Automated monitoring system

### Integration Workflows

- ✅ Complete document signing workflow (template → submission → completion)
- ✅ Error handling and recovery scenarios
- ✅ Concurrent request handling
- ✅ Performance and scalability testing

### External Integrations

- ✅ DocuSeal API interaction mocking
- ✅ Slack notification testing
- ✅ Firebase Storage operations
- ✅ Firestore database operations

## Mocking Strategy

### External Services

- **DocuSeal API**: Mocked using `axios` mock to simulate API responses
- **Firebase Admin SDK**: Comprehensive mocking of Firestore, Storage, and Auth
- **Slack Webhooks**: Mocked HTTP requests to test notification flow
- **JWT Operations**: Real JWT library used with test secrets

### Test Data

- Consistent test data generation using helper functions
- Realistic submission and template objects
- Proper webhook event structures
- Admin and user authentication objects

## Test Configuration

### Environment Variables

Tests use dedicated test environment variables:

```
DOCUSEAL_API_KEY=test-api-key-for-jest
SLACK_WEBHOOK_URL=https://hooks.slack.com/test-webhook
```

### Jest Configuration

- Test environment: Node.js
- Test timeout: 30 seconds
- Coverage reporting: Text, LCOV, and HTML formats
- Setup files for global mocks and utilities

## Best Practices

### Writing New Tests

1. Use helper functions for consistent test data
2. Mock external services appropriately
3. Test both success and error scenarios
4. Include edge cases and validation testing
5. Verify proper error handling and logging

### Naming Conventions

- Test files: `*.test.js`
- Helper files: `helpers.js`
- Mock data: Use descriptive prefixes (e.g., `test-`, `mock-`)

### Structure

```
describe('Function Name', () => {
  describe('Specific Feature', () => {
    test('should do something specific', async () => {
      // Arrange
      // Act
      // Assert
    });
  });
});
```

## Debugging Tests

### Common Issues

1. **Async/Await**: Ensure all async operations are properly awaited
2. **Mocks**: Clear mocks between tests using `jest.clearAllMocks()`
3. **Timeouts**: Increase timeout for slow operations
4. **Authentication**: Use proper admin auth objects for protected functions

### Debugging Commands

```bash
# Run specific test file
npm test -- docuseal.test.js

# Run tests matching pattern
npm test -- --testNamePattern="authentication"

# Run with verbose output
npm test -- --verbose

# Debug with Node inspector
node --inspect-brk node_modules/.bin/jest --runInBand
```

## Coverage Goals

Target coverage metrics:

- **Functions**: 95%+ coverage
- **Lines**: 90%+ coverage
- **Branches**: 85%+ coverage
- **Statements**: 90%+ coverage

## Integration with CI/CD

Tests are designed to run in CI/CD environments:

- No external dependencies (all mocked)
- Deterministic results
- Proper error codes and exit status
- Coverage reporting for automated analysis

## Security Testing

Security aspects covered:

- Authentication bypass attempts
- Rate limiting enforcement
- Input validation and sanitization
- Admin privilege escalation prevention
- JWT token security and expiration
