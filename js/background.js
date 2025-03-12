// LinkedIn Connection Pro - Background Service Worker

// Global state - will need to be persisted across service worker restarts
let AppState = {
  isRunning: false,
  currentIndex: 0,
  profileLinks: [],
  note: '',
  templateId: 'default',
  delay: 60000,
  automationTabId: null,
  lastActiveTime: Date.now(),
  nextProfileTimeout: null,
  resumeFromIndex: 0,
  
  // Analytics tracking
  analytics: {
    startTime: null,
    endTime: null,
    totalSent: 0,
    successful: 0,
    failed: 0,
    alreadyConnected: 0,
    connectionsByDate: {},
    connectionsByTemplate: {},
    errorTypes: {}
  },
  
  // Profile data storage
  profiles: {},
  
  // Templates
  templates: {
    default: 'Hi [Name], I noticed your profile and would like to connect. I work in [Industry] at [Company] and thought we might benefit from networking.',
    recruiter: 'Hi [Name], I\'m a recruiter at [Company] specializing in [Industry] roles. I\'d love to connect and keep you updated on opportunities that match your expertise.',
    sales: 'Hi [Name], I noticed your work in [Industry] at [Company]. I help professionals like you with [Value Proposition]. Would you be open to connecting?',
    networking: 'Hi [Name], I\'m expanding my professional network in the [Industry] space and your profile caught my attention. I\'d be happy to connect and share insights.'
  },
  
  // Settings
  settings: {
    autoResume: true,
    autoExtract: true,
    notifications: true,
    darkMode: false,
    detectionMethod: 'auto',
    dataStorage: '90'
  }
};

// Reference to timers and intervals - need to be re-established after worker restarts
let heartbeatInterval = null;
let recoveryInterval = null;
let analyticsUpdateInterval = null;

// Service Worker Lifecycle Events
self.addEventListener('install', (event) => {
  console.log("LinkedIn Connection Pro service worker installed");
  
  // Skip waiting to become active immediately
  self.skipWaiting();
  
  // Load state from storage during installation
  event.waitUntil(
    chrome.storage.local.get([
      'connectionProState', 
      'connectionAnalytics', 
      'connectionProfiles', 
      'connectionTemplates', 
      'settings'
    ]).then((result) => {
      if (result.connectionProState) {
        console.log("Restoring state from storage");
        Object.assign(AppState, result.connectionProState);
        AppState.lastActiveTime = Date.now();
      }
      
      if (result.connectionAnalytics) {
        console.log("Restoring analytics from storage");
        AppState.analytics = {...AppState.analytics, ...result.connectionAnalytics};
      }
      
      if (result.connectionProfiles) {
        console.log("Restoring profiles from storage");
        AppState.profiles = result.connectionProfiles;
      }
      
      if (result.connectionTemplates) {
        console.log("Restoring templates from storage");
        AppState.templates = {...AppState.templates, ...result.connectionTemplates};
      }
      
      if (result.settings) {
        console.log("Restoring settings from storage");
        AppState.settings = {...AppState.settings, ...result.settings};
      }
    })
  );
});

self.addEventListener('activate', (event) => {
  console.log("LinkedIn Connection Pro service worker activated");
  
  // Claim clients so the service worker starts controlling current clients
  event.waitUntil(clients.claim());
  
  // After activation, check if we need to resume operation
  event.waitUntil(
    chrome.storage.local.get(['connectionProState']).then((result) => {
      if (result.connectionProState && result.connectionProState.isRunning && AppState.settings.autoResume) {
        console.log("Auto-resuming connection process");
        
        // Check if the tab still exists
        if (AppState.automationTabId) {
          chrome.tabs.get(AppState.automationTabId, (tab) => {
            if (chrome.runtime.lastError) {
              // Tab doesn't exist anymore, reset automation tab state
              AppState.automationTabId = null;
              saveState();
              
              // Restart from current index
              startSingleTabAutomation();
            } else {
              // Tab exists, continue where we left off
              updatePopup();
              startHeartbeat();
              startRecoveryChecker();
              startAnalyticsUpdater();
            }
          });
        } else {
          // No tab, create a new one
          startSingleTabAutomation();
        }
      }
    })
  );
});

