# Firebase Security Setup

## ⚠️ IMPORTANT: Firebase Configuration Security

This project now uses a secure configuration system to prevent API key exposure.

### Setup Instructions

1. **The firebase-config.js file is gitignored** - it won't be committed to version control
2. **For local development:**
   - Copy `public/config/firebase-config.template.js` to `public/config/firebase-config.js`
   - Replace `YOUR_API_KEY_HERE` with your actual Firebase API key
   - **Never commit this file to Git!**

### Files Updated

The following files now reference the external config:

- ✅ `public/docuseal-signin.html`
- ✅ `public/admin.html`
- ✅ `public/index.html`
- ✅ `public/scripts/script.js`
- ✅ `public/docuseal.html`
- ✅ `public/articles.html`
- ✅ `public/products.html`
- ✅ `public/test.html`

### Security Measures Implemented

1. **External Config File**: API keys are now in a separate file (`firebase-config.js`)
2. **Gitignore Protection**: The config file is excluded from version control
3. **Template File**: A template file shows the required structure without exposing keys
4. **Error Handling**: All files check if the config is loaded properly

### API Key Security Best Practices

1. **Regenerate the compromised key** in Google Cloud Console
2. **Set API restrictions**:
   - HTTP referrers (web sites): Add your domain(s)
   - API restrictions: Limit to Firebase APIs only
3. **Monitor usage** in Google Cloud Console
4. **Never commit API keys** to version control again

### For Production Deployment

For production deployments (Firebase Hosting, etc.), you'll need to:

1. Create the `firebase-config.js` file during your build process
2. Use environment variables in your CI/CD pipeline
3. Ensure the config file is created before deployment but not stored in your repository

### Quick Test

After setup, open your browser's developer console and check for:

- No "Firebase configuration not loaded" errors
- Successful Firebase initialization
- Proper authentication flows

---

**Remember: The security of your Firebase project depends on keeping API keys secure!**
