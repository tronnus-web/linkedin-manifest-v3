document.addEventListener('DOMContentLoaded', function() {
  // DOM Elements
  const tabButtons = document.querySelectorAll('.tab-button');
  const tabContents = document.querySelectorAll('.tab-content');
  
  const startButton = document.getElementById('start-button');
  const stopButton = document.getElementById('stop-button');
  const resetButton = document.getElementById('reset-button');
  
  const profileLinks = document.getElementById('profile-links');
  const connectionNote = document.getElementById('connection-note');
  const delayRange = document.getElementById('delay-range');
  const delayInput = document.getElementById('delay-input');
  
  const templateSelect = document.getElementById('template-select');
  const togglePersonalization = document.getElementById('toggle-personalization');
  const personalizationContent = document.querySelector('.personalization-content');
  
  const statusText = document.getElementById('status-text');
  const progressBar = document.getElementById('progress-bar');
  const progressCount = document.getElementById('progress-count');
  const progressPercentage = document.getElementById('progress-percentage');
  
  const personalizationTags = document.querySelectorAll('.tag');
  const darkModeToggle = document.getElementById('dark-mode');

  // State
  let appState = {
    isRunning: false,
    currentIndex: 0,
    profileLinks: [],
    note: '',
    delay: 60,
    totalProfilesProcessed: 0,
    successfulConnections: 0,
    failedConnections: 0,
    templates: {},
    templateId: 'default',
    analytics: {
      sentByDate: {},
      acceptedByDate: {},
      templatePerformance: {}
    },
    resumeFromIndex: 0,
    settings: {
      autoResume: true,
      autoExtract: true,
      notifications: true,
      darkMode: false,
      detectionMethod: 'auto',
      dataStorage: '90'
    }
  };
  
  // Initialize
  initializeApp();
  
  // Event Listeners
  // Tab Navigation
  tabButtons.forEach(button => {
    button.addEventListener('click', () => {
      const tabName = button.getAttribute('data-tab');
      switchTab(tabName);
    });
  });
  
  // Form Interactions
  delayRange.addEventListener('input', () => {
    delayInput.value = delayRange.value;
  });
  
  delayInput.addEventListener('input', () => {
    delayRange.value = delayInput.value;
  });
  
  togglePersonalization.addEventListener('click', () => {
    togglePersonalization.classList.toggle('active');
    
    if (togglePersonalization.classList.contains('active')) {
      personalizationContent.classList.add('active');
      personalizationContent.style.maxHeight = personalizationContent.scrollHeight + 'px';
    } else {
      personalizationContent.classList.remove('active');
      personalizationContent.style.maxHeight = '0';
    }
  });
  
  // Personalization Tags
  personalizationTags.forEach(tag => {
    tag.addEventListener('click', () => {
      const tagText = tag.getAttribute('data-tag');
      insertTagAtCursor(connectionNote, tagText);
    });
  });
  
  // Template Selection
  templateSelect.addEventListener('change', () => {
    const selectedTemplate = templateSelect.value;
    loadTemplate(selectedTemplate);
    appState.templateId = selectedTemplate;
  });

  // Date Range Filter
document.getElementById('date-range').addEventListener('change', function() {
  const selectedRange = this.value;
  console.log("Date range changed to:", selectedRange);
  
  // Request analytics data with the selected filter
  chrome.runtime.sendMessage({ 
    action: 'getAnalytics',
    dateRange: selectedRange 
  }, function(response) {
    if (response && response.analytics) {
      updateCharts(response.analytics, selectedRange);
      updateAnalyticsMetrics(response.analytics);
    }
  });
});
  
  // Action Buttons
  startButton.addEventListener('click', startSendingConnections);
  stopButton.addEventListener('click', stopSendingConnections);
  resetButton.addEventListener('click', resetProcess);
  
  // Dark Mode Toggle
  darkModeToggle.addEventListener('change', () => {
    document.body.setAttribute('data-theme', darkModeToggle.checked ? 'dark' : 'light');
    appState.settings.darkMode = darkModeToggle.checked;
    saveSettings();
  });
  
  // Template Tab Setup
  const templateCards = document.querySelectorAll('.template-card');
  templateCards.forEach(card => {
    card.addEventListener('click', () => {
      templateCards.forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      
      // Get template name and update dropdown
      const templateName = card.querySelector('h4').textContent;
      document.getElementById('template-select').value = templateNameToValue(templateName);
      
      // Load template content
      loadTemplate(templateNameToValue(templateName));
      
      // Set current templateId
      appState.templateId = templateNameToValue(templateName);
    });
  });
  
  // Modal handling
  setupModalHandlers();
  
  // Initialize connection with background script
  chrome.runtime.sendMessage({ action: 'getStatus' }, function(response) {
    if (response) {
      updateUI(response);
    }
  });
  
  // Listen for status updates from background script
  chrome.runtime.onMessage.addListener(function(message) {
    if (message.status) {
      updateUI(message);
    }
  });
  
  // Functions
  function initializeApp() {
    // Load saved data
    chrome.storage.local.get(['profileLinks', 'note', 'delay', 'connectProState', 'templates', 'analytics', 'settings'], function(data) {
      if (data.profileLinks) profileLinks.value = data.profileLinks;
      if (data.note) connectionNote.value = data.note;
      
      if (data.delay) {
        delayInput.value = data.delay;
        delayRange.value = data.delay;
      }
      
      if (data.templates) {
        appState.templates = data.templates;
        populateTemplates();
      }
      
      if (data.analytics) {
        appState.analytics = data.analytics;
        updateAnalyticsUI();
      }
      
      if (data.settings) {
        appState.settings = {...appState.settings, ...data.settings};
        applySettings();
      }
      
      // Check if process is already running from saved state
      if (data.connectProState && data.connectProState.isRunning) {
        updateUI({
          status: getStatusText(data.connectProState),
          progress: getProgressPercentage(data.connectProState),
          isRunning: true,
          current: data.connectProState.currentIndex,
          total: data.connectProState.profileLinks.length
        });
      }
      
      // Request analytics data from background script
      chrome.runtime.sendMessage({ action: 'getAnalytics' }, function(response) {
        if (response && response.analytics) {
          // Update charts with real data
          updateCharts(response.analytics);
          
          // Update analytics metrics on the page
          updateAnalyticsMetrics(response.analytics);
        }
      });
      
      // Make sure we have the updated templates and refresh the UI
      chrome.runtime.sendMessage({ action: 'getTemplates' }, function(response) {
        if (response && response.templates) {
          appState.templates = response.templates;
          
          // If on templates tab, update the UI
          if (document.querySelector('.tab-button[data-tab="templates"]').classList.contains('active')) {
            updateTemplatesUI();
          }
        }
      });
    });
    
    // Initialize chart
    initializeChart();
  }
  
  function applySettings() {
    // Apply dark mode
    if (appState.settings.darkMode) {
      document.body.setAttribute('data-theme', 'dark');
      darkModeToggle.checked = true;
    }
    
    // Set other settings
    document.getElementById('auto-resume').checked = appState.settings.autoResume;
    document.getElementById('auto-extract').checked = appState.settings.autoExtract;
    document.getElementById('notifications').checked = appState.settings.notifications;
    document.getElementById('detection-method').value = appState.settings.detectionMethod;
    document.getElementById('data-storage').value = appState.settings.dataStorage;
  }
  
  function saveSettings() {
    appState.settings = {
      autoResume: document.getElementById('auto-resume').checked,
      autoExtract: document.getElementById('auto-extract').checked,
      notifications: document.getElementById('notifications').checked,
      darkMode: document.getElementById('dark-mode').checked,
      detectionMethod: document.getElementById('detection-method').value,
      dataStorage: document.getElementById('data-storage').value
    };
    
    chrome.storage.local.set({ 'settings': appState.settings });
  }
  
  function switchTab(tabName) {
    // Remove active class from all tabs
    tabButtons.forEach(button => button.classList.remove('active'));
    tabContents.forEach(content => content.classList.remove('active'));
    
    // Add active class to selected tab
    document.querySelector(`.tab-button[data-tab="${tabName}"]`).classList.add('active');
    document.getElementById(`${tabName}-tab`).classList.add('active');
    
    // Special handling for analytics tab
    if (tabName === 'analytics') {
      setTimeout(() => {
        if (typeof initializeCharts === 'function') {
          initializeCharts();
        } else {
          console.log("initializeCharts function not defined");
        }
      }, 100);
    }
  }
  
  function insertTagAtCursor(textArea, tag) {
    const startPos = textArea.selectionStart;
    const endPos = textArea.selectionEnd;
    const text = textArea.value;
    
    textArea.value = text.substring(0, startPos) + tag + text.substring(endPos);
    textArea.focus();
    textArea.selectionStart = startPos + tag.length;
    textArea.selectionEnd = startPos + tag.length;
  }
  
  function loadTemplate(templateId) {
    let templateText = '';
    
    // First check if the template exists in our saved templates
    if (appState.templates && appState.templates[templateId]) {
      templateText = appState.templates[templateId];
    } else {
      // Fallback to built-in templates
      switch (templateId) {
        case 'default':
          templateText = 'Hi [Name], I noticed your profile and would like to connect. I work in [Industry] at [Company] and thought we might benefit from networking.';
          break;
        case 'recruiter':
          templateText = 'Hi [Name], I\'m a recruiter at [Company] specializing in [Industry] roles. I\'d love to connect and keep you updated on opportunities that match your expertise.';
          break;
        case 'sales':
          templateText = 'Hi [Name], I noticed your work in [Industry] at [Company]. I help professionals like you with [Value Proposition]. Would you be open to connecting?';
          break;
        case 'networking':
          templateText = 'Hi [Name], I\'m expanding my professional network in the [Industry] space and your profile caught my attention. I\'d be happy to connect and share insights.';
          break;
        case 'custom':
          templateText = connectionNote.value; // Keep current text
          break;
      }
    }
    
    connectionNote.value = templateText;
  }
  
  function templateNameToValue(name) {
    // Convert template name to dropdown value
    if (name === 'Default Template') return 'default';
    if (name === 'Recruiter Template') return 'recruiter';
    if (name === 'Sales Template') return 'sales';
    if (name === 'Networking Template') return 'networking';
    
    // Generic conversion
    return name.toLowerCase().replace(/\s+/g, '-').replace(/-+/g, '-').replace(/template/g, '').replace(/-$/, '');
  }
  
  function populateTemplates() {
    // This would be expanded in a full implementation
    // For now we just call updateTemplatesUI
    updateTemplatesUI();
  }
  
  function startSendingConnections() {
    const links = profileLinks.value.trim().split('\n')
      .filter(link => link.trim() !== '')
      .map(link => link.trim());
    
    const note = connectionNote.value;
    const delay = parseInt(delayInput.value);
    
    if (links.length === 0) {
      statusText.textContent = 'Please enter at least one LinkedIn profile link';
      return;
    }
    
    // Save values for next time
    chrome.storage.local.set({
      profileLinks: profileLinks.value,
      note: note,
      delay: delay
    });
    
    // Get resume index if available
    chrome.storage.local.get(['resumeFromIndex'], function(data) {
      const startIndex = data.resumeFromIndex || 0;
      
      // Send data to background script to start automation
      chrome.runtime.sendMessage({
        action: 'start',
        links: links,
        note: note,
        delay: delay,
        startIndex: startIndex,
        templateId: appState.templateId
      });
      
      // Update UI
      startButton.disabled = true;
      stopButton.disabled = false;
      statusText.textContent = 'Starting...';
    });
  }
  
  function stopSendingConnections() {
    chrome.runtime.sendMessage({ action: 'getStatus' }, function(response) {
      if (response && response.current) {
        // Store current position for resuming later
        chrome.storage.local.set({ 'resumeFromIndex': response.current });
        console.log(`Saved position at index: ${response.current}`);
      }
      
      // Stop the process
      chrome.runtime.sendMessage({ action: 'stop' });
    });
  }
  
  function resetProcess() {
    // Reset progress and counters
    chrome.runtime.sendMessage({ action: 'reset' });
    
    // Reset local state
    appState.resumeFromIndex = 0;
    appState.currentIndex = 0;
    chrome.storage.local.set({ 'resumeFromIndex': 0 });
    
    // Update UI
    updateUI({
      status: 'Ready',
      progress: 0,
      isRunning: false,
      current: 0,
      total: 0
    });
  }
  
  function updateUI(message) {
    if (message.status) {
      statusText.textContent = message.status;
    }
    
    if (message.progress !== undefined) {
      progressBar.style.width = message.progress + '%';
      progressPercentage.textContent = message.progress + '%';
    }
    
    if (message.current !== undefined && message.total !== undefined) {
      progressCount.textContent = `${message.current}/${message.total}`;
      
      // Update state
      appState.currentIndex = message.current;
      appState.profileLinks = new Array(message.total);
    }
    
    if (message.isRunning !== undefined) {
      appState.isRunning = message.isRunning;
      startButton.disabled = message.isRunning;
      stopButton.disabled = !message.isRunning;
      
      // Track analytics
      if (message.connectionSent) {
        trackConnection('sent');
      }
      
      if (message.connectionAccepted) {
        trackConnection('accepted');
      }
    }
  }
  
  function getStatusText(state) {
    if (!state.isRunning && state.currentIndex === 0) {
      return 'Ready';
    } else if (state.isRunning) {
      return `Processing ${state.currentIndex + 1}/${state.profileLinks.length} profiles`;
    } else {
      return `Completed ${state.currentIndex}/${state.profileLinks.length} profiles`;
    }
  }
  
  function getProgressPercentage(state) {
    if (!state.profileLinks || state.profileLinks.length === 0) {
      return 0;
    }
    return Math.round((state.currentIndex / state.profileLinks.length) * 100);
  }
  
  function setupModalHandlers() {
    const templateEditorModal = document.getElementById('template-editor-modal');
    const closeModalBtn = document.querySelector('.close-modal');
    const cancelBtn = document.querySelector('.modal-cancel');
    const saveBtn = document.querySelector('.modal-save');
    const addTemplateBtn = document.getElementById('add-template');
    const editTemplateBtns = document.querySelectorAll('.template-actions .icon-button');
    
    // Open modal for new template
    if (addTemplateBtn) {
      addTemplateBtn.addEventListener('click', () => {
        document.getElementById('template-name').value = 'New Template';
        document.getElementById('template-content').value = '';
        templateEditorModal.classList.add('active');
      });
    }
    
    // Open modal for existing template
    editTemplateBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation(); // Prevent template card activation
        const templateCard = btn.closest('.template-card');
        const templateName = templateCard.querySelector('h4').textContent;
        const templateContent = templateCard.querySelector('.template-preview').textContent.trim();
        
        document.getElementById('template-name').value = templateName;
        document.getElementById('template-content').value = templateContent;
        templateEditorModal.classList.add('active');
      });
    });
    
    // Close modal
    if (closeModalBtn) {
      closeModalBtn.addEventListener('click', () => {
        templateEditorModal.classList.remove('active');
      });
    }
    
    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => {
        templateEditorModal.classList.remove('active');
      });
    }
    
    // Save template with enhanced functionality
    if (saveBtn) {
      saveBtn.addEventListener('click', () => {
        const templateName = document.getElementById('template-name').value;
        const templateContent = document.getElementById('template-content').value;
        
        if (!templateName || !templateContent) {
          alert('Please provide both a template name and content');
          return;
        }
        
        // Convert template name to a valid ID
        const templateId = templateName.toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/-+/g, '-')
          .replace(/^-|-$/g, '');
        
        console.log(`Saving template: ${templateId}`);
        
        // First get existing templates to avoid overwriting
        chrome.runtime.sendMessage({ action: 'getTemplates' }, function(response) {
          let templates = {};
          
          if (response && response.templates) {
            templates = response.templates;
          }
          
          // Add/update this template
          templates[templateId] = templateContent;
          
          // Save template to state
          appState.templates = templates;
          
          // Send template to background script
          chrome.runtime.sendMessage({
            action: 'saveTemplate',
            templateId: templateId,
            templateContent: templateContent,
            templateName: templateName,
            allTemplates: templates
          }, function(response) {
            console.log('Template save response:', response);
            
            // Update UI
            updateTemplatesUI();
            
            // Add to template dropdown
            const templateOption = document.createElement('option');
            templateOption.value = templateId;
            templateOption.textContent = templateName;
            
            const templateSelect = document.getElementById('template-select');
            
            // Check if template already exists in dropdown
            const existingOption = Array.from(templateSelect.options).find(opt => opt.value === templateId);
            
            if (!existingOption) {
              templateSelect.appendChild(templateOption);
            }
            
            // Close modal
            templateEditorModal.classList.remove('active');
          });
        });
      });
    }
    
    // Insert tag into template content
    const tagPills = document.querySelectorAll('.tag-pill');
    tagPills.forEach(pill => {
      pill.addEventListener('click', () => {
        const tag = pill.getAttribute('data-tag');
        insertTagAtCursor(document.getElementById('template-content'), tag);
      });
    });
  }
  
  function trackConnection(type) {
    const today = new Date().toISOString().split('T')[0];
    const templateUsed = templateSelect.value;
    
    // Initialize if necessary
    if (!appState.analytics.sentByDate) {
      appState.analytics.sentByDate = {};
    }
    
    if (!appState.analytics.acceptedByDate) {
      appState.analytics.acceptedByDate = {};
    }
    
    if (!appState.analytics.templatePerformance) {
      appState.analytics.templatePerformance = {};
    }
    
    // Update counters
    if (type === 'sent') {
      if (!appState.analytics.sentByDate[today]) {
        appState.analytics.sentByDate[today] = 0;
      }
      appState.analytics.sentByDate[today]++;
      
      if (!appState.analytics.templatePerformance[templateUsed]) {
        appState.analytics.templatePerformance[templateUsed] = { sent: 0, accepted: 0 };
      }
      appState.analytics.templatePerformance[templateUsed].sent++;
    }
    
    if (type === 'accepted') {
      if (!appState.analytics.acceptedByDate[today]) {
        appState.analytics.acceptedByDate[today] = 0;
      }
      appState.analytics.acceptedByDate[today]++;
      
      if (!appState.analytics.templatePerformance[templateUsed]) {
        appState.analytics.templatePerformance[templateUsed] = { sent: 1, accepted: 0 };
      }
      appState.analytics.templatePerformance[templateUsed].accepted++;
    }
    
    // Save analytics data
    chrome.storage.local.set({ 'analytics': appState.analytics });
    
    // Update UI if on analytics tab
    if (document.querySelector('.tab-button[data-tab="analytics"]').classList.contains('active')) {
      updateAnalyticsUI();
    }
  }
  
  function updateAnalyticsUI() {
    // This function would update the analytics charts and tables
    chrome.runtime.sendMessage({ action: 'getAnalytics' }, function(response) {
      if (response && response.analytics) {
        updateCharts(response.analytics);
        updateAnalyticsMetrics(response.analytics);
      }
    });
  }
  
  // Debug Chart Initialization
  function debugChartInitialization() {
    console.log("=== Chart Debug Information ===");
    
    // Check for the canvas element
    const canvas = document.getElementById('connections-chart');
    console.log("Canvas element exists:", !!canvas);
    
    if (canvas) {
      console.log("Canvas dimensions:", {
        width: canvas.width,
        height: canvas.height,
        offsetWidth: canvas.offsetWidth,
        offsetHeight: canvas.offsetHeight,
        style: canvas.getAttribute('style')
      });
    } else {
      console.error("Canvas element with ID 'connections-chart' not found!");
      
      // Look for other canvas elements
      const allCanvases = document.querySelectorAll('canvas');
      console.log(`Found ${allCanvases.length} canvas elements on the page:`);
      allCanvases.forEach((c, i) => {
        console.log(`Canvas ${i}: id=${c.id}, class=${c.className}`);
      });
    }
    
    // Check if Chart.js is loaded
    console.log("Chart global object exists:", typeof Chart !== 'undefined');
    
    // Check the chart container
    const container = document.querySelector('.chart-container');
    console.log("Chart container exists:", !!container);
    if (container) {
      console.log("Chart container dimensions:", {
        offsetWidth: container.offsetWidth,
        offsetHeight: container.offsetHeight,
        style: container.getAttribute('style')
      });
      console.log("Chart container HTML:", container.innerHTML);
    }

    // Check if we have any data to display
    chrome.runtime.sendMessage({ action: 'getAnalytics' }, function(response) {
      console.log("Analytics data received:", response);
      if (response && response.analytics) {
        console.log("Total sent:", response.analytics.totalSent);
        console.log("connectionsByDate:", response.analytics.connectionsByDate);
      }
    });
  }
  
  // Get last 7 days as labels
  function getLast7DaysLabels() {
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      days.push(formatDate(date));
    }
    return days;
  }

  // Get date labels for specified number of days
