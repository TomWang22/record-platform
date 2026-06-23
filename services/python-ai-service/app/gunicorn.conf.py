import multiprocessing
import os

bind = f"0.0.0.0:{os.getenv('AI_PORT','5005')}"
# WEB_CONCURRENCY caps gunicorn workers to avoid OOM on dev clusters (Colima/k8s reports host CPU count).
_cpu_count = multiprocessing.cpu_count()
_web_concurrency = os.getenv("WEB_CONCURRENCY")
if _web_concurrency:
    workers = max(1, min(int(_web_concurrency), 8))
else:
    workers = min(max(2, _cpu_count), 4)
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
