# gRPC & HTTP/2/3 Implementation Status

## Services with gRPC Support

### ✅ Implemented Services
1. **auth-service** - Port 50051
2. **records-service** - Port 50051
3. **social-service** - Port 50056
4. **listings-service** - Port 50057 ⭐ **NEW**

### Service Details

#### auth-service
- **gRPC Port**: 50051
- **Proto**: `proto/auth.proto`
- **Service**: `auth.AuthService`
- **Methods**: `Authenticate`, `Register`, `ValidateToken`, `RefreshToken`, `HealthCheck`
- **Ingress Route**: `/auth.AuthService`

#### records-service
- **gRPC Port**: 50051
- **Proto**: `proto/records.proto`
- **Service**: `records.RecordsService`
- **Methods**: `SearchRecords`, `GetRecord`, `CreateRecord`, `UpdateRecord`, `DeleteRecord`, `HealthCheck`
- **Ingress Route**: `/records.RecordsService`

#### social-service
- **gRPC Port**: 50056
- **Proto**: `proto/social.proto`
- **Service**: `social.SocialService`
- **Methods**: 
  - Forum: `ListPosts`, `GetPost`, `CreatePost`, `UpdatePost`, `DeletePost`, `VotePost`, `ListComments`, `CreateComment`, `UpdateComment`, `DeleteComment`, `VoteComment`
  - Messaging: `ListMessages`, `GetMessage`, `SendMessage`, `ReplyMessage`, `UpdateMessage`, `DeleteMessage`, `GetThread`, `MarkMessageRead`
  - `HealthCheck`
- **Ingress Route**: `/social.SocialService`
- **Database**: Separate PostgreSQL on port 5434 (schemas: `forum`, `messages`)
- **Special Features**: Kafka integration for real-time messaging

#### listings-service ⭐ NEW
- **gRPC Port**: 50057
- **Proto**: `proto/listings.proto`
- **Service**: `listings.ListingsService`
- **Methods**: 
  - CRUD: `GetListing`, `ListMyListings`, `SearchListings`, `CreateListing`, `UpdateListing`, `DeleteListing`
  - Auctions: `PlaceBid`
  - Offers: `MakeOffer`
  - Watchlist: `AddToWatchlist`, `RemoveFromWatchlist`, `GetWatchlist`
  - `HealthCheck`
- **Ingress Route**: `/listings.ListingsService`
- **Database**: Separate PostgreSQL on port 5435 (schema: `listings`)
- **Special Features**: eBay-style listing types (fixed_price, auction, OBO, best_offer), image uploads, auction bidding

## Ingress Configuration

### gRPC Ingress (`infra/k8s/overlays/dev/ingress-grpc.yaml`)
```yaml
paths:
  - path: /records.RecordsService
    backend:
      service:
        name: records-service
        port: 50051
  - path: /auth.AuthService
    backend:
      service:
        name: auth-service
        port: 50051
  - path: /social.SocialService
    backend:
      service:
        name: social-service
        port: 50056
  - path: /listings.ListingsService  # ⭐ NEW
    backend:
      service:
        name: listings-service
        port: 50057
```

## API Gateway Integration

The API Gateway (`api-gateway`) uses gRPC clients to communicate with services:

```typescript
// services/api-gateway/src/server.ts
const authGrpcClient = createAuthClient("auth-service:50051");
const recordsGrpcClient = createRecordsClient("records-service:50051");
const socialGrpcClient = createSocialClient("social-service:50056");
const listingsGrpcClient = createListingsClient("listings-service:50057"); // ⭐ NEW
```

### HTTP REST → gRPC Mapping

#### auth-service
- `POST /api/auth/register` → `auth.AuthService/Register`
- `POST /api/auth/login` → `auth.AuthService/Authenticate`

#### records-service
- `GET /api/records` → `records.RecordsService/SearchRecords`
- `POST /api/records` → `records.RecordsService/CreateRecord`
- `GET /api/records/:id` → `records.RecordsService/GetRecord`
- `PUT /api/records/:id` → `records.RecordsService/UpdateRecord`
- `DELETE /api/records/:id` → `records.RecordsService/DeleteRecord`

#### social-service ⭐ NEW
- `GET /api/forum/posts` → `social.SocialService/ListPosts`
- `POST /api/forum/posts` → `social.SocialService/CreatePost`
- `GET /api/forum/posts/:postId` → `social.SocialService/GetPost`
- `POST /api/forum/posts/:postId/vote` → `social.SocialService/VotePost`
- `GET /api/forum/posts/:postId/comments` → `social.SocialService/ListComments`
- `POST /api/forum/posts/:postId/comments` → `social.SocialService/CreateComment`
- `GET /api/messages` → `social.SocialService/ListMessages`
- `POST /api/messages` → `social.SocialService/SendMessage`
- `POST /api/messages/:messageId/reply` → `social.SocialService/ReplyMessage`

## HTTP/2 & HTTP/3 Support

### Caddy Configuration
- Caddy 2.8 with strict TLS
- ALPN negotiation: `h2`, `h3`
- HTTP/2 and HTTP/3 enabled globally

### Testing
- **HTTP/2**: `curl --http2 https://record.local:8443/api/...`
- **HTTP/3**: `curl --http3-only https://record.local:8443/api/...`
- **gRPC**: Uses HTTP/2 automatically (ALPN `h2`)

## Testing Status

### ✅ Tested Services
- [x] auth-service (HTTP/2, HTTP/3, gRPC)
- [x] records-service (HTTP/2, HTTP/3, gRPC)

### ⚠️ Pending Tests
- [ ] **social-service** (HTTP/2, HTTP/3, gRPC)
  - Forum endpoints
  - Messaging endpoints
  - Kafka integration
  - Database connectivity (port 5434)
- [ ] **listings-service** (HTTP/2, HTTP/3, gRPC) ⭐ **NEW - NEEDS TESTING**
  - CRUD operations
  - Auction bidding
  - OBO/Best Offer
  - Watchlist management
  - Image uploads
  - Database connectivity (port 5435)

## Test Scripts

### Existing Scripts
- `scripts/test-microservices-http2-http3.sh` - **TODO**: Add social-service and listings-service tests
- `scripts/test-grpc-http2-http3-alpn.sh` - **TODO**: Add social-service and listings-service gRPC tests
- `scripts/test-http2-http3-strict-tls.sh` - Tests ingress (should work for all services)

### New Test Script Needed
- `scripts/test-social-service.sh` - Dedicated social-service testing

## Next Steps for Testing Agent

1. **Update test scripts** to include social-service and listings-service endpoints
2. **Test HTTP/2** for all service endpoints
3. **Test HTTP/3** for all service endpoints
4. **Test gRPC** direct calls:
   - social-service (port 50056)
   - listings-service (port 50057) ⭐ **NEW**
5. **Verify integrations**:
   - Kafka (social-service messages)
   - Database connectivity (social: port 5434, listings: port 5435)
   - Redis caching
6. **End-to-end tests**:
   - Forum and messaging flows (social-service)
   - Listing CRUD, auctions, OBO (listings-service) ⭐ **NEW**

See `docs/SOCIAL-SERVICE-TESTING.md` for social-service testing checklist.  
See `docs/LISTINGS-SERVICE-STATUS.md` for listings-service details.
