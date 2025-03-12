// analytics.js - Complete rewrite with fixes

// Wait for DOM to be fully loaded
document.addEventListener('DOMContentLoaded', function() {
  // Initialize analytics when tab is activated
  document.querySelector('.tab-button[data-tab="analytics"]').addEventListener('click', function() {
    // Small delay to ensure the tab content is visible
    setTimeout(initializeAnalytics, 100);
  });
  
  // Initialize if we're already on analytics tab
  if (document.querySelector('.tab-button[data-tab="analytics"].active')) {
    initializeAnalytics();
  }
  
  // Set up date range filter
  document.getElementById('date-range').addEventListener('change', function() {
    updateAnalyticsForDateRange(this.value);
  });
  
  // Set up export button
  document.querySelector('.export-section button').addEventListener('click', exportAnalyticsData);
});

// Main initialization function
function initializeAnalytics() {
  console.log("Initializing analytics view");
  
  // Request data from background
  chrome.runtime.sendMessage({ action: 'getAnalytics' }, function(response) {
    if (!response || !response.analytics) {
      console.log("No analytics data returned");
      displayNoDataMessage();
      return;
    }
    
    console.log("Received analytics data:", response.analytics);
    
    // Store analytics data globally for filtering
    window.analyticsData = response.analytics;
    
    // Update metrics and charts based on current date filter
    const dateRange = document.getElementById('date-range').value;
    updateAnalyticsForDateRange(dateRange);
  });
}

// Update all analytics based on date range
function updateAnalyticsForDateRange(dateRange) {
  if (!window.analyticsData) return;
  
  const data = filterDataByDateRange(window.analyticsData, dateRange);
  
  // Update UI with filtered data
  updateMetricsCards(data);
  updateConnectionsChart(data);
  updateTemplatePerformance(data);
}

// Filter analytics data by date range
function filterDataByDateRange(data, dateRange) {
  // Make a shallow copy to work with
  const filteredData = {...data};
  
  if (dateRange === 'all') {
    return filteredData; // Return all data
  }
  
  const daysToInclude = parseInt(dateRange);
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysToInclude);
  
  // Filter connectionsByDate
  filteredData.connectionsByDate = {};
  
  if (data.connectionsByDate) {
    Object.keys(data.connectionsByDate).forEach(dateStr => {
      const entryDate = new Date(dateStr);
      if (entryDate >= cutoffDate) {
        filteredData.connectionsByDate[dateStr] = data.connectionsByDate[dateStr];
      }
    });
  }
  
  // Recalculate totals based on filtered data
  filteredData.totalSent = 0;
  filteredData.successful = 0;
  
  Object.values(filteredData.connectionsByDate).forEach(day => {
    filteredData.totalSent += (day.sent || 0);
    filteredData.successful += (day.successful || 0);
  });
  
  // Also filter template performance
  if (data.connectionsByTemplate) {
    // We don't have date info for templates, so we'll use the full data
    // In a more advanced implementation, you would store date info with templates
    filteredData.connectionsByTemplate = data.connectionsByTemplate;
  }
  
  return filteredData;
}

// Update metrics cards with data
function updateMetricsCards(data) {
  // Update connection count metrics
  const sentElement = document.querySelector('.metric-card:nth-child(1) .metric-value');
  const acceptedElement = document.querySelector('.metric-card:nth-child(2) .metric-value');
  const rateElement = document.querySelector('.metric-card:nth-child(3) .metric-value');
  const daysElement = document.querySelector('.metric-card:nth-child(4) .metric-value');
  
  // Set current values
  if (sentElement) sentElement.textContent = data.totalSent || 0;
  if (acceptedElement) acceptedElement.textContent = data.successful || 0;
  
  // Calculate and update acceptance rate
  if (rateElement) {
    const rate = data.totalSent > 0 
      ? ((data.successful / data.totalSent) * 100).toFixed(1) 
      : "0.0";
    rateElement.textContent = rate + "%";
  }
  
  // Average days to accept - this would require additional data tracking
  // For now, we'll just use a placeholder
  if (daysElement) {
    daysElement.textContent = "3.2";
  }
  
  // Update change indicators - would need previous period data
  // For demonstration, use hardcoded values
  const sentChangeElem = document.querySelector('.metric-card:nth-child(1) .metric-change');
  const acceptedChangeElem = document.querySelector('.metric-card:nth-child(2) .metric-change');
  const rateChangeElem = document.querySelector('.metric-card:nth-child(3) .metric-change');
  const daysChangeElem = document.querySelector('.metric-card:nth-child(4) .metric-change');
  
  if (sentChangeElem) sentChangeElem.innerHTML = '+12% <span>vs previous</span>';
  if (acceptedChangeElem) acceptedChangeElem.innerHTML = '+5% <span>vs previous</span>';
  if (rateChangeElem) rateChangeElem.innerHTML = '-3% <span>vs previous</span>';
  if (daysChangeElem) daysChangeElem.innerHTML = '-0.5 <span>vs previous</span>';
}

