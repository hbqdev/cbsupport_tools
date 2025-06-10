let currentResults = null;

function showMessage(message, type = 'info') {
    const messagesDiv = document.getElementById('messages');
    const messageDiv = document.createElement('div');
    messageDiv.className = type;
    messageDiv.textContent = message;
    messagesDiv.appendChild(messageDiv);
    
    // Auto-remove after 5 seconds
    setTimeout(() => {
        messageDiv.remove();
    }, 5000);
}

function showLoading(message) {
    const messagesDiv = document.getElementById('messages');
    const loadingDiv = document.createElement('div');
    loadingDiv.className = 'loading';
    loadingDiv.id = 'loadingMessage';
    loadingDiv.innerHTML = `
        <div class="spinner"></div>
        <div>${message}</div>
    `;
    messagesDiv.appendChild(loadingDiv);
}

function hideLoading() {
    const loadingDiv = document.getElementById('loadingMessage');
    if (loadingDiv) {
        loadingDiv.remove();
    }
}

async function detectZips() {
    const zipPath = document.getElementById('zipPath').value.trim();
    const extractPath = document.getElementById('extractPath').value.trim();
    showLoading('Detecting and extracting ZIP files...');
    
    try {
        const requestBody = {};
        if (zipPath) {
            requestBody.zip_path = zipPath;
        }
        if (extractPath) {
            requestBody.extract_path = extractPath;
        }
        
        const response = await fetch('/api/detect-zips', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody)
        });
        
        const data = await response.json();
        hideLoading();
        
        if (data.success) {
            showMessage(`✅ Successfully extracted ${data.count} ZIP files from ${data.search_path} to ${data.extract_path}`, 'success');
            updateStatus();
            saveState(); // Save state after successful extraction
        } else {
            showMessage(`❌ Error: ${data.error}`, 'error');
        }
    } catch (error) {
        hideLoading();
        showMessage(`❌ Network error: ${error.message}`, 'error');
    }
}

async function analyzeLogs() {
    const timestamp = document.getElementById('timestamp').value;
    const contextLines = parseInt(document.getElementById('contextLines').value);
    
    if (!timestamp) {
        showMessage('❌ Please enter a timestamp', 'error');
        return;
    }
    
    showLoading('Analyzing logs across all nodes...');
    
    try {
        const response = await fetch('/api/analyze', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                timestamp: timestamp,
                context_lines: contextLines
            })
        });
        
        const data = await response.json();
        hideLoading();
        
        if (data.success) {
            currentResults = data.results;
            displayResults(data.results);
            updateStatus(data.results);
            saveState(); // Save state after successful analysis
            showMessage('✅ Analysis completed successfully', 'success');
        } else {
            showMessage(`❌ Error: ${data.error}`, 'error');
        }
    } catch (error) {
        hideLoading();
        showMessage(`❌ Network error: ${error.message}`, 'error');
    }
}

function displayResults(results) {
    const container = document.getElementById('resultsContainer');
    const content = document.getElementById('resultsContent');
    const timestampSpan = document.getElementById('resultsTimestamp');
    
    timestampSpan.textContent = `Target: ${results.timestamp}`;
    
    if (Object.keys(results.nodes).length === 0) {
        content.innerHTML = '<div class="no-results">No matches found for the specified timestamp</div>';
        container.style.display = 'block';
        return;
    }
    
    // Create tabbed interface
    let html = '<div class="tab-nav">';
    
    // Create tabs for each file type
    results.summary.available_files.forEach((fileName, index) => {
        const activeClass = index === 0 ? 'active' : '';
        html += `
            <button class="tab-btn ${activeClass}" onclick="showTab('${fileName}')">
                📄 ${fileName}
            </button>
        `;
    });
    
    html += '</div>';
    
    // Create tab content for each file type
    results.summary.available_files.forEach((fileName, index) => {
        const activeClass = index === 0 ? 'active' : '';
        html += `
            <div class="tab-content ${activeClass}" id="tab-${fileName}">
                ${generateFileComparison(fileName, results.by_file[fileName], results.nodes)}
            </div>
        `;
    });
    
    content.innerHTML = html;
    container.style.display = 'block';
}

