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
import subprocess
import shutil
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Tuple, Optional
import json

from flask import Flask, render_template, request, jsonify, send_from_directory
from dateutil import parser as date_parser

app = Flask(__name__, static_folder='static', static_url_path='/static')
app.config['MAX_CONTENT_LENGTH'] = 500 * 1024 * 1024  # 500MB max file size

class LogAnalyzer:
    def __init__(self, work_dir: str = "work_data", zip_path: str = "."):
        self.work_dir = Path(work_dir)
        self.work_dir.mkdir(exist_ok=True)
        self.zip_path = Path(zip_path)
        self.extracted_dirs = []
        # Predefined list of log files to focus on
        self.target_files = [
            "diag.log"
        ]
        # Check for existing extractions on startup
        self._discover_existing_extractions()
    
    def _discover_existing_extractions(self):
        """Discover any existing extracted directories."""
        if self.work_dir.exists():
            for item in self.work_dir.iterdir():
                if item.is_dir() and any(self.find_log_files(str(item)).values()):
                    self.extracted_dirs.append(str(item))
            if self.extracted_dirs:
                print(f"Found {len(self.extracted_dirs)} existing extracted directories")
        
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
                    # Extract directly to the base directory (work_data/subfolder)
                    # The ZIP contents will create their own node directories
                    zip_ref.extractall(extract_base_dir)
                    extracted.append(str(extract_base_dir))
                    print(f"Extracted {zip_file} to {extract_base_dir}")
                    
            except Exception as e:
                print(f"Error extracting {zip_file}: {e}")
        
        if not zip_files:
            print(f"No ZIP files found in {search_path}")
                
        self.extracted_dirs = extracted
        return extracted
    
    def download_and_extract_from_s3(self, s3_urls: List[str], custom_extract_path: str = None, subfolder_name: str = None) -> List[str]:
        """Download ZIP files from S3 URLs and extract them."""
        extract_base_dir = Path(custom_extract_path) if custom_extract_path else self.work_dir
        
        # Create subfolder if specified
        if subfolder_name:
            extract_base_dir = extract_base_dir / subfolder_name
        
        extract_base_dir.mkdir(parents=True, exist_ok=True)
        
        extracted = []
        
        # Download and extract files from S3
        for s3_url in s3_urls:
            try:
                # Extract filename from S3 URL
                filename = s3_url.split('/')[-1]
                local_zip_path = extract_base_dir / filename
                
                print(f"Downloading {s3_url} to {local_zip_path}")
                
                # Use AWS CLI to download directly to final location
                result = subprocess.run([
                    'aws', 's3', 'cp', s3_url, str(local_zip_path)
                ], capture_output=True, text=True, check=True)
                
                if local_zip_path.exists():
                    print(f"Successfully downloaded {filename}")
                    
                    # Extract the ZIP file directly using unzip command
                    print(f"Extracting {local_zip_path} to {extract_base_dir}")
                    unzip_result = subprocess.run([
                        'unzip', '-o', str(local_zip_path), '-d', str(extract_base_dir)
                    ], capture_output=True, text=True)
                    
                    if unzip_result.returncode == 0:
                        print(f"Successfully extracted {filename}")
                        extracted.append(str(extract_base_dir))
                        
                        # Clean up the ZIP file after extraction
                        local_zip_path.unlink()
                        print(f"Cleaned up {filename}")
                    else:
                        print(f"Error extracting {filename}: {unzip_result.stderr}")
                        raise Exception(f"Failed to extract {filename}: {unzip_result.stderr}")
                else:
                    print(f"Failed to download {filename}")
                    raise Exception(f"Download failed for {filename}")
                        
            except subprocess.CalledProcessError as e:
                print(f"AWS CLI error downloading {s3_url}: {e.stderr}")
                raise Exception(f"Failed to download {s3_url}: {e.stderr}")
            except Exception as e:
                print(f"Error processing {s3_url}: {e}")
                raise
        
        # Update extracted_dirs list
        if extracted:
            self.extracted_dirs.extend(extracted)
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
    
    def get_directory_contents(self, directory_path: str) -> List[Dict]:
        """Get directory contents with file information."""
        contents = []
        try:
            for item in os.listdir(directory_path):
                item_path = os.path.join(directory_path, item)
                stat = os.stat(item_path)
                
                contents.append({
                    'name': item,
                    'path': item_path,
                    'is_directory': os.path.isdir(item_path),
                    'size': stat.st_size if not os.path.isdir(item_path) else None,
                    'modified': stat.st_mtime,
                    'size_human': self.format_file_size(stat.st_size) if not os.path.isdir(item_path) else None
                })
        except Exception as e:
            print(f"Error reading directory {directory_path}: {e}")
            
        # Sort: directories first, then files
        contents.sort(key=lambda x: (not x['is_directory'], x['name'].lower()))
        return contents
    
    def format_file_size(self, size_bytes: int) -> str:
        """Format file size in human readable format."""
        if size_bytes == 0:
            return "0B"
        size_names = ["B", "KB", "MB", "GB"]
        i = 0
        while size_bytes >= 1024.0 and i < len(size_names) - 1:
            size_bytes /= 1024.0
            i += 1
        return f"{size_bytes:.1f}{size_names[i]}"
    
    def read_file_content(self, file_path: str, start_line: int = 1, lines_per_page: int = 100, search_term: str = None) -> Dict:
        """Read file content with pagination and optional search."""
        try:
            with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                lines = f.readlines()
            
            total_lines = len(lines)
            
            # If search term provided, filter lines
            if search_term:
                filtered_lines = []
                for i, line in enumerate(lines):
                    if search_term.lower() in line.lower():
                        filtered_lines.append({
                            'line_number': i + 1,
                            'content': line.rstrip(),
                            'highlighted': True
                        })
                return {
                    'lines': filtered_lines[:lines_per_page],  # Limit search results
                    'total_lines': len(filtered_lines),
                    'total_file_lines': total_lines,
                    'search_term': search_term,
                    'is_search': True
                }
            
            # Regular pagination
            end_line = min(start_line + lines_per_page - 1, total_lines)
            start_idx = start_line - 1
            end_idx = end_line
            
            page_lines = []
            for i in range(start_idx, end_idx):
                if i < total_lines:
                    page_lines.append({
                        'line_number': i + 1,
                        'content': lines[i].rstrip(),
                        'highlighted': False
                    })
            
            return {
                'lines': page_lines,
                'start_line': start_line,
                'end_line': end_line,
                'total_lines': total_lines,
                'has_more': end_line < total_lines,
                'is_search': False
            }
            
        except Exception as e:
            raise Exception(f"Error reading file {file_path}: {e}")
    
    def execute_bash_search(self, command_type: str, file_paths: List[str], search_pattern: str, context_lines: int = 5) -> Dict:
        """Execute bash commands for fast text processing."""
        results = {}
        
        try:
            for file_path in file_paths:
                print(f"Processing file: {file_path}")  # Debug log
                
                original_file_path = file_path  # Keep original for results key
                
                # Ensure we have an absolute path
                if not os.path.isabs(file_path):
                    file_path = os.path.abspath(file_path)
                    print(f"Converted to absolute path: {file_path}")  # Debug log
                
                if not os.path.exists(file_path):
                    print(f"File not found: {file_path}")  # Debug log
                    print(f"Current working directory: {os.getcwd()}")  # Debug log
                    results[original_file_path] = {'error': f'File not found: {file_path}'}
                    continue
                
                # Check file permissions
                if not os.access(file_path, os.R_OK):
                    print(f"File not readable: {file_path}")  # Debug log
                    results[original_file_path] = {'error': f'File not readable: {file_path}'}
                    continue
                
                # Get file info for results
                try:
                    # Extract node name more reliably
                    path_parts = Path(file_path).parts
                    node_name = path_parts[-2] if len(path_parts) > 1 else 'unknown'
                    file_name = Path(file_path).name
                    
                    print(f"Node: {node_name}, File: {file_name}")  # Debug log
                    
                except Exception as e:
                    print(f"Error parsing file path {file_path}: {e}")
                    node_name = 'unknown'
                    file_name = Path(file_path).name
                
                if command_type == 'grep':
                    # Use grep for fast searching
                    # Use absolute path and quote it to handle @ symbols in directory names
                    abs_file_path = os.path.abspath(file_path)
                    cmd = ['grep', '-i', f'-C{context_lines}', search_pattern, abs_file_path]
                elif command_type == 'timestamp_grep':
                    # Special case for timestamp searching - use more flexible pattern matching
                    # Use -F for fixed string matching to avoid regex issues
                    # Use absolute path and quote it to handle @ symbols in directory names
                    abs_file_path = os.path.abspath(file_path)
                    cmd = ['grep', '-F', f'-C{context_lines}', search_pattern, abs_file_path]
                else:
                    results[original_file_path] = {'error': f'Unsupported command type: {command_type}'}
                    continue
                
                print(f"Executing command: {' '.join(cmd)}")  # Debug log
                print(f"Search pattern being used: '{search_pattern}'")  # Debug log
                
                try:
                    # Run the command with absolute paths to avoid @ symbol issues
                    result = subprocess.run(
                        cmd, 
                        capture_output=True, 
                        text=True, 
                        timeout=30
                    )
                    
                    print(f"Command return code: {result.returncode}")  # Debug log
                    print(f"Command stdout length: {len(result.stdout)}")  # Debug log
                    if result.stdout:
                        print(f"First 500 chars of grep output: {result.stdout[:500]}")  # Debug log
                    if result.stderr:
                        print(f"Command stderr: {result.stderr}")  # Debug log
                    
                    if result.returncode == 0:
                        # Parse grep output
                        matches = self.parse_grep_output(result.stdout, search_pattern)
                        results[original_file_path] = {
                            'node_name': node_name,
                            'file_name': file_name,
                            'matches': matches,
                            'match_count': len(matches)
                        }
                        print(f"Found {len(matches)} matches")  # Debug log
                        if matches:
                            print(f"First match context lines count: {len(matches[0].get('context_lines', []))}")  # Debug log
                            for i, context_line in enumerate(matches[0].get('context_lines', [])[:5]):  # Show first 5 context lines
                                print(f"  Context line {i}: is_match={context_line.get('is_match')}, content='{context_line.get('content', '')[:50]}...'")  # Debug log
                    elif result.returncode == 1:
                        # No matches found (normal for grep)
                        results[original_file_path] = {
                            'node_name': node_name,
                            'file_name': file_name,
                            'matches': [],
                            'match_count': 0
                        }
                        print("No matches found")  # Debug log
                    else:
                        # Error
                        error_msg = result.stderr.strip() if result.stderr else f'Command failed with return code {result.returncode}'
                        results[original_file_path] = {'error': error_msg}
                        print(f"Command error: {error_msg}")  # Debug log
                        
                except subprocess.TimeoutExpired:
                    results[original_file_path] = {'error': 'Command timeout'}
                    print("Command timed out")  # Debug log
                except Exception as e:
                    results[original_file_path] = {'error': str(e)}
                    print(f"Exception during command execution: {e}")  # Debug log
                    
        except Exception as e:
            print(f"Error in execute_bash_search: {e}")  # Debug log
            raise Exception(f"Error executing bash command: {e}")
            
        return results
    
    def parse_grep_output(self, grep_output: str, search_pattern: str) -> List[Dict]:
        """Parse grep output into structured matches - simplified for raw display."""
        if not grep_output.strip():
            return []
            
        # Just return the raw grep output as a single match for simple display
        matches = [{
            'line_number': 1,
            'matched_line': 'Raw grep output',
            'raw_output': grep_output.strip()
        }]
        
        print(f"Returning raw grep output with {len(grep_output.strip().split())} lines")  # Debug log
        return matches

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