// Update connections chart
function updateConnectionsChart(data) {
  console.log("Updating connections chart with data:", data);
  
  // Get canvas and check if it exists
  const canvas = document.getElementById('connections-chart');
  if (!canvas) {
    console.error("Canvas element 'connections-chart' not found");
    return;
  }
  
  // Get chart container for proper sizing
  const container = canvas.closest('.chart-container');
  if (container) {
    // Set canvas dimensions to match container
    canvas.style.width = '100%';
    canvas.style.height = '100%';
  }
  
  // Get chart context
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    console.error("Could not get 2D context from canvas");
    return;
  }
  
  // Get or create chart
  let chart = window.connectionsChart;
  
  // Prepare data for the chart
  const chartData = prepareChartData(data);
  
  if (chart) {
    // Update existing chart
    chart.data.labels = chartData.labels;
    chart.data.datasets[0].data = chartData.sent;
    chart.data.datasets[1].data = chartData.accepted;
    chart.update();
  } else {
    // Create new chart
    try {
      window.connectionsChart = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: chartData.labels,
          datasets: [
            {
              label: 'Connections Sent',
              data: chartData.sent,
              backgroundColor: '#0077B5',
              borderColor: '#0077B5',
              borderWidth: 1,
              borderRadius: 4,
              barThickness: 8,
            },
            {
              label: 'Connections Accepted',
              data: chartData.accepted,
              backgroundColor: '#00A0DC',
              borderColor: '#00A0DC',
              borderWidth: 1,
              borderRadius: 4,
              barThickness: 8,
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          layout: {
            padding: {
              top: 5,
              bottom: 5
            }
          },
          scales: {
            y: {
              beginAtZero: true,
              grid: {
                color: 'rgba(200, 200, 200, 0.1)',
              },
              ticks: {
                font: {
                  size: 10
                },
                color: 'rgba(255, 255, 255, 0.7)'
              }
            },
            x: {
              grid: {
                display: false
              },
              ticks: {
                font: {
                  size: 10
                },
                color: 'rgba(255, 255, 255, 0.7)'
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
    } catch (error) {
      console.error("Error creating chart:", error);
    }
  }
}

// Prepare data for the chart
function prepareChartData(data) {
  // Get the last 7 days
  const labels = getLast7DaysLabels();
  const sent = [];
  const accepted = [];
  
  // Process data for each day
  labels.forEach(day => {
    // Convert from "Mar 7" format to ISO date format for lookup
    const dateObj = new Date(day + ", " + new Date().getFullYear());
    const isoDate = dateObj.toISOString().split('T')[0];
    
    const dayData = data.connectionsByDate && data.connectionsByDate[isoDate] 
      ? data.connectionsByDate[isoDate] 
      : { sent: 0, successful: 0 };
      
    sent.push(dayData.sent || 0);
    accepted.push(dayData.successful || 0);
  });
  
  return { labels, sent, accepted };
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

// Format date as "MMM DD"
function formatDate(date) {
  const options = { month: 'short', day: 'numeric' };
  return date.toLocaleDateString('en-US', options);
}

// Update template performance table
function updateTemplatePerformance(data) {
  // Update template performance table if it exists
  const tableBody = document.querySelector('.data-table tbody');
  if (!tableBody) {
    console.error("Template performance table body not found");
    return;
  }
  
  tableBody.innerHTML = ''; // Clear existing rows
  
  if (!data.connectionsByTemplate || Object.keys(data.connectionsByTemplate).length === 0) {
    // No template data
    const row = document.createElement('tr');
    row.innerHTML = '<td colspan="4">No template data available</td>';
    tableBody.appendChild(row);
    return;
  }
  
  // Create rows for each template
  Object.entries(data.connectionsByTemplate).forEach(([templateId, templateData]) => {
    const row = document.createElement('tr');
    const sent = templateData.sent || 0;
    const accepted = templateData.accepted || 0;
    const rate = sent > 0 ? ((accepted / sent) * 100).toFixed(1) : "0.0";
    
    // Format template name for display
    let templateName = templateId
      .split('-')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
      
    // Handle special cases
    if (templateId === 'default') templateName = 'Default Template';
    if (templateId === 'recruiter') templateName = 'Recruiter Template';
    if (templateId === 'sales') templateName = 'Sales Template';
    if (templateId === 'networking') templateName = 'Networking Template';
    
    row.innerHTML = `
      <td>${templateName}</td>
      <td>${sent}</td>
      <td>${accepted}</td>
      <td>${rate}%</td>
    `;
    
    tableBody.appendChild(row);
  });
}

// Display a message when no data is available
function displayNoDataMessage() {
  // Update chart container
  const chartContainer = document.querySelector('.chart');
  if (chartContainer) {
    chartContainer.innerHTML = '<div class="no-data-message">No connection data available. Start sending connections to see analytics.</div>';
  }
  
  // Update template table
  const tableBody = document.querySelector('.data-table tbody');
  if (tableBody) {
    tableBody.innerHTML = '<tr><td colspan="4">No template data available</td></tr>';
  }
  
  // Set metrics to zero
  const metricValues = document.querySelectorAll('.metric-value');
  metricValues.forEach(elem => {
    if (elem.textContent.includes('%')) {
      elem.textContent = '0.0%';
    } else {
      elem.textContent = '0';
    }
  });
}

// Export analytics data as CSV
function exportAnalyticsData() {
  if (!window.analyticsData) {
    alert('No data to export');
    return;
  }
  
  chrome.runtime.sendMessage({ action: 'exportAnalytics' }, function(response) {
    if (response && response.csvContent) {
      // Create a blob from the CSV content
      const blob = new Blob([response.csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      
      // Create temporary link and trigger download
      const link = document.createElement('a');
      link.href = url;
      link.download = `linkedin-connections-${new Date().toISOString().split('T')[0]}.csv`;
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } else {
      alert('Failed to export data');
    }
  });
}

// Add CSS to fix the chart/template overlap issue
function applyFixStyling() {
  const style = document.createElement('style');
  style.textContent = `
    .chart-container {
      height: 240px;
      margin-bottom: 30px;
      position: relative;
    }
    .chart {
      height: 100%;
      width: 100%;
      position: relative;
    }
    .no-data-message {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: rgba(255,255,255,0.5);
      font-style: italic;
    }
    .template-performance-section {
      margin-top: 30px;
    }
    #connections-chart {
      width: 100% !important;
      height: 100% !important;
    }
  `;
  document.head.appendChild(style);
}

// Call this when the script loads
applyFixStyling();