// js/document-signing.js

// Initialize Firebase
let auth, functions;

if (!window.firebaseConfig) {
  console.error(
    "Firebase configuration not loaded! Make sure config/firebase-config.js is included."
  );
  // Don't throw error in test mode, just log it
  if (new URLSearchParams(window.location.search).get("token") !== "test") {
    throw new Error("Firebase configuration missing");
  }
} else {
  try {
    // Initialize Firebase app
    firebase.initializeApp(window.firebaseConfig);

    auth = firebase.auth();
    functions = firebase.functions();
    console.log("Firebase initialized successfully");
  } catch (error) {
    console.error("Firebase initialization error:", error);
  }
}

// PDF.js configuration
pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

// DOM Elements
const documentTitle = document.getElementById("documentTitle");
const documentStatus = document.getElementById("documentStatus");
const downloadBtn = document.getElementById("downloadBtn");
const signBtn = document.getElementById("signBtn");
const toolbar = document.getElementById("toolbar");
const pdfCanvas = document.getElementById("pdfCanvas");
const annotationLayer = document.getElementById("annotationLayer");
const pageNum = document.getElementById("pageNum");
const pageCount = document.getElementById("pageCount");
const prevPage = document.getElementById("prevPage");
const nextPage = document.getElementById("nextPage");
const zoomIn = document.getElementById("zoomIn");
const zoomOut = document.getElementById("zoomOut");
const zoomLevel = document.getElementById("zoomLevel");
const toast = document.getElementById("toast");

// Panels
const signaturePanel = document.getElementById("signaturePanel");
const textPanel = document.getElementById("textPanel");
const signerInfo = document.getElementById("signerInfo");

// Signature Elements
const signatureCanvas = document.getElementById("signatureCanvas");
const clearSignature = document.getElementById("clearSignature");
const saveSignature = document.getElementById("saveSignature");
const typedSignature = document.getElementById("typedSignature");
const savedSignatures = document.getElementById("savedSignatures");

// State
let pdfDoc = null;
let currentPage = 1;
let scale = 1.0;
let documentData = null;
let documentId = null;
let accessToken = null;
let currentTool = "signature";
let annotations = [];
let isDrawing = false;
let signatureCtx = null;
let pendingAnnotation = null;

// Store original PDF page dimensions for accurate coordinate conversion
let originalPdfDimensions = { width: 0, height: 0 };

// Initialize
document.addEventListener("DOMContentLoaded", () => {
  // Initialize signature storage first
  if (typeof SignatureStorage !== "undefined") {
    window.signatureStorage = new SignatureStorage();
    window.signatureStorage.init();
    console.log("Enhanced signature storage initialized");
  } else {
    console.warn(
      "SignatureStorage class not found, falling back to basic localStorage"
    );
  }

  // Get URL parameters
  const urlParams = new URLSearchParams(window.location.search);
  documentId = urlParams.get("id");
  accessToken = urlParams.get("token");

  if (!documentId) {
    showToast("Invalid document link", "error");
    setTimeout(() => (window.location.href = "index.html"), 2000);
    return;
  }

  initializeSignatureCanvas();
  setupEventListeners();
  loadDocument();
  loadSavedSignatures();
});

// Document Loading
async function loadDocument() {
  try {
    console.log(
      "Loading document with ID:",
      documentId,
      "and token:",
      accessToken
    );

    // If we're in test mode (token = "test"), use mock data
    if (accessToken === "test") {
      console.log("Using mock data for testing");
      documentData = {
        title: "Test Document",
        status: "pending",
        createdBy: "Test User",
        currentSigner: {
          canSign: true,
          role: "Signer",
          status: "pending",
        },
        signers: [
          {
            name: "Test Signer",
            role: "Signer",
            status: "pending",
          },
        ],
        isCreator: false,
      };

      updateUI();

      // Create a simple mock PDF
      createMockPDF();
      return;
    }

    const getDocument = functions.httpsCallable("getDocument");
    const result = await getDocument({ documentId, accessToken });

    if (!result.data.success) {
      throw new Error(result.data.error || "Failed to load document");
    }

    documentData = result.data.document;
    updateUI();
    loadPDF();
  } catch (error) {
    console.error("Load error:", error);
    showToast(error.message || "Failed to load document", "error");
    setTimeout(() => (window.location.href = "index.html"), 2000);
  }
}

async function loadPDF() {
  try {
    console.log("Loading PDF for document:", documentId);
    const getDocumentPdf = functions.httpsCallable("getDocumentPdf");
    const result = await getDocumentPdf({ documentId, accessToken });

    if (!result.data.success) {
      throw new Error(result.data.error || "Failed to load PDF");
    }

    console.log("PDF data received, size:", result.data.pdfData.length);

    // Convert base64 to Uint8Array
    const pdfData = atob(result.data.pdfData);
    const pdfArray = new Uint8Array(pdfData.length);
    for (let i = 0; i < pdfData.length; i++) {
      pdfArray[i] = pdfData.charCodeAt(i);
    }

    console.log("Converted to Uint8Array, size:", pdfArray.length);

    // Load PDF with PDF.js
    const loadingTask = pdfjsLib.getDocument({ data: pdfArray });
    pdfDoc = await loadingTask.promise;

    console.log("PDF loaded successfully, pages:", pdfDoc.numPages);
    pageCount.textContent = pdfDoc.numPages;
    renderPage(currentPage);
  } catch (error) {
    console.error("PDF load error:", error);
    showToast("Failed to load PDF: " + error.message, "error");
  }
}

