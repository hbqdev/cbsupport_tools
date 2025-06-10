let currentResults = null;
let nodeData = {};
let customSelectedFiles = [];
let collapsedSections = {};
let targetFiles = []; // Will be loaded from backend

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
        // Fetch current status and target files
        fetch('/api/status')
            .then(response => response.json())
            .then(data => {
                console.log('Status API response:', data); // Debug log
                document.getElementById('nodeCount').textContent = data.count;
                
                // Update target files from backend
                if (data.target_files) {
                    console.log('Updating target files from backend:', data.target_files); // Debug log
                    targetFiles = data.target_files;
                    updateTargetFilesDisplay();
                    console.log('Current targetFiles after update:', targetFiles); // Debug log
                } else {
                    console.log('No target_files in API response'); // Debug log
                }
            })
            .catch(error => {
                console.error('Error fetching status:', error);
            });
    }
}

function updateTargetFilesDisplay() {
    console.log('updateTargetFilesDisplay called with targetFiles:', targetFiles); // Debug log
    
    // Update the predefined files checkbox label using the ID
    const predefinedLabel = document.getElementById('predefinedFilesLabel');
    if (predefinedLabel) {
        const newText = `☑️ Predefined Files (${targetFiles.join(', ')})`;
        console.log('Updating predefined label to:', newText); // Debug log
        predefinedLabel.textContent = newText;
    } else {
        console.log('Predefined label element not found'); // Debug log
    }
    
    // Update the status panel
    const targetFilesSpan = document.getElementById('targetFiles');
    if (targetFilesSpan) {
        const newText = targetFiles.join(', ');
        console.log('Updating status panel to:', newText); // Debug log
        targetFilesSpan.textContent = newText;
    } else {
        console.log('Target files span element not found'); // Debug log
    }
}

// State persistence functions
function saveState() {
    const state = {
        zipPath: document.getElementById('zipPath').value,
        extractPath: document.getElementById('extractPath').value,
        s3Urls: document.getElementById('s3Urls').value,
        subfolderName: document.getElementById('subfolderName').value,
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
            if (state.s3Urls) document.getElementById('s3Urls').value = state.s3Urls;
            if (state.subfolderName) document.getElementById('subfolderName').value = state.subfolderName;
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
    document.getElementById('s3Urls').addEventListener('input', saveState);
    document.getElementById('subfolderName').addEventListener('input', saveState);
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

async function downloadFromS3() {
    const s3Urls = document.getElementById('s3Urls').value.trim();
    const extractPath = document.getElementById('extractPath').value.trim();
    const subfolderName = document.getElementById('subfolderName').value.trim();
    
    if (!s3Urls) {
        showMessage('❌ Please enter at least one S3 URL', 'error');
        return;
    }
    
    // Parse URLs (one per line)
    const urls = s3Urls.split('\n').map(url => url.trim()).filter(url => url.length > 0);
    
    if (urls.length === 0) {
        showMessage('❌ No valid S3 URLs found', 'error');
        return;
    }
    
    showLoading(`Downloading ${urls.length} file(s) from S3...`);
    
    try {
        const requestBody = {
            s3_urls: urls
        };
        
        if (extractPath) {
            requestBody.extract_path = extractPath;
        }
        
        if (subfolderName) {
            requestBody.subfolder_name = subfolderName;
        }
        
        const response = await fetch('/api/download-s3', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody)
        });
        
        const data = await response.json();
        hideLoading();
        
        if (data.success) {
            showMessage(`✅ Successfully downloaded and extracted ${data.count} ZIP files to ${data.extract_path}`, 'success');
            updateStatus();
            saveState(); // Save state after successful download
        } else {
            showMessage(`❌ Error: ${data.error}`, 'error');
        }
    } catch (error) {
        hideLoading();
        showMessage(`❌ Network error: ${error.message}`, 'error');
    }
}

// Collapsible sections functionality
function toggleSection(sectionId) {
    const content = document.getElementById(`${sectionId}-content`);
    const toggle = document.getElementById(`${sectionId}-toggle`);
    
    if (content.classList.contains('collapsed')) {
        content.classList.remove('collapsed');
        toggle.textContent = '▼';
        toggle.classList.remove('collapsed');
        collapsedSections[sectionId] = false;
    } else {
        content.classList.add('collapsed');
        toggle.textContent = '▶';
        toggle.classList.add('collapsed');
        collapsedSections[sectionId] = true;
    }
    saveState();
}

