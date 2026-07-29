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
        from app import ai_main
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
        from app import ai_main
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
        from app import ai_main
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
        from app import ai_main
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
        from app import ai_main
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

    async def AuctionHeat(self, request, context):
        """Platform intelligence: auction monitor - read heat of auction"""
        # Stub: compute simple heat from bid_count; full ML in data_pipeline
        bid_count = getattr(request, 'bid_count', 0) or 0
        heat = min(1.0, bid_count / 10.0) if bid_count else 0.0
        sentiment = 'high_urgency' if heat > 0.7 else 'lukewarm' if heat > 0.3 else 'cold'
        return python_ai_pb2.AuctionHeatResponse(
            heat_score=heat,
            sentiment=sentiment,
            recommendation=(
                'Monitor bidding; consider reserve adjustment.'
                if heat < 0.5
                else 'Active auction.'
            ),
            t_ms=0,
        )

    async def SellerBuyerInsight(self, request, context):
        """Platform intelligence: shopping/listings - seller and buyer insights"""
        return python_ai_pb2.SellerBuyerInsightResponse(
            suggested_price=getattr(request, 'asking_price', 0) or 0,
            demand_level='medium',
            recommendation='Check analytics for demand trends.',
            context={},
            t_ms=0,
        )

    async def SocialNegotiationInsight(self, request, context):
        """Platform intelligence: social - negotiation, planning, psychology"""
        return python_ai_pb2.SocialNegotiationInsightResponse(
            sentiment_analysis='neutral',
            negotiation_tips='Listen actively; clarify goals.',
            planning_suggestion='Break into steps; set deadlines.',
            psychology_notes={},
            t_ms=0,
        )

# Standard gRPC Health Service implementation
class HealthServicer:
    """Standard grpc.health.v1.Health service implementation"""
    
    async def Check(self, request, context):
        """Check health status"""
        # ServingStatus enum: UNKNOWN=0, SERVING=1, NOT_SERVING=2, SERVICE_UNKNOWN=3
        try:
            # Import health_pb2 dynamically if not already imported
            try:
                import health_pb2
            except ImportError:
                # Try to import from /app directory
                import sys
                sys.path.insert(0, '/app')
                import health_pb2
            
            # Create proper protobuf response message
            response = health_pb2.HealthCheckResponse()
            response.status = health_pb2.HealthCheckResponse.SERVING  # SERVING = 1
            return response
        except Exception as e:
            print(f"[python-ai-grpc] Health check failed: {e}")
            import traceback
            traceback.print_exc()
            # Return NOT_SERVING on error
            try:
                import health_pb2
            except ImportError:
                import sys
                sys.path.insert(0, '/app')
                import health_pb2
            response = health_pb2.HealthCheckResponse()
            response.status = health_pb2.HealthCheckResponse.NOT_SERVING  # NOT_SERVING = 2
            return response
    
    async def Watch(self, request, context):
        """Watch health status (streaming)"""
        # Simple implementation - send periodic health checks
        import asyncio
        try:
            # Import health_pb2
            try:
                import health_pb2
            except ImportError:
                import sys
                sys.path.insert(0, '/app')
                import health_pb2
            
            while True:
                await asyncio.sleep(5)
                response = health_pb2.HealthCheckResponse()
                response.status = health_pb2.HealthCheckResponse.SERVING
                await context.write(response)
        except Exception as e:
            context.abort(grpc.StatusCode.INTERNAL, f'Health watch failed: {str(e)}')

async def serve(port: int = 50060):
    """Start gRPC server"""
    if not PROTO_LOADED:
        print("[python-ai-grpc] Proto stubs not available, gRPC server disabled")
        return None

    from app.peer_auth import PeerAuthInterceptor

    server = grpc.aio.server(
        futures.ThreadPoolExecutor(max_workers=10),
        interceptors=[PeerAuthInterceptor()],
    )
    print("[python-ai-grpc] peer authorization interceptor enabled")
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
    
    key_path = os.getenv('TLS_KEY_PATH', '/etc/certs/tls.key')
    cert_path = os.getenv('TLS_CERT_PATH', '/etc/certs/tls.crt')
    ca_path = os.getenv('TLS_CA_PATH', os.getenv('GRPC_CA_CERT', '/etc/certs/ca.crt'))
    
    if os.path.exists(key_path) and os.path.exists(cert_path):
        with open(key_path, 'rb') as f:
            private_key = f.read()
        with open(cert_path, 'rb') as f:
            certificate_chain = f.read()
        
        if not os.path.exists(ca_path):
            print(f"[python-ai-grpc] FATAL: CA cert not found at {ca_path}", file=sys.stderr)
            sys.exit(1)
        
        with open(ca_path, 'rb') as f:
            root_certificates = f.read()
        
        server_credentials = grpc.ssl_server_credentials(
            [(private_key, certificate_chain)],
            root_certificates=root_certificates,
            require_client_auth=True
        )
        print("[python-ai-grpc] strict mTLS (client cert required)")
        server.add_secure_port(f'0.0.0.0:{port}', server_credentials)
        print(f"[python-ai-grpc] server listening on 0.0.0.0:{port} (TLS enabled, HTTP/2 only)")
    else:
        if os.getenv('NODE_ENV') == 'production':
            print(f"[python-ai-grpc] FATAL: TLS certs not found at {key_path}, {cert_path}", file=sys.stderr)
            sys.exit(1)
        print("[python-ai-grpc] TLS certs not found, starting insecure server (dev only)")
        server.add_insecure_port(f'0.0.0.0:{port}')
        print(f"[python-ai-grpc] server listening on 0.0.0.0:{port}")
    
    await server.start()
    return server

if __name__ == '__main__':
    port = int(os.getenv('GRPC_PORT', '50060'))
    server = serve(port)
    if server:
        import asyncio
        asyncio.get_event_loop().run_forever()
