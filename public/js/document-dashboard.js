// js/document-dashboard.js

// Initialize Firebase
if (!window.firebaseConfig) {
  console.error(
    "Firebase configuration not loaded! Make sure config/firebase-config.js is included."
  );
  throw new Error("Firebase configuration missing");
}

// Initialize Firebase app
firebase.initializeApp(window.firebaseConfig);

const auth = firebase.auth();
const functions = firebase.functions();

// DOM Elements
const userEmail = document.getElementById("userEmail");
const logoutBtn = document.getElementById("logoutBtn");
const uploadArea = document.getElementById("uploadArea");
const fileInput = document.getElementById("fileInput");
const fileDetails = document.getElementById("fileDetails");
const fileName = document.getElementById("fileName");
const removeFile = document.getElementById("removeFile");
const documentForm = document.getElementById("documentForm");
const signersList = document.getElementById("signersList");
const addSignerBtn = document.getElementById("addSignerBtn");
const signerModal = document.getElementById("signerModal");
const signerForm = document.getElementById("signerForm");
const documentsList = document.getElementById("documentsList");
const filterTabs = document.querySelectorAll(".tab-btn");
const toast = document.getElementById("toast");

// State
let selectedFile = null;
let signers = [];
let currentFilter = "all";

// Initialize
document.addEventListener("DOMContentLoaded", () => {
  checkAuth();
  setupEventListeners();
});

// Authentication
function checkAuth() {
  auth.onAuthStateChanged((user) => {
    if (user) {
      userEmail.textContent = user.email;
      loadDocuments();
    } else {
      window.location.href = "signin.html";
    }
  });
}

// Event Listeners
function setupEventListeners() {
  // Logout
  logoutBtn.addEventListener("click", () => {
    auth.signOut().then(() => {
      window.location.href = "signin.html";
    });
  });

  // File Upload
  uploadArea.addEventListener("click", () => fileInput.click());
  uploadArea.addEventListener("dragover", handleDragOver);
  uploadArea.addEventListener("drop", handleDrop);
  uploadArea.addEventListener("dragleave", handleDragLeave);
  fileInput.addEventListener("change", handleFileSelect);
  removeFile.addEventListener("click", clearFile);

  // Document Form
  documentForm.addEventListener("submit", handleDocumentSubmit);

  // Signers
  addSignerBtn.addEventListener("click", () => showSignerModal());
  signerForm.addEventListener("submit", handleSignerSubmit);

  // Filter Tabs
  filterTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      filterTabs.forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      currentFilter = tab.dataset.filter;
      filterDocuments();
    });
  });
}

// File Handling
function handleDragOver(e) {
  e.preventDefault();
  uploadArea.classList.add("dragover");
}

function handleDragLeave(e) {
  e.preventDefault();
  uploadArea.classList.remove("dragover");
}

function handleDrop(e) {
  e.preventDefault();
  uploadArea.classList.remove("dragover");

  const files = e.dataTransfer.files;
  if (files.length > 0 && files[0].type === "application/pdf") {
    processFile(files[0]);
  } else {
    showToast("Please upload a PDF file", "error");
  }
}

function handleFileSelect(e) {
  const file = e.target.files[0];
  if (file && file.type === "application/pdf") {
    processFile(file);
  } else {
    showToast("Please upload a PDF file", "error");
  }
}

function processFile(file) {
  selectedFile = file;
  fileName.textContent = file.name;
  uploadArea.style.display = "none";
  fileDetails.style.display = "block";

  // Set default title
  const docTitle = document.getElementById("docTitle");
  docTitle.value = file.name.replace(".pdf", "");
}

function clearFile() {
  selectedFile = null;
  fileInput.value = "";
  uploadArea.style.display = "block";
  fileDetails.style.display = "none";
  documentForm.reset();
  signers = [];
  updateSignersList();
}

// Signers Management
function showSignerModal() {
  signerModal.classList.add("show");
  document.getElementById("signerName").focus();
}

function closeSignerModal() {
  signerModal.classList.remove("show");
  signerForm.reset();
}

function handleSignerSubmit(e) {
  e.preventDefault();

  const name = document.getElementById("signerName").value.trim();
  const email = document.getElementById("signerEmail").value.trim();
  const role = document.getElementById("signerRole").value.trim() || "Signer";

  // Check for duplicate email
  if (signers.some((s) => s.email === email)) {
    showToast("This email is already added", "error");
    return;
  }

  signers.push({ name, email, role });
  updateSignersList();
  closeSignerModal();
  showToast("Signer added successfully", "success");
}

function updateSignersList() {
  signersList.innerHTML = "";

  if (signers.length === 0) {
    signersList.innerHTML =
      '<p class="text-secondary">No signers added yet</p>';
    return;
  }

  signers.forEach((signer, index) => {
    const signerItem = document.createElement("div");
    signerItem.className = "signer-item";
    signerItem.innerHTML = `
            <div class="signer-info">
                <strong>${signer.name}</strong>
                <span>${signer.email} - ${signer.role}</span>
            </div>
            <button class="btn-icon" onclick="removeSigner(${index})">×</button>
        `;
    signersList.appendChild(signerItem);
  });
}

