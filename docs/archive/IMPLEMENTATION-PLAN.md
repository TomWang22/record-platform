# Implementation Plan: Social Service Enhancement & Packet Capture Fixes

**Date:** 2026-01-31  
**Status:** In Progress

## Overview

This document outlines the implementation plan for enhancing the social service with Discord/Reddit/WhatsApp-like features and fixing packet capture verification in test suites.

## Completed ✅

### 1. HTTP/3 Support in K6
- **Status:** ✅ COMPLETE
- **Changes:**
  - Updated `infra/k8s/base/k6/Dockerfile` to use Go 1.23 and xk6-http3 extension
  - Built custom k6 image with HTTP/3 support
  - Verified k6 v0.50.0 with `github.com/record-platform/xk6-http3` extension
- **Impact:** K6 tests can now properly send HTTP/3 requests, enabling accurate packet capture verification

## In Progress 🚧

### 2. Packet Capture Fixes

#### 2.1 Rotation Suite HTTP/3 Capture
- **Issue:** No QUIC packets detected during rotation tests
- **Root Cause:** Timing issues and k6 not sending HTTP/3 requests
- **Solution:** 
  - ✅ Built k6 with HTTP/3 support
  - ⏳ Need to verify packet capture timing
  - ⏳ Add longer capture window after k6 test completes
  - ⏳ Add QUIC version detection

#### 2.2 HTTP/2 Protocol Verification
- **Issue:** Tests report "TCP 443 - likely HTTP/2" without definitive proof
- **Solution:**
  - Use tshark to detect HTTP/2 magic string (`PRI * HTTP/2.0`)
  - Check for HTTP/2 frames (SETTINGS, HEADERS, DATA)
  - Verify ALPN negotiation shows `h2`

#### 2.3 HTTP/3/QUIC Verification
- **Solution:**
  - Detect QUIC Initial packets (long header, version field)
  - Verify QUIC version (0x00000001 for QUIC v1)
  - Check for CRYPTO frames containing TLS handshake
  - Verify HTTP/3 SETTINGS frame

## Pending 📋

### 3. Social Service Enhancements

#### 3.1 Role Management System
**Features:**
- User roles: `admin`, `moderator`, `member`, `guest`
- Group/forum-specific roles
- Permission system

**Database Schema:**
```sql
-- Add to social service DB
CREATE TABLE IF NOT EXISTS roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(50) NOT NULL,
  permissions JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  role_id UUID REFERENCES roles(id),
  context_type VARCHAR(50), -- 'forum', 'group', 'global'
  context_id UUID, -- forum_id or group_id
  granted_by UUID,
  granted_at TIMESTAMP DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_user_roles_user ON user_roles(user_id);
CREATE INDEX idx_user_roles_context ON user_roles(context_type, context_id);
```

**API Endpoints:**
- `POST /api/social/roles` - Create role (admin only)
- `GET /api/social/roles` - List roles
- `POST /api/social/users/:userId/roles` - Assign role
- `DELETE /api/social/users/:userId/roles/:roleId` - Remove role
- `GET /api/social/users/:userId/roles` - Get user roles

#### 3.2 Admin/Moderator Actions

**Kick/Ban System:**
```sql
CREATE TABLE IF NOT EXISTS moderation_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action_type VARCHAR(50) NOT NULL, -- 'kick', 'ban', 'mute', 'warn'
  target_user_id UUID NOT NULL,
  moderator_id UUID NOT NULL,
  context_type VARCHAR(50), -- 'forum', 'group'
  context_id UUID,
  reason TEXT,
  expires_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS banned_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  context_type VARCHAR(50),
  context_id UUID,
  banned_by UUID NOT NULL,
  reason TEXT,
  expires_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, context_type, context_id)
);
```

**API Endpoints:**
- `POST /api/social/groups/:groupId/kick` - Kick user from group
- `POST /api/social/groups/:groupId/ban` - Ban user from group
- `POST /api/social/groups/:groupId/unban` - Unban user
- `POST /api/social/forum/posts/:postId/ban` - Ban user from forum
- `GET /api/social/moderation/actions` - List moderation actions (admin/mod only)

#### 3.3 Message Read Status

**Database Schema:**
```sql
CREATE TABLE IF NOT EXISTS message_read_status (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID REFERENCES messages(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  read_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(message_id, user_id)
);

-- Add to messages table
ALTER TABLE messages ADD COLUMN IF NOT EXISTS read_count INTEGER DEFAULT 0;

-- Indexes
CREATE INDEX idx_message_read_user ON message_read_status(user_id);
CREATE INDEX idx_message_read_message ON message_read_status(message_id);
```

