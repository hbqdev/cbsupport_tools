#!/usr/bin/env python3
"""
Couchbase Log Analysis Tool
A web-based tool for parsing and analyzing Couchbase collectinfo logs across multiple nodes.
"""

import os
import re
import zipfile
import glob
import argparse
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Tuple, Optional
import json

from flask import Flask, render_template, request, jsonify, send_from_directory
from dateutil import parser as date_parser

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 500 * 1024 * 1024  # 500MB max file size

class LogAnalyzer:
    def __init__(self, work_dir: str = "work_data", zip_path: str = "."):
        self.work_dir = Path(work_dir)
        self.work_dir.mkdir(exist_ok=True)
        self.zip_path = Path(zip_path)
        self.extracted_dirs = []
        # Predefined list of log files to focus on
        self.target_files = [
            "diag.log",
            "couchbase.log", 
            "memcached.log",
            "ns_server.debug.log"
        ]
        
    def detect_and_extract_zips(self, custom_path: str = None, custom_extract_path: str = None) -> List[str]:
        """Detect and extract all zip files in the specified directory."""
        search_path = Path(custom_path) if custom_path else self.zip_path
        extract_base_dir = Path(custom_extract_path) if custom_extract_path else self.work_dir
        extract_base_dir.mkdir(exist_ok=True)
        
        zip_files = glob.glob(str(search_path / "*.zip"))
        extracted = []
        
        for zip_file in zip_files:
            try:
                with zipfile.ZipFile(zip_file, 'r') as zip_ref:
                    # Create extraction directory
                    extract_dir = extract_base_dir / Path(zip_file).stem
                    extract_dir.mkdir(exist_ok=True)
                    
                    # Extract all files
                    zip_ref.extractall(extract_dir)
                    extracted.append(str(extract_dir))
                    print(f"Extracted {zip_file} to {extract_dir}")
                    
            except Exception as e:
                print(f"Error extracting {zip_file}: {e}")
        
        if not zip_files:
            print(f"No ZIP files found in {search_path}")
                
        self.extracted_dirs = extracted
        return extracted
    
    def find_log_files(self, directory: str) -> Dict[str, str]:
        """Find target log files in a directory and return as dict."""
        log_files = {}
        for root, dirs, files in os.walk(directory):
            for file in files:
                if file in self.target_files:
                    log_files[file] = os.path.join(root, file)
        return log_files
    
    def parse_timestamp(self, line: str) -> Optional[datetime]:
        """Extract and parse timestamp from a log line."""
        # Pattern for Couchbase timestamp: 2025-06-09T18:30:17.455783+00:00
        timestamp_pattern = r'^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[+-]\d{2}:\d{2})?)'
        match = re.match(timestamp_pattern, line.strip())
        
        if match:
            try:
                return date_parser.parse(match.group(1))
            except Exception:
                return None
        return None
    
    def find_timestamp_matches(self, file_path: str, target_timestamp: str, context_lines: int = 5) -> List[Dict]:
        """Find lines matching the target timestamp with exact precision only."""
        matches = []
        
        try:
            # Parse target timestamp to get the datetime object
            target_dt = date_parser.parse(target_timestamp)
            
            # Determine precision format based on user input
            precision_format = self.detect_timestamp_precision(target_timestamp)
            target_str = target_dt.strftime(precision_format)
            
            with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                lines = f.readlines()
            
            # Only search for the exact precision provided by user
            for i, line in enumerate(lines):
                line_dt = self.parse_timestamp(line)
                if line_dt:
                    line_str = line_dt.strftime(precision_format)
                    if line_str == target_str:
                        # Get context lines
                        start_idx = max(0, i - context_lines)
                        end_idx = min(len(lines), i + context_lines + 1)
                        
                        context = {
                            'line_number': i + 1,
                            'matched_line': line.strip(),
                            'precision': precision_format,
                            'context_lines': [
                                {
                                    'line_num': start_idx + j + 1,
                                    'content': lines[start_idx + j].rstrip(),
                                    'is_match': start_idx + j == i
                                }
                                for j in range(end_idx - start_idx)
                            ]
                        }
                        matches.append(context)
                    
        except Exception as e:
            print(f"Error processing {file_path}: {e}")
            
        return matches
    
    def detect_timestamp_precision(self, timestamp_str: str) -> str:
        """Detect the precision level from user input and return appropriate format."""
        # Remove timezone info for precision detection
        clean_timestamp = timestamp_str.split('+')[0].split('-', 3)[-1] if '+' in timestamp_str else timestamp_str
        clean_timestamp = clean_timestamp.split('Z')[0] if 'Z' in clean_timestamp else clean_timestamp
        
        # Count the components to determine precision
        if '.' in clean_timestamp:
            return "%Y-%m-%dT%H:%M:%S.%f"  # Has microseconds
        elif len(clean_timestamp.split(':')) == 3:
            return "%Y-%m-%dT%H:%M:%S"     # Has seconds
        elif len(clean_timestamp.split(':')) == 2:
            return "%Y-%m-%dT%H:%M"        # Has minutes
        elif 'T' in clean_timestamp and len(clean_timestamp.split('T')[1]) >= 2:
            return "%Y-%m-%dT%H"           # Has hours
        else:
            return "%Y-%m-%d"              # Day only
    
    def analyze_logs(self, target_timestamp: str, context_lines: int = 5) -> Dict:
        """Analyze all extracted logs for the target timestamp."""
        results = {
            'timestamp': target_timestamp,
            'nodes': {},
            'by_file': {},  # New: organize results by file type for easy comparison
            'summary': {
                'total_nodes': 0,
                'total_matches': 0,
                'files_with_matches': 0,
                'available_files': self.target_files
            }
        }
        
        # Initialize by_file structure
        for file_name in self.target_files:
            results['by_file'][file_name] = {}
        
        # Process each extracted directory (node)
        for extract_dir in self.extracted_dirs:
            node_name = Path(extract_dir).name
            log_files = self.find_log_files(extract_dir)
            
            node_results = {
                'log_files': {},
                'total_matches': 0,
                'available_files': list(log_files.keys())
            }
            
            # Process each target file
            for file_name in self.target_files:
                if file_name in log_files:
                    log_file = log_files[file_name]
                    matches = self.find_timestamp_matches(log_file, target_timestamp, context_lines)
                    
                    if matches:
                        file_data = {
                            'file_path': log_file,
                            'matches': matches
                        }
                        node_results['log_files'][file_name] = file_data
                        node_results['total_matches'] += len(matches)
                        results['summary']['files_with_matches'] += 1
                        
                        # Add to by_file structure for cross-node comparison
                        results['by_file'][file_name][node_name] = file_data
                    else:
                        # File exists but no matches
                        results['by_file'][file_name][node_name] = {
                            'file_path': log_file,
                            'matches': [],
                            'no_matches': True
                        }
                else:
                    # File doesn't exist in this node
                    results['by_file'][file_name][node_name] = {
                        'file_missing': True
                    }
            
            # Always include node in results (even if no matches) for comparison
            results['nodes'][node_name] = node_results
            if node_results['total_matches'] > 0:
                results['summary']['total_matches'] += node_results['total_matches']
        
        results['summary']['total_nodes'] = len(results['nodes'])
        return results