// Save state to storage
function saveState() {
  // Update the last active time
  AppState.lastActiveTime = Date.now();
  
  // Save core state
  chrome.storage.local.set({ 
    'connectionProState': {
      isRunning: AppState.isRunning,
      currentIndex: AppState.currentIndex,
      profileLinks: AppState.profileLinks,
      note: AppState.note,
      templateId: AppState.templateId,
      delay: AppState.delay,
      automationTabId: AppState.automationTabId,
      lastActiveTime: AppState.lastActiveTime,
      resumeFromIndex: AppState.resumeFromIndex,
      settings: AppState.settings
    }
  });
}

// Save analytics separately to avoid storage size issues
function saveAnalytics() {
  chrome.storage.local.set({ 'connectionAnalytics': AppState.analytics });
}

// Save profiles data separately 
function saveProfiles() {
  // Apply data retention policy based on settings
  const profiles = pruneProfilesByRetentionPolicy(AppState.profiles);
  chrome.storage.local.set({ 'connectionProfiles': profiles });
}

// Save templates
function saveTemplates() {
  chrome.storage.local.set({ 'connectionTemplates': AppState.templates });
}

// Save settings
function saveSettings() {
  chrome.storage.local.set({ 'settings': AppState.settings });
}

// Prune old profile data based on retention policy
function pruneProfilesByRetentionPolicy(profiles) {
  const retentionDays = parseInt(AppState.settings.dataStorage);
  if (isNaN(retentionDays) || retentionDays === 0) return profiles; // Unlimited retention
  
  const now = Date.now();
  const maxAge = retentionDays * 24 * 60 * 60 * 1000; // days to milliseconds
  
  // Create a new profiles object with only the data within retention period
  const prunedProfiles = {};
  Object.keys(profiles).forEach(profileId => {
    const profile = profiles[profileId];
    if (profile.timestamp) {
      const profileDate = new Date(profile.timestamp).getTime();
      if (now - profileDate < maxAge) {
        prunedProfiles[profileId] = profile;
      }
    } else {
      // If no timestamp, keep it to be safe
      prunedProfiles[profileId] = profile;
    }
  });
  
  return prunedProfiles;
}

// Start the heartbeat system to keep scripts alive
function startHeartbeat() {
  // Clear any existing heartbeat
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
  }
  
  // Send heartbeat signal every 25 seconds
  heartbeatInterval = setInterval(() => {
    if (AppState.automationTabId && AppState.isRunning) {
      console.log("Sending heartbeat to tab");
      chrome.tabs.sendMessage(AppState.automationTabId, { action: 'heartbeat' })
        .then(response => {
          if (response) {
            console.log("Heartbeat response received");
            AppState.lastActiveTime = Date.now();
            saveState();
          }
        })
        .catch(error => {
          console.log("Heartbeat failed - tab may be inactive");
        });
    } else {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
  }, 25000);
}

// Start the recovery checker
function startRecoveryChecker() {
  // Clear any existing recovery interval
  if (recoveryInterval) {
    clearInterval(recoveryInterval);
  }
  
  // Check automation status every minute
  recoveryInterval = setInterval(() => {
    if (AppState.isRunning) {
      checkAndRecoverAutomation();
    } else {
      clearInterval(recoveryInterval);
      recoveryInterval = null;
    }
  }, 60000);
}

// Start analytics update interval
function startAnalyticsUpdater() {
  // Clear any existing interval
  if (analyticsUpdateInterval) {
    clearInterval(analyticsUpdateInterval);
  }
  
  // Save analytics every 5 minutes during operation
  analyticsUpdateInterval = setInterval(() => {
    if (AppState.isRunning) {
      saveAnalytics();
    } else {
      clearInterval(analyticsUpdateInterval);
      analyticsUpdateInterval = null;
    }
  }, 300000); // 5 minutes
}

