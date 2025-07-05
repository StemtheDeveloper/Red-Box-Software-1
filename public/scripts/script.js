// Import the centralized auth system
import "./auth.js";

// Function to check if user is admin (keeping for compatibility)
function checkAdminStatus() {
  return window.RBSAuth
    ? window.RBSAuth.isAdmin()
    : localStorage.getItem("userEmail") === "stiaan44@gmail.com";
}

// Function to handle sign out (keeping for compatibility)
async function handleSignOut() {
  if (window.RBSAuth) {
    return await window.RBSAuth.signOut();
  }

  // Fallback method
  try {
    const auth = getAuth();
    await signOut(auth);
    localStorage.removeItem("userEmail");
    updateNavigation();
    window.location.href = "index.html";
  } catch (error) {
    console.error("Error signing out:", error);
  }
}

// Function to update navigation based on auth and admin status
function updateNavigation() {
  if (window.RBSAuth) {
    window.RBSAuth.updateUI();
  } else {
    // Fallback for when auth system isn't loaded yet
    const isAdmin = checkAdminStatus();
    const isAuthenticated = !!localStorage.getItem("userEmail");
    updateAuthElements(isAuthenticated, isAdmin);
  }

  // Add event listeners after updating the navigation
  setupEventListeners();
}

// Function to set up event listeners for navigation
function setupEventListeners() {
  const currentLocation = window.location.href;
  const navLinksA = document.querySelectorAll(".nav-links a");

  navLinksA.forEach((link) => {
    if (link.href === currentLocation) {
      link.classList.add("active");
    }
  });

  const burger = document.querySelector(".burger");
  const dropdownContent = document.querySelector(".dropdown-content");
  const shadow = document.getElementById("shadow");

  if (burger && dropdownContent && shadow) {
    burger.addEventListener("click", () => {
      dropdownContent.classList.toggle("show");
      shadow.classList.toggle("show");
    });

    shadow.addEventListener("click", () => {
      dropdownContent.classList.toggle("show");
      shadow.classList.toggle("show");
    });
  }
}

// Function to update authentication-related elements in navigation
function updateAuthElements(isAuthenticated, isAdmin) {
  // Find sign out buttons, admin links, and profile links
  const signOutBtns = document.querySelectorAll(".sign-out-btn");
  const adminLinks = document.querySelectorAll('a[href="admin.html"]');
  const profileLinks = document.querySelectorAll('a[href="profile.html"]');

  // Show/hide sign out buttons
  signOutBtns.forEach((btn) => {
    if (isAuthenticated) {
      btn.style.display = "block";
    } else {
      btn.style.display = "none";
    }
  });

  // Show/hide admin links
  adminLinks.forEach((link) => {
    if (isAuthenticated && isAdmin) {
      link.style.display = "block";
    } else {
      link.style.display = "none";
    }
  });

  // Show/hide profile links
  profileLinks.forEach((link) => {
    if (isAuthenticated) {
      link.style.display = "block";
    } else {
      link.style.display = "none";
    }
  });

  // Add sign in link if not authenticated
  if (!isAuthenticated) {
    addSignInLink();
  } else {
    removeSignInLink();
  }
}

// Function to add sign in link to navigation
function addSignInLink() {
  const navContainers = document.querySelectorAll("#navBtnsCont");

  navContainers.forEach((container) => {
    // Check if sign in link already exists
    if (!container.querySelector(".signin-link")) {
      const signInLi = document.createElement("li");
      signInLi.innerHTML =
        '<a href="signin.html" class="signin-link">Sign In</a>';
      container.appendChild(signInLi);
    }
  });
}

// Function to remove sign in link from navigation
function removeSignInLink() {
  const signInLinks = document.querySelectorAll(".signin-link");
  signInLinks.forEach((link) => {
    const li = link.closest("li");
    if (li) li.remove();
  });
}

// Make handleSignOut available globally
window.handleSignOut = handleSignOut;

// Import Firebase functions
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.9.0/firebase-auth.js";

// Firebase configuration will be loaded from external file
// Check if configuration is available
if (!window.firebaseConfig) {
  console.error(
    "Firebase configuration not loaded! Make sure config/firebase-config.js is included."
  );
}
const firebaseConfig = window.firebaseConfig;

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

// Initial setup when DOM is loaded
document.addEventListener("DOMContentLoaded", () => {
  onAuthStateChanged(auth, (user) => {
    if (user && user.email) {
      localStorage.setItem("userEmail", user.email);
    } else {
      localStorage.removeItem("userEmail");
    }
    updateNavigation();
  });
});
