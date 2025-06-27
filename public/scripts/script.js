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
    updateNavigation();
    // Redirect to home page after sign out
    window.location.href = "index.html";
  } catch (error) {
    console.error("Error signing out:", error);
  }
}

// Function to update navigation based on admin status
function updateNavigation() {
  const isAdmin = checkAdminStatus();

  // Add event listeners after updating the navigation
  setupEventListeners();
}

// Function to get navigation HTML
function getNavigationHTML() {
  return `
    <nav>
      <a href="index.html">
        <div class="logo">
          <img id="logo" src="./Images/RBS Logo main.svg" alt="RBS Logo. It's a box that's red" />
        </div>
      </a>
      <div class="burger">
        <div class="line"></div>
        <div class="line"></div>
        <div class="line"></div>
      </div>

      <div id="webNav">
        <div id="navBtnsCont" class="nav-links">
          <a href="index.html"><li>Home</li></a>
          <a href="projects.html"><li>Projects</li></a>
          <a href="products.html"><li>Products</li></a>
          <a href="services.html"><li>Services</li></a>
          <a href="articles.html"><li>Articles</li></a>
          <a href="about.html"><li>About</li></a>
          <a href="contact.html"><li>Contact</li></a>
          <div class="tools-dropdown">
            <li>More ▼</li>
            <div class="tools-dropdown-content">
              <a href="clip_path_editor.html">Clip Path Editor</a>
              <a href="cubic_bezier.html">Cubic Bezier</a>
              <a href="base64.html">Base64 image encoder - decoder</a>
              <a href="kanban.html">Kanban Task Manager</a>
              <a href="qr_code_generator.html">QR code generator</a>
              
            </div>
          </div>
          <br />
          <br />
          <br />
        </div>
      </div>
      <div class="dropdown-content">
        <div id="navBtnsCont" class="nav-links">
          <a href="index.html"><li>Home</li></a>
          <a href="projects.html"><li>Projects</li></a>
          <a href="products.html"><li>Products</li></a>
          <a href="services.html"><li>Services</li></a>
          <a href="articles.html"><li>Articles</li></a>
          <a href="about.html"><li>About</li></a>
          <a href="contact.html"><li>Contact</li></a>
          <div class="tools-dropdown">
            <li>More ▼</li>
            <div class="tools-dropdown-content">
              <a href="clip_path_editor.html">Clip Path Editor</a>
              <a href="cubic_bezier.html">Cubic Bezier</a>
              <a href="base64.html">Base64 image encoder - decoder</a>
              <a href="kanban.html">Kanban Task Manager</a>
              <a href="qr_code_generator.html">QR code generator</a>
              
            </div>
          </div>
        </div>
      </div>
      <div id="shadow"></div>
    </nav>
  `;
}

// Function to inject navigation
function injectNavigation() {
  const body = document.body;
  body.insertAdjacentHTML("afterbegin", getNavigationHTML());
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
  apiKey: "AIzaSyC2CwIcLmGi46-VeVBgGuzgjl1rAN_S3IY",
  authDomain: "red-box-software.firebaseapp.com",
  projectId: "red-box-software",
  storageBucket: "red-box-software.appspot.com",
  messagingSenderId: "94993930256",
  appId: "1:94993930256:web:b47f330bee30bddffb1295",
  measurementId: "G-2LX6NFYS1J",
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

// Initial setup when DOM is loaded
document.addEventListener("DOMContentLoaded", () => {
  injectNavigation();
  onAuthStateChanged(auth, (user) => {
    if (user && user.email) {
      localStorage.setItem("userEmail", user.email);
    } else {
      localStorage.removeItem("userEmail");
    }
    updateNavigation();
  });
});