// Check if automation needs recovery
function checkAndRecoverAutomation() {
  console.log("Running recovery check");
  
  // Check if it's been more than 5 minutes since last activity
  const fiveMinutes = 5 * 60 * 1000;
  const timeSinceActive = Date.now() - AppState.lastActiveTime;
  
  if (timeSinceActive > fiveMinutes) {
    console.log("Automation appears stalled - attempting recovery");
    
    // Check if tab exists
    if (AppState.automationTabId) {
      chrome.tabs.get(AppState.automationTabId)
        .then(tab => {
          // Tab exists but may be inactive - try to refresh it
          console.log("Refreshing automation tab");
          return chrome.tabs.reload(AppState.automationTabId);
        })
        .then(() => {
          // After reload, wait and try again
          setTimeout(function() {
            if (AppState.isRunning) {
              console.log("Re-sending connection request after refresh");
              chrome.tabs.sendMessage(AppState.automationTabId, {
                action: 'sendConnection',
                note: AppState.note,
                templateId: AppState.templateId
              });
              AppState.lastActiveTime = Date.now();
              saveState();
            }
          }, 10000);
        })
        .catch(error => {
          // Tab was closed - attempt to recover
          console.log("Automation tab was lost - creating new tab");
          AppState.automationTabId = null;
          saveState();
          
          // Restart from current index
          startSingleTabAutomation();
        });
    } else {
      // No tab, create a new one
      startSingleTabAutomation();
    }
  }
}

// Show desktop notification
function showNotification(title, message) {
  if (AppState.settings.notifications) {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'images/icon128.png',
      title: title,
      message: message
    });
  }
}

// Store profile data
function storeProfileData(profileData) {
  if (!profileData || !profileData.profileId) return;
  
  // Add or update profile data
  AppState.profiles[profileData.profileId] = {
    ...profileData,
    lastUpdate: new Date().toISOString()
  };
  
  // Save profiles to storage
  saveProfiles();
}

// Simplified track connection in analytics
function trackConnection(status, profileData = null) {
  // Only track successful connections
  if (status === 'success') {
    AppState.analytics.successful++;
    AppState.analytics.totalSent++; // Only increment for successful attempts
    
    // Track by date
    const today = new Date().toISOString().split('T')[0];
    if (!AppState.analytics.connectionsByDate[today]) {
      AppState.analytics.connectionsByDate[today] = {
        sent: 0,
        successful: 0
      };
    }
    
    AppState.analytics.connectionsByDate[today].sent++; // Only increment for successful
    AppState.analytics.connectionsByDate[today].successful++;
    
    // Track by template
    if (AppState.templateId) {
      if (!AppState.analytics.connectionsByTemplate[AppState.templateId]) {
        AppState.analytics.connectionsByTemplate[AppState.templateId] = {
          sent: 0,
          accepted: 0
        };
      }
      
      AppState.analytics.connectionsByTemplate[AppState.templateId].sent++; // Only increment for successful
    }
    
    // Store profile data if available
    if (profileData) {
      storeProfileData(profileData);
    }
    
    // Save analytics to storage
    saveAnalytics();
  }
}

// Initialize simplified connection tracking
function initializeConnectionTracking() {
  console.log("Initializing simplified connection tracking");
  // We no longer schedule periodic checks to simplify
}

// Initialize tracking
initializeConnectionTracking();

