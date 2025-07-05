/**
 * Enhanced Local Storage for Signatures
 * Replaces cloud storage with robust local storage management
 */

class SignatureStorage {
  constructor() {
    this.storageKey = "rbs_saved_signatures";
    this.maxSignatures = 10; // Increased from 5
    this.compressionQuality = 0.8; // For image compression
  }

  /**
   * Initialize storage and clean up if needed
   */
  init() {
    try {
      // Check if localStorage is available
      if (!this.isLocalStorageAvailable()) {
        console.warn(
          "Local storage not available, signatures will not be saved"
        );
        return false;
      }

      // Clean up old format signatures if they exist
      this.migrateOldFormat();

      // Clean up corrupted entries
      this.cleanupCorruptedEntries();

      return true;
    } catch (error) {
      console.error("Error initializing signature storage:", error);
      return false;
    }
  }

  /**
   * Check if localStorage is available
   */
  isLocalStorageAvailable() {
    try {
      const test = "test";
      localStorage.setItem(test, test);
      localStorage.removeItem(test);
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * Save a signature to local storage
   */
  saveSignature(signatureData, options = {}) {
    try {
      if (!signatureData) {
        throw new Error("Signature data is required");
      }

      // Compress the image if it's too large
      const compressedData = this.compressSignature(signatureData);

      const signature = {
        id: Date.now() + Math.random().toString(36).substr(2, 9),
        data: compressedData,
        type: options.type || "canvas",
        name: options.name || "Signature",
        date: new Date().toISOString(),
        size: this.getDataSize(compressedData),
        metadata: {
          userAgent: navigator.userAgent,
          timestamp: Date.now(),
          version: "2.0",
        },
      };

      const signatures = this.getAllSignatures();

      // Add new signature at the beginning
      signatures.unshift(signature);

      // Keep only the most recent signatures
      const trimmedSignatures = signatures.slice(0, this.maxSignatures);

      // Check storage quota
      if (!this.checkStorageQuota(trimmedSignatures)) {
        throw new Error("Not enough storage space available");
      }

      localStorage.setItem(this.storageKey, JSON.stringify(trimmedSignatures));

      console.log(
        `Signature saved successfully. Total signatures: ${trimmedSignatures.length}`
      );
      return signature.id;
    } catch (error) {
      console.error("Error saving signature:", error);
      throw error;
    }
  }

  /**
   * Get all saved signatures
   */
  getAllSignatures() {
    try {
      const stored = localStorage.getItem(this.storageKey);
      if (!stored) {
        return [];
      }

      const signatures = JSON.parse(stored);

      // Validate the format
      if (!Array.isArray(signatures)) {
        console.warn("Invalid signature storage format, resetting");
        localStorage.removeItem(this.storageKey);
        return [];
      }

      return signatures.filter((sig) => this.isValidSignature(sig));
    } catch (error) {
      console.error("Error loading signatures:", error);
      return [];
    }
  }

  /**
   * Get a specific signature by ID
   */
  getSignature(id) {
    const signatures = this.getAllSignatures();
    return signatures.find((sig) => sig.id === id);
  }

  /**
   * Delete a signature by ID
   */
  deleteSignature(id) {
    try {
      const signatures = this.getAllSignatures();
      const filteredSignatures = signatures.filter((sig) => sig.id !== id);

      localStorage.setItem(this.storageKey, JSON.stringify(filteredSignatures));

      console.log(`Signature ${id} deleted successfully`);
      return true;
    } catch (error) {
      console.error("Error deleting signature:", error);
      return false;
    }
  }

  /**
   * Clear all saved signatures
   */
  clearAllSignatures() {
    try {
      localStorage.removeItem(this.storageKey);
      console.log("All signatures cleared");
      return true;
    } catch (error) {
      console.error("Error clearing signatures:", error);
      return false;
    }
  }

  /**
   * Get storage usage statistics
   */
  getStorageStats() {
    const signatures = this.getAllSignatures();
    const totalSize = signatures.reduce((sum, sig) => sum + (sig.size || 0), 0);

    return {
      count: signatures.length,
      totalSize: totalSize,
      averageSize:
        signatures.length > 0 ? Math.round(totalSize / signatures.length) : 0,
      maxSignatures: this.maxSignatures,
      storageAvailable: this.getAvailableStorage(),
    };
  }

  /**
   * Compress signature data if it's too large
   */
  compressSignature(signatureData) {
    try {
      // If it's already small enough, return as-is
      if (this.getDataSize(signatureData) < 50000) {
        // 50KB
        return signatureData;
      }

      // Create a canvas to compress the image
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      const img = new Image();

      return new Promise((resolve) => {
        img.onload = () => {
          // Set reasonable dimensions
          const maxWidth = 400;
          const maxHeight = 150;

          let { width, height } = img;

          if (width > maxWidth) {
            height = (height * maxWidth) / width;
            width = maxWidth;
          }

          if (height > maxHeight) {
            width = (width * maxHeight) / height;
            height = maxHeight;
          }

          canvas.width = width;
          canvas.height = height;

          ctx.fillStyle = "white";
          ctx.fillRect(0, 0, width, height);
          ctx.drawImage(img, 0, 0, width, height);

          const compressedData = canvas.toDataURL(
            "image/png",
            this.compressionQuality
          );
          resolve(compressedData);
        };

        img.src = signatureData;
      });
    } catch (error) {
      console.warn("Error compressing signature, using original:", error);
      return signatureData;
    }
  }

  /**
   * Get the size of data in bytes
   */
  getDataSize(data) {
    if (!data) return 0;
    return new Blob([data]).size;
  }

  /**
   * Check if there's enough storage quota
   */
  checkStorageQuota(signatures) {
    try {
      const testData = JSON.stringify(signatures);
      localStorage.setItem("_quota_test", testData);
      localStorage.removeItem("_quota_test");
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get available storage space (estimation)
   */
  getAvailableStorage() {
    try {
      let used = 0;
      for (let key in localStorage) {
        if (localStorage.hasOwnProperty(key)) {
          used += localStorage[key].length;
        }
      }

      // Most browsers have 5-10MB limit for localStorage
      const estimated = 5 * 1024 * 1024; // 5MB
      return Math.max(0, estimated - used);
    } catch (error) {
      return 0;
    }
  }

  /**
   * Validate signature object
   */
  isValidSignature(signature) {
    return (
      signature &&
      signature.id &&
      signature.data &&
      signature.date &&
      (signature.data.startsWith("data:image/") ||
        signature.data.startsWith("data:"))
    );
  }

  /**
   * Migrate from old signature storage format
   */
  migrateOldFormat() {
    try {
      const oldKey = "savedSignatures";
      const oldData = localStorage.getItem(oldKey);

      if (oldData && !localStorage.getItem(this.storageKey)) {
        const oldSignatures = JSON.parse(oldData);

        if (Array.isArray(oldSignatures)) {
          const migratedSignatures = oldSignatures.map((sig) => ({
            id: sig.id || Date.now() + Math.random().toString(36).substr(2, 9),
            data: sig.data,
            type: "canvas",
            name: "Migrated Signature",
            date: sig.date || new Date().toISOString(),
            size: this.getDataSize(sig.data),
            metadata: {
              migrated: true,
              timestamp: Date.now(),
              version: "2.0",
            },
          }));

          localStorage.setItem(
            this.storageKey,
            JSON.stringify(migratedSignatures)
          );
          localStorage.removeItem(oldKey);

          console.log(
            `Migrated ${migratedSignatures.length} signatures to new format`
          );
        }
      }
    } catch (error) {
      console.error("Error migrating signatures:", error);
    }
  }

  /**
   * Clean up corrupted entries
   */
  cleanupCorruptedEntries() {
    try {
      const signatures = this.getAllSignatures();
      const validSignatures = signatures.filter((sig) =>
        this.isValidSignature(sig)
      );

      if (validSignatures.length !== signatures.length) {
        localStorage.setItem(this.storageKey, JSON.stringify(validSignatures));
        console.log(
          `Cleaned up ${
            signatures.length - validSignatures.length
          } corrupted signature entries`
        );
      }
    } catch (error) {
      console.error("Error cleaning up signatures:", error);
    }
  }

  /**
   * Export signatures as JSON
   */
  exportSignatures() {
    const signatures = this.getAllSignatures();
    const exportData = {
      version: "2.0",
      exported: new Date().toISOString(),
      signatures: signatures,
      stats: this.getStorageStats(),
    };

    return JSON.stringify(exportData, null, 2);
  }

  /**
   * Import signatures from JSON
   */
  importSignatures(jsonData, merge = false) {
    try {
      const importData = JSON.parse(jsonData);

      if (!importData.signatures || !Array.isArray(importData.signatures)) {
        throw new Error("Invalid import format");
      }

      const validSignatures = importData.signatures.filter((sig) =>
        this.isValidSignature(sig)
      );

      let currentSignatures = [];
      if (merge) {
        currentSignatures = this.getAllSignatures();
      }

      // Merge and deduplicate by ID
      const allSignatures = [...currentSignatures];
      validSignatures.forEach((importedSig) => {
        if (!allSignatures.find((sig) => sig.id === importedSig.id)) {
          allSignatures.push(importedSig);
        }
      });

      // Keep only the most recent
      const finalSignatures = allSignatures
        .sort((a, b) => new Date(b.date) - new Date(a.date))
        .slice(0, this.maxSignatures);

      localStorage.setItem(this.storageKey, JSON.stringify(finalSignatures));

      console.log(`Imported ${validSignatures.length} signatures`);
      return finalSignatures.length;
    } catch (error) {
      console.error("Error importing signatures:", error);
      throw error;
    }
  }
}

// Create global instance
window.signatureStorage = new SignatureStorage();

// Initialize on load
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    window.signatureStorage.init();
  });
} else {
  window.signatureStorage.init();
}

// Export for use in other modules
if (typeof module !== "undefined" && module.exports) {
  module.exports = SignatureStorage;
}
