# Platform-Wide Intelligence / Analytics Engine

**Design**: Analytics engine piped into Python AI for each service.  
**Protocol**: gRPC over strict TLS/mTLS; HTTP/2 and HTTP/3 for REST.  
**Tests**: Protocol-aware (tcpdump, tshark, netstat).

## Overview

Each service can call Python AI for AI-powered insights:

| Service           | Use Case                                   | RPC                          |
|-------------------|--------------------------------------------|------------------------------|
| Auction Monitor   | Read "heat" of auction (bidding, sentiment) | `AuctionHeat`                |
| Shopping / Listings | Seller and buyer intelligence            | `SellerBuyerInsight`         |
| Social            | Negotiation, planning, psychology          | `SocialNegotiationInsight`   |

## Proto: `proto/python-ai.proto`

- **AuctionHeat**: `auction_id`, `bid_count`, `current_bid` → `heat_score`, `sentiment`, `recommendation`
- **SellerBuyerInsight**: `service`, `role` (seller/buyer), `listing_id`, prices → `suggested_price`, `demand_level`, `recommendation`
- **SocialNegotiationInsight**: `user_id`, `thread_id`, `message_preview` → `sentiment_analysis`, `negotiation_tips`, `planning_suggestion`

## Implementation

- **Python AI**: Stub implementations in `services/python-ai-service/app/grpc_server.py`
- **Analytics pipeline**: Data from analytics DB / Kafka → Python AI
- **Services**: Call Python AI via gRPC (Envoy) or HTTP (api-gateway)

## Testing

- Strict TLS/mTLS for all RPCs
- Packet capture (tcpdump/tshark) to verify HTTP/2 and HTTP/3 at wire level
- Works after cert rotation
- Protocol-aware test suite (baseline → enhanced → rotation → standalone)
