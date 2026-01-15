#!/usr/bin/env python3
"""
Calculate percentiles from raw latency data
Used when k6 doesn't provide all percentiles
"""

import json
import sys
from typing import List, Dict, Any

def calculate_percentiles(values: List[float]) -> Dict[str, float]:
    """Calculate all percentiles from raw values"""
    if not values or len(values) == 0:
        return {}
    
    sorted_vals = sorted(values)
    n = len(sorted_vals)
    
    def percentile(p: float) -> float:
        """Calculate percentile value"""
        if p <= 0:
            return sorted_vals[0]
        if p >= 100:
            return sorted_vals[-1]
        index = (p / 100.0) * (n - 1)
        lower = int(index)
        upper = min(lower + 1, n - 1)
        weight = index - lower
        return sorted_vals[lower] * (1 - weight) + sorted_vals[upper] * weight
    
    return {
        'p1': percentile(1),
        'p5': percentile(5),
        'p10': percentile(10),
        'p25': percentile(25),
        'p50': percentile(50),
        'p75': percentile(75),
        'p90': percentile(90),
        'p95': percentile(95),
        'p99': percentile(99),
        'p999': percentile(99.9),
        'p9999': percentile(99.99),
        'p99999': percentile(99.999),
        'p999999': percentile(99.9999),
        'p9999999': percentile(99.99999),
        'p99999999': percentile(99.999999),
        'p100': sorted_vals[-1],
        'min': sorted_vals[0],
        'max': sorted_vals[-1],
        'avg': sum(sorted_vals) / n,
        'median': percentile(50),
    }

def extract_percentiles_from_k6(data: Dict[str, Any], metric_name: str) -> Dict[str, float]:
    """Extract percentiles from k6 JSON output format"""
    metric = data.get('metrics', {}).get(metric_name, {})
    
    # k6 stores percentiles in values dict with keys like 'p(50)', 'p(95)', etc.
    # Values are in microseconds, need to convert to milliseconds
    values = metric.get('values', {})
    percentiles = metric.get('percentiles', {})
    
    # Merge percentiles and values (percentiles take precedence)
    all_values = {**values, **percentiles}
    
    result = {}
    
    # Helper to get percentile value and convert to ms
    def get_percentile(p: float) -> float:
        key = f'p({p})'
        value = all_values.get(key, 0)
        # Convert from microseconds to milliseconds if > 1000
        if value > 1000:
            value = value / 1000
        return value
    
    # Extract all percentiles
    for p in [1, 5, 10, 25, 50, 75, 90, 95, 99, 99.9, 99.99, 99.999, 99.9999, 99.99999, 99.999999]:
        value = get_percentile(p)
        if p == int(p):
            result[f'p{int(p)}'] = value
        else:
            # Convert 99.9 -> p999, 99.99 -> p9999, etc.
            p_key = str(p).replace('.', '')
            result[f'p{p_key}'] = value
    
    # Add min, max, avg, med
    result['min'] = all_values.get('min', 0) / 1000 if all_values.get('min', 0) > 1000 else all_values.get('min', 0)
    result['max'] = all_values.get('max', 0) / 1000 if all_values.get('max', 0) > 1000 else all_values.get('max', 0)
    result['avg'] = all_values.get('avg', 0) / 1000 if all_values.get('avg', 0) > 1000 else all_values.get('avg', 0)
    result['med'] = all_values.get('med', 0) / 1000 if all_values.get('med', 0) > 1000 else all_values.get('med', 0)
    result['p100'] = result.get('max', 0)
    
    return result

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage: python3 calculate-percentiles.py <k6-summary.json>")
        sys.exit(1)
    
    with open(sys.argv[1], 'r') as f:
        data = json.load(f)
    
    print("=== Extended Percentile Analysis from k6 JSON ===")
    print("")
    
    # Analyze http_req_duration
    http_duration = data.get('metrics', {}).get('http_req_duration', {})
    if http_duration:
        print("=== HTTP Request Duration Percentiles ===")
        http_percentiles = extract_percentiles_from_k6(data, 'http_req_duration')
        for key in ['p1', 'p5', 'p10', 'p25', 'p50', 'p75', 'p90', 'p95', 'p99', 'p999', 'p9999', 'p99999', 'p999999', 'p9999999', 'p100', 'min', 'max', 'avg', 'med']:
            if key in http_percentiles:
                print(f"  {key:12s}: {http_percentiles[key]:10.2f} ms")
        print("")
    
    # Analyze service-specific latency metrics
    services = ['auth', 'records', 'listings', 'social', 'shopping', 'analytics', 'python_ai']
    print("=== Service-Specific Latency Percentiles ===")
    for service in services:
        metric_name = f'{service}_latency_ms'
        if metric_name in data.get('metrics', {}):
            print(f"\n{service}:")
            service_percentiles = extract_percentiles_from_k6(data, metric_name)
            for key in ['p50', 'p90', 'p95', 'p99', 'p999', 'p9999', 'p99999', 'p999999', 'p100', 'avg', 'min', 'max']:
                if key in service_percentiles:
                    print(f"    {key:12s}: {service_percentiles[key]:10.2f} ms")
