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
        
    def detect_and_extract_zips(self, custom_path: str = None) -> List[str]:
        """Detect and extract all zip files in the specified directory."""
        search_path = Path(custom_path) if custom_path else self.zip_path
        zip_files = glob.glob(str(search_path / "*.zip"))
        extracted = []
        
        for zip_file in zip_files:
            try:
                with zipfile.ZipFile(zip_file, 'r') as zip_ref:
                    # Create extraction directory
                    extract_dir = self.work_dir / Path(zip_file).stem
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
    
    def find_log_files(self, directory: str) -> List[str]:
        """Find all .log files in a directory."""
        log_files = []
        for root, dirs, files in os.walk(directory):
            for file in files:
                if file.endswith('.log'):
                    log_files.append(os.path.join(root, file))
        return sorted(log_files)
    
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
        """Find lines matching the target timestamp with progressively reduced precision."""
        matches = []
        
        try:
            # Parse target timestamp
            target_dt = date_parser.parse(target_timestamp)
            
            # Different precision levels
            precision_formats = [
                "%Y-%m-%dT%H:%M:%S.%f",  # Full precision
                "%Y-%m-%dT%H:%M:%S",     # Second precision
                "%Y-%m-%dT%H:%M",        # Minute precision
                "%Y-%m-%dT%H",           # Hour precision
                "%Y-%m-%d",              # Day precision
            ]
            
            with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                lines = f.readlines()
            
            # Try each precision level
            for precision_format in precision_formats:
                target_str = target_dt.strftime(precision_format)
                
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
                
                # If we found matches at this precision, don't try lower precision
                if matches:
                    break
                    
        except Exception as e:
            print(f"Error processing {file_path}: {e}")
            
        return matches
    
    def analyze_logs(self, target_timestamp: str, context_lines: int = 5) -> Dict:
        """Analyze all extracted logs for the target timestamp."""
        results = {
            'timestamp': target_timestamp,
            'nodes': {},
            'summary': {
                'total_nodes': 0,
                'total_matches': 0,
                'files_with_matches': 0
            }
        }
        
        # Process each extracted directory (node)
        for extract_dir in self.extracted_dirs:
            node_name = Path(extract_dir).name
            log_files = self.find_log_files(extract_dir)
            
            node_results = {
                'log_files': {},
                'total_matches': 0
            }
            
            for log_file in log_files:
                file_name = os.path.basename(log_file)
                matches = self.find_timestamp_matches(log_file, target_timestamp, context_lines)
                
                if matches:
                    node_results['log_files'][file_name] = {
                        'file_path': log_file,
                        'matches': matches
                    }
                    node_results['total_matches'] += len(matches)
                    results['summary']['files_with_matches'] += 1
            
            if node_results['total_matches'] > 0:
                results['nodes'][node_name] = node_results
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
        extracted = analyzer.detect_and_extract_zips(custom_path)
        return jsonify({
            'success': True,
            'extracted_dirs': extracted,
            'count': len(extracted),
            'search_path': str(custom_path or analyzer.zip_path)
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
    parser.add_argument('--port', '-p', type=int, default=8080,
                        help='Port to run the web server on (default: 8080)')
    
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