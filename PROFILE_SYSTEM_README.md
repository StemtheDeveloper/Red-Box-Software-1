# User Profile System

## Overview

The Red Box Software website now includes a comprehensive user profile system that allows authenticated users to manage their personal information, security settings, preferences, and account details.

## Features

### 📋 Personal Information

- Edit first name, last name, phone number, and company
- Add a personal bio
- Manage address information (street, city, state, ZIP, country)
- All changes are saved to Firestore and synced across sessions

### 🔐 Security Settings

- Change password with real-time validation
- Two-factor authentication toggles (SMS and Email)
- Login notification preferences
- Password requirements:
  - At least 8 characters
  - One uppercase letter
  - One lowercase letter
  - One number

### ⚙️ Preferences

- Theme selection (Light, Dark, Auto)
- Language preferences
- Timezone settings
- Notification preferences:
  - Email notifications
  - Marketing emails
  - Document reminders

### 👤 Account Management

- View account creation date
- View last sign-in time
- Email verification status with option to resend verification
- Download personal data (GDPR compliance)
- Account deletion with confirmation requirements

## File Structure

```
public/
├── profile.html              # Main profile page
├── config/
│   └── firebase-config.js    # Firebase configuration
├── scripts/
│   ├── auth.js              # Authentication system (updated)
│   └── script.js            # Navigation script (updated)
└── ...
```

## Database Schema

The profile system uses Firestore with the following structure:

```javascript
// users/{userId} document
{
  firstName: string,
  lastName: string,
  phone: string,
  company: string,
  bio: string,
  address: string,
  city: string,
  state: string,
  zipCode: string,
  country: string,
  preferences: {
    theme: string,      // 'light', 'dark', 'auto'
    language: string,   // 'en', 'es', 'fr', etc.
    timezone: string    // timezone identifier
  },
  settings: {
    smsAuth: boolean,
    emailAuth: boolean,
    loginNotifications: boolean,
    emailNotifications: boolean,
    marketingEmails: boolean,
    documentReminders: boolean
  },
  updatedAt: string    // ISO timestamp
}
```

## Security

### Firestore Rules

The profile system is protected by Firestore security rules that ensure:

- Users can only read/write their own profile data
- Admin users have additional access where needed
- All operations require authentication

### Password Security

- Password changes require current password verification
- Strong password requirements enforced
- Secure reauthentication before sensitive operations

## Navigation Integration

The profile system is integrated into the site navigation:

- Profile link appears for authenticated users
- Hidden for unauthenticated users
- Accessible from all major pages (index, dashboard, admin, etc.)

## Usage

### Accessing the Profile

1. Sign in to your account
2. Click "Profile" in the navigation menu
3. Or visit `/profile.html` directly (redirects to sign-in if not authenticated)

### Managing Information

1. Navigate to the desired tab (Personal Info, Security, Preferences, Account)
2. Make your changes
3. Click "Save Changes" or relevant action button
4. Changes are immediately saved to Firestore

### Account Deletion

1. Go to Account tab
2. Scroll to "Danger Zone"
3. Click "Delete Account"
4. Enter your password and type "DELETE" to confirm
5. Account and all data will be permanently removed

## Mobile Responsiveness

The profile page is fully responsive and includes:

- Collapsible tabs on mobile devices
- Touch-friendly form controls
- Optimized layouts for small screens
- Accessible navigation patterns

## Error Handling

The system includes comprehensive error handling:

- Form validation with real-time feedback
- Firebase error translation to user-friendly messages
- Loading states and progress indicators
- Graceful fallbacks for network issues

## Future Enhancements

Potential future additions:

- Profile picture upload
- Social media account linking
- Activity logs and audit trail
- Advanced privacy controls
- Export options in different formats