function generateFileComparison(fileName, fileData, allNodes) {
    const nodeCount = Object.keys(allNodes).length;
    let gridClass = 'single-node';
    
    if (nodeCount === 2) gridClass = 'two-nodes';
    else if (nodeCount === 3) gridClass = 'three-nodes';
    else if (nodeCount > 3) gridClass = 'many-nodes';
    
    let html = `<div class="file-comparison ${gridClass}">`;
    
    // Display each node's data for this file
    Object.entries(allNodes).forEach(([nodeName, nodeData]) => {
        html += `
            <div class="node-section">
                <div class="node-header">
                    🖥️ ${nodeName}
                </div>
                <div class="node-content">
        `;
        
        const nodeFileData = fileData[nodeName];
        
        if (nodeFileData && nodeFileData.file_missing) {
            html += `<div class="file-missing">📋 ${fileName} not found in this node</div>`;
        } else if (nodeFileData && nodeFileData.no_matches) {
            html += `<div class="no-matches">📄 ${fileName} exists but no timestamp matches found</div>`;
        } else if (nodeFileData && nodeFileData.matches && nodeFileData.matches.length > 0) {
            nodeFileData.matches.forEach((match, matchIndex) => {
                html += `
                    <div class="log-match">
                        <div class="match-header">
                            Line ${match.line_number} | Precision: ${match.precision}
                        </div>
                        <div class="context-lines">
                `;
                
                match.context_lines.forEach(contextLine => {
                    const lineClass = contextLine.is_match ? 'context-line match' : 'context-line';
                    html += `
                        <div class="${lineClass}">
                            ${escapeHtml(contextLine.content)}
                        </div>
                    `;
                });
                
                html += `
                        </div>
                    </div>
                `;
            });
        } else {
            html += `<div class="file-missing">📋 ${fileName} not processed</div>`;
        }
        
        html += `
                </div>
            </div>
        `;
    });
    
    html += '</div>';
    return html;
}

function showTab(fileName) {
    // Hide all tabs and remove active class
    document.querySelectorAll('.tab-content').forEach(tab => {
        tab.classList.remove('active');
    });
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    
    // Show selected tab and add active class
    document.getElementById(`tab-${fileName}`).classList.add('active');
    event.target.classList.add('active');
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function updateStatus(results = null) {
    if (results) {
        document.getElementById('nodeCount').textContent = results.summary.total_nodes;
        document.getElementById('matchCount').textContent = results.summary.total_matches;
        document.getElementById('fileCount').textContent = results.summary.files_with_matches;
    } else {
        // Fetch current status
        fetch('/api/status')
            .then(response => response.json())
            .then(data => {
                document.getElementById('nodeCount').textContent = data.count;
            })
            .catch(error => {
                console.error('Error fetching status:', error);
            });
    }
}

// State persistence functions
function saveState() {
    const state = {
        zipPath: document.getElementById('zipPath').value,
        extractPath: document.getElementById('extractPath').value,
        timestamp: document.getElementById('timestamp').value,
        contextLines: document.getElementById('contextLines').value,
        results: currentResults
    };
    localStorage.setItem('cbLogAnalyzerState', JSON.stringify(state));
}

function loadState() {
    const saved = localStorage.getItem('cbLogAnalyzerState');
    if (saved) {
        try {
            const state = JSON.parse(saved);
            
            // Restore form inputs
            if (state.zipPath) document.getElementById('zipPath').value = state.zipPath;
            if (state.extractPath) document.getElementById('extractPath').value = state.extractPath;
            if (state.timestamp) document.getElementById('timestamp').value = state.timestamp;
            if (state.contextLines) document.getElementById('contextLines').value = state.contextLines;
            
            // Restore results if they exist
            if (state.results) {
                currentResults = state.results;
                displayResults(state.results);
                updateStatus(state.results);
            }
        } catch (e) {
            console.log('Error loading saved state:', e);
        }
    }
}

function autoSaveInputs() {
    // Auto-save inputs when they change
    document.getElementById('zipPath').addEventListener('input', saveState);
    document.getElementById('extractPath').addEventListener('input', saveState);
    document.getElementById('timestamp').addEventListener('input', saveState);
    document.getElementById('contextLines').addEventListener('input', saveState);
}

async function checkExistingExtractions() {
    try {
        const response = await fetch('/api/status');
        const data = await response.json();
        
        if (data.count > 0) {
            showMessage(`📁 Found ${data.count} previously extracted node(s). Ready for analysis!`, 'success');
        }
    } catch (error) {
        console.log('Error checking existing extractions:', error);
    }
}

// Initialize status on page load
document.addEventListener('DOMContentLoaded', function() {
    loadState();
    autoSaveInputs();
    updateStatus();
    checkExistingExtractions();
}); 