// UI Updates
function updateUI() {
  documentTitle.textContent = documentData.title;

  // Update status
  const statusMap = {
    pending: "Waiting for signatures",
    partial: "Partially signed",
    completed: "Fully signed",
  };
  documentStatus.textContent =
    statusMap[documentData.status] || documentData.status;

  // Show/hide sign button
  if (documentData.currentSigner && documentData.currentSigner.canSign) {
    signBtn.style.display = "block";
    toolbar.style.display = "flex";
  }

  // Update signer info
  if (documentData.currentSigner || !documentData.isCreator) {
    signerInfo.style.display = "block";
    document.getElementById("sentBy").textContent = documentData.createdBy;

    if (documentData.currentSigner) {
      document.getElementById("signerRole").textContent =
        documentData.currentSigner.role;
      document.getElementById("signerStatus").textContent =
        documentData.currentSigner.status === "completed"
          ? "Signed"
          : "Pending";
    }

    // Show all signers status
    const signersList = document.getElementById("signersList");
    signersList.innerHTML = "<h4>All Signers:</h4>";

    documentData.signers.forEach((signer) => {
      const item = document.createElement("div");
      item.className = "signer-status-item";
      item.innerHTML = `
                <span>${signer.name} (${signer.role})</span>
                <span class="status-icon ${signer.status}">
                    ${signer.status === "completed" ? "✓" : "○"}
                </span>
            `;
      signersList.appendChild(item);
    });
  }
}

// PDF Rendering
async function renderPage(pageNumber) {
  try {
    console.log("Rendering page:", pageNumber);
    const page = await pdfDoc.getPage(pageNumber);

    // CRITICAL: Get and store original PDF page dimensions at scale 1.0
    const originalViewport = page.getViewport({ scale: 1.0 });
    originalPdfDimensions = {
      width: originalViewport.width,
      height: originalViewport.height,
    };

    // Get scaled viewport for rendering
    const viewport = page.getViewport({ scale });

    const canvas = pdfCanvas;
    const context = canvas.getContext("2d");
    canvas.height = viewport.height;
    canvas.width = viewport.width;

    console.log("PDF Rendering Info:", {
      original: originalPdfDimensions,
      scaled: { width: viewport.width, height: viewport.height },
      scale: scale,
      canvas: { width: canvas.width, height: canvas.height },
    });

    const renderContext = {
      canvasContext: context,
      viewport: viewport,
    };

    await page.render(renderContext);
    console.log("Page rendered successfully");

    // Update annotation layer position
    updateAnnotationLayer();

    // Re-render existing annotations for this page
    renderAnnotations();

    // Update navigation buttons
    updateNavigationButtons();
  } catch (error) {
    console.error("Render error:", error);
    showToast("Failed to render page: " + error.message, "error");
  }
}

function updateAnnotationLayer() {
  const canvas = pdfCanvas;
  const container = canvas.parentElement;

  // Set annotation layer to match canvas dimensions and position
  annotationLayer.style.width = canvas.width + "px";
  annotationLayer.style.height = canvas.height + "px";
  annotationLayer.style.position = "absolute";
  annotationLayer.style.top = "0px";
  annotationLayer.style.left = "0px";
  annotationLayer.style.pointerEvents = "auto";
  annotationLayer.style.zIndex = "10";

  // Add active class to enable pointer events
  annotationLayer.classList.add("active");

  // Ensure the container is relatively positioned
  if (container) {
    container.style.position = "relative";
  }
}