// Set up message listeners for communication with popup and content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("Background received message:", message.action);
  
  if (message.action === 'start') {
    console.log("Starting automation");
    
    // Initialize with user settings
    AppState.isRunning = true;
    AppState.profileLinks = message.links;
    AppState.note = message.note;
    AppState.delay = message.delay * 1000;
    AppState.lastActiveTime = Date.now();
    
    // Set template ID if provided
    if (message.templateId) {
      AppState.templateId = message.templateId;
    }
    
    // Start from a specific index if requested
    if (message.startIndex !== undefined && message.startIndex > 0 && message.startIndex < message.links.length) {
      AppState.currentIndex = message.startIndex;
      console.log(`Starting from saved position: ${message.startIndex}`);
    } else {
      AppState.currentIndex = 0;
    }
    
    // Reset resume point
    AppState.resumeFromIndex = AppState.currentIndex;
    
    // Initialize analytics for this run
    if (!AppState.analytics.startTime) {
      AppState.analytics.startTime = new Date().toISOString();
    }
    
    saveState();
    
    // Show notification
    showNotification(
      'LinkedIn Connection Pro', 
      `Starting to send connections to ${AppState.profileLinks.length} profiles`
    );
    
    // Start processing with the single tab approach
    startSingleTabAutomation();
    
    // Start monitors
    startHeartbeat();
    startRecoveryChecker();
    startAnalyticsUpdater();
    
    // Update popup
    updatePopup();
    
    sendResponse({success: true});
    return true;
  }
  
  if (message.action === 'stop') {
    console.log("Stopping automation");
    AppState.isRunning = false;
    
    // Update analytics end time
    AppState.analytics.endTime = new Date().toISOString();
    saveAnalytics();
    
    // Store resume point for later
    AppState.resumeFromIndex = AppState.currentIndex;
    saveState();
    
    // Clear any pending timeouts
    if (AppState.currentRecoveryTimeout) {
      clearTimeout(AppState.currentRecoveryTimeout);
      AppState.currentRecoveryTimeout = null;
    }
    
    if (AppState.nextProfileTimeout) {
      clearTimeout(AppState.nextProfileTimeout);
      AppState.nextProfileTimeout = null;
    }
    
    // Stop intervals
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
    if (recoveryInterval) {
      clearInterval(recoveryInterval);
      recoveryInterval = null;
    }
    if (analyticsUpdateInterval) {
      clearInterval(analyticsUpdateInterval);
      analyticsUpdateInterval = null;
    }
    
    // Close current tab if open
    if (AppState.automationTabId) {
      chrome.tabs.remove(AppState.automationTabId)
        .then(() => {
          AppState.automationTabId = null;
          saveState();
        })
        .catch(err => {
          console.log("Error closing tab:", err);
          AppState.automationTabId = null;
          saveState();
        });
    }
    
    // Show notification
    showNotification(
      'LinkedIn Connection Pro', 
      `Automation stopped at profile ${AppState.currentIndex}/${AppState.profileLinks.length}`
    );
    
    // Update popup
    updatePopup();
    
    sendResponse({success: true});
    return true;
  }
  
  if (message.action === 'reset') {
    console.log("Resetting automation state");
    
    // Reset connection state
    AppState.currentIndex = 0;
    AppState.resumeFromIndex = 0;
    saveState();
    
    // Update popup
    updatePopup();
    
    sendResponse({status: "reset_complete"});
    return true;
  }
  
  if (message.action === 'connectionSent') {
    console.log("Connection sent successfully");
    AppState.lastActiveTime = Date.now();
    
    // Track in analytics
    trackConnection('success', message.profileData);
    
    // Move to next profile
    moveToNextProfile();
    
    sendResponse({success: true});
    return true;
  }
  
  if (message.action === 'connectionFailed') {
    console.log("Connection failed");
    AppState.lastActiveTime = Date.now();
    
    // Track error types
    if (message.failureReason) {
      if (!AppState.analytics.errorTypes[message.failureReason]) {
        AppState.analytics.errorTypes[message.failureReason] = 0;
      }
      AppState.analytics.errorTypes[message.failureReason]++;
    }
    
    // Store profile data if available
    if (message.profileData) {
      storeProfileData(message.profileData);
    }
    
    // Move to next profile
    moveToNextProfile();
    
    sendResponse({success: true});
    return true;
  }
  
  if (message.action === 'saveTemplate') {
    console.log("Saving template:", message.templateId);
    
    if (message.templateId && message.templateContent) {
      // If all templates were provided, use them
      if (message.allTemplates) {
        AppState.templates = message.allTemplates;
      } else {
        // Otherwise just update this one template
        AppState.templates[message.templateId] = message.templateContent;
      }
      
      saveTemplates();
      
      sendResponse({status: "template_saved", success: true});
    }
    return true;
  }
  
  if (message.action === 'getTemplates') {
    console.log("Getting templates");
    // Return all templates
    sendResponse({templates: AppState.templates});
    return true;
  }
  
  if (message.action === 'deleteTemplate') {
    console.log("Deleting template:", message.templateId);
    
    if (message.templateId && AppState.templates[message.templateId]) {
      delete AppState.templates[message.templateId];
      saveTemplates();
      
      sendResponse({status: "template_deleted", success: true});
    }
    return true;
  }
  
  if (message.action === 'getAnalytics') {
    // Return analytics data
    let filteredAnalytics = AppState.analytics;
    
    // If date range specified, filter the data
    if (message.dateRange && message.dateRange !== 'all') {
      const daysToInclude = parseInt(message.dateRange);
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysToInclude);
      
      // Create a filtered copy of the analytics
      const filtered = {...AppState.analytics};
      filtered.connectionsByDate = {};
      
      // Only include dates after the cutoff
      Object.keys(AppState.analytics.connectionsByDate || {}).forEach(dateStr => {
        const entryDate = new Date(dateStr);
        if (entryDate >= cutoffDate) {
          filtered.connectionsByDate[dateStr] = AppState.analytics.connectionsByDate[dateStr];
        }
      });
      
      // Recalculate totals
      filtered.totalSent = 0;
      Object.values(filtered.connectionsByDate).forEach(day => {
        filtered.totalSent += (day.sent || 0);
      });
      
      filteredAnalytics = filtered;
    }
    
    sendResponse({analytics: filteredAnalytics});
    return true;
  }
  
  if (message.action === 'saveSettings') {
    console.log("Saving settings");
    
    if (message.settings) {
      AppState.settings = {...AppState.settings, ...message.settings};
      saveSettings();
      
      sendResponse({status: "settings_saved"});
    }
    return true;
  }
  
  if (message.action === 'heartbeatResponse') {
    console.log("Received heartbeat response");
    AppState.lastActiveTime = Date.now();
    saveState();
    // Send response if a callback was provided
    sendResponse({status: "alive"});
    return true;
  }
  
  if (message.action === 'contentUnloading') {
    console.log("Content script unloading - saving state");
    saveState();
    return true;
  }
  
  if (message.action === 'getStatus') {
    // Return current status to popup
    sendResponse({
      status: getStatusText(),
      progress: getProgressPercentage(),
      isRunning: AppState.isRunning,
      current: AppState.currentIndex,
      total: AppState.profileLinks.length,
      resumePoint: AppState.resumeFromIndex
    });
    return true;
  }
  
  if (message.action === 'exportAnalytics') {
    const csvContent = exportAnalyticsToCSV();
    sendResponse({csvContent: csvContent});
    return true;
  }
  
  return false; // Not handled - no response
});

