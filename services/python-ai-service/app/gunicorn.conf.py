import multiprocessing, os
bind = f"0.0.0.0:{os.getenv('AI_PORT','5005')}"
# Cap workers based on memory limits to prevent OOM
# With 4Gi memory limit, estimate ~100MB per worker + 200MB overhead = ~38 workers max
# But be conservative: use CPU-based calculation with a hard cap
cpu_count = multiprocessing.cpu_count()
# Formula: workers = CPU cores * 2 (for I/O-bound async work), but cap at 20 to prevent memory issues
# This prevents spawning too many workers under load
workers = min(max(4, cpu_count * 2), 30)  # Increased cap to 30 workers for higher concurrency
worker_class = "uvicorn.workers.UvicornWorker"
threads = 1
preload_app = True
# Increased timeout to 90s to handle slow analytics/external API calls
# With Redis singleflight, only one request computes, but external APIs can be slow
# Increased from 60s to 90s to reduce timeout errors under high load
timeout = 90
graceful_timeout = 10
keepalive = 5
accesslog = "-"
errorlog = "-"

# Enable HTTP/2 support (requires h2 library)
# Note: UvicornWorker supports HTTP/2 when h2 is installed
# For QUIC/HTTP/3, would need additional setup (not standard in Uvicorn)
# HTTP/2 provides multiplexing and better performance than HTTP/1.1
# HTTP/2 is enabled automatically when h2 is installed and client supports it