// Event Listeners
function setupEventListeners() {
  // Navigation
  prevPage.addEventListener("click", () => {
    if (currentPage > 1) {
      currentPage--;
      pageNum.textContent = currentPage;
      renderPage(currentPage);
      updateNavigationButtons();
    }
  });

  nextPage.addEventListener("click", () => {
    if (currentPage < pdfDoc.numPages) {
      currentPage++;
      pageNum.textContent = currentPage;
      renderPage(currentPage);
      updateNavigationButtons();
    }
  });

  // Zoom
  zoomIn.addEventListener("click", () => {
    scale = Math.min(scale + 0.25, 3.0);
    zoomLevel.textContent = Math.round(scale * 100) + "%";
    renderPage(currentPage);
  });

  zoomOut.addEventListener("click", () => {
    scale = Math.max(scale - 0.25, 0.5);
    zoomLevel.textContent = Math.round(scale * 100) + "%";
    renderPage(currentPage);
  });

  // Tools
  document.querySelectorAll(".tool-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document
        .querySelectorAll(".tool-btn")
        .forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      currentTool = btn.dataset.tool;

      // Close any open panels
      signaturePanel.style.display = "none";
      textPanel.style.display = "none";
    });
  });

  // Annotation layer click
  annotationLayer.addEventListener("click", handleAnnotationClick);

  // Sign button
  signBtn.addEventListener("click", () => {
    if (annotations.length === 0) {
      showToast("Please add your signature to the document", "error");
      return;
    }

    document.getElementById("confirmModal").classList.add("show");
  });

  // Download button
  downloadBtn.addEventListener("click", downloadDocument);

  // Signature tabs
  document.querySelectorAll(".sig-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document
        .querySelectorAll(".sig-tab")
        .forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");

      // Show/hide tab content
      document.querySelectorAll(".sig-content").forEach((content) => {
        content.style.display = "none";
      });

      const tabName = tab.dataset.tab;
      document.getElementById(tabName + "Tab").style.display = "block";
    });
  });

  // Signature panel actions
  document
    .getElementById("applySignature")
    .addEventListener("click", applySignature);
  document.getElementById("cancelSignature").addEventListener("click", () => {
    signaturePanel.style.display = "none";
    pendingAnnotation = null;
  });

  // Text panel actions
  document.getElementById("applyText").addEventListener("click", applyText);
  document.getElementById("cancelText").addEventListener("click", () => {
    textPanel.style.display = "none";
    pendingAnnotation = null;
  });

  // Clear signature
  clearSignature.addEventListener("click", () => {
    const ctx = signatureCanvas.getContext("2d");
    ctx.clearRect(0, 0, signatureCanvas.width, signatureCanvas.height);
  });

  // Undo/Clear
  document.getElementById("undoBtn").addEventListener("click", () => {
    if (annotations.length > 0) {
      annotations.pop();
      renderAnnotations();
    }
  });

  document.getElementById("clearBtn").addEventListener("click", () => {
    if (confirm("Clear all annotations?")) {
      annotations = [];
      renderAnnotations();
    }
  });

  // Confirm sign
  document
    .getElementById("confirmSign")
    .addEventListener("click", submitSignature);

  // Window resize handler to update annotation layer
  window.addEventListener("resize", () => {
    if (pdfDoc) {
      setTimeout(updateAnnotationLayer, 100);
    }
  });
}

function updateNavigationButtons() {
  prevPage.disabled = currentPage <= 1;
  nextPage.disabled = currentPage >= pdfDoc.numPages;
}

// Annotation Handling
function handleAnnotationClick(e) {
  console.log("Annotation layer clicked", e);

  if (!documentData) {
    console.warn("Document data not loaded yet");
    showToast("Document is still loading, please wait", "warning");
    return;
  }

  if (!documentData.currentSigner || !documentData.currentSigner.canSign) {
    console.warn("User cannot sign this document");
    showToast("You are not authorized to sign this document", "error");
    return;
  }

  // Get click coordinates relative to the annotation layer
  const rect = annotationLayer.getBoundingClientRect();
  const layerX = e.clientX - rect.left;
  const layerY = e.clientY - rect.top;

  // IMPORTANT: Ensure we have the current PDF page dimensions
  if (!pdfDoc) {
    console.error("PDF not loaded");
    return;
  }

  // Store comprehensive positioning data
  pendingAnnotation = {
    x: layerX,
    y: layerY,
    page: currentPage,
    // Store actual canvas dimensions at time of annotation
    canvasWidth: pdfCanvas.width,
    canvasHeight: pdfCanvas.height,
    scale: scale,
    // Store the original PDF dimensions if available
    originalPdfWidth: originalPdfDimensions.width || pdfCanvas.width / scale,
    originalPdfHeight: originalPdfDimensions.height || pdfCanvas.height / scale,
  };

  console.log("Click position captured:", {
    layerCoords: { x: layerX, y: layerY },
    page: currentPage,
    canvas: {
      width: pdfCanvas.width,
      height: pdfCanvas.height,
      scale: scale,
    },
    originalPdf: {
      width: pendingAnnotation.originalPdfWidth,
      height: pendingAnnotation.originalPdfHeight,
    },
  });

  switch (currentTool) {
    case "signature":
      console.log("Opening signature panel");
      signaturePanel.style.display = "block";
      break;
    case "text":
      console.log("Opening text panel");
      textPanel.style.display = "block";
      document.getElementById("textInput").focus();
      break;
    case "date":
      console.log("Adding date annotation");
      addDateAnnotation(layerX, layerY);
      break;
    default:
      console.log("Unknown tool:", currentTool);
  }
}

