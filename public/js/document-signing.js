// js/document-signing.js

// Initialize Firebase
const auth = firebase.auth();
const functions = firebase.functions();

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

// Initialize
document.addEventListener("DOMContentLoaded", () => {
  // Get URL parameters
  const urlParams = new URLSearchParams(window.location.search);
  documentId = urlParams.get("id");
  accessToken = urlParams.get("token");

  if (!documentId) {
    showToast("Invalid document link", "error");
    setTimeout(() => (window.location.href = "/"), 2000);
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
    setTimeout(() => (window.location.href = "/"), 2000);
  }
}

async function loadPDF() {
  try {
    const getDocumentPdf = functions.httpsCallable("getDocumentPdf");
    const result = await getDocumentPdf({ documentId, accessToken });

    if (!result.data.success) {
      throw new Error(result.data.error || "Failed to load PDF");
    }

    // Convert base64 to Uint8Array
    const pdfData = atob(result.data.pdfData);
    const pdfArray = new Uint8Array(pdfData.length);
    for (let i = 0; i < pdfData.length; i++) {
      pdfArray[i] = pdfData.charCodeAt(i);
    }

    // Load PDF with PDF.js
    const loadingTask = pdfjsLib.getDocument({ data: pdfArray });
    pdfDoc = await loadingTask.promise;

    pageCount.textContent = pdfDoc.numPages;
    renderPage(currentPage);
  } catch (error) {
    console.error("PDF load error:", error);
    showToast("Failed to load PDF", "error");
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
    const page = await pdfDoc.getPage(pageNumber);
    const viewport = page.getViewport({ scale });

    const canvas = pdfCanvas;
    const context = canvas.getContext("2d");
    canvas.height = viewport.height;
    canvas.width = viewport.width;

    const renderContext = {
      canvasContext: context,
      viewport: viewport,
    };

    await page.render(renderContext);

    // Update annotation layer position
    updateAnnotationLayer();
  } catch (error) {
    console.error("Render error:", error);
    showToast("Failed to render page", "error");
  }
}

function updateAnnotationLayer() {
  const canvasRect = pdfCanvas.getBoundingClientRect();
  annotationLayer.style.width = pdfCanvas.width + "px";
  annotationLayer.style.height = pdfCanvas.height + "px";
  annotationLayer.style.left = canvasRect.left + "px";
  annotationLayer.style.top = canvasRect.top + "px";
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
}

function updateNavigationButtons() {
  prevPage.disabled = currentPage <= 1;
  nextPage.disabled = currentPage >= pdfDoc.numPages;
}

// Annotation Handling
function handleAnnotationClick(e) {
  if (!documentData.currentSigner || !documentData.currentSigner.canSign)
    return;

  const rect = annotationLayer.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  pendingAnnotation = { x, y, page: currentPage };

  switch (currentTool) {
    case "signature":
      signaturePanel.style.display = "block";
      break;
    case "text":
      textPanel.style.display = "block";
      document.getElementById("textInput").focus();
      break;
    case "date":
      addDateAnnotation(x, y);
      break;
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
    annotations.push({
      type: "signature",
      data: signatureData,
      x: pendingAnnotation.x,
      y: pendingAnnotation.y,
      page: pendingAnnotation.page,
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
  signatureCtx = signatureCanvas.getContext("2d");
  signatureCtx.strokeStyle = "#000";
  signatureCtx.lineWidth = 2;
  signatureCtx.lineCap = "round";

  let lastX = 0;
  let lastY = 0;

  signatureCanvas.addEventListener("mousedown", (e) => {
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
    isDrawing = false;
  });

  signatureCanvas.addEventListener("mouseout", () => {
    isDrawing = false;
  });

  // Touch support
  signatureCanvas.addEventListener("touchstart", (e) => {
    e.preventDefault();
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
}

// Submit Signature
async function submitSignature() {
  if (!documentData.currentSigner) {
    showToast("You are not authorized to sign this document", "error");
    return;
  }

  try {
    // Get the primary signature annotation
    const signatureAnnotation = annotations.find((a) => a.type === "signature");
    if (!signatureAnnotation) {
      showToast("Please add your signature before submitting", "error");
      return;
    }

    const confirmBtn = document.getElementById("confirmSign");
    confirmBtn.disabled = true;
    confirmBtn.textContent = "Signing...";

    const addSignature = functions.httpsCallable("addSignature");
    const result = await addSignature({
      documentId: documentId,
      signerId: documentData.currentSigner.id,
      accessToken: accessToken,
      signatureData: signatureAnnotation.data,
      signatureType: "image",
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
  } catch (error) {
    console.error("Save error:", error);
    showToast("Failed to save signature", "error");
  }
}

function loadSavedSignatures() {
  try {
    const signatures = JSON.parse(
      localStorage.getItem("savedSignatures") || "[]"
    );

    if (signatures.length === 0) {
      savedSignatures.innerHTML = "<p>No saved signatures</p>";
      return;
    }

    savedSignatures.innerHTML = "";
    signatures.forEach((sig) => {
      const item = document.createElement("div");
      item.className = "saved-sig-item";
      item.dataset.signature = sig.data;
      item.innerHTML = `
                <img src="${sig.data}" alt="Saved signature">
                <button class="btn-icon" onclick="deleteSavedSignature(${sig.id})">×</button>
            `;

      item.addEventListener("click", () => {
        document.querySelectorAll(".saved-sig-item").forEach((i) => {
          i.classList.remove("selected");
        });
        item.classList.add("selected");
      });

      savedSignatures.appendChild(item);
    });
  } catch (error) {
    console.error("Load signatures error:", error);
  }
}

window.deleteSavedSignature = function (id) {
  try {
    let signatures = JSON.parse(
      localStorage.getItem("savedSignatures") || "[]"
    );
    signatures = signatures.filter((sig) => sig.id !== id);
    localStorage.setItem("savedSignatures", JSON.stringify(signatures));
    loadSavedSignatures();
    showToast("Signature deleted", "success");
  } catch (error) {
    console.error("Delete error:", error);
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
