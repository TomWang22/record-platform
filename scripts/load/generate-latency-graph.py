#!/usr/bin/env python3
"""
Generate latency graphs from k6 test results
Creates HTML visualization with percentile charts
"""

import json
import sys
import re
import os
import subprocess
import tempfile
from datetime import datetime

def parse_k6_output(output_text):
    """Parse k6 output text to extract metrics"""
    data = {
        'summary': {},
        'http_metrics': {'percentiles': {}, 'avg': 0, 'min': 0, 'max': 0, 'median': 0},
        'custom_metrics': {
            'pipeline_latency': {},
            'analytics_to_ai': {},
            'ai_advice': {},
            'gateway': {}
        },
        'test_name': 'Python AI Service Pipeline'  # Default, will be detected from output
    }
    
    # Detect test suite from output
    if 'Listings Service' in output_text or 'listings' in output_text.lower() or 'listings-limit' in output_text.lower():
        data['test_name'] = 'Listings Service Limit Test'
    elif 'Python AI Service Pipeline' in output_text or 'python-ai-pipeline' in output_text.lower():
        data['test_name'] = 'Python AI Service Pipeline'
    elif 'Social Service' in output_text or 'social' in output_text.lower():
        data['test_name'] = 'Social Service'
    elif 'analytics' in output_text.lower() and 'ai' in output_text.lower():
        data['test_name'] = 'Python AI Service Pipeline'
    # Add more test suite detection as needed
    
    # Extract summary metrics from k6 output format
    # Format: "http_reqs.......................: 6125    16.391678/s"
    total_match = re.search(r'http_reqs[^:]*:\s+(\d+)', output_text)
    if total_match:
        data['summary']['total_requests'] = int(total_match.group(1))
    else:
        # Try alternative format: "Total Requests: 6125"
        total_match = re.search(r'Total Requests:\s+(\d+)', output_text)
        if total_match:
            data['summary']['total_requests'] = int(total_match.group(1))
    
    # Extract test duration from execution time (get the LAST/final duration)
    # Format: "running (6m13.7s), 00/50 VUs, 1015 complete and 12 interrupted iterations"
    # Find all duration matches and use the last one (final duration)
    duration_matches = list(re.finditer(r'running\s+\((\d+)m([\d.]+)s\)', output_text))
    if duration_matches:
        # Use the last match (final duration)
        duration_match = duration_matches[-1]
        minutes = int(duration_match.group(1))
        seconds = float(duration_match.group(2))
        data['summary']['test_duration'] = minutes * 60 + seconds
    else:
        # Try format: "Test Duration: 362.7s"
        duration_match = re.search(r'Test Duration:\s+([\d.]+)s', output_text)
        if duration_match:
            data['summary']['test_duration'] = float(duration_match.group(1))
    
    # Extract HTTP error rate from k6 output format
    # Format: "http_req_failed.................: 34.23%  2097 out of 6125"
    http_error_match = re.search(r'http_req_failed[^:]*:\s+([\d.]+)%', output_text)
    if http_error_match:
        data['summary']['http_error_rate'] = f"{http_error_match.group(1)}%"
        data['summary']['error_rate'] = f"{http_error_match.group(1)}%"  # Legacy field
    else:
        # Try to match HTTP Error Rate first (new format)
        http_error_match = re.search(r'HTTP Error Rate:\s+([\d.]+)%', output_text)
        if http_error_match:
            data['summary']['http_error_rate'] = f"{http_error_match.group(1)}%"
            data['summary']['error_rate'] = f"{http_error_match.group(1)}%"  # Legacy field
        else:
            # Fallback to old format
            error_rate_match = re.search(r'Error Rate:\s+([\d.]+)%', output_text)
            if error_rate_match:
                data['summary']['error_rate'] = f"{error_rate_match.group(1)}%"
                data['summary']['http_error_rate'] = f"{error_rate_match.group(1)}%"
    
    # Extract HTTP Success Rate if available
    http_success_match = re.search(r'HTTP Success Rate:\s+([\d.]+)%', output_text)
    if http_success_match:
        data['summary']['http_success_rate'] = f"{http_success_match.group(1)}%"
    
    pipeline_success_match = re.search(r'pipeline_success[^:]*:\s+([\d.]+)%', output_text)
    if pipeline_success_match:
        data['summary']['pipeline_success_rate'] = f"{pipeline_success_match.group(1)}%"
    else:
        # Try alternative format: "Pipeline Success Rate: 94.59%"
        pipeline_success_match = re.search(r'Pipeline Success Rate:\s+([\d.]+)%', output_text)
        if pipeline_success_match:
            data['summary']['pipeline_success_rate'] = f"{pipeline_success_match.group(1)}%"
    
    # Extract HTTP latency percentiles from k6 output format
    # Format: "http_req_duration...............: avg=1.37s       min=292.12µs med=91.79ms  max=1m0s   p(90)=1.34s   p(95)=3.46s"
    # k6 outputs percentiles in format: p(1), p(5), p(10), ..., p(99), p(99.9), p(99.99), etc.
    
    # Extract from http_req_duration line
    # Format: "http_req_duration...............: avg=1.37s       min=292.12µs med=91.79ms  max=1m0s   p(90)=1.34s   p(95)=3.46s"
    # First extract the max value separately to handle "1m0s" format - capture until next space or end
    max_match = re.search(r'http_req_duration[^:]*:\s+.*?max=([^\s]+)', output_text)
    max_value_str = max_match.group(1) if max_match else "0s"
    
    # Now extract other values with a regex that doesn't try to capture max
    http_duration_line = re.search(r'http_req_duration[^:]*:\s+.*?avg=([\d.]+)([smµ]s?).*?min=([\d.]+)([smµ]s?).*?med=([\d.]+)([smµ]s?)', output_text)
    if http_duration_line:
        # Convert to ms
        avg_val = float(http_duration_line.group(1))
        avg_unit = http_duration_line.group(2)
        if avg_unit == 's':
            avg_val *= 1000
        elif avg_unit == 'µs':
            avg_val /= 1000
        data['http_metrics']['avg'] = avg_val
        
        min_val = float(http_duration_line.group(3))
        min_unit = http_duration_line.group(4)
        if min_unit == 's':
            min_val *= 1000
        elif min_unit == 'µs':
            min_val /= 1000
        data['http_metrics']['min'] = min_val
        
        med_val = float(http_duration_line.group(5))
        med_unit = http_duration_line.group(6)
        if med_unit == 's':
            med_val *= 1000
        elif med_unit == 'µs':
            med_val /= 1000
        data['http_metrics']['median'] = med_val
        
        # Handle max - could be "1m0s" format (1 minute = 60 seconds)
        # max_value_str was extracted separately above
        # Check for "1m0s" format
        max_min_sec_match = re.search(r'(\d+)m(\d+)s', max_value_str)
        if max_min_sec_match:
            # Format: "1m0s" = 1 minute + 0 seconds = 60 seconds
            max_val = int(max_min_sec_match.group(1)) * 60 + int(max_min_sec_match.group(2))
            max_val *= 1000  # Convert to ms
        else:
            # Regular format: "60s" or "60000ms" - extract number and unit
            max_num_match = re.search(r'([\d.]+)([smµ]s?)', max_value_str)
            if max_num_match:
                max_val = float(max_num_match.group(1))
                max_unit = max_num_match.group(2)
                if max_unit == 's':
                    max_val *= 1000
                elif max_unit == 'µs':
                    max_val /= 1000
            else:
                max_val = 0
        data['http_metrics']['max'] = max_val
    else:
        # If http_duration_line not found, try to extract max separately
        max_match = re.search(r'http_req_duration[^:]*:\s+.*?max=([\d.]+[msµ]?s?)', output_text)
        if max_match:
            max_value_str = max_match.group(1)
            max_min_sec_match = re.search(r'(\d+)m(\d+)s', max_value_str)
            if max_min_sec_match:
                max_val = int(max_min_sec_match.group(1)) * 60 + int(max_min_sec_match.group(2))
                max_val *= 1000
                data['http_metrics']['max'] = max_val
    
    # Extract ALL percentiles from the formatted handleSummary output
    # Format: "  p1      (1st):        0.00ms" or "  p90     (90th):       2824.99ms"
    # The handleSummary function outputs percentiles in a formatted text format
    # Updated pattern to handle spaces, variable spacing, and "ms" suffix
    # Pattern matches: p1 (1st): 0.00ms or p90 (90th): 2824.99ms
    percentile_pattern = r'p(\d+(?:\.\d+)?)\s+\([^)]+\):\s+([\d.]+)ms'
    percentile_matches = re.findall(percentile_pattern, output_text)
    
    # Also try alternative format with more flexible spacing
    if not percentile_matches:
        # Try with more flexible spacing: "p90     (90th):       2824.99ms"
        percentile_pattern_alt = r'p(\d+(?:\.\d+)?)\s+\([^)]+\):\s+([\d.]+)ms'
        percentile_matches = re.findall(percentile_pattern_alt, output_text, re.MULTILINE)
    
    # Also try format without parentheses: "p1: 0.00ms" or "p90: 2824.99ms"
    if not percentile_matches:
        percentile_pattern_simple = r'p(\d+(?:\.\d+)?):\s+([\d.]+)ms'
        percentile_matches = re.findall(percentile_pattern_simple, output_text)
    
    # Map all found percentiles
    for p_key, p_val in percentile_matches:
        value = float(p_val)
        # Normalize percentile key (e.g., "99.9" -> "p999", "1" -> "p1")
        if '.' in p_key:
            # Decimal percentiles like 99.9, 99.99, etc.
            p_num = p_key.replace('.', '')
            data['http_metrics']['percentiles'][f'p{p_num}'] = value
        else:
            # Integer percentiles like 1, 5, 10, 25, 50, 75, 90, 95, 99, 100
            data['http_metrics']['percentiles'][f'p{p_key}'] = value
    
    # If still no matches, try extracting from the detailed percentile breakdown section
    # Format: "  p90     (90th):       6067.71ms" in a section labeled "HTTP Request Latency Percentiles"
    if not percentile_matches:
        # Look for the section between "HTTP Request Latency Percentiles" and next section
        percentile_section = re.search(r'HTTP Request Latency Percentiles.*?(?=\n\n|\n📊|\n🔗|\n🤖|\n🌐|$)', output_text, re.DOTALL)
        if percentile_section:
            section_text = percentile_section.group(0)
            percentile_matches = re.findall(r'p(\d+(?:\.\d+)?)\s+\([^)]+\):\s+([\d.]+)ms', section_text)
            for p_key, p_val in percentile_matches:
                value = float(p_val)
                if '.' in p_key:
                    p_num = p_key.replace('.', '')
                    data['http_metrics']['percentiles'][f'p{p_num}'] = value
                else:
                    data['http_metrics']['percentiles'][f'p{p_key}'] = value
    
    # Also try to extract from thresholds section if handleSummary format not found
    if not percentile_matches:
        # Format in thresholds: "✓ 'p(1)<50' p(1)=579.15µs" or "✗ 'p(90)<500' p(90)=1.34s"
        threshold_percentiles = re.findall(r"p\(([\d.]+)\)=([\d.]+)([smµ]s?)", output_text)
        for p_key, p_val, p_unit in threshold_percentiles:
            value = float(p_val)
            if p_unit == 's' or p_unit == 'm':
                value *= 1000
            elif p_unit == 'µs':
                value /= 1000
            
            # Map percentile keys
            if '.' in p_key:
                p_num = p_key.replace('.', '')
                data['http_metrics']['percentiles'][f'p{p_num}'] = value
            else:
                data['http_metrics']['percentiles'][f'p{p_key}'] = value
    
    # Extract min, avg, max, median (fallback to old format if not found above)
    if data['http_metrics']['min'] == 0:
        min_match = re.search(r'Min:\s+([\d.]+)ms', output_text)
        if min_match:
            data['http_metrics']['min'] = float(min_match.group(1))
    
    if data['http_metrics']['avg'] == 0:
        avg_match = re.search(r'Avg:\s+([\d.]+)ms', output_text)
        if avg_match:
            data['http_metrics']['avg'] = float(avg_match.group(1))
    
    if data['http_metrics']['max'] == 0:
        max_match = re.search(r'Max:\s+([\d.]+)ms', output_text)
        if max_match:
            data['http_metrics']['max'] = float(max_match.group(1))
    
    if data['http_metrics']['median'] == 0:
        median_match = re.search(r'Median:\s+([\d.]+)ms', output_text)
        if median_match:
            data['http_metrics']['median'] = float(median_match.group(1))
    
    # Extract pipeline component latencies from k6 text output format
    # Format 1: "analytics_to_ai_latency_ms......: avg=5.626095    min=0        med=2        max=423    p(90)=8       p(95)=16.7"
    # Format 2: From handleSummary output: "📊 Analytics → AI Latency:\n  p50: 0.00ms\n  p95: 29.00ms\n  p99: 0.00ms"
    
    # Try Format 2 first (handleSummary formatted output)
    analytics_section = re.search(r'📊 Analytics → AI Latency:.*?(?=\n🤖|\n🌐|\n📊|\n🔗|$)', output_text, re.DOTALL)
    if analytics_section:
        section_text = analytics_section.group(0)
        analytics_avg_match = re.search(r'Avg:\s+([\d.]+)ms', section_text)
        analytics_p95_match = re.search(r'p95:\s+([\d.]+)ms', section_text)
        analytics_p99_match = re.search(r'p99:\s+([\d.]+)ms', section_text)
        if analytics_p95_match:
            data['custom_metrics']['analytics_to_ai'] = {
                'avg': float(analytics_avg_match.group(1)) if analytics_avg_match else 0,
                'p95': float(analytics_p95_match.group(1)),
                'p99': float(analytics_p99_match.group(1)) if analytics_p99_match else 0
            }
    
    # Fallback to Format 1 (k6 raw metrics)
    if 'analytics_to_ai' not in data['custom_metrics'] or data['custom_metrics']['analytics_to_ai'].get('p95', 0) == 0:
        analytics_match = re.search(r'analytics_to_ai_latency_ms.*?avg=([\d.]+).*?p\(95\)=([\d.]+)', output_text)
        if analytics_match:
            data['custom_metrics']['analytics_to_ai'] = {
                'avg': float(analytics_match.group(1)),
                'p95': float(analytics_match.group(2)),
                'p99': 0
            }
            analytics_p99_match = re.search(r'analytics_to_ai_latency_ms[^:]*:\s+.*?p\(99\)=([\d.]+)', output_text)
            if analytics_p99_match:
                data['custom_metrics']['analytics_to_ai']['p99'] = float(analytics_p99_match.group(1))
    
    # AI Advice Latency
    ai_section = re.search(r'🤖 AI Advice Latency.*?(?=\n🌐|\n📊|\n🔗|$)', output_text, re.DOTALL)
    if ai_section:
        section_text = ai_section.group(0)
        ai_avg_match = re.search(r'Avg:\s+([\d.]+)ms', section_text)
        ai_p95_match = re.search(r'p95:\s+([\d.]+)ms', section_text)
        ai_p99_match = re.search(r'p99:\s+([\d.]+)ms', section_text)
        if ai_p95_match:
            data['custom_metrics']['ai_advice'] = {
                'avg': float(ai_avg_match.group(1)) if ai_avg_match else 0,
                'p95': float(ai_p95_match.group(1)),
                'p99': float(ai_p99_match.group(1)) if ai_p99_match else 0
            }
    
    if 'ai_advice' not in data['custom_metrics'] or data['custom_metrics']['ai_advice'].get('p95', 0) == 0:
        ai_match = re.search(r'ai_advice_latency_ms.*?avg=([\d.]+).*?p\(95\)=([\d.]+)', output_text)
        if ai_match:
            data['custom_metrics']['ai_advice'] = {
                'avg': float(ai_match.group(1)),
                'p95': float(ai_match.group(2)),
                'p99': 0
            }
            ai_p99_match = re.search(r'ai_advice_latency_ms[^:]*:\s+.*?p\(99\)=([\d.]+)', output_text)
            if ai_p99_match:
                data['custom_metrics']['ai_advice']['p99'] = float(ai_p99_match.group(1))
    
    # API Gateway Latency
    gateway_section = re.search(r'🌐 API Gateway Latency:.*?(?=\n📊|\n🔗|\n🤖|$)', output_text, re.DOTALL)
    if gateway_section:
        section_text = gateway_section.group(0)
        gateway_avg_match = re.search(r'Avg:\s+([\d.]+)ms', section_text)
        gateway_p95_match = re.search(r'p95:\s+([\d.]+)ms', section_text)
        gateway_p99_match = re.search(r'p99:\s+([\d.]+)ms', section_text)
        if gateway_p95_match:
            data['custom_metrics']['gateway'] = {
                'avg': float(gateway_avg_match.group(1)) if gateway_avg_match else 0,
                'p95': float(gateway_p95_match.group(1)),
                'p99': float(gateway_p99_match.group(1)) if gateway_p99_match else 0
            }
    
    if 'gateway' not in data['custom_metrics'] or data['custom_metrics']['gateway'].get('p95', 0) == 0:
        gateway_match = re.search(r'gateway_latency_ms.*?avg=([\d.]+).*?p\(95\)=([\d.]+)', output_text)
        if gateway_match:
            data['custom_metrics']['gateway'] = {
                'avg': float(gateway_match.group(1)),
                'p95': float(gateway_match.group(2)),
                'p99': 0
            }
            gateway_p99_match = re.search(r'gateway_latency_ms[^:]*:\s+.*?p\(99\)=([\d.]+)', output_text)
            if gateway_p99_match:
                data['custom_metrics']['gateway']['p99'] = float(gateway_p99_match.group(1))
    
    # Total Pipeline Latency
    pipeline_section = re.search(r'🔗 Pipeline Latency.*?(?=\n📊|\n🤖|\n🌐|$)', output_text, re.DOTALL)
    if pipeline_section:
        section_text = pipeline_section.group(0)
        pipeline_avg_match = re.search(r'Avg:\s+([\d.]+)ms', section_text)
        pipeline_p95_match = re.search(r'p95:\s+([\d.]+)ms', section_text)
        pipeline_p99_match = re.search(r'p99:\s+([\d.]+)ms', section_text)
        if pipeline_p95_match:
            data['custom_metrics']['pipeline_latency'] = {
                'avg': float(pipeline_avg_match.group(1)) if pipeline_avg_match else 0,
                'p95': float(pipeline_p95_match.group(1)),
                'p99': float(pipeline_p99_match.group(1)) if pipeline_p99_match else 0
            }
    
    if 'pipeline_latency' not in data['custom_metrics'] or data['custom_metrics']['pipeline_latency'].get('p95', 0) == 0:
        pipeline_match = re.search(r'pipeline_latency_ms.*?avg=([\d.]+).*?p\(95\)=([\d.]+)', output_text)
        if pipeline_match:
            data['custom_metrics']['pipeline_latency'] = {
                'avg': float(pipeline_match.group(1)),
                'p95': float(pipeline_match.group(2)),
                'p99': 0
            }
            pipeline_p99_match = re.search(r'pipeline_latency_ms[^:]*:\s+.*?p\(99\)=([\d.]+)', output_text)
            if pipeline_p99_match:
                data['custom_metrics']['pipeline_latency']['p99'] = float(pipeline_p99_match.group(1))
    
    # Extract success rates
    analytics_success_match = re.search(r'analytics_success[^:]*:\s+([\d.]+)%', output_text)
    if analytics_success_match:
        data['summary']['analytics_success_rate'] = f"{analytics_success_match.group(1)}%"
    
    ai_success_match = re.search(r'ai_success[^:]*:\s+([\d.]+)%', output_text)
    if ai_success_match:
        data['summary']['ai_success_rate'] = f"{ai_success_match.group(1)}%"
    
    return data