function applySignature() {
  const activeTab = document.querySelector(".sig-tab.active").dataset.tab;
  let signatureData = null;

  switch (activeTab) {
    case "draw":
      signatureData = signatureCanvas.toDataURL();
      if (isCanvasEmpty(signatureCanvas)) {
        showToast("Please draw your signature", "error");
        return;
      }

      // Save signature if requested
      if (saveSignature.checked) {
        saveSignatureToStorage(signatureData);
      }
      break;

    case "type":
      const text = typedSignature.value.trim();
      if (!text) {
        showToast("Please type your signature", "error");
        return;
      }

      const font = document.querySelector('input[name="font"]:checked').value;
      signatureData = createTextSignature(text, font);
      break;

    case "saved":
      const selected = document.querySelector(".saved-sig-item.selected");
      if (!selected) {
        showToast("Please select a signature", "error");
        return;
      }
      signatureData = selected.dataset.signature;
      break;
  }

  if (signatureData && pendingAnnotation) {
    // Ensure we capture current state
    const currentCanvasWidth = pdfCanvas.width;
    const currentCanvasHeight = pdfCanvas.height;
    const currentScale = scale;

    annotations.push({
      type: "signature",
      data: signatureData,
      x: pendingAnnotation.x,
      y: pendingAnnotation.y,
      page: pendingAnnotation.page,
      // Store all coordinate conversion data
      canvasWidth: currentCanvasWidth,
      canvasHeight: currentCanvasHeight,
      scale: currentScale,
      originalPdfWidth: originalPdfDimensions.width,
      originalPdfHeight: originalPdfDimensions.height,
    });

    console.log("Signature annotation added:", {
      position: { x: pendingAnnotation.x, y: pendingAnnotation.y },
      canvas: { width: currentCanvasWidth, height: currentCanvasHeight },
      scale: currentScale,
      originalPdf: originalPdfDimensions,
    });

    renderAnnotations();
    signaturePanel.style.display = "none";
    pendingAnnotation = null;
  }
}

function applyText() {
  const text = document.getElementById("textInput").value.trim();
  if (!text) {
    showToast("Please enter text", "error");
    return;
  }

  const fontSize = document.getElementById("fontSize").value;

  if (pendingAnnotation) {
    annotations.push({
      type: "text",
      data: text,
      fontSize: fontSize,
      x: pendingAnnotation.x,
      y: pendingAnnotation.y,
      page: pendingAnnotation.page,
      // Include enhanced positioning data for accurate coordinate conversion
      canvasWidth: pendingAnnotation.canvasWidth,
      canvasHeight: pendingAnnotation.canvasHeight,
      scale: pendingAnnotation.scale,
      layerRect: pendingAnnotation.layerRect,
      // Include original PDF dimensions for accurate coordinate conversion
      originalPdfWidth: pendingAnnotation.originalPdfWidth,
      originalPdfHeight: pendingAnnotation.originalPdfHeight,
    });

    renderAnnotations();
    textPanel.style.display = "none";
    document.getElementById("textInput").value = "";
    pendingAnnotation = null;
  }
}

function addDateAnnotation(x, y) {
  const date = new Date().toLocaleDateString();
  annotations.push({
    type: "date",
    data: date,
    x: x,
    y: y,
    page: currentPage,
    // Include enhanced positioning data for accurate coordinate conversion
    canvasWidth: pdfCanvas.width,
    canvasHeight: pdfCanvas.height,
    scale: scale,
    layerRect: {
      width: annotationLayer.getBoundingClientRect().width,
      height: annotationLayer.getBoundingClientRect().height,
    },
    // Ensure we always have original PDF dimensions
    originalPdfWidth:
      originalPdfDimensions && originalPdfDimensions.width
        ? originalPdfDimensions.width
        : pdfCanvas.width / scale,
    originalPdfHeight:
      originalPdfDimensions && originalPdfDimensions.height
        ? originalPdfDimensions.height
        : pdfCanvas.height / scale,
  });

  renderAnnotations();
}

// Render Annotations
function renderAnnotations() {
  annotationLayer.innerHTML = "";

  annotations.forEach((annotation, index) => {
    if (annotation.page !== currentPage) return;

    const element = document.createElement("div");
    element.className = `annotation ${annotation.type}`;
    element.style.left = annotation.x + "px";
    element.style.top = annotation.y + "px";
    element.dataset.index = index;

    switch (annotation.type) {
      case "signature":
        const img = document.createElement("img");
        img.src = annotation.data;
        element.appendChild(img);
        break;

      case "text":
        element.textContent = annotation.data;
        element.style.fontSize = annotation.fontSize + "px";
        break;

      case "date":
        element.textContent = annotation.data;
        break;
    }

    // Add delete button
    const deleteBtn = document.createElement("div");
    deleteBtn.className = "annotation-delete";
    deleteBtn.innerHTML = "×";
    deleteBtn.onclick = () => {
      annotations.splice(index, 1);
      renderAnnotations();
    };
    element.appendChild(deleteBtn);

    // Make draggable
    makeDraggable(element, annotation);

    annotationLayer.appendChild(element);
  });
}