# Global analyzer instance - will be initialized with command line args
analyzer = None

@app.route('/')
def index():
    """Main page."""
    return render_template('index.html')

@app.route('/api/detect-zips', methods=['POST'])
def detect_zips():
    """Detect and extract zip files."""
    try:
        data = request.get_json() or {}
        custom_path = data.get('zip_path')
        custom_extract_path = data.get('extract_path')
        extracted = analyzer.detect_and_extract_zips(custom_path, custom_extract_path)
        return jsonify({
            'success': True,
            'extracted_dirs': extracted,
            'count': len(extracted),
            'search_path': str(custom_path or analyzer.zip_path),
            'extract_path': str(custom_extract_path or analyzer.work_dir)
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/analyze', methods=['POST'])
def analyze():
    """Analyze logs for a specific timestamp."""
    try:
        data = request.get_json()
        timestamp = data.get('timestamp')
        context_lines = data.get('context_lines', 5)
        
        if not timestamp:
            return jsonify({
                'success': False,
                'error': 'Timestamp is required'
            }), 400
        
        results = analyzer.analyze_logs(timestamp, context_lines)
        return jsonify({
            'success': True,
            'results': results
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/status')
def status():
    """Get current status of extracted directories."""
    return jsonify({
        'extracted_dirs': analyzer.extracted_dirs,
        'count': len(analyzer.extracted_dirs)
    })

def main():
    global analyzer
    
    parser = argparse.ArgumentParser(description='Couchbase Log Analyzer')
    parser.add_argument('--zip-path', '-z', default='.', 
                        help='Path to directory containing ZIP files (default: current directory)')
    parser.add_argument('--work-dir', '-w', default='work_data',
                        help='Directory for extracted files (default: work_data)')
    parser.add_argument('--port', '-p', type=int, default=9000,
                        help='Port to run the web server on (default: 9000)')
    
    args = parser.parse_args()
    
    # Initialize the analyzer with the specified paths
    analyzer = LogAnalyzer(work_dir=args.work_dir, zip_path=args.zip_path)
    
    print(f"🔍 Couchbase Log Analyzer")
    print(f"📁 ZIP files search path: {os.path.abspath(args.zip_path)}")
    print(f"💾 Work directory: {os.path.abspath(args.work_dir)}")
    print(f"🌐 Starting web server on http://localhost:{args.port}")
    print(f"📖 Open your browser and navigate to: http://localhost:{args.port}")
    
    app.run(debug=True, host='0.0.0.0', port=args.port)

if __name__ == '__main__':
    main()