def _generate_component_cards_html(test_name, forum_post_metrics, comment_metrics, group_metrics, p2p_message_metrics, 
                                   forum_post_success, comment_success, group_success, kafka_success,
                                   analytics_metrics, ai_metrics, gateway_metrics, pipeline_metrics,
                                   analytics_success, ai_success, search_metrics=None, create_metrics=None, 
                                   bid_metrics=None, watchlist_metrics=None, get_metrics=None, 
                                   update_metrics=None, offer_metrics=None, ebay_metrics=None, rating_metrics=None,
                                   search_success=0, create_success=0, bid_success=0, watchlist_success=0):
    """Generate component cards HTML based on test suite"""
    # Listings Service components
    if 'Listings' in test_name or (search_metrics and isinstance(search_metrics, dict) and search_metrics.get('avg', 0) > 0):
        search_avg = (search_metrics.get('avg', 0) * 1000) if search_metrics and search_metrics.get('avg', 0) < 1000 else (search_metrics.get('avg', 0) if search_metrics else 0)
        search_p95 = (search_metrics.get('p(95)', 0) * 1000) if search_metrics and search_metrics.get('p(95)', 0) < 1000 else (search_metrics.get('p(95)', 0) if search_metrics else 0)
        search_p99 = (search_metrics.get('p(99)', 0) * 1000) if search_metrics and search_metrics.get('p(99)', 0) < 1000 else (search_metrics.get('p(99)', 0) if search_metrics else 0)
        
        create_avg = (create_metrics.get('avg', 0) * 1000) if create_metrics and create_metrics.get('avg', 0) < 1000 else (create_metrics.get('avg', 0) if create_metrics else 0)
        create_p95 = (create_metrics.get('p(95)', 0) * 1000) if create_metrics and create_metrics.get('p(95)', 0) < 1000 else (create_metrics.get('p(95)', 0) if create_metrics else 0)
        create_p99 = (create_metrics.get('p(99)', 0) * 1000) if create_metrics and create_metrics.get('p(99)', 0) < 1000 else (create_metrics.get('p(99)', 0) if create_metrics else 0)
        
        bid_avg = (bid_metrics.get('avg', 0) * 1000) if bid_metrics and bid_metrics.get('avg', 0) < 1000 else (bid_metrics.get('avg', 0) if bid_metrics else 0)
        bid_p95 = (bid_metrics.get('p(95)', 0) * 1000) if bid_metrics and bid_metrics.get('p(95)', 0) < 1000 else (bid_metrics.get('p(95)', 0) if bid_metrics else 0)
        bid_p99 = (bid_metrics.get('p(99)', 0) * 1000) if bid_metrics and bid_metrics.get('p(99)', 0) < 1000 else (bid_metrics.get('p(99)', 0) if bid_metrics else 0)
        
        watchlist_avg = (watchlist_metrics.get('avg', 0) * 1000) if watchlist_metrics and watchlist_metrics.get('avg', 0) < 1000 else (watchlist_metrics.get('avg', 0) if watchlist_metrics else 0)
        watchlist_p95 = (watchlist_metrics.get('p(95)', 0) * 1000) if watchlist_metrics and watchlist_metrics.get('p(95)', 0) < 1000 else (watchlist_metrics.get('p(95)', 0) if watchlist_metrics else 0)
        watchlist_p99 = (watchlist_metrics.get('p(99)', 0) * 1000) if watchlist_metrics and watchlist_metrics.get('p(99)', 0) < 1000 else (watchlist_metrics.get('p(99)', 0) if watchlist_metrics else 0)
        
        return f"""
            <div class="metric-card">
                <div class="metric-label">Search Listings</div>
                <div class="metric-value">{search_avg:.2f}ms</div>
                <div style="font-size: 12px; color: #666; margin-top: 5px;">
                    P95: {search_p95:.2f}ms | P99: {search_p99:.2f}ms
                </div>
                <div style="font-size: 11px; color: {'#4CAF50' if search_success > 0.95 else '#ff9800'}; margin-top: 3px;">
                    Success: {search_success * 100:.1f}%
                </div>
            </div>
            <div class="metric-card">
                <div class="metric-label">Create Listing</div>
                <div class="metric-value">{create_avg:.2f}ms</div>
                <div style="font-size: 12px; color: #666; margin-top: 5px;">
                    P95: {create_p95:.2f}ms | P99: {create_p99:.2f}ms
                </div>
                <div style="font-size: 11px; color: {'#4CAF50' if create_success > 0.90 else '#ff9800'}; margin-top: 3px;">
                    Success: {create_success * 100:.1f}%
                </div>
            </div>
            <div class="metric-card">
                <div class="metric-label">Place Bid</div>
                <div class="metric-value">{bid_avg:.2f}ms</div>
                <div style="font-size: 12px; color: #666; margin-top: 5px;">
                    P95: {bid_p95:.2f}ms | P99: {bid_p99:.2f}ms
                </div>
                <div style="font-size: 11px; color: {'#4CAF50' if bid_success > 0.90 else '#ff9800'}; margin-top: 3px;">
                    Success: {bid_success * 100:.1f}%
                </div>
            </div>
            <div class="metric-card">
                <div class="metric-label">Watchlist Operations</div>
                <div class="metric-value">{watchlist_avg:.2f}ms</div>
                <div style="font-size: 12px; color: #666; margin-top: 5px;">
                    P95: {watchlist_p95:.2f}ms | P99: {watchlist_p99:.2f}ms
                </div>
                <div style="font-size: 11px; color: {'#4CAF50' if watchlist_success > 0.95 else '#ff9800'}; margin-top: 3px;">
                    Success: {watchlist_success * 100:.1f}%
                </div>
            </div>
        """
    elif 'Python AI Service Pipeline' in test_name:
        # Python AI Service Pipeline components
        analytics_avg = analytics_metrics.get('avg', analytics_metrics.get('p50', 0))
        analytics_p95 = analytics_metrics.get('p95', 0)
        analytics_p99 = analytics_metrics.get('p99', 0)
        
        ai_avg = ai_metrics.get('avg', ai_metrics.get('p50', 0))
        ai_p95 = ai_metrics.get('p95', 0)
        ai_p99 = ai_metrics.get('p99', 0)
        
        gateway_avg = gateway_metrics.get('avg', gateway_metrics.get('p50', 0))
        gateway_p95 = gateway_metrics.get('p95', 0)
        gateway_p99 = gateway_metrics.get('p99', 0)
        
        pipeline_avg = pipeline_metrics.get('avg', pipeline_metrics.get('p50', 0))
        pipeline_p95 = pipeline_metrics.get('p95', 0)
        pipeline_p99 = pipeline_metrics.get('p99', 0)
        
        return f"""
            <div class="metric-card">
                <div class="metric-label">Analytics → AI</div>
                <div class="metric-value">{analytics_avg:.2f}ms</div>
                <div style="font-size: 12px; color: #666; margin-top: 5px;">
                    P95: {analytics_p95:.2f}ms | P99: {analytics_p99:.2f}ms
                </div>
                <div style="font-size: 11px; color: {'#4CAF50' if analytics_success > 85 else '#ff9800'}; margin-top: 3px;">
                    Success: {analytics_success:.1f}%
                </div>
            </div>
            <div class="metric-card">
                <div class="metric-label">AI Advice</div>
                <div class="metric-value">{ai_avg:.2f}ms</div>
                <div style="font-size: 12px; color: #666; margin-top: 5px;">
                    P95: {ai_p95:.2f}ms | P99: {ai_p99:.2f}ms
                </div>
                <div style="font-size: 11px; color: {'#4CAF50' if ai_success > 90 else '#ff9800'}; margin-top: 3px;">
                    Success: {ai_success:.1f}%
                </div>
            </div>
            <div class="metric-card">
                <div class="metric-label">API Gateway</div>
                <div class="metric-value">{gateway_avg:.2f}ms</div>
                <div style="font-size: 12px; color: #666; margin-top: 5px;">
                    P95: {gateway_p95:.2f}ms | P99: {gateway_p99:.2f}ms
                </div>
            </div>
            <div class="metric-card">
                <div class="metric-label">Total Pipeline</div>
                <div class="metric-value">{pipeline_avg:.2f}ms</div>
                <div style="font-size: 12px; color: #666; margin-top: 5px;">
                    P95: {pipeline_p95:.2f}ms | P99: {pipeline_p99:.2f}ms
                </div>
            </div>
        """
    else:
        # Social Service components (default)
        return f"""
            <div class="metric-card">
                <div class="metric-label">Forum Post Creation</div>
                <div class="metric-value">{forum_post_metrics.get('avg', forum_post_metrics.get('med', 0)):.2f}ms</div>
                <div style="font-size: 12px; color: #666; margin-top: 5px;">
                    P95: {forum_post_metrics.get('p(95)', 0):.2f}ms | P99: {forum_post_metrics.get('p(99)', 0):.2f}ms
                </div>
                <div style="font-size: 11px; color: {'#4CAF50' if forum_post_success > 0.9 else '#ff9800'}; margin-top: 3px;">
                    Success: {forum_post_success * 100:.1f}%
                </div>
            </div>
            <div class="metric-card">
                <div class="metric-label">Comment Creation</div>
                <div class="metric-value">{comment_metrics.get('avg', comment_metrics.get('med', 0)):.2f}ms</div>
                <div style="font-size: 12px; color: #666; margin-top: 5px;">
                    P95: {comment_metrics.get('p(95)', 0):.2f}ms | P99: {comment_metrics.get('p(99)', 0):.2f}ms
                </div>
                <div style="font-size: 11px; color: {'#4CAF50' if comment_success > 0.9 else '#ff9800'}; margin-top: 3px;">
                    Success: {comment_success * 100:.1f}%
                </div>
            </div>
            <div class="metric-card">
                <div class="metric-label">Group Creation</div>
                <div class="metric-value">{group_metrics.get('avg', group_metrics.get('med', 0)):.2f}ms</div>
                <div style="font-size: 12px; color: #666; margin-top: 5px;">
                    P95: {group_metrics.get('p(95)', 0):.2f}ms | P99: {group_metrics.get('p(99)', 0):.2f}ms
                </div>
                <div style="font-size: 11px; color: {'#4CAF50' if group_success > 0.9 else '#ff9800'}; margin-top: 3px;">
                    Success: {group_success * 100:.1f}%
                </div>
            </div>
            <div class="metric-card">
                <div class="metric-label">P2P Messaging</div>
                <div class="metric-value">{p2p_message_metrics.get('avg', p2p_message_metrics.get('med', 0)):.2f}ms</div>
                <div style="font-size: 12px; color: #666; margin-top: 5px;">
                    P95: {p2p_message_metrics.get('p(95)', 0):.2f}ms | P99: {p2p_message_metrics.get('p(99)', 0):.2f}ms
                </div>
                <div style="font-size: 11px; color: {'#4CAF50' if kafka_success > 0.9 else '#ff9800'}; margin-top: 3px;">
                    Success: {(kafka_success * 100 if kafka_success > 0 else 0):.1f}%
                </div>
            </div>
        """