// Signature Canvas
function initializeSignatureCanvas() {
  console.log("Initializing signature canvas");

  if (!signatureCanvas) {
    console.error("Signature canvas element not found");
    return;
  }

  signatureCtx = signatureCanvas.getContext("2d");
  signatureCtx.strokeStyle = "#000";
  signatureCtx.lineWidth = 2;
  signatureCtx.lineCap = "round";

  let lastX = 0;
  let lastY = 0;

  signatureCanvas.addEventListener("mousedown", (e) => {
    console.log("Signature canvas mousedown");
    isDrawing = true;
    const rect = signatureCanvas.getBoundingClientRect();
    lastX = e.clientX - rect.left;
    lastY = e.clientY - rect.top;
  });

  signatureCanvas.addEventListener("mousemove", (e) => {
    if (!isDrawing) return;

    const rect = signatureCanvas.getBoundingClientRect();
    const currentX = e.clientX - rect.left;
    const currentY = e.clientY - rect.top;

    signatureCtx.beginPath();
    signatureCtx.moveTo(lastX, lastY);
    signatureCtx.lineTo(currentX, currentY);
    signatureCtx.stroke();

    lastX = currentX;
    lastY = currentY;
  });

  signatureCanvas.addEventListener("mouseup", () => {
    console.log("Signature canvas mouseup");
    isDrawing = false;
  });

  signatureCanvas.addEventListener("mouseout", () => {
    isDrawing = false;
  });

  // Touch support
  signatureCanvas.addEventListener("touchstart", (e) => {
    e.preventDefault();
    console.log("Signature canvas touchstart");
    const touch = e.touches[0];
    const mouseEvent = new MouseEvent("mousedown", {
      clientX: touch.clientX,
      clientY: touch.clientY,
    });
    signatureCanvas.dispatchEvent(mouseEvent);
  });

  signatureCanvas.addEventListener("touchmove", (e) => {
    e.preventDefault();
    const touch = e.touches[0];
    const mouseEvent = new MouseEvent("mousemove", {
      clientX: touch.clientX,
      clientY: touch.clientY,
    });
    signatureCanvas.dispatchEvent(mouseEvent);
  });

  signatureCanvas.addEventListener("touchend", (e) => {
    e.preventDefault();
    const mouseEvent = new MouseEvent("mouseup", {});
    signatureCanvas.dispatchEvent(mouseEvent);
  });

  console.log("Signature canvas initialized successfully");
}

// Submit Signature
async function submitSignature() {
  if (!documentData.currentSigner) {
    showToast("You are not authorized to sign this document", "error");
    return;
  }

  try {
    // Check if we have any annotations
    if (annotations.length === 0) {
      showToast("Please add your signature before submitting", "error");
      return;
    }

    // Get the primary signature annotation (required)
    const signatureAnnotation = annotations.find((a) => a.type === "signature");
    if (!signatureAnnotation) {
      showToast("Please add at least one signature before submitting", "error");
      return;
    }

    const confirmBtn = document.getElementById("confirmSign");
    confirmBtn.disabled = true;
    confirmBtn.textContent = "Signing...";

    console.log("Submitting signature with annotations:", annotations);
    console.log("Canvas dimensions:", {
      width: pdfCanvas.width,
      height: pdfCanvas.height,
      scale: scale,
    });
    console.log("Original PDF dimensions:", originalPdfDimensions);

    // Prepare annotation data with positioning and scaling information
    const annotationData = annotations.map((annotation) => ({
      type: annotation.type,
      data: annotation.data,
      x: annotation.x,
      y: annotation.y,
      page: annotation.page,
      fontSize: annotation.fontSize || null,
      // Include all positioning data for accurate coordinate conversion
      canvasWidth: annotation.canvasWidth || pdfCanvas.width,
      canvasHeight: annotation.canvasHeight || pdfCanvas.height,
      scale: annotation.scale || scale,
      originalPdfWidth:
        annotation.originalPdfWidth ||
        (originalPdfDimensions
          ? originalPdfDimensions.width
          : pdfCanvas.width / scale),
      originalPdfHeight:
        annotation.originalPdfHeight ||
        (originalPdfDimensions
          ? originalPdfDimensions.height
          : pdfCanvas.height / scale),
      timestamp: new Date().toISOString(),
    }));

    console.log("Annotation data being sent:", annotationData);

    const addSignature = functions.httpsCallable("addSignature");
    const result = await addSignature({
      documentId: documentId,
      signerId: documentData.currentSigner.id,
      accessToken: accessToken,
      signatureData: signatureAnnotation.data, // Keep main signature for backward compatibility
      signatureType: "image",
      annotations: annotationData, // Send all positioned annotations
      documentMetadata: {
        totalPages: pdfDoc ? pdfDoc.numPages : 1,
        currentScale: scale,
        canvasWidth: pdfCanvas.width,
        canvasHeight: pdfCanvas.height,
      },
    });

    if (result.data.success) {
      showToast(
        result.data.message || "Document signed successfully!",
        "success"
      );
      document.getElementById("confirmModal").classList.remove("show");

      // Reload document to update status
      setTimeout(() => {
        window.location.reload();
      }, 2000);
    } else {
      throw new Error(result.data.error || "Failed to sign document");
    }
  } catch (error) {
    console.error("Sign error:", error);
    showToast(error.message || "Failed to sign document", "error");
  } finally {
    const confirmBtn = document.getElementById("confirmSign");
    confirmBtn.disabled = false;
    confirmBtn.textContent = "Confirm & Sign";
  }
}