// File browser functionality
async function loadNodeExplorer() {
    const loading = document.getElementById('explorerLoading');
    const content = document.getElementById('explorerContent');
    
    loading.style.display = 'block';
    
    try {
        const response = await fetch('/api/browse-files', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({})
        });
        
        const data = await response.json();
        loading.style.display = 'none';
        
        if (data.success) {
            nodeData = data.nodes;
            displayNodeExplorer(data.nodes);
        } else {
            content.innerHTML = `<div class="error">Error loading nodes: ${data.error}</div>`;
        }
    } catch (error) {
        loading.style.display = 'none';
        content.innerHTML = `<div class="error">Network error: ${error.message}</div>`;
    }
}

function displayNodeExplorer(nodes) {
    const content = document.getElementById('explorerContent');
    
    if (Object.keys(nodes).length === 0) {
        content.innerHTML = '<div class="no-results">No extracted nodes found. Please extract ZIP files first.</div>';
        return;
    }
    
    let html = '<div class="node-explorer">';
    
    Object.entries(nodes).forEach(([nodeName, nodeInfo]) => {
        // Default to expanded if not set
        const isExpanded = collapsedSections[`node-${nodeName}`] !== true;
        const toggleIcon = isExpanded ? '▼' : '▶';
        
        html += `
            <div class="node-item">
                <div class="node-header" onclick="toggleNode('${nodeName}')">
                    <span>📁 ${nodeName}</span>
                    <span class="toggle-icon" id="node-${nodeName}-toggle">${toggleIcon}</span>
                </div>
                <div class="file-list ${isExpanded ? '' : 'collapsed'}" id="node-${nodeName}-list">
        `;
        
        if (nodeInfo.contents && nodeInfo.contents.length > 0) {
            nodeInfo.contents.forEach(file => {
                const icon = file.is_directory ? '📁' : '📄';
                const sizeInfo = file.is_directory ? '' : ` (${file.size_human})`;
                const isSelected = customSelectedFiles.some(f => f.path === file.path);
                
                html += `
                    <div class="file-item ${isSelected ? 'selected' : ''}" onclick="handleFileClick('${file.path}', '${nodeName}', '${file.name}', ${file.is_directory})">
                        <span class="file-icon">${icon}</span>
                        <div class="file-info">
                            <span class="file-name">${file.name}</span>
                            <span class="file-size">${sizeInfo}</span>
                        </div>
                    </div>
                `;
            });
        } else {
            html += '<div class="file-item">No files found</div>';
        }
        
        html += `
                </div>
            </div>
        `;
    });
    
    html += '</div>';
    content.innerHTML = html;
}

function toggleNode(nodeName) {
    const list = document.getElementById(`node-${nodeName}-list`);
    const toggle = document.getElementById(`node-${nodeName}-toggle`);
    
    if (!list || !toggle) {
        console.error(`Node elements not found for: ${nodeName}`);
        return;
    }
    
    if (list.classList.contains('collapsed')) {
        list.classList.remove('collapsed');
        toggle.textContent = '▼';
        collapsedSections[`node-${nodeName}`] = false;
    } else {
        list.classList.add('collapsed');
        toggle.textContent = '▶';
        collapsedSections[`node-${nodeName}`] = true;
    }
    saveState();
}

function handleFileClick(filePath, nodeName, fileName, isDirectory) {
    if (isDirectory) {
        // Handle directory expansion/browsing if needed
        return;
    }
    
    // Toggle file selection for custom list
    const existingIndex = customSelectedFiles.findIndex(f => f.path === filePath);
    
    if (existingIndex > -1) {
        // Remove from selection
        customSelectedFiles.splice(existingIndex, 1);
    } else {
        // Add to selection
        customSelectedFiles.push({
            path: filePath,
            nodeName: nodeName,
            fileName: fileName
        });
    }
    
    updateCustomFilesList();
    displayNodeExplorer(nodeData); // Refresh to update selected state
    saveState();
}

function updateCustomFilesList() {
    const count = document.getElementById('customFileCount');
    const list = document.getElementById('customFilesList');
    
    count.textContent = customSelectedFiles.length;
    
    if (customSelectedFiles.length === 0) {
        list.innerHTML = '<div style="color: #6c757d; font-style: italic;">No files selected</div>';
    } else {
        let html = '';
        customSelectedFiles.forEach((file, index) => {
            html += `
                <div class="custom-file-item">
                    <span>📄 ${file.nodeName}/${file.fileName}</span>
                    <span class="remove-file" onclick="removeCustomFile(${index})">✕</span>
                </div>
            `;
        });
        list.innerHTML = html;
    }
}

function removeCustomFile(index) {
    customSelectedFiles.splice(index, 1);
    updateCustomFilesList();
    displayNodeExplorer(nodeData); // Refresh to update selected state
    saveState();
}

