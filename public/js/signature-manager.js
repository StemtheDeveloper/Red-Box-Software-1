/**
 * Signature Storage Management Utilities
 * Provides tools for managing locally stored signatures
 */

// Add signature management utilities to the window object
window.SignatureManager = {
  /**
   * Display storage statistics in console
   */
  showStats() {
    if (!window.signatureStorage) {
      console.log("Enhanced signature storage not available");
      return;
    }

    const stats = window.signatureStorage.getStorageStats();
    console.group("📝 Signature Storage Statistics");
    console.log(`Signatures: ${stats.count}/${stats.maxSignatures}`);
    console.log(`Total Storage: ${Math.round(stats.totalSize / 1024)}KB`);
    console.log(`Average Size: ${Math.round(stats.averageSize / 1024)}KB`);
    console.log(
      `Available Storage: ~${Math.round(stats.storageAvailable / 1024)}KB`
    );
    console.groupEnd();

    return stats;
  },

  /**
   * Export all signatures to a downloadable file
   */
  exportSignatures() {
    if (!window.signatureStorage) {
      console.error("Enhanced signature storage not available");
      return;
    }

    try {
      const exportData = window.signatureStorage.exportSignatures();
      const blob = new Blob([exportData], { type: "application/json" });
      const url = URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = url;
      a.download = `rbs-signatures-export-${
        new Date().toISOString().split("T")[0]
      }.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      URL.revokeObjectURL(url);
      console.log("✅ Signatures exported successfully");
    } catch (error) {
      console.error("❌ Export failed:", error);
    }
  },

  /**
   * Import signatures from a file
   */
  importSignatures(file, merge = true) {
    if (!window.signatureStorage) {
      console.error("Enhanced signature storage not available");
      return;
    }

    if (!file) {
      console.error("No file provided");
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const importedCount = window.signatureStorage.importSignatures(
          e.target.result,
          merge
        );
        console.log(`✅ Imported ${importedCount} signatures`);

        // Reload signatures if we're on a signing page
        if (typeof loadSavedSignatures === "function") {
          loadSavedSignatures();
        }
      } catch (error) {
        console.error("❌ Import failed:", error);
      }
    };

    reader.readAsText(file);
  },

  /**
   * Clear all signatures with confirmation
   */
  clearAllSignatures() {
    if (!window.signatureStorage) {
      console.error("Enhanced signature storage not available");
      return;
    }

    const stats = window.signatureStorage.getStorageStats();
    if (stats.count === 0) {
      console.log("No signatures to clear");
      return;
    }

    if (
      confirm(
        `Are you sure you want to delete all ${stats.count} saved signatures? This cannot be undone.`
      )
    ) {
      window.signatureStorage.clearAllSignatures();
      console.log("✅ All signatures cleared");

      // Reload signatures if we're on a signing page
      if (typeof loadSavedSignatures === "function") {
        loadSavedSignatures();
      }
    }
  },

  /**
   * Create a backup of signatures
   */
  createBackup() {
    if (!window.signatureStorage) {
      console.error("Enhanced signature storage not available");
      return;
    }

    const stats = window.signatureStorage.getStorageStats();
    if (stats.count === 0) {
      console.log("No signatures to backup");
      return;
    }

    try {
      const backupData = window.signatureStorage.exportSignatures();
      const backupKey = `rbs_signature_backup_${Date.now()}`;
      localStorage.setItem(backupKey, backupData);

      console.log(`✅ Backup created: ${backupKey}`);
      console.log(
        'To restore, use: SignatureManager.restoreBackup("' + backupKey + '")'
      );

      return backupKey;
    } catch (error) {
      console.error("❌ Backup failed:", error);
    }
  },

  /**
   * Restore from a backup
   */
  restoreBackup(backupKey, merge = false) {
    if (!window.signatureStorage) {
      console.error("Enhanced signature storage not available");
      return;
    }

    try {
      const backupData = localStorage.getItem(backupKey);
      if (!backupData) {
        console.error("Backup not found:", backupKey);
        return;
      }

      const restoredCount = window.signatureStorage.importSignatures(
        backupData,
        merge
      );
      console.log(`✅ Restored ${restoredCount} signatures from backup`);

      // Reload signatures if we're on a signing page
      if (typeof loadSavedSignatures === "function") {
        loadSavedSignatures();
      }

      return restoredCount;
    } catch (error) {
      console.error("❌ Restore failed:", error);
    }
  },

  /**
   * List all available backups
   */
  listBackups() {
    const backups = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith("rbs_signature_backup_")) {
        const timestamp = key.replace("rbs_signature_backup_", "");
        const date = new Date(parseInt(timestamp));
        backups.push({
          key: key,
          date: date.toLocaleString(),
          timestamp: timestamp,
        });
      }
    }

    if (backups.length === 0) {
      console.log("No backups found");
      return [];
    }

    console.group("📋 Available Signature Backups");
    backups.forEach((backup) => {
      console.log(`${backup.date} - ${backup.key}`);
    });
    console.groupEnd();

    return backups;
  },

  /**
   * Show help for signature management
   */
  help() {
    console.group("📝 Signature Manager Help");
    console.log("Available commands:");
    console.log("- SignatureManager.showStats() - Show storage statistics");
    console.log(
      "- SignatureManager.exportSignatures() - Export all signatures to file"
    );
    console.log(
      "- SignatureManager.importSignatures(file, merge) - Import signatures from file"
    );
    console.log(
      "- SignatureManager.clearAllSignatures() - Clear all signatures"
    );
    console.log("- SignatureManager.createBackup() - Create a backup");
    console.log(
      "- SignatureManager.restoreBackup(key, merge) - Restore from backup"
    );
    console.log("- SignatureManager.listBackups() - List all backups");
    console.log("- SignatureManager.help() - Show this help");
    console.groupEnd();
  },
};

// Auto-display help when the script loads (only in development)
if (
  window.location.hostname === "localhost" ||
  window.location.hostname === "127.0.0.1"
) {
  console.log(
    "🚀 Signature Manager loaded. Type SignatureManager.help() for available commands."
  );
}