def generate_html_report(data, summary_file_path=None):
    """Generate HTML report with latency graphs"""
    
    # Initialize all component metrics to empty dicts/defaults
    forum_post_metrics = {}
    comment_metrics = {}
    group_metrics = {}
    p2p_message_metrics = {}
    forum_post_success = 0
    comment_success = 0
    group_success = 0
    kafka_success = 0
    analytics_metrics = {}
    ai_metrics = {}
    gateway_metrics = {}
    pipeline_metrics = {}
    analytics_success = 0
    ai_success = 0
    
    # Support both k6 raw format and our summary format
    if 'http_metrics' in data:
        # Our summary format (legacy text parsing format)
        http_metrics = data.get('http_metrics', {}).get('percentiles', {})
        # For legacy format, use http_metrics as base (no social-service specific metrics)
        # Extract Python AI Pipeline custom metrics from parsed data
        custom_metrics = data.get('custom_metrics', {})
        analytics_metrics = custom_metrics.get('analytics_to_ai', {})
        ai_metrics = custom_metrics.get('ai_advice', {})
        gateway_metrics = custom_metrics.get('gateway', {})
        pipeline_metrics = custom_metrics.get('pipeline_latency', {})
        
        # Get success rates from summary
        analytics_success_val = data.get('summary', {}).get('analytics_success_rate', '0%')
        analytics_success = float(analytics_success_val.rstrip('%')) if isinstance(analytics_success_val, str) else analytics_success_val
        ai_success_val = data.get('summary', {}).get('ai_success_rate', '0%')
        ai_success = float(ai_success_val.rstrip('%')) if isinstance(ai_success_val, str) else ai_success_val
        
        # Extract percentiles from our format
        # Build complete percentile dict from p1 to p99, then tail percentiles
        percentiles = {}
        
        # Extract p1 to p99
        for p in range(1, 100):
            key = f'p{p}'
            percentiles[key] = http_metrics.get(key, 0)
        
        # Extract tail percentiles
        tail_keys = ['p999', 'p9999', 'p99999', 'p999999', 'p9999999', 'p99999999']
        for key in tail_keys:
            percentiles[key] = http_metrics.get(key, 0)
        
        # p100 (max)
        percentiles['p100'] = http_metrics.get('p100', http_metrics.get('max', 0))
        
        # Ensure key percentiles are present (use median for p50 if missing)
        if percentiles.get('p50', 0) == 0:
            percentiles['p50'] = http_metrics.get('median', 0)
        http_avg = data.get('http_metrics', {}).get('avg', 0)
        http_min = data.get('http_metrics', {}).get('min', 0)
        http_max = data.get('http_metrics', {}).get('max', 0)
        http_median = data.get('http_metrics', {}).get('median', 0)
    else:
        # k6 raw format (summary JSON from --summary-export)
        # k6 summary format has metrics.http_req_duration.values for raw or percentiles for aggregated
        http_duration_metric = data.get('metrics', {}).get('http_req_duration', {})
        
        # Try percentiles first (summary format), then values (raw format)
        http_percentiles = http_duration_metric.get('percentiles', {})
        http_values = http_duration_metric.get('values', {})
        
        # Helper function to extract percentile from either percentiles or values dict
        # k6 outputs durations in microseconds, so we need to convert to milliseconds
        def get_percentile(p_key, default=0):
            value = 0
            if http_percentiles:
                value = http_percentiles.get(p_key, http_values.get(p_key, default))
            else:
                value = http_values.get(p_key, default)
            
            # Convert from microseconds to milliseconds if value is > 1000 (likely microseconds)
            # k6 outputs http_req_duration in microseconds
            if value > 1000:
                value = value / 1000
            return value
        
        # Extract ALL percentiles from p1 to p99, then p999, p9999, etc.
        # k6 may not output all percentiles, so we extract what's available
        percentiles = {}
        
        # Extract p1 to p99 (all integer percentiles)
        for p in range(1, 100):
            p_key = f'p({p})'
            value = get_percentile(p_key, 0)
            if value > 0 or p in [1, 5, 10, 25, 50, 75, 90, 95, 99]:  # Always include key percentiles
                percentiles[f'p{p}'] = value
        
        # Extract tail percentiles (p999, p9999, etc.)
        tail_percentiles = {
            'p999': 'p(99.9)',
            'p9999': 'p(99.99)',
            'p99999': 'p(99.999)',
            'p999999': 'p(99.9999)',
            'p9999999': 'p(99.99999)',
            'p99999999': 'p(99.999999)',
        }
        
        for key, p_key in tail_percentiles.items():
            value = get_percentile(p_key, 0)
            percentiles[key] = value
        
        # p100 (max) - convert from microseconds to milliseconds
        max_value = http_values.get('max', 0)
        if max_value > 1000:  # Likely in microseconds
            max_value = max_value / 1000
        percentiles['p100'] = get_percentile('p(100)', max_value)
        
        # Use calculate-percentiles.py to fill in missing percentiles if available
        # Note: os is already imported at module level, don't re-import
        script_dir = os.path.dirname(os.path.abspath(__file__))
        percentile_script = os.path.join(script_dir, 'calculate-percentiles.py')
        
        # If we have missing percentiles, try to calculate them
        missing_percentiles = [p for p in [1, 5, 10, 25, 50, 75, 90, 95, 99, 99.9, 99.99, 99.999, 99.9999, 99.99999, 99.999999, 100] 
                              if f'p{int(p) if p == int(p) else p}' not in percentiles or percentiles.get(f'p{int(p) if p == int(p) else p}', 0) == 0]
        
        if missing_percentiles and os.path.exists(percentile_script):
            try:
                # Save current data to temp file for percentile calculator
                with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as tmp:
                    json.dump(data, tmp)
                    tmp_path = tmp.name
                
                # Run percentile calculator
                result = subprocess.run(
                    ['python3', percentile_script, tmp_path],
                    capture_output=True,
                    text=True,
                    timeout=10
                )
                
                if result.returncode == 0:
                    calculated = json.loads(result.stdout)
                    # Merge calculated percentiles (they use keys like 'p1', 'p5', etc.)
                    for key, value in calculated.items():
                        if key.startswith('p') and (key not in percentiles or percentiles[key] == 0):
                            percentiles[key] = value
                
                # Cleanup
                os.unlink(tmp_path)
            except Exception as e:
                # Fallback to interpolation if calculation fails
                pass
        
        # Ensure we have at least the key percentiles even if k6 didn't output them
        # Use interpolation for missing values
        key_percentiles = [1, 5, 10, 25, 50, 75, 90, 95, 99]
        for p in key_percentiles:
            key = f'p{p}'
            if key not in percentiles or percentiles[key] == 0:
                # Try to interpolate from nearby percentiles
                # k6 http_req_duration is already in milliseconds, no conversion needed
                if p == 1:
                    min_val = http_values.get('min', 0)
                    if min_val > 1000:  # Convert from microseconds
                        min_val = min_val / 1000
                    percentiles[key] = min_val
                elif p == 50:
                    med_val = http_values.get('med', http_values.get('p(50)', 0))
                    if med_val > 1000:  # Convert from microseconds
                        med_val = med_val / 1000
                    percentiles[key] = med_val
                else:
                    # Linear interpolation from nearest known percentiles
                    known_below = max([k for k in percentiles.keys() if k.startswith('p') and k[1:].isdigit() and int(k[1:]) < p] + ['p0'], key=lambda x: int(x[1:]) if x[1:].isdigit() else 0)
                    known_above = min([k for k in percentiles.keys() if k.startswith('p') and k[1:].isdigit() and int(k[1:]) > p] + ['p100'], key=lambda x: int(x[1:]) if x[1:].isdigit() else 100)
                    if known_below != 'p0' and known_above != 'p100':
                        p_below = int(known_below[1:])
                        p_above = int(known_above[1:])
                        v_below = percentiles[known_below]
                        v_above = percentiles[known_above]
                        if p_above > p_below:
                            weight = (p - p_below) / (p_above - p_below)
                            percentiles[key] = v_below + (v_above - v_below) * weight
                    else:
                        percentiles[key] = 0
        
        # Convert from microseconds to milliseconds if needed
        http_avg = http_values.get('avg', 0)
        if http_avg > 1000:  # Likely in microseconds
            http_avg = http_avg / 1000
        
        http_min = http_values.get('min', 0)
        if http_min > 1000:  # Likely in microseconds
            http_min = http_min / 1000
        
        http_max = http_values.get('max', 0)
        if http_max > 1000:  # Likely in microseconds
            http_max = http_max / 1000
        
        http_median = http_values.get('med', 0)
        if http_median > 1000:  # Likely in microseconds
            http_median = http_median / 1000
        
        # Get test name to determine which components to show
        test_name = data.get('test_name', 'Service')
        if isinstance(test_name, dict):
            test_name = test_name.get('test_name', 'Service')
        
        # Auto-detect Listings Service Limit Test
        if 'listings' in str(test_name).lower() or 'listings-limit' in str(input_file).lower() if 'input_file' in locals() else False:
            test_name = 'Listings Service Limit Test'
        
        # Auto-detect Social Service if we have social-service specific metrics
        if (test_name == 'Service' and 
            (forum_post_metrics or comment_metrics or group_metrics or p2p_message_metrics)):
            test_name = 'Social Service'
        
        # For social-service specific metrics, get from custom metrics
        # These are Trend metrics that track latency for different features
        forum_post_metrics = data.get('metrics', {}).get('forum_post_creation_time', {}).get('values', {})
        comment_metrics = data.get('metrics', {}).get('comment_creation_time', {}).get('values', {})
        group_metrics = data.get('metrics', {}).get('group_creation_time', {}).get('values', {})
        p2p_message_metrics = data.get('metrics', {}).get('p2p_message_time', {}).get('values', {})
        
        # If p2p_message_time is empty, try to extract from http_req_duration with Message_P2P tag
        # Check if there are tagged metrics in http_req_duration
        if not p2p_message_metrics or p2p_message_metrics.get('avg', 0) == 0:
            # Try to get from tagged http_req_duration metrics
            http_duration_metric = data.get('metrics', {}).get('http_req_duration', {})
            # k6 may store tagged metrics separately, check for Message_P2P tag
            # This would be in a structure like: http_req_duration{name:Message_P2P}
            # But k6 summary format doesn't include tags in nested structure
            # So we'll parse from JSONL if available
            pass  # Will be handled below in JSONL parsing section
        
        # Also check for success rates
        forum_post_success = data.get('metrics', {}).get('forum_post_creation_success', {}).get('values', {}).get('rate', 0)
        comment_success = data.get('metrics', {}).get('comment_creation_success', {}).get('values', {}).get('rate', 0)
        group_success = data.get('metrics', {}).get('group_creation_success', {}).get('values', {}).get('rate', 0)
        kafka_success = data.get('metrics', {}).get('kafka_ingestion_success', {}).get('values', {}).get('rate', 0)
        p2p_message_success = data.get('metrics', {}).get('p2p_message_success', {}).get('values', {}).get('rate', 0)
        
        # For Python AI Service Pipeline, get custom metrics from our parsed format
        # First try from custom_metrics (parsed from text)
        custom_metrics = data.get('custom_metrics', {})
        analytics_metrics = custom_metrics.get('analytics_to_ai', {})
        ai_metrics = custom_metrics.get('ai_advice', {})
        gateway_metrics = custom_metrics.get('gateway', {})
        pipeline_metrics = custom_metrics.get('pipeline_latency', {})
        
        # Also try to get from k6 metrics format (if available)
        if not analytics_metrics or analytics_metrics.get('avg', 0) == 0:
            analytics_metrics = data.get('metrics', {}).get('analytics_to_ai_latency_ms', {}).get('values', {})
        if not ai_metrics or ai_metrics.get('avg', 0) == 0:
            ai_metrics = data.get('metrics', {}).get('ai_advice_latency_ms', {}).get('values', {})
        if not gateway_metrics or gateway_metrics.get('avg', 0) == 0:
            gateway_metrics = data.get('metrics', {}).get('gateway_latency_ms', {}).get('values', {})
        if not pipeline_metrics or pipeline_metrics.get('avg', 0) == 0:
            pipeline_metrics = data.get('metrics', {}).get('pipeline_latency_ms', {}).get('values', {})
        
        # Get success rates for Python AI Pipeline
        analytics_success_val = data.get('summary', {}).get('analytics_success_rate', '0%')
        analytics_success = float(analytics_success_val.rstrip('%')) if isinstance(analytics_success_val, str) else analytics_success_val
        ai_success_val = data.get('summary', {}).get('ai_success_rate', '0%')
        ai_success = float(ai_success_val.rstrip('%')) if isinstance(ai_success_val, str) else ai_success_val
    
    # Prepare data for Chart.js - ensure correct order
    # Order: p1, p5, p10, p25, p50, p75, p90, p95, p99, p999, p9999, p99999, p999999, p9999999, p99999999, p100
    ordered_labels = ['p1', 'p5', 'p10', 'p25', 'p50', 'p75', 'p90', 'p95', 'p99', 
                      'p999', 'p9999', 'p99999', 'p999999', 'p9999999', 'p99999999', 'p100']
    
    # Always include all labels, even if value is 0 (0.00ms means timeout/no data for that percentile)
    percentile_labels = ordered_labels
    percentile_values = [percentiles.get(p, 0) for p in ordered_labels]
    
    # Format values for display (show 0.00ms as valid data - represents timeouts)
    percentile_values_display = [f"{v:.2f}ms" for v in percentile_values]
    
    # Get summary values
    # Try multiple formats for total requests
    total_requests = data.get('summary', {}).get('total_requests', 0)
    if not total_requests:
        # k6 format: metrics.http_reqs.values.count
        http_reqs = data.get('metrics', {}).get('http_reqs', {})
        if isinstance(http_reqs, dict):
            total_requests = http_reqs.get('values', {}).get('count', 0) or http_reqs.get('count', 0)
        
        # If still 0, try to calculate from http_req_duration count or iterations
        if not total_requests:
            http_duration = data.get('metrics', {}).get('http_req_duration', {})
            if isinstance(http_duration, dict):
                # k6 summary might have count in different places
                total_requests = http_duration.get('values', {}).get('count', 0) or http_duration.get('count', 0)
        
        # If still 0, check iterations
        if not total_requests:
            iterations = data.get('metrics', {}).get('iterations', {})
            if isinstance(iterations, dict):
                total_requests = iterations.get('values', {}).get('count', 0) or iterations.get('count', 0)
        
        # If still 0, try to estimate from http_req_duration count (if available)
        # or use a default based on test duration (this is a fallback)
        if not total_requests:
            # Try to estimate from component metrics if available
            forum_posts = data.get('metrics', {}).get('forum_post_creation_success', {}).get('values', {}).get('count', 0)
            comments = data.get('metrics', {}).get('comment_creation_success', {}).get('values', {}).get('count', 0)
            if forum_posts or comments:
                # Rough estimate: each iteration makes multiple requests
                total_requests = max(forum_posts, comments) * 10  # Rough multiplier
    
    # Try multiple formats for test duration
    test_duration = data.get('summary', {}).get('test_duration', 0)
    if not test_duration:
        # k6 format: root_group.duration is in nanoseconds
        root_group = data.get('root_group', {})
        if root_group.get('duration'):
            test_duration = root_group['duration'] / 1000000000  # Convert nanoseconds to seconds
        # Alternative: state.testRunDurationMs
        elif data.get('state', {}).get('testRunDurationMs'):
            test_duration = data['state']['testRunDurationMs'] / 1000
    # Get error rate - try multiple formats
    error_rate = 0.0
    error_rate_str = data.get('summary', {}).get('error_rate', '0%')
    if error_rate_str and isinstance(error_rate_str, str):
        error_rate = float(error_rate_str.rstrip('%')) if error_rate_str else 0.0
    elif error_rate_str:
        error_rate = float(error_rate_str) * 100  # If it's a decimal (0.94 = 94%)
    
    # Also try from k6 format: metrics.http_req_failed.values.rate
    if error_rate == 0.0:
        http_req_failed = data.get('metrics', {}).get('http_req_failed', {})
        if isinstance(http_req_failed, dict):
            failed_values = http_req_failed.get('values', {})
            failed_rate = failed_values.get('rate', 0)
            if failed_rate:
                error_rate = float(failed_rate) * 100  # Convert decimal to percentage
    pipeline_success_str = data.get('summary', {}).get('pipeline_success_rate', '0%')
    pipeline_success = float(pipeline_success_str.rstrip('%')) if pipeline_success_str else 0.0
    
    # Get test name from data or use default
    test_name = data.get('test_name', 'Service')
    if isinstance(test_name, dict):
        test_name = test_name.get('test_name', 'Service')
    
    # Auto-detect Listings Service from test field or listings-specific metrics
    if test_name == 'Service':
        # Check test field in summary JSON
        test_field = data.get('test', '')
        if 'Listings Service' in test_field or 'listings' in test_field.lower():
            test_name = 'Listings Service'
        # Also check for listings-specific metrics
        search_metrics_check = data.get('metrics', {}).get('listings_search_latency_ms', {}).get('values', {})
        if search_metrics_check and search_metrics_check.get('avg', 0) > 0:
            test_name = 'Listings Service'
    
    # Auto-detect Social Service if we have social-service specific metrics
    forum_post_metrics = data.get('metrics', {}).get('forum_post_creation_time', {}).get('values', {})
    comment_metrics = data.get('metrics', {}).get('comment_creation_time', {}).get('values', {})
    group_metrics = data.get('metrics', {}).get('group_creation_time', {}).get('values', {})
    p2p_message_metrics = data.get('metrics', {}).get('p2p_message_time', {}).get('values', {})
    
    # Try to extract P2P metrics from JSONL if summary doesn't have them
    # Look for k6-results.json in the same directory as summary file
    if summary_file_path:
        summary_dir = os.path.dirname(os.path.abspath(summary_file_path))
    else:
        summary_dir = os.getcwd()
    results_jsonl = os.path.join(summary_dir, 'k6-results.json')
    if (not p2p_message_metrics or p2p_message_metrics.get('avg', 0) == 0) and os.path.exists(results_jsonl):
        try:
            import statistics
            p2p_times = []
            with open(results_jsonl, 'r') as f:
                for line in f:
                    try:
                        entry = json.loads(line.strip())
                        if entry.get('type') == 'Point' and entry.get('metric') == 'http_req_duration':
                            tags = entry.get('data', {}).get('tags', {})
                            # Check for Message_P2P tag
                            if tags.get('name') == 'Message_P2P':
                                value = entry.get('data', {}).get('value')
                                if value and value > 0:
                                    # Convert from seconds to milliseconds if needed
                                    if value < 1000:  # Likely already in ms
                                        p2p_times.append(value)
                                    else:  # Likely in seconds
                                        p2p_times.append(value * 1000)
                    except (json.JSONDecodeError, KeyError):
                        continue
            
            if p2p_times:
                p2p_message_metrics = {
                    'avg': statistics.mean(p2p_times),
                    'min': min(p2p_times),
                    'max': max(p2p_times),
                    'med': statistics.median(p2p_times),
                }
                if len(p2p_times) > 1:
                    sorted_times = sorted(p2p_times)
                    p2p_message_metrics['p(90)'] = sorted_times[int(len(sorted_times) * 0.90)]
                    p2p_message_metrics['p(95)'] = sorted_times[int(len(sorted_times) * 0.95)]
                    p2p_message_metrics['p(99)'] = sorted_times[int(len(sorted_times) * 0.99)]
        except Exception as e:
            # Silently fail - use empty metrics
            pass
    
    if (test_name == 'Service' and 
        (forum_post_metrics or comment_metrics or group_metrics or p2p_message_metrics)):
        test_name = 'Social Service'
    
    # Determine success rate label based on test type
    if 'Social Service' in test_name:
        success_label = 'Request Success'
        # Calculate overall success rate from HTTP requests
        http_reqs = data.get('metrics', {}).get('http_reqs', {})
        http_req_failed = data.get('metrics', {}).get('http_req_failed', {})
        if isinstance(http_reqs, dict) and isinstance(http_req_failed, dict):
            total_reqs = http_reqs.get('values', {}).get('count', 0) or http_reqs.get('count', 0)
            failed_reqs = http_req_failed.get('values', {}).get('count', 0) or http_req_failed.get('count', 0)
            if total_reqs > 0:
                pipeline_success = ((total_reqs - failed_reqs) / total_reqs) * 100
            else:
                pipeline_success = 100.0 - (error_rate if error_rate else 0.0)
        else:
            pipeline_success = 100.0 - (error_rate if error_rate else 0.0)
    else:
        success_label = 'Pipeline Success'
    
    html = f"""<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>{test_name} - Latency Analysis</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
    <style>
        body {{
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            margin: 0;
            padding: 20px;
            background: #f5f5f5;
        }}
        .container {{
            max-width: 1400px;
            margin: 0 auto;
            background: white;
            padding: 30px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }}
        h1 {{
            color: #333;
            border-bottom: 3px solid #4CAF50;
            padding-bottom: 10px;
        }}
        h2 {{
            color: #555;
            margin-top: 30px;
        }}
        .metrics-grid {{
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 20px;
            margin: 20px 0;
        }}
        .metric-card {{
            background: #f9f9f9;
            padding: 15px;
            border-radius: 6px;
            border-left: 4px solid #4CAF50;
        }}
        .metric-label {{
            font-size: 12px;
            color: #666;
            text-transform: uppercase;
            margin-bottom: 5px;
        }}
        .metric-value {{
            font-size: 24px;
            font-weight: bold;
            color: #333;
        }}
        .chart-container {{
            margin: 30px 0;
            position: relative;
            height: 400px;
        }}
        .percentile-table {{
            width: 100%;
            border-collapse: collapse;
            margin: 20px 0;
        }}
        .percentile-table th, .percentile-table td {{
            padding: 12px;
            text-align: left;
            border-bottom: 1px solid #ddd;
        }}
        .percentile-table th {{
            background: #4CAF50;
            color: white;
            font-weight: 600;
        }}
        .percentile-table tr:hover {{
            background: #f5f5f5;
        }}
        .success-rate {{
            color: #4CAF50;
            font-weight: bold;
        }}
        .warning {{
            color: #ff9800;
        }}
        .error {{
            color: #f44336;
        }}
    </style>
</head>
<body>
    <div class="container">
        <h1>{test_name if 'Limit Test' in test_name else test_name + ' Limit Test'} - Latency Analysis</h1>
        <p><strong>Test Date:</strong> {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}</p>
        
        <h2>Summary Metrics</h2>
        <div class="metrics-grid">
            <div class="metric-card">
                <div class="metric-label">Total Requests</div>
                <div class="metric-value">{total_requests:,}</div>
            </div>
            <div class="metric-card">
                <div class="metric-label">Test Duration</div>
                <div class="metric-value">{test_duration:.1f}s</div>
            </div>
            <div class="metric-card">
                <div class="metric-label">Error Rate</div>
                <div class="metric-value {'error' if error_rate > 5 else 'success-rate'}">
                    {error_rate:.2f}%
                </div>
            </div>
            <div class="metric-card">
                <div class="metric-label">{success_label}</div>
                <div class="metric-value {'success-rate' if pipeline_success > 90 else 'warning'}">
                    {pipeline_success:.1f}%
                </div>
            </div>
            <div class="metric-card">
                <div class="metric-label">Avg Latency</div>
                <div class="metric-value">{http_avg:.2f}ms</div>
            </div>
            <div class="metric-card">
                <div class="metric-label">P95 Latency</div>
                <div class="metric-value">{percentiles.get('p95', 0):.2f}ms</div>
            </div>
            <div class="metric-card">
                <div class="metric-label">P99 Latency</div>
                <div class="metric-value">{percentiles.get('p99', 0):.2f}ms</div>
            </div>
            <div class="metric-card">
                <div class="metric-label">Max Latency</div>
                <div class="metric-value">{http_max:.2f}ms</div>
            </div>
        </div>
        
        <h2>HTTP Request Latency Percentiles</h2>
        <div class="chart-container">
            <canvas id="latencyChart"></canvas>
        </div>
        
        <h2>Latency Distribution Histogram</h2>
        <div class="chart-container">
            <canvas id="histogramChart"></canvas>
        </div>
        
        <h2>Detailed Percentile Breakdown</h2>
        <table class="percentile-table">
            <thead>
                <tr>
                    <th>Percentile</th>
                    <th>Latency (ms)</th>
                    <th>Description</th>
                </tr>
            </thead>
            <tbody>
                <tr><td>p1 (1st)</td><td>{percentiles.get('p1', 0):.2f}ms</td><td>1% of requests faster than this</td></tr>
                <tr><td>p5 (5th)</td><td>{percentiles.get('p5', 0):.2f}ms</td><td>5% of requests faster than this</td></tr>
                <tr><td>p10 (10th)</td><td>{percentiles.get('p10', 0):.2f}ms</td><td>10% of requests faster than this</td></tr>
                <tr><td>p25 (25th)</td><td>{percentiles.get('p25', 0):.2f}ms</td><td>25% of requests faster than this</td></tr>
                <tr><td>p50 (median)</td><td>{percentiles.get('p50', 0):.2f}ms</td><td>50% of requests faster than this</td></tr>
                <tr><td>p75 (75th)</td><td>{percentiles.get('p75', 0):.2f}ms</td><td>75% of requests faster than this</td></tr>
                <tr><td>p90 (90th)</td><td>{percentiles.get('p90', 0):.2f}ms</td><td>90% of requests faster than this</td></tr>
                <tr><td>p95 (95th)</td><td>{percentiles.get('p95', 0):.2f}ms</td><td>95% of requests faster than this</td></tr>
                <tr><td>p99 (99th)</td><td>{percentiles.get('p99', 0):.2f}ms</td><td>99% of requests faster than this</td></tr>
                <tr><td>p99.9 (99.9th)</td><td>{percentiles.get('p999', 0):.2f}ms</td><td>99.9% of requests faster than this</td></tr>
                <tr><td>p99.99 (99.99th)</td><td>{percentiles.get('p9999', 0):.2f}ms</td><td>99.99% of requests faster than this</td></tr>
                <tr><td>p99.999 (99.999th)</td><td>{percentiles.get('p99999', 0):.2f}ms</td><td>99.999% of requests faster than this</td></tr>
                <tr><td>p99.9999 (99.9999th)</td><td>{percentiles.get('p999999', 0):.2f}ms</td><td>99.9999% of requests faster than this</td></tr>
                <tr><td>p99.99999 (99.99999th)</td><td>{percentiles.get('p9999999', 0):.2f}ms</td><td>99.99999% of requests faster than this</td></tr>
                <tr><td>p99.999999 (99.999999th)</td><td>{percentiles.get('p99999999', 0):.2f}ms</td><td>99.999999% of requests faster than this</td></tr>
                <tr><td>p100 (max)</td><td>{percentiles.get('p100', http_max):.2f}ms</td><td>Maximum observed latency</td></tr>
            </tbody>
        </table>
        
        <h2>Pipeline Component Latency Breakdown</h2>
        <div class="chart-container">
            <canvas id="componentChart"></canvas>
        </div>
        
        <h2>Component Breakdown</h2>
        <div class="metrics-grid">
            {_generate_component_cards_html(test_name, forum_post_metrics, comment_metrics, group_metrics, p2p_message_metrics, forum_post_success, comment_success, group_success, kafka_success, analytics_metrics, ai_metrics, gateway_metrics, pipeline_metrics, analytics_success, ai_success)}
        </div>
    </div>
    
    <script>
        // HTTP Latency Percentiles Chart
        const latencyCtx = document.getElementById('latencyChart').getContext('2d');
        new Chart(latencyCtx, {{
            type: 'line',
            data: {{
                labels: {json.dumps(percentile_labels)},
                datasets: [{{
                    label: 'Latency (ms)',
                    data: {json.dumps(percentile_values)},
                    borderColor: 'rgb(76, 175, 80)',
                    backgroundColor: 'rgba(76, 175, 80, 0.1)',
                    tension: 0.4,
                    fill: true
                }}]
            }},
            options: {{
                responsive: true,
                maintainAspectRatio: false,
                plugins: {{
                    title: {{
                        display: true,
                        text: 'HTTP Request Latency Percentiles (p1 to p100)',
                        font: {{ size: 16 }}
                    }},
                    legend: {{
                        display: false
                    }}
                }},
                scales: {{
                    y: {{
                        beginAtZero: true,
                        title: {{
                            display: true,
                            text: 'Latency (ms)'
                        }}
                    }},
                    x: {{
                        title: {{
                            display: true,
                            text: 'Percentile'
                        }}
                    }}
                }}
            }}
        }});
        
        // Latency Distribution Histogram
        // Create histogram bins from percentiles (approximate distribution)
        const histogramCtx = document.getElementById('histogramChart').getContext('2d');
        // Use percentiles to approximate distribution
        // Create bins: 0-100ms, 100-500ms, 500-1000ms, 1s-5s, 5s-10s, 10s-20s, 20s+
        const bins = [
            {{label: '0-100ms', max: 100}},
            {{label: '100-500ms', max: 500}},
            {{label: '500ms-1s', max: 1000}},
            {{label: '1s-5s', max: 5000}},
            {{label: '5s-10s', max: 10000}},
            {{label: '10s-20s', max: 20000}},
            {{label: '20s+', max: 999999}}
        ];
        
        // Calculate approximate counts for each bin based on percentiles
        // This is an approximation - for accurate histogram, we'd need raw data
        const percentileData = {json.dumps(percentiles)};
        const totalReqs = {total_requests};
        const binCounts = bins.map(bin => {{
            // Estimate count based on percentiles
            // Count requests in this bin range
            let count = 0;
            const binPercentiles = Object.keys(percentileData)
                .filter(k => k.startsWith('p') && k !== 'p100')
                .map(k => {{
                    const pNum = parseInt(k.substring(1).replace(/\\D/g, ''));
                    return {{percentile: pNum, value: percentileData[k] || 0}};
                }})
                .sort((a, b) => a.percentile - b.percentile);
            
            // Find percentiles that fall in this bin
            for (let i = 0; i < binPercentiles.length - 1; i++) {{
                const p1 = binPercentiles[i];
                const p2 = binPercentiles[i + 1];
                const val1 = p1.value;
                const val2 = p2.value;
                
                // If values are in this bin range, estimate count
                if (val1 <= bin.max && val2 <= bin.max) {{
                    count += (p2.percentile - p1.percentile) * totalReqs / 100;
                }} else if (val1 <= bin.max && val2 > bin.max) {{
                    // Partial overlap
                    const overlap = (bin.max - val1) / (val2 - val1);
                    count += (p2.percentile - p1.percentile) * overlap * totalReqs / 100;
                }}
            }}
            return Math.max(0, Math.round(count));
        }});
        
        new Chart(histogramCtx, {{
            type: 'bar',
            data: {{
                labels: bins.map(b => b.label),
                datasets: [{{
                    label: 'Request Count',
                    data: binCounts,
                    backgroundColor: 'rgba(33, 150, 243, 0.8)',
                    borderColor: 'rgba(33, 150, 243, 1)',
                    borderWidth: 1
                }}]
            }},
            options: {{
                responsive: true,
                maintainAspectRatio: false,
                plugins: {{
                    title: {{
                        display: true,
                        text: 'Latency Distribution (Approximate)',
                        font: {{ size: 16 }}
                    }},
                    legend: {{
                        display: false
                    }}
                }},
                scales: {{
                    y: {{
                        beginAtZero: true,
                        title: {{
                            display: true,
                            text: 'Request Count'
                        }}
                    }},
                    x: {{
                        title: {{
                            display: true,
                            text: 'Latency Range'
                        }}
                    }}
                }}
            }}
        }});
        
        // {test_name} Components Chart (Dynamic based on test type)
        const componentCtx = document.getElementById('componentChart').getContext('2d');
        let componentLabels, componentAvgData, componentP95Data, componentColors;
        
        if ('{test_name}' === 'Python AI Service Pipeline') {{
            componentLabels = ['Analytics → AI', 'AI Advice', 'API Gateway', 'Total Pipeline'];
            componentAvgData = [
                {analytics_metrics.get('avg', analytics_metrics.get('p50', 0)):.2f},
                {ai_metrics.get('avg', ai_metrics.get('p50', 0)):.2f},
                {gateway_metrics.get('avg', gateway_metrics.get('p50', 0)):.2f},
                {pipeline_metrics.get('avg', pipeline_metrics.get('p50', 0)):.2f}
            ];
            componentP95Data = [
                {analytics_metrics.get('p95', 0):.2f},
                {ai_metrics.get('p95', 0):.2f},
                {gateway_metrics.get('p95', 0):.2f},
                {pipeline_metrics.get('p95', 0):.2f}
            ];
            componentColors = [
                'rgba(33, 150, 243, 0.8)',
                'rgba(156, 39, 176, 0.8)',
                'rgba(255, 152, 0, 0.8)',
                'rgba(76, 175, 80, 0.8)'
            ];
        }} else {{
            componentLabels = ['Forum Posts', 'Comments', 'Groups', 'P2P Messages'];
            componentAvgData = [
                {forum_post_metrics.get('avg', forum_post_metrics.get('med', 0)):.2f},
                {comment_metrics.get('avg', comment_metrics.get('med', 0)):.2f},
                {group_metrics.get('avg', group_metrics.get('med', 0)):.2f},
                {p2p_message_metrics.get('avg', p2p_message_metrics.get('med', 0)):.2f}
            ];
            componentP95Data = [
                {forum_post_metrics.get('p(95)', 0):.2f},
                {comment_metrics.get('p(95)', 0):.2f},
                {group_metrics.get('p(95)', 0):.2f},
                {p2p_message_metrics.get('p(95)', 0):.2f}
            ];
            componentColors = [
                'rgba(33, 150, 243, 0.8)',
                'rgba(156, 39, 176, 0.8)',
                'rgba(255, 152, 0, 0.8)',
                'rgba(76, 175, 80, 0.8)'
            ];
        }}
        
        new Chart(componentCtx, {{
            type: 'bar',
            data: {{
                labels: componentLabels,
                datasets: [{{
                    label: 'Average Latency (ms)',
                    data: componentAvgData,
                    backgroundColor: componentColors
                }}, {{
                    label: 'P95 Latency (ms)',
                    data: componentP95Data,
                    backgroundColor: componentColors.map(c => c.replace('0.8', '0.5'))
                }}]
            }},
            options: {{
                responsive: true,
                maintainAspectRatio: false,
                plugins: {{
                    title: {{
                        display: true,
                        text: 'Component Latency Breakdown',
                        font: {{ size: 16 }}
                    }}
                }},
                scales: {{
                    y: {{
                        beginAtZero: true,
                        title: {{
                            display: true,
                            text: 'Latency (ms)'
                        }}
                    }}
                }}
            }}
        }});
    </script>
</body>
</html>
"""
    return html

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage: python3 generate-latency-graph.py <k6-output.txt or k6-summary.json> [output.html]")
        sys.exit(1)
    
    input_file = sys.argv[1]
    
    # Generate unique filename based on test suite if not provided
    if len(sys.argv) > 2:
        output_file = sys.argv[2]
    else:
        # Try to detect test suite from input file to generate unique filename
        try:
            with open(input_file, 'r', encoding='utf-8') as f:
                content = f.read()
            
            # Detect test suite - check for specific patterns
            test_suite = 'service'  # Default fallback
            
            # Check for Python AI Service Pipeline test (multiple patterns)
            if ('Python AI Service Pipeline' in content or 
                'python-ai-pipeline' in content.lower() or
                'python-ai-service' in content.lower() or
                'selling-advice' in content.lower() or
                'buying-advice' in content.lower() or
                'ai/selling-advice' in content.lower() or
                'ai/buying-advice' in content.lower()):
                test_suite = 'python-ai-pipeline'
            # Check for Social Service test
            elif ('Social Service' in content or 
                  ('social' in content.lower() and 'service' in content.lower() and 'python' not in content.lower())):
                test_suite = 'social-service'
            
            # Generate filename with timestamp
            from datetime import datetime
            timestamp = datetime.now().strftime('%Y%m%d-%H%M%S')
            output_file = f'latency-report-{test_suite}-{timestamp}.html'
        except:
            # Fallback to default
            output_file = 'latency-report.html'
    
    try:
        # Try to read as text first (k6 output)
        with open(input_file, 'r', encoding='utf-8') as f:
            content = f.read()
        
        # Check if it's JSON or text
        if content.strip().startswith('{'):
            # JSON format
            data = json.loads(content)
        else:
            # Text format - parse it
            data = parse_k6_output(content)
        
        # Try to load raw-data.json if available (from handleSummary)
        # This contains the full k6 metrics with all percentiles
        input_dir = os.path.dirname(os.path.abspath(input_file))
        raw_data_file = os.path.join(input_dir, 'raw-data.json')
        if os.path.exists(raw_data_file):
            try:
                with open(raw_data_file, 'r', encoding='utf-8') as f:
                    raw_data = json.loads(f.read())
                # Merge raw data percentiles into parsed data for better accuracy
                if 'metrics' in raw_data and 'http_req_duration' in raw_data['metrics']:
                    http_duration = raw_data['metrics']['http_req_duration']
                    http_values = http_duration.get('values', {})
                    http_percentiles = http_duration.get('percentiles', {})
                    
                    # Extract percentiles from k6 format (p(1), p(5), etc.)
                    def get_k6_percentile(p):
                        # k6 uses p(XX) format, values are in microseconds
                        key = f'p({p})'
                        value = http_percentiles.get(key, http_values.get(key, 0))
                        # Convert from microseconds to milliseconds
                        if value > 1000:
                            value = value / 1000
                        return value
                    
                    # Update percentiles in http_metrics
                    if 'http_metrics' not in data:
                        data['http_metrics'] = {'percentiles': {}}
                    if 'percentiles' not in data['http_metrics']:
                        data['http_metrics']['percentiles'] = {}
                    
                    # Extract all percentiles from k6 data
                    for p in [1, 5, 10, 25, 50, 75, 90, 95, 99, 99.9, 99.99, 99.999, 99.9999, 99.99999, 99.999999]:
                        value = get_k6_percentile(p)
                        if value > 0 or p in [1, 5, 10, 25, 50, 75, 90, 95, 99]:  # Always include key percentiles
                            if p == int(p):
                                data['http_metrics']['percentiles'][f'p{int(p)}'] = value
                            else:
                                p_key = str(p).replace('.', '')
                                data['http_metrics']['percentiles'][f'p{p_key}'] = value
                    
                    # p100 (max)
                    max_val = http_values.get('max', 0)
                    if max_val > 1000:
                        max_val = max_val / 1000
                    data['http_metrics']['percentiles']['p100'] = max_val
                    data['http_metrics']['max'] = max_val
                    
                    # avg, min, median
                    avg_val = http_values.get('avg', 0)
                    if avg_val > 1000:
                        avg_val = avg_val / 1000
                    data['http_metrics']['avg'] = avg_val
                    
                    min_val = http_values.get('min', 0)
                    if min_val > 1000:
                        min_val = min_val / 1000
                    data['http_metrics']['min'] = min_val
                    
                    med_val = http_values.get('med', http_values.get('p(50)', 0))
                    if med_val > 1000:
                        med_val = med_val / 1000
                    data['http_metrics']['median'] = med_val
                    if 'p50' not in data['http_metrics']['percentiles'] or data['http_metrics']['percentiles']['p50'] == 0:
                        data['http_metrics']['percentiles']['p50'] = med_val
            except Exception as e:
                print(f"⚠️  Warning: Could not load raw-data.json: {e}", file=sys.stderr)
        
        html = generate_html_report(data, input_file)
        
        with open(output_file, 'w', encoding='utf-8') as f:
            f.write(html)
        
        print(f"✅ Generated latency report: {output_file}")
        import os as os_module
        print(f"   Open in browser: file://{os_module.path.abspath(output_file)}")
    except Exception as e:
        print(f"❌ Error generating report: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        sys.exit(1)