window.removeSigner = function (index) {
  signers.splice(index, 1);
  updateSignersList();
  showToast("Signer removed", "success");
};

// Document Submission
async function handleDocumentSubmit(e) {
  e.preventDefault();

  if (!selectedFile) {
    showToast("Please select a file", "error");
    return;
  }

  if (signers.length === 0) {
    showToast("Please add at least one signer", "error");
    return;
  }

  const submitBtn = documentForm.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  submitBtn.textContent = "Uploading...";

  try {
    // Convert file to base64
    const base64Data = await fileToBase64(selectedFile);

    // Prepare data
    const data = {
      fileName: selectedFile.name,
      fileSize: selectedFile.size,
      fileType: selectedFile.type,
      base64Data: base64Data.split(",")[1], // Remove data:application/pdf;base64,
      title: document.getElementById("docTitle").value.trim(),
      description: document.getElementById("docDescription").value.trim(),
      signers: signers,
    };

    // Call Firebase function
    const uploadDocument = functions.httpsCallable("uploadDocument");
    const result = await uploadDocument(data);

    if (result.data.success) {
      showToast("Document sent successfully!", "success");
      clearFile();
      loadDocuments();
    } else {
      throw new Error(result.data.error || "Upload failed");
    }
  } catch (error) {
    console.error("Upload error:", error);
    showToast(error.message || "Failed to upload document", "error");
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Send for Signing";
  }
}

// Load Documents
async function loadDocuments() {
  documentsList.innerHTML = '<div class="loading">Loading documents...</div>';

  try {
    const getUserDocuments = functions.httpsCallable("getUserDocuments");
    const result = await getUserDocuments({ limit: 100 });

    if (result.data.success) {
      displayDocuments(result.data.documents);
    } else {
      throw new Error(result.data.error || "Failed to load documents");
    }
  } catch (error) {
    console.error("Load error:", error);
    documentsList.innerHTML = `
            <div class="error-state">
                <p>Failed to load documents</p>
                <button class="btn btn-primary" onclick="loadDocuments()">Retry</button>
            </div>
        `;
  }
}

function displayDocuments(documents) {
  if (documents.length === 0) {
    documentsList.innerHTML =
      '<p class="text-secondary">No documents found</p>';
    return;
  }

  // Store all documents for filtering
  window.allDocuments = documents;
  filterDocuments();
}

function filterDocuments() {
  const documents = window.allDocuments || [];
  let filtered = documents;

  switch (currentFilter) {
    case "pending":
      filtered = documents.filter((d) => d.status === "pending");
      break;
    case "completed":
      filtered = documents.filter((d) => d.status === "completed");
      break;
    case "sent":
      filtered = documents.filter((d) => d.isCreator);
      break;
    case "received":
      filtered = documents.filter((d) => !d.isCreator);
      break;
  }

  documentsList.innerHTML = "";

  if (filtered.length === 0) {
    documentsList.innerHTML =
      '<p class="text-secondary">No documents match the selected filter</p>';
    return;
  }

  filtered.forEach((doc) => {
    const card = createDocumentCard(doc);
    documentsList.appendChild(card);
  });
}

function createDocumentCard(doc) {
  const card = document.createElement("div");
  card.className = "document-card";

  const statusClass = `status-${doc.status}`;
  const statusText = doc.status.charAt(0).toUpperCase() + doc.status.slice(1);

  card.innerHTML = `
        <div class="document-info">
            <h3>${doc.title}</h3>
            <div class="document-meta">
                <span>${doc.isCreator ? "Sent" : "Received"}</span>
                <span>•</span>
                <span>${formatDate(doc.createdAt)}</span>
                <span>•</span>
                <span>${doc.completedSigners}/${doc.signersCount} signed</span>
            </div>
        </div>
        <div class="document-actions">
            <span class="status-badge ${statusClass}">${statusText}</span>
            <button class="btn btn-primary" onclick="viewDocument('${doc.id}')">
                ${
                  doc.isCreator || doc.signerStatus === "completed"
                    ? "View"
                    : "Sign"
                }
            </button>
        </div>
    `;

  return card;
}

window.viewDocument = function (documentId) {
  window.location.href = `/sign-document.html?id=${documentId}`;
};

// Utility Functions
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result);
    reader.onerror = (error) => reject(error);
  });
}

function formatDate(timestamp) {
  if (!timestamp) return "Unknown";
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function showToast(message, type = "info") {
  toast.textContent = message;
  toast.className = `toast show ${type}`;

  setTimeout(() => {
    toast.classList.remove("show");
  }, 3000);
}

// Modal close functions
window.closeSignerModal = closeSignerModal;