// Enhanced analysis with processing mode
async function analyzeLogs() {
    const timestamp = document.getElementById('timestamp').value;
    const contextLines = parseInt(document.getElementById('contextLines').value);
    const processingMode = 'bash'; // Always use bash mode
    const usePredefined = document.getElementById('usePredefinedFiles').checked;
    const useCustom = document.getElementById('useCustomFiles').checked;
    
    if (!timestamp) {
        showMessage('❌ Please enter a timestamp', 'error');
        return;
    }
    
    if (!usePredefined && !useCustom) {
        showMessage('❌ Please select at least one file list to process', 'error');
        return;
    }
    
    if (useCustom && customSelectedFiles.length === 0) {
        showMessage('❌ No custom files selected', 'error');
        return;
    }
    
    // Ensure target files are loaded from backend
    if (usePredefined && targetFiles.length === 0) {
        showMessage('❌ Target files not loaded yet. Please wait...', 'error');
        await loadTargetFiles(); // Force load if not already loaded
        if (targetFiles.length === 0) {
            showMessage('❌ Could not load target files from backend', 'error');
            return;
        }
    }
    
    showLoading('Analyzing logs...');
    
    try {
        let requestBody = {
            timestamp: timestamp,
            context_lines: contextLines,
            processing_mode: processingMode,
            use_predefined: usePredefined,
            use_custom: useCustom
        };
        
        if (useCustom) {
            requestBody.custom_files = customSelectedFiles;
        }
        
        const endpoint = '/api/execute-command'; // Always use bash endpoint
        
        // Always use bash processing
        // Prepare for bash processing
        const filePaths = [];
        if (usePredefined) {
            // Add predefined files from all nodes
            Object.values(nodeData).forEach(nodeInfo => {
                // Use the global targetFiles array (loaded from backend)
                targetFiles.forEach(fileName => {
                    const file = nodeInfo.contents?.find(f => f.name === fileName && !f.is_directory);
                    if (file) {
                        console.log(`Adding predefined file: ${file.path}`); // Debug log
                        filePaths.push(file.path);
                    }
                });
            });
        }
        if (useCustom) {
            customSelectedFiles.forEach(file => {
                console.log(`Adding custom file: ${file.path}`); // Debug log
                filePaths.push(file.path);
            });
        }
        
        if (filePaths.length === 0) {
            hideLoading();
            showMessage('❌ No files found to process', 'error');
            return;
        }
        
        // For bash processing, we might need to adjust the timestamp pattern
        // Remove timezone info and microseconds for more flexible matching
        let searchPattern = timestamp;
        
        // Try different timestamp formats for better grep matching
        if (timestamp.includes('T') && timestamp.includes(':')) {
            // Extract just the date and time part, removing microseconds and timezone
            let baseTimestamp = timestamp.split('.')[0]; // Remove microseconds
            baseTimestamp = baseTimestamp.split('+')[0].split('-').slice(0, 3).join('-') + 'T' + baseTimestamp.split('T')[1]; // Remove timezone
            searchPattern = baseTimestamp.substring(0, 19); // YYYY-MM-DDTHH:MM:SS
        }
        
        requestBody = {
            command_type: 'timestamp_grep',
            file_paths: filePaths,
            search_pattern: searchPattern,
            context_lines: contextLines
        };
        
        console.log('Bash search request:', requestBody); // Debug log
        console.log('usePredefined:', usePredefined, 'useCustom:', useCustom); // Debug log
        console.log('customSelectedFiles:', customSelectedFiles); // Debug log
        console.log('Final filePaths being sent:', filePaths); // Debug log
        
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody)
        });
        
        const data = await response.json();
        hideLoading();
        
        if (data.success) {
            // Always display bash results
            displayBashResults(data.results, timestamp);
            saveState();
            showMessage('✅ Analysis completed successfully', 'success');
        } else {
            showMessage(`❌ Error: ${data.error}`, 'error');
        }
    } catch (error) {
        hideLoading();
        showMessage(`❌ Network error: ${error.message}`, 'error');
    }
}

