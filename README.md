# 🔍 Couchbase Log Analyzer

A powerful web-based tool for analyzing Couchbase collectinfo logs across multiple cluster nodes with intelligent timestamp matching.

## 🚀 Features

- **Automatic ZIP Detection**: Automatically detects and extracts Couchbase collectinfo ZIP files
- **Smart Timestamp Matching**: Progressive precision reduction for flexible timestamp matching
- **Cross-Node Analysis**: Correlate logs across multiple cluster nodes simultaneously  
- **Cross-File Correlation**: View logs from different files at the same timeframe
- **Modern Web Interface**: Clean, responsive UI with real-time feedback
- **Context-Aware Display**: Shows lines before and after matches for better context

## 📋 Prerequisites

- Python 3.7+
- pip (Python package installer)

## 🛠️ Installation

1. **Clone or navigate to the project directory:**
   ```bash
   cd cbsupport_tools
   ```

2. **Create a virtual environment (recommended):**
   ```bash
   python -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   ```

3. **Install dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

## 🎯 Usage

### 1. Start the Application

You can start the application in several ways:

**Basic usage (searches current directory for ZIP files):**
```bash
python app.py
```

**Specify ZIP files directory:**
```bash
python app.py --zip-path /path/to/your/zip/files
```

**Custom port and directories:**
```bash
python app.py --zip-path /path/to/zips --work-dir /path/to/work --port 9000
```

**Available options:**
- `--zip-path` or `-z`: Path to directory containing ZIP files (default: current directory)
- `--work-dir` or `-w`: Directory for extracted files (default: work_data)
- `--port` or `-p`: Port to run web server on (default: 8080)

The application will show you the paths being used and the URL to access it.

### 2. Prepare Your Data

Your Couchbase collectinfo ZIP files can be in any directory. Files should follow the naming pattern:
```
collectinfo-2025-06-09t182520-ns_1@svc-dqisea-node-003.example.com-redacted-417559ba22e17fa9.zip
```

### 3. Extract ZIP Files

1. Open your web browser and navigate to the URL shown when you started the app (e.g., `http://localhost:8080`)
2. **Optional**: Enter a different path in the "ZIP Files Directory Path" field if you want to search a different location
3. Click "📦 Detect & Extract ZIP Files" to automatically find and extract all ZIP files
4. The status panel will show the number of extracted nodes and which directory was searched

### 4. Analyze Logs

1. **Enter Target Timestamp**: Input the timestamp you want to search for
   - Format: `2025-06-09T18:30:17.455783+00:00`
   - The tool supports various precision levels
   
2. **Set Context Lines**: Choose how many lines before/after the match to display (default: 5)

3. **Click "🔍 Analyze Logs"** to start the analysis

### 5. Review Results

The results will show:
- **Cross-Node View**: Same timestamp across all cluster nodes
- **Multiple Log Files**: All relevant log files from each node
- **Context Lines**: Lines before and after each match
- **Smart Matching**: Shows which precision level was used for matching

## 🔧 How It Works

### Timestamp Matching Logic

The tool uses progressive precision reduction:

1. **Full Precision**: `2025-06-09T18:30:17.455783+00:00`
2. **Second Precision**: `2025-06-09T18:30:17`
3. **Minute Precision**: `2025-06-09T18:30`
4. **Hour Precision**: `2025-06-09T18`
5. **Day Precision**: `2025-06-09`

It tries each level until matches are found, ensuring you don't miss relevant logs due to slight timing differences.

### File Processing

- Automatically detects all `.log` files in extracted directories
- Processes files with UTF-8 encoding and error handling
- Extracts timestamps using regex pattern matching
- Provides contextual lines around each match

## 📁 Directory Structure

```
cbsupport_tools/
├── app.py                 # Main Flask application
├── requirements.txt       # Python dependencies
├── templates/
│   └── index.html        # Web interface
├── work_data/            # Extracted ZIP contents (auto-created)
├── *.zip                # Your collectinfo ZIP files
└── README.md            # This file
```

## 🎨 Interface Overview

### Control Panel
- **ZIP Detection**: One-click extraction of all ZIP files
- **Timestamp Input**: Smart timestamp search with format hints
- **Context Control**: Adjustable context lines (1-20)

### Status Panel
- **Extracted Nodes**: Number of cluster nodes processed
- **Total Matches**: All timestamp matches found
- **Files with Matches**: Count of log files containing matches

### Results Display
- **Node-by-Node View**: Organized by cluster node
- **File-by-File Breakdown**: Each log file shown separately
- **Highlighted Matches**: Target lines highlighted in yellow
- **Line Numbers**: Easy reference to original file locations

## 🚨 Troubleshooting

### Common Issues

**ZIP files not detected:**
- Ensure ZIP files are in the `cbsupport_tools` directory
- Check file permissions

**No matches found:**
- Verify timestamp format
- Try reducing precision (remove microseconds, timezone, etc.)
- Check if logs contain the expected timestamp format

**Memory issues with large files:**
- The tool processes files line by line to minimize memory usage
- For extremely large deployments, consider processing subsets of nodes

**Web interface not loading:**
- Ensure Flask is running on port 5000
- Check for firewall restrictions
- Try accessing via `127.0.0.1:5000` instead of `localhost:5000`

## 🔒 Security Notes

- This tool is designed for local analysis of log files
- It runs a local web server for the interface
- No data is sent to external services
- Extracted files are stored locally in `work_data/`

## 🤝 Contributing

Feel free to submit issues, feature requests, or pull requests to improve this tool.

## 📄 License

[Insert your license information here]

---

**Happy Log Analyzing! 🎉**