@app.route('/api/download-s3', methods=['POST'])
def download_s3():
    """Download and extract ZIP files from S3 URLs."""
    try:
        data = request.get_json()
        s3_urls = data.get('s3_urls', [])
        custom_extract_path = data.get('extract_path')
        subfolder_name = data.get('subfolder_name')
        
        if not s3_urls:
            return jsonify({
                'success': False,
                'error': 'At least one S3 URL is required'
            }), 400
        
        # Validate S3 URLs
        for url in s3_urls:
            if not url.startswith('s3://'):
                return jsonify({
                    'success': False,
                    'error': f'Invalid S3 URL: {url}. URLs must start with s3://'
                }), 400
        
        extracted = analyzer.download_and_extract_from_s3(s3_urls, custom_extract_path, subfolder_name)
        
        # Determine final extract path for response
        extract_base_dir = Path(custom_extract_path) if custom_extract_path else analyzer.work_dir
        if subfolder_name:
            extract_base_dir = extract_base_dir / subfolder_name
            
        return jsonify({
            'success': True,
            'extracted_dirs': extracted,
            'count': len(extracted),
            'extract_path': str(extract_base_dir),
            's3_urls': s3_urls
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/browse-files', methods=['POST'])
def browse_files():
    """Browse files in extracted directories."""
    try:
        data = request.get_json() or {}
        node_path = data.get('node_path')
        
        if not node_path:
            # Return all nodes - look in work_data/subfolder structure
            nodes = {}
            
            # Check work_data directory structure
            work_data_path = os.path.join(os.getcwd(), 'work_data')
            print(f"Looking for nodes in: {work_data_path}")  # Debug log
            
            if os.path.exists(work_data_path):
                # Look for subdirectories in work_data
                for item in os.listdir(work_data_path):
                    subfolder_path = os.path.join(work_data_path, item)
                    if os.path.isdir(subfolder_path):
                        print(f"Found subfolder: {subfolder_path}")  # Debug log
                        
                        # Look for any directories inside this subfolder
                        for node_item in os.listdir(subfolder_path):
                            node_path = os.path.join(subfolder_path, node_item)
                            if os.path.isdir(node_path):
                                print(f"Found directory: {node_path}")  # Debug log
                                
                                # Use the directory name as the node name
                                node_name = node_item
                                nodes[node_name] = {
                                    'path': node_path,
                                    'contents': analyzer.get_directory_contents(node_path)
                                }
            
            # Also check analyzer.extracted_dirs for any directly extracted directories
            for extract_dir in analyzer.extracted_dirs:
                if os.path.exists(extract_dir):
                    node_name = Path(extract_dir).name
                    if node_name not in nodes:  # Don't overwrite existing
                        nodes[node_name] = {
                            'path': extract_dir,
                            'contents': analyzer.get_directory_contents(extract_dir)
                        }
            
            print(f"Found {len(nodes)} nodes")  # Debug log
            return jsonify({
                'success': True,
                'nodes': nodes
            })
        else:
            # Return specific directory contents
            contents = analyzer.get_directory_contents(node_path)
            return jsonify({
                'success': True,
                'contents': contents
            })
            
    except Exception as e:
        print(f"Error in browse_files: {e}")  # Debug log
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/view-file', methods=['POST'])
def view_file():
    """View file content with pagination."""
    try:
        data = request.get_json()
        file_path = data.get('file_path')
        start_line = data.get('start_line', 1)
        lines_per_page = data.get('lines_per_page', 100)
        search_term = data.get('search_term')
        
        if not file_path or not os.path.exists(file_path):
            return jsonify({
                'success': False,
                'error': 'File not found'
            }), 400
            
        content = analyzer.read_file_content(file_path, start_line, lines_per_page, search_term)
        return jsonify({
            'success': True,
            'content': content
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/execute-command', methods=['POST'])
def execute_command():
    """Execute bash command for fast text processing."""
    try:
        data = request.get_json()
        print(f"Execute command received data: {data}")  # Debug log
        
        command_type = data.get('command_type')  # 'grep', 'awk', etc.
        file_paths = data.get('file_paths', [])
        search_pattern = data.get('search_pattern')
        context_lines = data.get('context_lines', 5)
        
        print(f"Command type: {command_type}, File paths: {len(file_paths)}, Search pattern: '{search_pattern}'")  # Debug log
        print(f"File paths: {file_paths}")  # Debug log
        
        if not command_type:
            return jsonify({
                'success': False,
                'error': 'Missing command_type parameter'
            }), 400
            
        if not file_paths:
            return jsonify({
                'success': False,
                'error': 'Missing file_paths parameter'
            }), 400
            
        if not search_pattern:
            return jsonify({
                'success': False,
                'error': 'Missing search_pattern parameter'
            }), 400
            
        results = analyzer.execute_bash_search(command_type, file_paths, search_pattern, context_lines)
        
        # Debug: Print the structure being sent to frontend
        for file_path, result in results.items():
            if 'matches' in result and result['matches']:
                print(f"DEBUG: Sending to frontend - {file_path}")
                print(f"  Match count: {len(result['matches'])}")
                for i, match in enumerate(result['matches'][:1]):  # Show first match
                    print(f"  Match {i}: line {match.get('line_number')}")
                    print(f"    Context lines count: {len(match.get('context_lines', []))}")
                    for j, ctx in enumerate(match.get('context_lines', [])[:3]):  # Show first 3 context lines
                        print(f"      Context {j}: is_match={ctx.get('is_match')}, line={ctx.get('line_num')}, content='{ctx.get('content', '')[:50]}...'")
        
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
    # Count actual nodes using the same logic as browse_files
    nodes = {}
    
    # Check work_data directory structure  
    work_data_path = os.path.join(os.getcwd(), 'work_data')
    
    if os.path.exists(work_data_path):
        # Look for subdirectories in work_data
        for item in os.listdir(work_data_path):
            subfolder_path = os.path.join(work_data_path, item)
            if os.path.isdir(subfolder_path):
                # Look for any directories inside this subfolder
                for node_item in os.listdir(subfolder_path):
                    node_path = os.path.join(subfolder_path, node_item)
                    if os.path.isdir(node_path):
                        # Use the directory name as the node name
                        node_name = node_item
                        nodes[node_name] = node_path
    
    # Also check analyzer.extracted_dirs for any directly extracted directories
    for extract_dir in analyzer.extracted_dirs:
        if os.path.exists(extract_dir):
            node_name = Path(extract_dir).name
            if node_name not in nodes:  # Don't overwrite existing
                nodes[node_name] = extract_dir
    
    return jsonify({
        'extracted_dirs': list(nodes.values()),
        'count': len(nodes),
        'target_files': analyzer.target_files
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