function displayBashResults(results, timestamp) {
    const container = document.getElementById('resultsContainer');
    const content = document.getElementById('resultsContent');
    const timestampSpan = document.getElementById('resultsTimestamp');
    
    console.log('Frontend received results:', results); // Debug log
    
    timestampSpan.textContent = `Target: ${timestamp} (Bash Processing)`;
    
    let html = '<div class="bash-results">';
    
    if (Object.keys(results).length === 0) {
        html += '<div class="no-results">No matches found for the specified timestamp</div>';
    } else {
        Object.entries(results).forEach(([filePath, result]) => {
            if (result.error) {
                html += `
                    <div class="result-section">
                        <h4>❌ ${filePath}</h4>
                        <div class="error">Error: ${result.error}</div>
                    </div>
                `;
            } else {
                html += `
                    <div class="result-section">
                        <h4>📄 ${result.node_name}/${result.file_name} (${result.match_count} matches)</h4>
                `;
                
                if (result.matches && result.matches.length > 0) {
                    result.matches.forEach((match, matchIndex) => {
                        console.log('Processing match:', match); // Debug log
                        
                        // Display the raw grep output directly
                        html += '<pre style="background: #f8f9fa; padding: 10px; margin: 10px 0; white-space: pre-wrap; font-family: monospace; font-size: 12px; line-height: 1.4;">';
                        
                        if (match.raw_output) {
                            // Just display the raw grep output exactly as the terminal shows it
                            html += escapeHtml(match.raw_output);
                        } else {
                            html += 'No output available\n';
                        }
                        
                        html += '</pre>';
                        
                        // Add separator between matches
                        if (matchIndex < result.matches.length - 1) {
                            html += '<hr style="margin: 20px 0; border: 2px solid #007bff;">';
                        }
                    });
                } else {
                    html += '<div class="no-matches">No matches found in this file</div>';
                }
                
                html += '</div>';
            }
        });
    }
    
    html += '</div>';
    content.innerHTML = html;
    container.style.display = 'block';
}

// Enhanced state persistence
function saveState() {
    const state = {
        zipPath: document.getElementById('zipPath').value,
        extractPath: document.getElementById('extractPath').value,
        s3Urls: document.getElementById('s3Urls').value,
        subfolderName: document.getElementById('subfolderName').value,
        timestamp: document.getElementById('timestamp').value,
        contextLines: document.getElementById('contextLines').value,
        processingMode: 'bash',
        usePredefinedFiles: document.getElementById('usePredefinedFiles').checked,
        useCustomFiles: document.getElementById('useCustomFiles').checked,
        customSelectedFiles: customSelectedFiles,
        collapsedSections: collapsedSections,
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
            if (state.s3Urls) document.getElementById('s3Urls').value = state.s3Urls;
            if (state.subfolderName) document.getElementById('subfolderName').value = state.subfolderName;
            if (state.timestamp) document.getElementById('timestamp').value = state.timestamp;
            if (state.contextLines) document.getElementById('contextLines').value = state.contextLines;
            if (state.processingMode) document.getElementById('processingMode').value = state.processingMode;
            if (state.usePredefinedFiles !== undefined) document.getElementById('usePredefinedFiles').checked = state.usePredefinedFiles;
            if (state.useCustomFiles !== undefined) document.getElementById('useCustomFiles').checked = state.useCustomFiles;
            
            // Restore custom files and collapsed sections
            if (state.customSelectedFiles) customSelectedFiles = state.customSelectedFiles;
            if (state.collapsedSections) collapsedSections = state.collapsedSections;
            
            // Restore collapsed section states
            Object.entries(collapsedSections).forEach(([sectionId, isCollapsed]) => {
                if (isCollapsed) {
                    const content = document.getElementById(`${sectionId}-content`);
                    const toggle = document.getElementById(`${sectionId}-toggle`);
                    if (content && toggle) {
                        content.classList.add('collapsed');
                        toggle.textContent = '▶';
                        toggle.classList.add('collapsed');
                    }
                }
            });
            
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
    document.getElementById('s3Urls').addEventListener('input', saveState);
    document.getElementById('subfolderName').addEventListener('input', saveState);
    document.getElementById('timestamp').addEventListener('input', saveState);
    document.getElementById('contextLines').addEventListener('input', saveState);
    document.getElementById('processingMode').addEventListener('change', saveState);
    document.getElementById('usePredefinedFiles').addEventListener('change', saveState);
    document.getElementById('useCustomFiles').addEventListener('change', saveState);
}

async function checkExistingExtractions() {
    try {
        const response = await fetch('/api/status');
        const data = await response.json();
        
        if (data.count > 0) {
            showMessage(`📁 Found ${data.count} previously extracted node(s). Ready for analysis!`, 'success');
            // Auto-load the file explorer if nodes are available
            setTimeout(loadNodeExplorer, 1000);
        }
    } catch (error) {
        console.log('Error checking existing extractions:', error);
    }
}

// Initialize status on page load
// Function to load target files from backend
async function loadTargetFiles() {
    try {
        const response = await fetch('/api/status');
        const data = await response.json();
        console.log('Loading target files from backend:', data.target_files); // Debug log
        
        if (data.target_files) {
            targetFiles = data.target_files;
            updateTargetFilesDisplay();
            console.log('Target files loaded successfully:', targetFiles); // Debug log
        }
    } catch (error) {
        console.error('Error loading target files:', error);
    }
}

document.addEventListener('DOMContentLoaded', function() {
    loadState();
    autoSaveInputs();
    loadTargetFiles(); // Load target files first
    updateStatus(); 
    checkExistingExtractions();
    updateCustomFilesList();
}); 