function getDateLabels(days) {
  const labels = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    labels.push(formatDate(date));
  }
  return labels;
}

  // Format date as "MMM DD"
  function formatDate(date) {
    const options = { month: 'short', day: 'numeric' };
    return date.toLocaleDateString('en-US', options);
  }
  
  // Initialize Chart
  function initializeChart() {
    console.log("initializeChart called");
    
    // Only initialize if on analytics tab and Chart.js is loaded
    if (!document.getElementById('connections-chart')) {
      console.log("connections-chart element not found or not on analytics tab");
      return;
    }
    
    if (typeof Chart === 'undefined') {
      console.error("Chart.js not loaded!");
      return;
    }
    
    // Run debug checks
    debugChartInitialization();
    
    console.log("Chart element found, proceeding with initialization");
    
    // Get chart labels (last 7 days)
    const labels = getLast7DaysLabels();
    console.log("Chart labels:", labels);
    
    // Initialize with empty data - will be populated later
    const connectionData = {
      sent: [0, 0, 0, 0, 0, 0, 0],
      accepted: [0, 0, 0, 0, 0, 0, 0]
    };
    
    // Get the chart context
    const ctx = document.getElementById('connections-chart').getContext('2d');
    console.log("Chart context obtained");
    
    // Create chart with initial empty data
    try {
      const connectionsChart = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: labels,
          datasets: [
            {
              label: 'Connections Sent',
              data: connectionData.sent,
              backgroundColor: '#0077B5',
              borderColor: '#0077B5',
              borderWidth: 1,
              borderRadius: 4,
              barThickness: 10,
            },
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            y: {
              beginAtZero: true,
              grid: {
                color: 'rgba(200, 200, 200, 0.1)',
              },
              ticks: {
                font: {
                  size: 11
                }
              }
            },
            x: {
              grid: {
                display: false
              },
              ticks: {
                font: {
                  size: 11
                },
                maxRotation: 90,
                minRotation: 45,
                callback: function(value, index, values) {
                  // Show fewer labels if there are many
                  const labelCount = values.length;
                  if (labelCount > 14) {
                    return index % 3 === 0 ? this.getLabelForValue(value) : '';
                  }
                  return this.getLabelForValue(value);
                }
              }
            }
          },
          plugins: {
            legend: {
              display: false
            },
            tooltip: {
              mode: 'index',
              intersect: false,
              backgroundColor: 'rgba(50, 50, 50, 0.95)',
              padding: 10,
              cornerRadius: 4,
              titleFont: {
                size: 12
              },
              bodyFont: {
                size: 12
              }
            }
          }
        }
      });
      
      console.log("Chart created successfully");
      
      // Save chart instance for later updates
      window.connectionsChart = connectionsChart;
      
      // Request real data from background script
      chrome.runtime.sendMessage({ action: 'getAnalytics' }, function(response) {
        console.log("Received analytics response:", response);
        if (response && response.analytics) {
          // Process the real data and update charts
          updateCharts(response.analytics);
        }
      });
    } catch (error) {
      console.error("Error creating chart:", error);
    }
  }
  
  // Update Charts with real data