**API Endpoints:**
- ✅ `POST /api/messages/:id/read` - Mark message as read (EXISTS)
- `POST /api/messages/read-batch` - Mark multiple messages as read
- `GET /api/messages/unread` - Get unread messages count
- `GET /api/messages/unread/list` - List unread messages

#### 3.4 Thread Context & Reply Chains

**Database Schema:**
```sql
-- Add to messages table
ALTER TABLE messages ADD COLUMN IF NOT EXISTS parent_message_id UUID REFERENCES messages(id);
ALTER TABLE messages ADD COLUMN IF NOT EXISTS thread_id UUID;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply_depth INTEGER DEFAULT 0;

-- Create index for thread queries
CREATE INDEX idx_messages_thread ON messages(thread_id);
CREATE INDEX idx_messages_parent ON messages(parent_message_id);
```

**API Endpoints:**
- ✅ `POST /api/messages/:id/reply` - Reply to message (EXISTS)
- ✅ `GET /api/messages/thread/:threadId` - Get thread (EXISTS)
- `GET /api/messages/:id/replies` - Get direct replies to message
- `GET /api/messages/:id/thread-context` - Get full thread context (parent + siblings + children)

### 4. Test Suite Enhancements

#### 4.1 Update Social Service Tests
**File:** `scripts/test-social-service-comprehensive.sh`

**New Tests:**
- Role assignment and permission checks
- Admin kick/ban operations
- Message read status tracking
- Thread context retrieval
- Moderator actions

#### 4.2 Protocol Verification Library
**File:** `scripts/lib/protocol-verification.sh`

```bash
# Verify HTTP/2 at wire level
verify_http2_protocol() {
  local pcap="$1"
  # Check for HTTP/2 magic string
  # Check for SETTINGS frame
  # Verify ALPN negotiation
}

# Verify HTTP/3/QUIC at wire level
verify_http3_protocol() {
  local pcap="$1"
  # Check for QUIC Initial packets
  # Verify QUIC version
  # Check for HTTP/3 SETTINGS frame
}
```

#### 4.3 Add Protocol Verification to All Suites
- `scripts/test-microservices-http2-http3.sh` (baseline)
- `scripts/test-microservices-http2-http3-enhanced.sh` (enhanced)
- `scripts/enhanced-adversarial-tests.sh` (adversarial)
- `scripts/rotation-suite.sh` (rotation) - IN PROGRESS

#### 4.4 Before/After Rotation Verification
- Capture packets before rotation
- Capture packets after rotation
- Compare protocol usage
- Verify no downgrade attacks

## Implementation Order

### Phase 1: Packet Capture Fixes (Priority: HIGH)
1. ✅ Build k6 with HTTP/3 support
2. Fix rotation suite packet capture timing
3. Add definitive HTTP/2 verification
4. Add HTTP/3/QUIC version detection
5. Add protocol verification to all test suites

### Phase 2: Social Service Core Features (Priority: HIGH)
1. Implement role management system
2. Add admin/moderator kick/ban functionality
3. Enhance message read status tracking
4. Improve thread context and reply chains

### Phase 3: Testing & Verification (Priority: MEDIUM)
1. Update social service test suite
2. Add comprehensive role/permission tests
3. Add moderation action tests
4. Verify all features work end-to-end

## Testing Strategy

### Unit Tests
- Role assignment logic
- Permission checking
- Ban/kick validation

### Integration Tests
- Full role management workflow
- Moderation actions with notifications
- Message read status across multiple users
- Thread context retrieval with deep nesting

### E2E Tests
- User journey: join group → get kicked → rejoin
- Admin journey: assign roles → ban user → unban
- Message journey: send → read → reply → thread context

## Success Criteria

### Packet Capture
- ✅ K6 sends HTTP/3 requests
- ⏳ HTTP/2 definitively verified (not just "likely")
- ⏳ HTTP/3/QUIC version detected in all tests
- ⏳ Rotation suite shows QUIC packets
- ⏳ All test suites have protocol verification

### Social Service
- ⏳ Role management fully functional
- ⏳ Admin can kick/ban users
- ⏳ Message read status tracked accurately
- ⏳ Thread context shows full conversation tree
- ⏳ All features tested comprehensively

## Notes

- Social service is inspired by Discord (roles, moderation), Reddit (forums, voting), and WhatsApp (messaging, groups)
- Packet capture must prove HTTP/2 and HTTP/3 at wire level, not just infer from TCP/UDP ports
- All database migrations should be backwards compatible
- API changes should maintain backwards compatibility where possible

## Next Steps

1. Fix rotation suite packet capture timing
2. Implement protocol verification library
3. Start social service database migrations
4. Implement role management API
5. Update test suites

---

**Last Updated:** 2026-01-31  
**Owner:** Tom  
**Reviewers:** N/A
