// Function to check if user is admin
function checkAdminStatus() {
  if (localStorage.getItem("userEmail") === "stiaan44@gmail.com") {
    return true;
  }
  return false;
}

// Function to handle sign out
async function handleSignOut() {
  try {
    const auth = getAuth();
    await signOut(auth);
    localStorage.removeItem("userEmail");
    window.location.href = "index.html";
  } catch (error) {
    console.error("Error signing out:", error);
  }
}

// Function to set up event listeners
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

  burger.addEventListener("click", () => {
    dropdownContent.classList.toggle("show");
    shadow.classList.toggle("show");
  });

  shadow.addEventListener("click", () => {
    dropdownContent.classList.toggle("show");
    shadow.classList.toggle("show");
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

// Your Firebase configuration
const firebaseConfig = {
  // ...existing config...
};

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
    setupEventListeners();

    // Show/hide admin links based on status
    const adminElements = document.querySelectorAll(".admin-only");
    const isAdmin = checkAdminStatus();
    adminElements.forEach((el) => {
      el.style.display = isAdmin ? "block" : "none";
    });
  });
});
