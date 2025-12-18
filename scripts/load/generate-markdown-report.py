#!/usr/bin/env python3
"""
Generate markdown report from k6 test results
Creates comprehensive markdown documentation with metrics
"""

import json
import sys
from datetime import datetime

def generate_markdown_report(data, output_file):
    """Generate markdown report from k6 summary JSON"""
    
    # Extract metrics safely
    metrics = data.get('metrics', {})
    http_duration = metrics.get('http_req_duration', {}).get('values', {}) or metrics.get('http_req_duration', {}).get('percentiles', {})
    http_reqs = metrics.get('http_reqs', {}).get('values', {})
    http_failed = metrics.get('http_req_failed', {}).get('values', {})
    
    # Extract percentiles
    def get_percentile(p):
        key = f'p({p})'
        return http_duration.get(key, http_duration.get(f'p{p}', 0))
    
    percentiles = {
        'p1': get_percentile(1),
        'p5': get_percentile(5),
        'p10': get_percentile(10),
        'p25': get_percentile(25),
        'p50': get_percentile(50),
        'p75': get_percentile(75),
        'p90': get_percentile(90),
        'p95': get_percentile(95),
        'p99': get_percentile(99),
        'p999': get_percentile(99.9),
        'p9999': get_percentile(99.99),
        'p99999': get_percentile(99.999),
        'p999999': get_percentile(99.9999),
        'p9999999': get_percentile(99.99999),
        'p99999999': get_percentile(99.999999),
        'p100': http_duration.get('max', 0)
    }
    
    # Extract custom metrics
    search_latency = metrics.get('listings_search_latency_ms', {}).get('values', {})
    create_latency = metrics.get('listings_create_latency_ms', {}).get('values', {})
    bid_latency = metrics.get('listings_bid_latency_ms', {}).get('values', {})
    watchlist_latency = metrics.get('listings_watchlist_latency_ms', {}).get('values', {})
    
    # Extract summary
    total_requests = http_reqs.get('count', 0)
    error_rate = http_failed.get('rate', 0) * 100
    success_rate = (1 - http_failed.get('rate', 0)) * 100
    avg_latency = http_duration.get('avg', 0)
    min_latency = http_duration.get('min', 0)
    max_latency = http_duration.get('max', 0)
    median_latency = http_duration.get('med', percentiles['p50'])
    
    # Test duration
    test_duration = data.get('state', {}).get('testRunDurationMs', 0) / 1000
    
    # Generate markdown
    md = f"""# Listings Service - Load Test Report

**Test Date:** {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}

## Executive Summary

| Metric | Value |
|--------|-------|
| **Total Requests** | {total_requests:,} |
| **Test Duration** | {test_duration:.1f}s |
| **Success Rate** | {success_rate:.2f}% |
| **Error Rate** | {error_rate:.2f}% |
| **Average Latency** | {avg_latency:.2f}ms |
| **Median Latency** | {median_latency:.2f}ms |
| **Min Latency** | {min_latency:.2f}ms |
| **Max Latency** | {max_latency:.2f}ms |

## HTTP Request Latency Percentiles

| Percentile | Latency (ms) | Description |
|------------|--------------|-------------|
| **p1 (1st)** | {percentiles['p1']:.2f} | 1% of requests faster than this |
| **p5 (5th)** | {percentiles['p5']:.2f} | 5% of requests faster than this |
| **p10 (10th)** | {percentiles['p10']:.2f} | 10% of requests faster than this |
| **p25 (25th)** | {percentiles['p25']:.2f} | 25% of requests faster than this |
| **p50 (median)** | {percentiles['p50']:.2f} | 50% of requests faster than this |
| **p75 (75th)** | {percentiles['p75']:.2f} | 75% of requests faster than this |
| **p90 (90th)** | {percentiles['p90']:.2f} | 90% of requests faster than this |
| **p95 (95th)** | {percentiles['p95']:.2f} | 95% of requests faster than this |
| **p99 (99th)** | {percentiles['p99']:.2f} | 99% of requests faster than this |
| **p99.9 (99.9th)** | {percentiles['p999']:.2f} | 99.9% of requests faster than this |
| **p99.99 (99.99th)** | {percentiles['p9999']:.2f} | 99.99% of requests faster than this |
| **p99.999 (99.999th)** | {percentiles['p99999']:.2f} | 99.999% of requests faster than this |
| **p99.9999 (99.9999th)** | {percentiles['p999999']:.2f} | 99.9999% of requests faster than this |
| **p99.99999 (99.99999th)** | {percentiles['p9999999']:.2f} | 99.99999% of requests faster than this |
| **p99.999999 (99.999999th)** | {percentiles['p99999999']:.2f} | 99.999999% of requests faster than this |
| **p100 (max)** | {percentiles['p100']:.2f} | Maximum observed latency |

## Component Breakdown

### Search Listings
- **Average Latency:** {search_latency.get('avg', 0):.2f}ms
- **P95 Latency:** {search_latency.get('p(95)', search_latency.get('p95', 0)):.2f}ms
- **P99 Latency:** {search_latency.get('p(99)', search_latency.get('p99', 0)):.2f}ms

### Create Listing
- **Average Latency:** {create_latency.get('avg', 0):.2f}ms
- **P95 Latency:** {create_latency.get('p(95)', create_latency.get('p95', 0)):.2f}ms
- **P99 Latency:** {create_latency.get('p(99)', create_latency.get('p99', 0)):.2f}ms

### Place Bid
- **Average Latency:** {bid_latency.get('avg', 0):.2f}ms
- **P95 Latency:** {bid_latency.get('p(95)', bid_latency.get('p95', 0)):.2f}ms
- **P99 Latency:** {bid_latency.get('p(99)', bid_latency.get('p99', 0)):.2f}ms

### Watchlist Operations
- **Average Latency:** {watchlist_latency.get('avg', 0):.2f}ms
- **P95 Latency:** {watchlist_latency.get('p(95)', watchlist_latency.get('p95', 0)):.2f}ms
- **P99 Latency:** {watchlist_latency.get('p(99)', watchlist_latency.get('p99', 0)):.2f}ms

## Throughput Metrics

| Operation | Count |
|-----------|-------|
| Total Searches | {metrics.get('total_listings_searches', {}).get('values', {}).get('count', 0)} |
| Total Listings Created | {metrics.get('total_listings_created', {}).get('values', {}).get('count', 0)} |
| Total Bids | {metrics.get('total_bids', {}).get('values', {}).get('count', 0)} |
| Total Offers | {metrics.get('total_offers', {}).get('values', {}).get('count', 0)} |
| Total Watchlist Adds | {metrics.get('total_watchlist_adds', {}).get('values', {}).get('count', 0)} |
| Total Ratings | {metrics.get('total_ratings', {}).get('values', {}).get('count', 0)} |

## Test Configuration

- **TLS:** Strict TLS (CA certificate verified)
- **Protocol:** HTTP/2 and HTTP/3 (QUIC) via ALPN negotiation
- **Test Type:** Comprehensive load test
- **Service:** Listings Service

## Notes

- All latency values are in milliseconds (ms)
- Percentiles are calculated from actual request latencies
- Error rate includes all HTTP errors (4xx, 5xx)
- Success rate = 100% - Error rate

---

*Report generated automatically from k6 test results*
"""
    
    with open(output_file, 'w') as f:
        f.write(md)
    
    print(f"✅ Generated markdown report: {output_file}")

if __name__ == '__main__':
    if len(sys.argv) < 3:
        print("Usage: generate-markdown-report.py <k6-summary.json> <output.md>")
        sys.exit(1)
    
    input_file = sys.argv[1]
    output_file = sys.argv[2]
    
    try:
        with open(input_file, 'r') as f:
            content = f.read().strip()
            if not content:
                print(f"⚠️  Warning: {input_file} is empty, skipping markdown report generation")
                sys.exit(0)
            data = json.loads(content)
    except json.JSONDecodeError as e:
        print(f"❌ Error: Invalid JSON in {input_file}: {e}", file=sys.stderr)
        sys.exit(1)
    except FileNotFoundError:
        print(f"❌ Error: File not found: {input_file}", file=sys.stderr)
        sys.exit(1)
    
    generate_markdown_report(data, output_file)