// Download Document
async function downloadDocument() {
  try {
    const getDocumentPdf = functions.httpsCallable("getDocumentPdf");
    const result = await getDocumentPdf({ documentId, accessToken });

    if (!result.data.success) {
      throw new Error(result.data.error || "Failed to download");
    }

    // Create blob and download
    const pdfData = atob(result.data.pdfData);
    const pdfArray = new Uint8Array(pdfData.length);
    for (let i = 0; i < pdfData.length; i++) {
      pdfArray[i] = pdfData.charCodeAt(i);
    }

    const blob = new Blob([pdfArray], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = result.data.fileName || "document.pdf";
    a.click();
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error("Download error:", error);
    showToast("Failed to download document", "error");
  }
}

// Mock PDF for testing
function createMockPDF() {
  console.log("Creating mock PDF for testing");

  // Create a simple canvas to act as our PDF
  const canvas = pdfCanvas;
  const context = canvas.getContext("2d");

  // Set canvas size
  canvas.width = 600;
  canvas.height = 800;

  // Draw a simple document layout
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);

  context.fillStyle = "#000000";
  context.font = "24px Arial";
  context.fillText("TEST DOCUMENT", 50, 50);

  context.font = "16px Arial";
  context.fillText("This is a test document for signature testing.", 50, 100);
  context.fillText(
    "Click anywhere on this document to add annotations.",
    50,
    130
  );
  context.fillText("Use the toolbar above to select different tools.", 50, 160);

  // Draw signature areas
  context.strokeStyle = "#cccccc";
  context.strokeRect(50, 300, 200, 80);
  context.fillText("Signature Area 1", 60, 350);

  context.strokeRect(350, 300, 200, 80);
  context.fillText("Signature Area 2", 360, 350);

  // Mock PDF doc object
  pdfDoc = {
    numPages: 1,
  };

  pageCount.textContent = "1";
  currentPage = 1;

  // Update annotation layer
  updateAnnotationLayer();
  updateNavigationButtons();

  console.log("Mock PDF created successfully");
}

// Utility Functions
function isCanvasEmpty(canvas) {
  const ctx = canvas.getContext("2d");
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;

  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] > 0) return false;
  }
  return true;
}

function createTextSignature(text, font) {
  const canvas = document.createElement("canvas");
  canvas.width = 300;
  canvas.height = 100;
  const ctx = canvas.getContext("2d");

  ctx.font = `30px ${font}`;
  ctx.fillStyle = "#000";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 150, 50);

  return canvas.toDataURL();
}

function saveSignatureToStorage(signatureData) {
  try {
    if (window.signatureStorage) {
      // Use enhanced signature storage
      const signatureId = window.signatureStorage.saveSignature(signatureData, {
        type: "canvas",
        name: `Signature ${new Date().toLocaleDateString()}`,
      });

      loadSavedSignatures();
      showToast("Signature saved", "success");

      return signatureId;
    } else {
      // Fallback to old method
      let signatures = JSON.parse(
        localStorage.getItem("savedSignatures") || "[]"
      );
      signatures.unshift({
        id: Date.now(),
        data: signatureData,
        date: new Date().toISOString(),
      });

      // Keep only last 5 signatures
      signatures = signatures.slice(0, 5);

      localStorage.setItem("savedSignatures", JSON.stringify(signatures));
      loadSavedSignatures();
      showToast("Signature saved", "success");
    }
  } catch (error) {
    console.error("Save error:", error);
    showToast("Failed to save signature", "error");
  }
}

