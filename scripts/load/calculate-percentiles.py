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

def extract_values_from_k6_data(data: Dict[str, Any], metric_name: str) -> List[float]:
    """Extract raw values from k6 summary data"""
    metric = data.get('metrics', {}).get(metric_name, {})
    
    # k6 stores values in different places depending on metric type
    # For Trend metrics: values are in values dict
    # For Counter/Rate: values are in values.count or values.rate
    # For http_req_duration: values are in values dict with keys like p(50), avg, min, max
    
    values = metric.get('values', {})
    
    # If we have raw samples, use them
    if 'samples' in values:
        return [float(v) for v in values['samples']]
    
    # If we have percentiles, we can't reconstruct raw data, but we can use them
    # For now, return empty list - we'll need to collect raw data in k6 script
    return []

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage: python3 calculate-percentiles.py <k6-summary.json>")
        sys.exit(1)
    
    with open(sys.argv[1], 'r') as f:
        data = json.load(f)
    
    # Try to extract http_req_duration values
    http_duration = data.get('metrics', {}).get('http_req_duration', {})
    http_values = http_duration.get('values', {})
    
    # k6 doesn't store raw samples by default, but we can use available percentiles
    # For now, this is a placeholder - we'll need to modify k6 script to collect raw data
    print(json.dumps({}, indent=2))