// Get status text for UI
function getStatusText() {
  if (!AppState.isRunning && AppState.currentIndex === 0) {
    return 'Ready';
  } else if (AppState.isRunning) {
    return `Processing ${AppState.currentIndex + 1}/${AppState.profileLinks.length} profiles`;
  } else {
    return `Completed ${AppState.currentIndex}/${AppState.profileLinks.length} profiles`;
  }
}

// Get progress percentage for UI
function getProgressPercentage() {
  if (AppState.profileLinks.length === 0) {
    return 0;
  }
  return Math.round((AppState.currentIndex / AppState.profileLinks.length) * 100);
}

// Update popup with current status
function updatePopup() {
  chrome.runtime.sendMessage({
    status: getStatusText(),
    progress: getProgressPercentage(),
    isRunning: AppState.isRunning,
    current: AppState.currentIndex,
    total: AppState.profileLinks.length,
    resumePoint: AppState.resumeFromIndex
  }).catch(err => {
    // Popup might not be open, this is normal
    console.log("Could not update popup, likely not open");
  });
}

// Start single tab automation
function startSingleTabAutomation() {
  // First check if we should still be running
  if (!AppState.isRunning) {
    console.log("Automation stopped, not processing more profiles");
    return;
  }

  if (AppState.profileLinks.length === 0) {
    console.log("No profiles to process");
    AppState.isRunning = false;
    saveState();
    updatePopup();
    return;
  }

  if (AppState.currentIndex >= AppState.profileLinks.length) {
    console.log("All profiles already processed");
    AppState.isRunning = false;
    saveState();
    updatePopup();
    return;
  }
  
  // Implementation continued - automation logic maintained from original
  // but adapted for service worker context
  console.log(`Processing profile ${AppState.currentIndex + 1}/${AppState.profileLinks.length}`);
  
  // Create a new tab for the profile
  chrome.tabs.create({ 
    url: AppState.profileLinks[AppState.currentIndex],
    active: false // Keep in background
  }).then(tab => {
    AppState.automationTabId = tab.id;
    AppState.lastActiveTime = Date.now();
    saveState();
    
    // Wait for page to load before sending the command
    setTimeout(() => {
      if (AppState.isRunning) {
        chrome.tabs.sendMessage(tab.id, {
          action: 'sendConnection',
          note: AppState.note,
          templateId: AppState.templateId
        }).catch(error => {
          console.log("Error sending message to tab, might not be ready yet");
          // Will be handled by recovery system if needed
        });
      }
    }, 10000); // Wait 10 seconds for page to load
  }).catch(error => {
    console.error("Error creating tab:", error);
    moveToNextProfile();
  });
}

