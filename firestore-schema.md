# Custom Document Signing System - Firestore Schema

## Collections Structure

### 1. documents

Stores document metadata and signing information

```javascript
{
  id: "doc_123",
  title: "Employment Contract",
  description: "Optional description of the document",
  fileName: "contract.pdf",
  fileSize: 1024000,
  fileType: "application/pdf",
  status: "pending|partial|completed|expired",

  // Creator information
  createdBy: "user_456",
  createdByEmail: "creator@example.com",
  createdByName: "John Creator",
  createdAt: timestamp,

  // Document storage paths
  originalPath: "documents/original/doc_123/contract.pdf",
  signedDocumentPath: "documents/signed/doc_123/signed_contract.pdf",

  // Signers array
  signers: [
    {
      id: "signer_789",
      email: "signer@example.com",
      name: "John Doe",
      role: "Employee",
      order: 1,
      status: "pending|completed",
      token: "secure_token_xyz",
      signedAt: timestamp,
      signatureData: {
        type: "image|text",
        data: "base64_signature_data",
        ipAddress: "192.168.1.1",
        userAgent: "browser_info"
      }
    }
  ],

  // Access control
  allowedViewers: ["creator@example.com", "signer@example.com"],

  // Completion info
  completedAt: timestamp,

  // Audit trail
  auditTrail: [
    {
      action: "document_created|document_signed|email_sent|document_completed",
      timestamp: timestamp,
      userId: "user_id",
      userEmail: "user@example.com",
      details: { /* action-specific details */ }
    }
  ]
}
```

### 2. signatures (Optional - for detailed signature tracking)

Individual signature records for detailed auditing

```javascript
{
  id: "sig_789",
  documentId: "doc_123",
  signerId: "signer_789",
  signerEmail: "signer@example.com",
  signerName: "John Doe",

  // Signature data
  signatureType: "image|text",
  signatureData: "base64_signature_image_or_text",

  // Position on document (future enhancement)
  position: {
    page: 1,
    x: 100,
    y: 200,
    width: 150,
    height: 50
  },

  // Metadata
  timestamp: timestamp,
  ipAddress: "192.168.1.1",
  userAgent: "browser_info",

  // Verification
  verified: true,
  verificationMethod: "email_token"
}
```

### 3. email_logs

Track email notifications sent

```javascript
{
  id: "email_log_123",
  documentId: "doc_123",
  to: "recipient@example.com",
  subject: "Document Signing Request",
  type: "invitation|reminder|completion",
  status: "sent|failed|bounced",
  provider: "gmail|sendgrid|smtp",
  messageId: "gmail_message_id",
  sentAt: timestamp,
  error: "error_message_if_failed"
}
```

### 4. document_templates (Future enhancement)

Reusable document templates

```javascript
{
  id: "template_456",
  name: "Employment Contract Template",
  description: "Standard employment contract",
  createdBy: "user_123",
  createdAt: timestamp,

  // Template file
  templatePath: "templates/template_456.pdf",

  // Default signature fields
  signatureFields: [
    {
      role: "Employee",
      required: true,
      page: 1,
      position: { x: 100, y: 200, width: 150, height: 50 }
    },
    {
      role: "HR Manager",
      required: true,
      page: 1,
      position: { x: 400, y: 200, width: 150, height: 50 }
    }
  ],

  isPublic: false,
  usageCount: 25
}
```

## Firestore Security Rules

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // Documents collection
    match /documents/{documentId} {
      // Creators can read/write their documents
      allow read, write: if request.auth != null &&
        request.auth.token.email == resource.data.createdByEmail;

      // Signers can read documents they're assigned to
      allow read: if request.auth != null &&
        request.auth.token.email in resource.data.allowedViewers;

      // Signers can update their signature status
      allow update: if request.auth != null &&
        request.auth.token.email in resource.data.allowedViewers &&
        // Only allow updating signer status, not document metadata
        request.resource.data.diff(resource.data).affectedKeys()
          .hasOnly(['signers', 'status', 'auditTrail', 'completedAt']);
    }

    // Individual signatures (optional detailed tracking)
    match /signatures/{signatureId} {
      allow read, write: if request.auth != null &&
        (request.auth.token.email == resource.data.signerEmail ||
         // Allow document creator to read signatures
         exists(/databases/$(database)/documents/documents/$(resource.data.documentId)) &&
         get(/databases/$(database)/documents/documents/$(resource.data.documentId)).data.createdByEmail == request.auth.token.email);
    }

    // Email logs - only creators and admins
    match /email_logs/{logId} {
      allow read: if request.auth != null &&
        (request.auth.token.email in ['stiaan44@gmail.com'] || // Admin emails
         // Document creator can see email logs for their documents
         exists(/databases/$(database)/documents/documents/$(resource.data.documentId)) &&
         get(/databases/$(database)/documents/documents/$(resource.data.documentId)).data.createdByEmail == request.auth.token.email);

      allow write: if false; // Only server can write email logs
    }

    // Templates - public read, authenticated write
    match /document_templates/{templateId} {
      allow read: if true; // Public templates can be read by anyone
      allow create: if request.auth != null;
      allow update, delete: if request.auth != null &&
        request.auth.token.email == resource.data.createdBy;
    }
  }
}
```

## Firebase Storage Rules

```javascript
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {

    // Original documents - only creator and signers can access
    match /documents/original/{documentId}/{filename} {
      allow read: if request.auth != null &&
        (getDocumentAccess(documentId).createdByEmail == request.auth.token.email ||
         request.auth.token.email in getDocumentAccess(documentId).allowedViewers);

      allow write: if request.auth != null &&
        getDocumentAccess(documentId).createdByEmail == request.auth.token.email;
    }

    // Signed documents - same access as originals
    match /documents/signed/{documentId}/{filename} {
      allow read: if request.auth != null &&
        (getDocumentAccess(documentId).createdByEmail == request.auth.token.email ||
         request.auth.token.email in getDocumentAccess(documentId).allowedViewers);

      allow write: if false; // Only server can write signed documents
    }

    // Document templates - public read
    match /templates/{templateId}/{filename} {
      allow read: if true;
      allow write: if request.auth != null;
    }
  }
}

// Helper function to get document access info
function getDocumentAccess(documentId) {
  return get(/databases/(default)/documents/documents/$(documentId)).data;
}
```

## Indexes Required

Create these indexes in Firestore:

1. **documents collection:**

   - allowedViewers (array) + status (ascending) + createdAt (descending)
   - createdByEmail (ascending) + createdAt (descending)
   - status (ascending) + createdAt (descending)

2. **email_logs collection:**

   - documentId (ascending) + sentAt (descending)
   - to (ascending) + sentAt (descending)
   - status (ascending) + sentAt (descending)

3. **signatures collection:**
   - documentId (ascending) + timestamp (descending)
   - signerEmail (ascending) + timestamp (descending)
