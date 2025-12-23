"""gRPC server for python-ai-service"""
import grpc
from concurrent import futures
import os
import sys
import importlib.util

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Don't import ai_main at module level to avoid Prometheus Counter duplication
# We'll import it lazily inside functions when needed

# Try to import generated proto stubs, fallback to dynamic loading
try:
    import python_ai_pb2
    import python_ai_pb2_grpc
    PROTO_LOADED = True
except ImportError:
    PROTO_LOADED = False
    print("[python-ai-grpc] Proto stubs not found, will use dynamic loading")

# Dynamic proto loading if stubs not available
if not PROTO_LOADED:
    try:
        import grpc_tools.protoc
        from grpc_tools import protoc
        import pkg_resources
        
        # Try to find proto file
        proto_paths = [
            '/app/proto/python-ai.proto',
            '/app/services/python-ai-service/proto/python-ai.proto',
            os.path.join(os.path.dirname(__file__), '../../../proto/python-ai.proto'),
        ]
        
        proto_file = None
        for path in proto_paths:
            if os.path.exists(path):
                proto_file = path
                break
        
        if not proto_file:
            raise FileNotFoundError(f"python-ai.proto not found in {proto_paths}")
        
        print(f"[python-ai-grpc] Loading proto from: {proto_file}")
        
        # For now, we'll use a simple implementation without generated stubs
        # In production, you'd generate stubs at build time
        python_ai_pb2 = None
        python_ai_pb2_grpc = None
    except Exception as e:
        print(f"[python-ai-grpc] Failed to load proto: {e}")
        python_ai_pb2 = None
        python_ai_pb2_grpc = None

class PythonAIServicer:
    """gRPC service implementation for Python AI Service"""
    
    async def HealthCheck(self, request, context):
        """Health check endpoint"""
        return python_ai_pb2.HealthCheckResponse(
            healthy=True,
            version='0.4.0'
        )
    
    async def PredictPrice(self, request, context):
        """Price prediction"""
        import ai_main
        items = []
        for item in request.items:
            items.append(ai_main.PredictItem(
                query=getattr(item, 'query', None),
                base_price=getattr(item, 'base_price', None),
                record_grade=getattr(item, 'record_grade', None),
                sleeve_grade=getattr(item, 'sleeve_grade', None),
                promo=getattr(item, 'promo', False),
                anniversary_boost=getattr(item, 'anniversary_boost', 0.0),
            ))
        
        predict_req = ai_main.PredictReq(items=items)
        result = await ai_main.app.post("/predict-price", json=predict_req.model_dump())
        
        return type('PredictPriceResponse', (), {
            'suggested': result.get('suggested', 0.0),
            'local_suggested': result.get('local_suggested', 0.0),
            'analytics_suggested': result.get('analytics_suggested'),
            'samples': result.get('samples', 0),
            'estimates': result.get('estimates', []),
            't_ms': result.get('t_ms', 0),
        })()
    
    async def GetPriceTrends(self, request, context):
        """Get price trends"""
        import ai_main
        result = await ai_main.app.get(f"/price-trends?q={request.query}")
        
        return type('GetPriceTrendsResponse', (), {
            'query': request.query,
            'count': result.get('count', 0),
            'low': result.get('ebay_price_summ', {}).get('low'),
            'p50': result.get('ebay_price_summ', {}).get('p50'),
            'high': result.get('ebay_price_summ', {}).get('high'),
            'discogs_titles': result.get('discogs_titles', []),
        })()
    
    async def GetRecommendations(self, request, context):
        """Get recommendations"""
        import ai_main
        recs = await ai_main.analytics_recommendations(request.query, request.user_id, request.limit)
        
        recommendations = []
        if recs and recs.get('recommendations'):
            for r in recs['recommendations']:
                recommendations.append(type('Recommendation', (), {
                    'query': r.get('query', ''),
                    'count': r.get('count', 0),
                    'similarity': r.get('similarity', 0.0),
                })())
        
        return type('GetRecommendationsResponse', (), {
            'query': request.query,
            'recommendations': recommendations,
            'source': recs.get('source', 'none') if recs else 'none',
        })()
    
    async def GetTrending(self, request, context):
        """Get trending items"""
        import ai_main
        trend = await ai_main.analytics_trending(request.days, request.limit)
        
        trending = []
        if trend and trend.get('trending'):
            for t in trend['trending']:
                trending.append(type('TrendingItem', (), {
                    'query': t.get('query', ''),
                    'count': t.get('count', 0),
                })())
        
        return type('GetTrendingResponse', (), {
            'days': request.days,
            'trending': trending,
            'source': trend.get('source', 'none') if trend else 'none',
        })()
    
    async def Chat(self, request, context):
        """Chatbot interface"""
        import ai_main
        # Use the existing chat endpoint logic
        chat_req = ai_main.ChatRequest(
            message=request.message,
            user_id=request.user_id,
            context=request.context if hasattr(request, 'context') else None,
        )
        
        result = await ai_main.app.post("/chat", json=chat_req.model_dump())
        
        return type('ChatResponse', (), {
            'message': result.get('message', ''),
            'response': result.get('response', ''),
            'analytics_context': result.get('analytics_context', {}),
            'timestamp': result.get('timestamp', 0),
        })()