function updateCharts(analytics, dateRange = '30') {
  if (!analytics) return;
  
  // Update connections chart if it exists
  if (window.connectionsChart) {
    // Get the appropriate number of days based on selected range
    let daysToShow = parseInt(dateRange);
    
    // Handle "all" case
    if (dateRange === 'all' || isNaN(daysToShow)) {
      // For "all" use all available data up to 365 days
      daysToShow = 365;
    }
    
    // Generate date labels based on selected range
    const dateLabels = getDateLabels(daysToShow);
    const sent = [];
    
    // Process data for each day
    dateLabels.forEach(day => {
      // Convert from "Mar 7" format to ISO date format for lookup
      const dateObj = new Date(day + ", " + new Date().getFullYear());
      const isoDate = dateObj.toISOString().split('T')[0];
      
      const dayData = analytics.connectionsByDate[isoDate] || { sent: 0 };
      sent.push(dayData.sent || 0);
    });
    
    // Update chart data
    window.connectionsChart.data.labels = dateLabels;
    window.connectionsChart.data.datasets[0].data = sent;
    
    // If there was an accepted dataset, remove it
    if (window.connectionsChart.data.datasets.length > 1) {
      window.connectionsChart.data.datasets.splice(1, 1);
    }
    
    // Update chart with new data
    window.connectionsChart.update();
  }
}
  
  // Update analytics metrics on the UI
  function updateAnalyticsMetrics(analytics) {
    // Update connection count metrics
    const sentElement = document.querySelector('.metric-card:nth-child(1) .metric-value');
    
    if (sentElement) sentElement.textContent = analytics.totalSent || 0;
    
    // Update template performance table if it exists
    const tableBody = document.querySelector('.data-table tbody');
    if (tableBody && analytics.connectionsByTemplate) {
      tableBody.innerHTML = ''; // Clear existing rows
      
      // Create rows for each template
      Object.entries(analytics.connectionsByTemplate).forEach(([templateId, data]) => {
        const row = document.createElement('tr');
        const sent = data.sent || 0;
        
        row.innerHTML = `
          <td>${templateId}</td>
          <td>${sent}</td>
        `;
        
        tableBody.appendChild(row);
      });
    }
  }
  
  function updateTemplatesUI() {
    console.log("Updating templates UI");
    
    // Get templates container
    const templatesContainer = document.querySelector('.templates-list');
    if (!templatesContainer) {
      console.log("Templates container not found");
      return;
    }
    
    // Get latest templates
    chrome.runtime.sendMessage({ action: 'getTemplates' }, function(response) {
      if (!response || !response.templates) {
        console.log("No templates returned from background");
        return;
      }
      
      console.log("Got templates:", response.templates);
      appState.templates = response.templates;
      
      // Clear existing templates
      templatesContainer.innerHTML = '';
      
      // Add each template
      Object.entries(response.templates).forEach(([templateId, templateContent]) => {
        // Convert ID to display name
        let templateName = templateId
          .split('-')
          .map(word => word.charAt(0).toUpperCase() + word.slice(1))
          .join(' ');
        
        // Handle special case for default templates
        if (templateId === 'default') templateName = 'Default Template';
        if (templateId === 'recruiter') templateName = 'Recruiter Template';
        if (templateId === 'sales') templateName = 'Sales Template';
        if (templateId === 'networking') templateName = 'Networking Template';
        
        // Create template card
        const templateCard = document.createElement('div');
        templateCard.className = 'template-card';
        templateCard.setAttribute('data-id', templateId);
        
        // Check if this is the current active template
        if (templateId === appState.templateId) {
          templateCard.classList.add('active');
        }
        
        // Set template card HTML
        templateCard.innerHTML = `
          <div class="template-header">
            <h4>${templateName}</h4>
            <div class="template-actions">
              <button class="icon-button edit-template" title="Edit template">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M11 4H4C3.44772 4 3 4.44772 3 5V19C3 19.5523 3.44772 20 4 20H18C18.5523 20 19 19.5523 19 19V12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                  <path d="M17.5 2.5C18.3284 1.67157 19.6716 1.67157 20.5 2.5C21.3284 3.32843 21.3284 4.67157 20.5 5.5L12 14L8 15L9 11L17.5 2.5Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </button>
              <button class="icon-button delete-template" title="Delete template">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M4 7H20" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                  <path d="M10 11V17" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                  <path d="M14 11V17" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                  <path d="M5 7L6 19C6 19.5304 6.21071 20.0391 6.58579 20.4142C6.96086 20.7893 7.46957 21 8 21H16C16.5304 21 17.0391 20.7893 17.4142 20.4142C17.7893 20.0391 18 19.5304 18 19L19 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                  <path d="M9 7V4C9 3.73478 9.10536 3.48043 9.29289 3.29289C9.48043 3.10536 9.73478 3 10 3H14C14.2652 3 14.5196 3.10536 14.7071 3.29289C14.8946 3.48043 15 3.73478 15 4V7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </button>
            </div>
          </div>
          <div class="template-preview">${templateContent}</div>
        `;
        
        // Add click event to select template
        templateCard.addEventListener('click', () => {
          // Remove active class from all templates
          document.querySelectorAll('.template-card').forEach(card => {
            card.classList.remove('active');
          });
          
          // Add active class to selected template
          templateCard.classList.add('active');
          
          // Update template select dropdown
          document.getElementById('template-select').value = templateId;
          
          // Load template content
          loadTemplate(templateId);
          
          // Update app state
          appState.templateId = templateId;
        });
        
        // Add template card to container
        templatesContainer.appendChild(templateCard);
      });
      
      // Add event listeners for edit and delete buttons
      const editButtons = document.querySelectorAll('.edit-template');
      editButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation(); // Prevent template selection
          const templateCard = btn.closest('.template-card');
          const templateId = templateCard.getAttribute('data-id');
          const templateName = templateCard.querySelector('h4').textContent;
          const templateContent = templateCard.querySelector('.template-preview').textContent;
          
          // Open editor modal
          document.getElementById('template-name').value = templateName;
          document.getElementById('template-content').value = templateContent;
          document.getElementById('template-editor-modal').classList.add('active');
        });
      });
      
      const deleteButtons = document.querySelectorAll('.delete-template');
      deleteButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation(); // Prevent template selection
          const templateCard = btn.closest('.template-card');
          const templateId = templateCard.getAttribute('data-id');
          
          // Don't allow deletion of default templates
          if (['default', 'recruiter', 'sales', 'networking'].includes(templateId)) {
            alert('Cannot delete default templates');
            return;
          }
          
          // Confirm deletion
          if (confirm(`Are you sure you want to delete the template "${templateCard.querySelector('h4').textContent}"?`)) {
            // Delete template
            delete appState.templates[templateId];
            
            // Send delete message to background
            chrome.runtime.sendMessage({
              action: 'deleteTemplate',
              templateId: templateId
            });
            
            // Update UI
            templateCard.remove();
            
            // Remove from dropdown
            const option = document.querySelector(`#template-select option[value="${templateId}"]`);
            if (option) option.remove();
          }
        });
      });
    });
  }
  
  // Extra helper functions for clipboard operations
  document.querySelector('.paste-button')?.addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      profileLinks.value = text;
    } catch (err) {
      console.error('Failed to read clipboard: ', err);
    }
  });
  
  // Make sure charts are initialized when switching to the Analytics tab
  tabButtons.forEach(button => {
    if (button.getAttribute('data-tab') === 'analytics') {
      button.addEventListener('click', function() {
        // Wait a short time for the tab content to be displayed
        setTimeout(() => {
          console.log("Analytics tab activated, initializing charts");
          initializeChart();
        }, 100);
      });
    }
  });
});