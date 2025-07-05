// Centralized Authentication Utilities for Red Box Software
// This file provides authentication helpers that can be used across the site

class RBSAuth {
  constructor() {
    this.auth = null;
    this.initialized = false;
    this.currentUser = null;
  }

  // Initialize Firebase Auth
  async initialize() {
    if (this.initialized) return;

    try {
      const { initializeApp } = await import(
        "https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js"
      );
      const { getAuth, onAuthStateChanged } = await import(
        "https://www.gstatic.com/firebasejs/10.9.0/firebase-auth.js"
      );

      if (!window.firebaseConfig) {
        console.error("Firebase configuration not loaded!");
        return false;
      }

      const app = initializeApp(window.firebaseConfig);
      this.auth = getAuth(app);
      this.initialized = true;

      // Set up auth state listener
      onAuthStateChanged(this.auth, (user) => {
        this.currentUser = user;
        if (user) {
          localStorage.setItem("userEmail", user.email);
          localStorage.setItem("userUID", user.uid);
          localStorage.setItem("userName", user.displayName || user.email);
        } else {
          localStorage.removeItem("userEmail");
          localStorage.removeItem("userUID");
          localStorage.removeItem("userName");
        }

        // Trigger custom event for other components to listen to
        window.dispatchEvent(
          new CustomEvent("authStateChanged", { detail: { user } })
        );
      });

      return true;
    } catch (error) {
      console.error("Failed to initialize Firebase Auth:", error);
      return false;
    }
  }

  // Check if user is authenticated
  isAuthenticated() {
    return !!this.currentUser || !!localStorage.getItem("userEmail");
  }

  // Check if user is admin
  isAdmin() {
    const email = this.currentUser?.email || localStorage.getItem("userEmail");
    return email === "stiaan44@gmail.com";
  }

  // Get current user info
  getCurrentUser() {
    return {
      user: this.currentUser,
      email: this.currentUser?.email || localStorage.getItem("userEmail"),
      uid: this.currentUser?.uid || localStorage.getItem("userUID"),
      name: this.currentUser?.displayName || localStorage.getItem("userName"),
      isAuthenticated: this.isAuthenticated(),
      isAdmin: this.isAdmin(),
    };
  }

  // Redirect to sign in with current page as return URL
  redirectToSignIn() {
    const currentUrl = window.location.href;
    const redirectParam = encodeURIComponent(currentUrl);

    // Simple approach - just redirect to signin.html
    // This should work if signin.html is in the same directory as the current page
    window.location.href = `signin.html?redirect=${redirectParam}`;
  }

  // Sign out user
  async signOut() {
    if (!this.auth) await this.initialize();

    try {
      const { signOut } = await import(
        "https://www.gstatic.com/firebasejs/10.9.0/firebase-auth.js"
      );
      await signOut(this.auth);

      // Clear local storage
      localStorage.removeItem("userEmail");
      localStorage.removeItem("userUID");
      localStorage.removeItem("userName");

      // Redirect to home
      window.location.href = "index.html";
      return true;
    } catch (error) {
      console.error("Sign out error:", error);
      return false;
    }
  }

  // Require authentication for page access
  async requireAuth(redirectIfNot = true) {
    if (!this.initialized) await this.initialize();

    return new Promise((resolve) => {
      if (this.isAuthenticated()) {
        resolve(true);
        return;
      }

      // Wait a moment for auth state to initialize
      setTimeout(() => {
        if (this.isAuthenticated()) {
          resolve(true);
        } else if (redirectIfNot) {
          this.redirectToSignIn();
          resolve(false);
        } else {
          resolve(false);
        }
      }, 1000);
    });
  }

  // Require admin access
  async requireAdmin(redirectIfNot = true) {
    const isAuth = await this.requireAuth(redirectIfNot);
    if (!isAuth) return false;

    if (this.isAdmin()) {
      return true;
    } else if (redirectIfNot) {
      alert("Admin access required. You will be redirected to the home page.");
      window.location.href = "index.html";
      return false;
    } else {
      return false;
    }
  }

  // Show authentication UI elements
  showAuthElements() {
    const signOutBtns = document.querySelectorAll(".sign-out-btn");
    const profileLinks = document.querySelectorAll('a[href="profile.html"]');

    signOutBtns.forEach((btn) => (btn.style.display = "block"));
    profileLinks.forEach((link) => (link.style.display = "block"));
  }

  // Hide authentication UI elements
  hideAuthElements() {
    const signOutBtns = document.querySelectorAll(".sign-out-btn");
    const profileLinks = document.querySelectorAll('a[href="profile.html"]');

    signOutBtns.forEach((btn) => (btn.style.display = "none"));
    profileLinks.forEach((link) => (link.style.display = "none"));
  }

  // Show admin UI elements
  showAdminElements() {
    const adminLinks = document.querySelectorAll('a[href="admin.html"]');
    adminLinks.forEach((link) => (link.style.display = "block"));
  }

  // Hide admin UI elements
  hideAdminElements() {
    const adminLinks = document.querySelectorAll('a[href="admin.html"]');
    adminLinks.forEach((link) => (link.style.display = "none"));
  }

  // Update all UI elements based on current auth state
  updateUI() {
    const userInfo = this.getCurrentUser();

    if (userInfo.isAuthenticated) {
      this.showAuthElements();
      this.removeSignInLinks();

      if (userInfo.isAdmin) {
        this.showAdminElements();
      } else {
        this.hideAdminElements();
      }
    } else {
      this.hideAuthElements();
      this.hideAdminElements();
      this.addSignInLinks();
    }
  }

  // Add sign in links to navigation
  addSignInLinks() {
    const navContainers = document.querySelectorAll("#navBtnsCont");

    navContainers.forEach((container) => {
      if (!container.querySelector(".signin-link")) {
        const signInLi = document.createElement("li");
        signInLi.innerHTML =
          '<a href="signin.html" class="signin-link">Sign In</a>';
        container.appendChild(signInLi);
      }
    });
  }

  // Remove sign in links from navigation
  removeSignInLinks() {
    const signInLinks = document.querySelectorAll(".signin-link");
    signInLinks.forEach((link) => {
      const li = link.closest("li");
      if (li) li.remove();
    });
  }
}

// Create global instance
window.RBSAuth = new RBSAuth();

// Auto-initialize when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    window.RBSAuth.initialize();
  });
} else {
  window.RBSAuth.initialize();
}

// Listen for auth state changes and update UI
window.addEventListener("authStateChanged", () => {
  window.RBSAuth.updateUI();
});

// Make sign out function globally available for existing code
window.handleSignOut = () => window.RBSAuth.signOut();

// Export for ES modules if needed
export default window.RBSAuth;
