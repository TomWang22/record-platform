/**
 * k6 Messaging Service Limit Test - Progressive Load Test
 * 
 * Finds the upper limit of messaging-service by progressively increasing load:
 * - Tests all messaging-service features: Reddit-style posts, P2P messaging, group chat
 * - Progressive VU increase until degradation
 * - Monitors error rates, latency, throughput
 * - Identifies breaking points for each feature
 * 
 * Usage:
 *   k6 run --out json=results.json scripts/load/k6-social-limit-test.js
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// Custom metrics
const forumPostCreationRate = new Rate('forum_post_creation_success');
const forumVoteRate = new Rate('forum_vote_success');
const commentCreationRate = new Rate('comment_creation_success');
const groupCreationRate = new Rate('group_creation_success');
const p2pMessageRate = new Rate('p2p_message_success');
const groupMessageRate = new Rate('group_message_success');

const forumPostCreationTime = new Trend('forum_post_creation_time');
const commentCreationTime = new Trend('comment_creation_time');
const groupCreationTime = new Trend('group_creation_time');
const p2pMessageTime = new Trend('p2p_message_time');
const groupMessageTime = new Trend('group_message_time');

const totalForumPosts = new Counter('total_forum_posts');
const totalComments = new Counter('total_comments');
const totalGroups = new Counter('total_groups');
const totalP2PMessages = new Counter('total_p2p_messages');
const totalGroupMessages = new Counter('total_group_messages');

// Progressive stages to find limit
export const options = {
  stages: [
    { duration: '30s', target: 10 },    // Baseline
    { duration: '1m', target: 25 },     // Light load
    { duration: '1m', target: 50 },     // Moderate load
    { duration: '1m', target: 100 },    // High load
    { duration: '1m', target: 200 },    // Very high load
    { duration: '1m', target: 300 },    // Extreme load
    { duration: '1m', target: 400 },    // Near breaking point
    { duration: '1m', target: 500 },    // Breaking point test
    { duration: '2m', target: 500 },    // Hold at max to identify sustained bottlenecks
    { duration: '1m', target: 0 },      // Ramp down
  ],
  // Connection pooling to avoid ephemeral port exhaustion
  // k6 reuses connections by default, but we explicitly configure it
  httpReq: {
    // Enable connection reuse (default: true)
    // This prevents ephemeral port exhaustion by reusing TCP connections
    // Each VU will reuse connections instead of creating new ones
  },
  thresholds: {
    // Error rate thresholds - key bottleneck indicator
    'http_req_failed': [
      'rate<0.01',  // Excellent: < 1% errors
      'rate<0.05',  // Acceptable: < 5% errors
      'rate<0.10',  // Degraded: < 10% errors
    ],
    // Latency thresholds - identify performance degradation
    'http_req_duration': [
      'p(50)<500',   // Median should be < 500ms
      'p(75)<1000',  // 75th percentile < 1s
      'p(90)<2000',  // 90th percentile < 2s
      'p(95)<3000',  // 95th percentile < 3s (bottleneck threshold)
      'p(99)<5000',  // 99th percentile < 5s (severe bottleneck)
    ],
    // Feature-specific success rates
    'forum_post_creation_success': ['rate>0.90'],
    'forum_vote_success': ['rate>0.90'],
    'comment_creation_success': ['rate>0.90'],
    'group_creation_success': ['rate>0.90'],
    'p2p_message_success': ['rate>0.90'],
    'group_message_success': ['rate>0.90'],
  },
  setupTimeout: '120s',
};

// Test configuration
const BASE_URL = __ENV.BASE_URL || (__ENV.IN_CLUSTER === 'true' 
  ? 'https://record.local:443'
  : 'https://record.local:30443');
const API_HOST = __ENV.API_HOST || (__ENV.IN_CLUSTER === 'true' 
  ? 'record.local'
  : 'record.local');
const API_PREFIX = '/api';

// Helper function to get common request options
// IMPORTANT: Connection pooling/reuse to avoid ephemeral port exhaustion
function getReqOptions(token = null) {
  const headers = {
    'Content-Type': 'application/json',
    'Host': API_HOST,
    'X-Loadtest': '1',
    'Connection': 'keep-alive',  // Enable HTTP keep-alive for connection reuse
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return {
    headers: headers,
    params: {
      timeout: '30s',
      tags: { name: 'messaging-service' },
    },
  };
}

// User credentials
let userTokens = {};
let userIds = {};
let userCounter = 0;

// Helper: Register/Login user
function authenticateUser(vuId) {
  const email = `k6-limit-test-${vuId}-${Date.now()}@example.com`;
  const password = 'test123';

  // Try registration first
  const registerOpts = getReqOptions(null);
  registerOpts.tags = { name: 'Auth_Register' };
  let registerRes = http.post(
    `${BASE_URL}${API_PREFIX}/auth/register`,
    JSON.stringify({ email, password }),
    registerOpts
  );

  let token = null;
  if (registerRes.status === 201 || registerRes.status === 200) {
    const body = JSON.parse(registerRes.body);
    token = body.token || body.access_token;
    userIds[vuId] = body.user?.id || body.id;
  } else {
    // Try login
    const loginOpts = getReqOptions(null);
    loginOpts.tags = { name: 'Auth_Login' };
    const loginRes = http.post(
      `${BASE_URL}${API_PREFIX}/auth/login`,
      JSON.stringify({ email, password }),
      loginOpts
    );
    if (loginRes.status === 200) {
      const body = JSON.parse(loginRes.body);
      token = body.token || body.access_token;
      userIds[vuId] = body.user?.id || body.id;
    }
  }

  if (token) {
    userTokens[vuId] = token;
    return token;
  }
  return null;
}

// Helper: Create forum post (Reddit-style)
function createForumPost(token, title, content, flair = 'Discussion') {
  const opts = getReqOptions(token);
  opts.tags = { name: 'Forum_CreatePost' };
  
  const res = http.post(
    `${BASE_URL}${API_PREFIX}/forum/posts`,
    JSON.stringify({ title, content, flair, upload_type: 'text' }),
    opts
  );

  const success = check(res, {
    'post created (201)': (r) => r.status === 201,
    'post has id': (r) => {
      if (r.status === 201) {
        const body = JSON.parse(r.body);
        return body.id !== undefined;
      }
      return false;
    },
  });

  forumPostCreationRate.add(success);
  forumPostCreationTime.add(res.timings.duration);

  if (success) {
    totalForumPosts.add(1);
    const body = JSON.parse(res.body);
    return body;
  }
  return null;
}

// Helper: Vote on post
function voteOnPost(token, postId, voteType = 'upvote') {
  const opts = getReqOptions(token);
  opts.tags = { name: 'Forum_Vote' };
  
  const res = http.post(
    `${BASE_URL}${API_PREFIX}/forum/posts/${postId}/vote`,
    JSON.stringify({ vote: voteType }),
    opts
  );

  const success = check(res, {
    'vote successful (200)': (r) => r.status === 200,
  });

  forumVoteRate.add(success);
  return success;
}

// Helper: Create comment
function createComment(token, postId, content) {
  const opts = getReqOptions(token);
  opts.tags = { name: 'Forum_CreateComment' };
  
  const res = http.post(
    `${BASE_URL}${API_PREFIX}/forum/posts/${postId}/comments`,
    JSON.stringify({ content }),
    opts
  );

  const success = check(res, {
    'comment created (201)': (r) => r.status === 201,
  });

  commentCreationRate.add(success);
  commentCreationTime.add(res.timings.duration);

  if (success) {
    totalComments.add(1);
    return JSON.parse(res.body);
  }
  return null;
}

// Helper: Create group
function createGroup(token, name, description) {
  const opts = getReqOptions(token);
  opts.tags = { name: 'Group_Create' };
  
  const res = http.post(
    `${BASE_URL}${API_PREFIX}/messages/groups`,
    JSON.stringify({ name, description }),
    opts
  );

  const success = check(res, {
    'group created (201)': (r) => r.status === 201,
  });

  groupCreationRate.add(success);
  groupCreationTime.add(res.timings.duration);

  if (success) {
    totalGroups.add(1);
    return JSON.parse(res.body);
  }
  return null;
}

// Helper: Send P2P message
function sendP2PMessage(token, recipientId, content, subject = 'Test Message') {
  const opts = getReqOptions(token);
  opts.tags = { name: 'P2P_SendMessage' };
  
  const res = http.post(
    `${BASE_URL}${API_PREFIX}/messages`,
    JSON.stringify({
      recipient_id: recipientId,
      content,
      subject,
      message_type: 'General',
    }),
    opts
  );

  const success = check(res, {
    'message sent (201)': (r) => r.status === 201,
  });

  p2pMessageRate.add(success);
  p2pMessageTime.add(res.timings.duration);

  if (success) {
    totalP2PMessages.add(1);
    return JSON.parse(res.body);
  }
  return null;
}

// Helper: Send group message
function sendGroupMessage(token, groupId, content) {
  const opts = getReqOptions(token);
  opts.tags = { name: 'Group_SendMessage' };
  
  const res = http.post(
    `${BASE_URL}${API_PREFIX}/messages/groups/${groupId}/messages`,
    JSON.stringify({ content, message_type: 'General' }),
    opts
  );

  const success = check(res, {
    'group message sent (201)': (r) => r.status === 201,
  });

  groupMessageRate.add(success);
  groupMessageTime.add(res.timings.duration);

  if (success) {
    totalGroupMessages.add(1);
    return JSON.parse(res.body);
  }
  return null;
}

// Main test function
export default function () {
  const vuId = __VU;
  const token = authenticateUser(vuId);
  
  if (!token) {
    console.error(`[VU ${vuId}] Failed to authenticate`);
    return;
  }

  // Shared state for this VU
  let postIds = [];
  let groupIds = [];
  let otherUserIds = [];

  group('Messaging Service Limit Test', () => {
    // 1. Create forum post (Reddit-style)
    group('Forum Posts', () => {
      const title = `Limit Test Post ${vuId}-${Date.now()}`;
      const content = `This is a test post for limit testing. VU: ${vuId}`;
      const post = createForumPost(token, title, content, 'Discussion');
      if (post) {
        postIds.push(post.id);
        sleep(0.5);
        
        // Vote on the post
        voteOnPost(token, post.id, 'upvote');
        sleep(0.3);
        
        // Add comment
        const comment = createComment(token, post.id, `Comment from VU ${vuId}`);
        if (comment) {
          sleep(0.2);
        }
      }
    });

    // 2. P2P Messaging
    group('P2P Messages', () => {
      // Get list of messages to find other users
      const listOpts = getReqOptions(token);
      listOpts.tags = { name: 'Messages_List' };
      const listRes = http.get(`${BASE_URL}${API_PREFIX}/messages?limit=10`, listOpts);
      
      if (listRes.status === 200) {
        const body = JSON.parse(listRes.body);
        if (body.messages && body.messages.length > 0) {
          const msg = body.messages[0];
          const recipientId = msg.sender_id !== userIds[vuId] ? msg.sender_id : msg.recipient_id;
          if (recipientId) {
            sendP2PMessage(token, recipientId, `P2P message from VU ${vuId}`, 'Limit Test');
            sleep(0.4);
          }
        }
      }
    });

    // 3. Group Chat
    group('Group Chat', () => {
      // Create a group
      const group = createGroup(token, `Limit Test Group ${vuId}`, 'Test group for limit testing');
      if (group) {
        groupIds.push(group.id);
        sleep(0.5);
        
        // Send message to group
        sendGroupMessage(token, group.id, `Group message from VU ${vuId}`);
        sleep(0.3);
      }
    });
  });

  // Small random sleep to avoid thundering herd
  sleep(Math.random() * 2);
}