function loadSavedSignatures() {
  console.log("Loading saved signatures");

  try {
    let signatures = [];

    if (window.signatureStorage) {
      // Use enhanced signature storage
      console.log("Using enhanced signature storage");
      signatures = window.signatureStorage.getAllSignatures();
      console.log("Found signatures:", signatures.length);
    } else {
      // Fallback to old method
      console.log("Using fallback signature storage");
      const stored = localStorage.getItem("savedSignatures");
      if (stored) {
        signatures = JSON.parse(stored);
      }
      console.log("Found signatures:", signatures.length);
    }

    if (signatures.length === 0) {
      savedSignatures.innerHTML = "<p>No saved signatures</p>";
      return;
    }

    savedSignatures.innerHTML = "";
    signatures.forEach((sig, index) => {
      try {
        const item = document.createElement("div");
        item.className = "saved-sig-item";

        // Ensure the signature data is properly formatted as a data URL
        let imageData = sig.data;
        if (!imageData.startsWith("data:")) {
          imageData = `data:image/png;base64,${sig.data}`;
        }
        item.dataset.signature = imageData;

        // Enhanced display with more information
        const displayName = sig.name || `Signature ${index + 1}`;
        const displayDate = sig.date
          ? new Date(sig.date).toLocaleDateString()
          : "Unknown date";

        item.innerHTML = `
                  <img src="${imageData}" alt="${displayName}" title="${displayName} - ${displayDate}" 
                       style="max-width: 100px; max-height: 50px; border: 1px solid #ccc;">
                  <div class="sig-info">
                    <small>${displayName}</small>
                    <small>${displayDate}</small>
                  </div>
                  <button class="btn-icon" onclick="deleteSavedSignature('${sig.id}')" title="Delete signature">×</button>
              `;

        item.addEventListener("click", (e) => {
          // Don't select if clicking delete button
          if (e.target.classList.contains("btn-icon")) return;

          document.querySelectorAll(".saved-sig-item").forEach((i) => {
            i.classList.remove("selected");
          });
          item.classList.add("selected");
          console.log("Selected signature:", sig.id);
        });

        savedSignatures.appendChild(item);
      } catch (itemError) {
        console.error("Error rendering signature item:", itemError, sig);
      }
    });

    // Show storage stats if enhanced storage is available
    if (window.signatureStorage) {
      const stats = window.signatureStorage.getStorageStats();
      const statsInfo = document.createElement("div");
      statsInfo.className = "storage-stats";
      statsInfo.innerHTML = `
        <small>Signatures: ${stats.count}/${
        stats.maxSignatures
      } | Storage: ${Math.round(stats.totalSize / 1024)}KB</small>
      `;
      savedSignatures.appendChild(statsInfo);
    }

    console.log("Saved signatures loaded successfully");
  } catch (error) {
    console.error("Load signatures error:", error);
    savedSignatures.innerHTML = "<p>Error loading signatures</p>";
    showToast("Error loading saved signatures", "error");
  }
}

window.deleteSavedSignature = function (id) {
  try {
    if (window.signatureStorage) {
      // Use enhanced signature storage
      window.signatureStorage.deleteSignature(id);
    } else {
      // Fallback to old method
      let signatures = JSON.parse(
        localStorage.getItem("savedSignatures") || "[]"
      );
      signatures = signatures.filter((sig) => sig.id != id); // Use != for compatibility
      localStorage.setItem("savedSignatures", JSON.stringify(signatures));
    }

    loadSavedSignatures();
    showToast("Signature deleted", "success");
  } catch (error) {
    console.error("Delete error:", error);
    showToast("Failed to delete signature", "error");
  }
};

function makeDraggable(element, annotation) {
  let isDragging = false;
  let startX, startY, initialX, initialY;

  element.addEventListener("mousedown", (e) => {
    if (e.target.classList.contains("annotation-delete")) return;

    isDragging = true;
    element.classList.add("selected");

    startX = e.clientX;
    startY = e.clientY;
    initialX = annotation.x;
    initialY = annotation.y;

    e.preventDefault();
  });

  document.addEventListener("mousemove", (e) => {
    if (!isDragging) return;

    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    annotation.x = initialX + dx;
    annotation.y = initialY + dy;

    element.style.left = annotation.x + "px";
    element.style.top = annotation.y + "px";
  });

  document.addEventListener("mouseup", () => {
    isDragging = false;
    element.classList.remove("selected");
  });
}

function showToast(message, type = "info") {
  toast.textContent = message;
  toast.className = `toast show ${type}`;

  setTimeout(() => {
    toast.classList.remove("show");
  }, 3000);
}

// Modal functions
window.closeConfirmModal = function () {
  document.getElementById("confirmModal").classList.remove("show");
};

// Debug functions for testing
window.debugSigningSystem = function () {
  console.group("🔍 Signing System Debug");
  console.log("Document ID:", documentId);
  console.log("Access Token:", accessToken ? "Present" : "Missing");
  console.log("Document Data:", documentData);
  console.log("PDF Doc:", pdfDoc);
  console.log("Current Page:", currentPage);
  console.log("Current Tool:", currentTool);
  console.log("Annotations:", annotations);
  console.log(
    "Signature Storage:",
    window.signatureStorage ? "Available" : "Not Available"
  );
  console.log("Annotation Layer:", {
    element: annotationLayer,
    style: annotationLayer ? annotationLayer.style.cssText : "Not found",
    classList: annotationLayer
      ? Array.from(annotationLayer.classList)
      : "Not found",
  });
  console.log("Signature Canvas:", {
    element: signatureCanvas,
    context: signatureCtx,
  });
  console.groupEnd();

  if (window.signatureStorage) {
    console.log(
      "Signature Storage Stats:",
      window.signatureStorage.getStorageStats()
    );
  }
};

// Debug function to check annotation data before submission
window.debugAnnotationData = function () {
  console.log("=== ANNOTATION DEBUG INFO ===");
  console.log("Current annotations:", annotations);
  console.log("PDF Canvas dimensions:", {
    width: pdfCanvas.width,
    height: pdfCanvas.height,
    scale: scale,
  });
  console.log("Current page:", currentPage);
  console.log("Document data:", documentData);

  if (annotations.length > 0) {
    annotations.forEach((annotation, index) => {
      console.log(`Annotation ${index}:`, {
        type: annotation.type,
        position: { x: annotation.x, y: annotation.y },
        page: annotation.page,
        dataLength: annotation.data ? annotation.data.length : 0,
      });
    });
  } else {
    console.log("No annotations found");
  }

  return {
    annotations,
    canvasDimensions: { width: pdfCanvas.width, height: pdfCanvas.height },
    scale,
    currentPage,
  };
};