// Move to next profile
function moveToNextProfile() {
  // First check if we should still be running
  if (!AppState.isRunning) {
    console.log("Automation stopped, not moving to next profile");
    return;
  }

  // Increment counter
  AppState.currentIndex++;
  AppState.resumeFromIndex = AppState.currentIndex; // Store resume point
  AppState.lastActiveTime = Date.now();
  saveState();
  
  // Update popup
  updatePopup();
  
  // If still running and profiles left, navigate to next profile after delay
  if (AppState.isRunning && AppState.currentIndex < AppState.profileLinks.length) {
    console.log(`Waiting ${AppState.delay/1000}s before next profile`);
    
    // Show notification of progress
    if (AppState.currentIndex % 5 === 0) { // Show every 5 profiles
      showNotification(
        'LinkedIn Connection Pro', 
        `Processed ${AppState.currentIndex}/${AppState.profileLinks.length} profiles`
      );
    }
    
    // Create a timeout for the next profile, and store it so we can cancel it if needed
    AppState.nextProfileTimeout = setTimeout(function() {
      // Clear the reference
      AppState.nextProfileTimeout = null;
      
      // Check if we're still running before starting the next profile
      if (AppState.isRunning) {
        // Process the next profile
        startSingleTabAutomation();
      }
    }, AppState.delay);
  } else if (AppState.currentIndex >= AppState.profileLinks.length) {
    // All profiles processed
    console.log("All profiles processed");
    AppState.isRunning = false;
    
    // Update analytics end time
    AppState.analytics.endTime = new Date().toISOString();
    saveAnalytics();
    
    saveState();
    updatePopup();
    
    // Show completion notification
    showNotification(
      'LinkedIn Connection Pro', 
      `Completed sending connections to ${AppState.profileLinks.length} profiles!`
    );
    
    // Stop intervals
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
    if (recoveryInterval) {
      clearInterval(recoveryInterval);
      recoveryInterval = null;
    }
    if (analyticsUpdateInterval) {
      clearInterval(analyticsUpdateInterval);
      analyticsUpdateInterval = null;
    }
    
    // Close automation tab if it exists
    if (AppState.automationTabId) {
      chrome.tabs.remove(AppState.automationTabId)
        .then(() => {
          AppState.automationTabId = null;
          saveState();
        })
        .catch(err => {
          console.log("Error closing tab:", err);
          AppState.automationTabId = null;
          saveState();
        });
    }
  }
}

// Handle tab removal
chrome.tabs.onRemoved.addListener((tabId) => {
  // If our automation tab was closed
  if (tabId === AppState.automationTabId) {
    console.log("Automation tab was closed");
    AppState.automationTabId = null;
    saveState();
    
    // If we're still running, try to recover
    if (AppState.isRunning) {
      console.log("Tab was closed while automation was running - will attempt recovery");
      setTimeout(function() {
        startSingleTabAutomation();
      }, 5000);
    }
  }
});

// Export analytics data as CSV - method for popup to trigger download
function exportAnalyticsToCSV() {
  // Headers for the CSV
  const headers = ['Date', 'Connections Sent'];
  
  // Start with headers
  let csvContent = headers.join(',') + '\n';
  
  // Get dates in order
  const dates = Object.keys(AppState.analytics.connectionsByDate || {}).sort();
  
  // Add a row for each date
  dates.forEach(date => {
    const dayData = AppState.analytics.connectionsByDate[date];
    const sent = dayData.sent || 0;
    
    // Format date for better readability
    const dateObj = new Date(date);
    const formattedDate = dateObj.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
    
    // Add row to CSV
    csvContent += `${formattedDate},${sent}\n`;
  });
  
  // Add template performance data
  csvContent += '\n\nTemplate Performance\n';
  csvContent += 'Template,Sent\n';
  
  // Add a row for each template
  Object.entries(AppState.analytics.connectionsByTemplate || {}).forEach(([templateId, data]) => {
    const sent = data.sent || 0;
    
    // Format template name
    let templateName = templateId;
    if (templateId === 'default') templateName = 'Default Template';
    if (templateId === 'recruiter') templateName = 'Recruiter Template';
    if (templateId === 'sales') templateName = 'Sales Template';
    if (templateId === 'networking') templateName = 'Networking Template';
    
    // Add row to CSV
    csvContent += `${templateName},${sent}\n`;
  });
  
  return csvContent;
}

// Initialize connection tracking
initializeConnectionTracking();

// Log that the service worker is ready
console.log('LinkedIn Connection Pro service worker ready');