# Standard gRPC Health Service implementation
class HealthServicer:
    """Standard grpc.health.v1.Health service implementation"""
    
    async def Check(self, request, context):
        """Check health status"""
        # ServingStatus enum: UNKNOWN=0, SERVING=1, NOT_SERVING=2, SERVICE_UNKNOWN=3
        try:
            # Simple health check - service is healthy if we can respond
            return type('HealthCheckResponse', (), {
                'status': 1,  # SERVING
                'message': 'Service is healthy'
            })()
        except Exception as e:
            print(f"[python-ai-grpc] Health check failed: {e}")
            return type('HealthCheckResponse', (), {
                'status': 2,  # NOT_SERVING
                'message': f'Service unhealthy: {str(e)}'
            })()
    
    async def Watch(self, request, context):
        """Watch health status (streaming)"""
        # Simple implementation - send periodic health checks
        import asyncio
        try:
            while True:
                await asyncio.sleep(5)
                response = type('HealthCheckResponse', (), {
                    'status': 1,  # SERVING
                    'message': 'Service is healthy'
                })()
                await context.write(response)
        except Exception as e:
            context.abort(grpc.StatusCode.INTERNAL, f'Health watch failed: {str(e)}')

async def serve(port: int = 50060):
    """Start gRPC server"""
    if not PROTO_LOADED:
        print("[python-ai-grpc] Proto stubs not available, gRPC server disabled")
        return None
    
    server = grpc.aio.server(futures.ThreadPoolExecutor(max_workers=10))
    # Find the correct function name dynamically
    add_func = None
    for attr_name in dir(python_ai_pb2_grpc):
        if 'add' in attr_name.lower() and 'servicer' in attr_name.lower() and 'to_server' in attr_name.lower():
            add_func = getattr(python_ai_pb2_grpc, attr_name)
            break
    if add_func:
        add_func(PythonAIServicer(), server)
    else:
        raise AttributeError("Could not find add_*Servicer_to_server function in python_ai_pb2_grpc")
    
    # Register standard gRPC Health Service (grpc.health.v1.Health)
    # Load health.proto dynamically
    try:
        health_proto_path = '/app/proto/health.proto'
        if not os.path.exists(health_proto_path):
            # Try alternative paths
            for alt_path in ['/app/services/python-ai-service/proto/health.proto',
                           os.path.join(os.path.dirname(__file__), '../../../proto/health.proto')]:
                if os.path.exists(alt_path):
                    health_proto_path = alt_path
                    break
        
        if os.path.exists(health_proto_path):
            # Generate health proto stubs on the fly
            import subprocess
            import tempfile
            temp_dir = tempfile.mkdtemp()
            try:
                subprocess.run([
                    'python', '-m', 'grpc_tools.protoc',
                    f'--proto_path={os.path.dirname(health_proto_path)}',
                    f'--python_out={temp_dir}',
                    f'--grpc_python_out={temp_dir}',
                    health_proto_path
                ], check=True, capture_output=True)
                
                # Import generated health stubs
                sys.path.insert(0, temp_dir)
                import health_pb2
                import health_pb2_grpc
                
                # Register health service
                health_pb2_grpc.add_HealthServicer_to_server(HealthServicer(), server)
                print("[python-ai-grpc] Standard gRPC Health Service (grpc.health.v1.Health) registered")
            except Exception as e:
                print(f"[python-ai-grpc] Failed to register health service: {e}")
                # Continue without health service
        else:
            print(f"[python-ai-grpc] health.proto not found at {health_proto_path}, skipping standard health service")
    except Exception as e:
        print(f"[python-ai-grpc] Error setting up health service: {e}")
        # Continue without health service
    
    # Try to load TLS certs (for production with ALPN = h2)
    key_path = os.getenv('TLS_KEY_PATH', '/etc/certs/tls.key')
    cert_path = os.getenv('TLS_CERT_PATH', '/etc/certs/tls.crt')
    ca_path = os.getenv('TLS_CA_PATH', os.getenv('GRPC_CA_CERT', '/etc/certs/ca.crt'))
    
    if os.path.exists(key_path) and os.path.exists(cert_path):
        # Read certificate files
        with open(key_path, 'rb') as f:
            private_key = f.read()
        with open(cert_path, 'rb') as f:
            certificate_chain = f.read()
        
        # For strict TLS: verify client certificates if CA cert exists
        root_certificates = None
        require_client_auth = False
        if os.path.exists(ca_path):
            with open(ca_path, 'rb') as f:
                root_certificates = f.read()
            require_client_auth = True
            print("[python-ai-grpc] Starting secure HTTP/2-only server with strict TLS (client cert verification)")
        else:
            print("[python-ai-grpc] Starting secure HTTP/2-only server with ALPN = h2 (no client cert verification)")
        
        # Create server credentials
        server_credentials = grpc.ssl_server_credentials(
            [(private_key, certificate_chain)],
            root_certificates=root_certificates,
            require_client_auth=require_client_auth
        )
        server.add_secure_port(f'[::]:{port}', server_credentials)
        print(f"[python-ai-grpc] server listening on {port} (TLS enabled, HTTP/2 only)")
    else:
        print("[python-ai-grpc] TLS certs not found, starting insecure server (dev only)")
        server.add_insecure_port(f'[::]:{port}')
        print(f"[python-ai-grpc] server listening on {port}")
    
    await server.start()
    return server

if __name__ == '__main__':
    port = int(os.getenv('GRPC_PORT', '50060'))
    server = serve(port)
    if server:
        import asyncio
        asyncio.get_event_loop().run_forever()