// Test annotation layer click
window.testAnnotationClick = function () {
  if (!annotationLayer) {
    console.error("Annotation layer not found");
    return;
  }

  console.log("Testing annotation layer click simulation");
  const event = new MouseEvent("click", {
    clientX: 100,
    clientY: 100,
    bubbles: true,
  });

  annotationLayer.dispatchEvent(event);
};

// Test annotation preview function
window.previewAnnotationsOnPDF = function () {
  console.group("📝 Annotation Preview");
  console.log("Current annotations:", annotations);
  console.log("Canvas dimensions:", {
    width: pdfCanvas.width,
    height: pdfCanvas.height,
    scale: scale,
  });

  if (annotations.length === 0) {
    console.log("No annotations to preview");
    console.groupEnd();
    return;
  }

  // Simulate the annotation data that will be sent to the backend
  const annotationData = annotations.map((annotation) => ({
    type: annotation.type,
    data: annotation.data,
    x: annotation.x,
    y: annotation.y,
    page: annotation.page,
    fontSize: annotation.fontSize || null,
    canvasWidth: pdfCanvas.width,
    canvasHeight: pdfCanvas.height,
    scale: scale,
    timestamp: new Date().toISOString(),
  }));

  console.log("Annotation data to be sent:", annotationData);
  console.groupEnd();

  return annotationData;
};

// Test function to manually test signature submission with debug data
window.testSignatureSubmission = async function () {
  if (!documentData.currentSigner) {
    console.error("No current signer found");
    return;
  }

  if (annotations.length === 0) {
    console.error("No annotations to submit");
    return;
  }

  const testData = {
    documentId: documentId,
    signerId: documentData.currentSigner.id,
    accessToken: accessToken,
    signatureData: annotations.find((a) => a.type === "signature")?.data,
    signatureType: "image",
    annotations: annotations.map((annotation) => ({
      type: annotation.type,
      data: annotation.data,
      x: annotation.x,
      y: annotation.y,
      page: annotation.page,
      fontSize: annotation.fontSize || null,
      canvasWidth: pdfCanvas.width,
      canvasHeight: pdfCanvas.height,
      scale: scale,
      timestamp: new Date().toISOString(),
    })),
    documentMetadata: {
      totalPages: pdfDoc ? pdfDoc.numPages : 1,
      currentScale: scale,
      canvasWidth: pdfCanvas.width,
      canvasHeight: pdfCanvas.height,
    },
  };

  console.log("Test signature data being sent:", testData);

  try {
    const addSignature = functions.httpsCallable("addSignature");
    const result = await addSignature(testData);
    console.log("Signature submission result:", result);
    return result;
  } catch (error) {
    console.error("Signature submission error:", error);
    return error;
  }
};

// Test function to verify coordinate conversion
window.testCoordinateConversion = function () {
  console.group("🔍 Coordinate Conversion Test");

  // Test coordinates (center of canvas)
  const testX = pdfCanvas.width / 2;
  const testY = pdfCanvas.height / 2;

  console.log("Test coordinates (canvas center):", { x: testX, y: testY });
  console.log("Canvas dimensions:", {
    width: pdfCanvas.width,
    height: pdfCanvas.height,
  });
  console.log("Original PDF dimensions:", originalPdfDimensions);
  console.log("Current scale:", scale);

  // Calculate expected PDF coordinates using the simplified method
  const canvasWidth = pdfCanvas.width;
  const canvasHeight = pdfCanvas.height;

  // Convert to normalized coordinates (0-1)
  const normalizedX = testX / canvasWidth;
  const normalizedY = testY / canvasHeight;

  console.log("Normalized coordinates:", { x: normalizedX, y: normalizedY });

  // For the actual PDF, we would apply these to the PDF page size
  // and flip the Y coordinate
  if (originalPdfDimensions) {
    const pdfX = normalizedX * originalPdfDimensions.width;
    const pdfY =
      originalPdfDimensions.height - normalizedY * originalPdfDimensions.height;
    console.log("Expected PDF coordinates:", { x: pdfX, y: pdfY });
  }

  console.groupEnd();
};

// Test function to add a test annotation at the center
window.addTestAnnotation = function () {
  const centerX = annotationLayer.getBoundingClientRect().width / 2;
  const centerY = annotationLayer.getBoundingClientRect().height / 2;

  console.log("Adding test annotation at center:", { x: centerX, y: centerY });

  // Simulate a click at the center
  const testEvent = {
    clientX: annotationLayer.getBoundingClientRect().left + centerX,
    clientY: annotationLayer.getBoundingClientRect().top + centerY,
  };

  const rect = annotationLayer.getBoundingClientRect();
  const layerX = testEvent.clientX - rect.left;
  const layerY = testEvent.clientY - rect.top;

  addDateAnnotation(layerX, layerY);
  console.log("Test annotation added");
};
