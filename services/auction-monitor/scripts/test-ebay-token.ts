/**
 * Test eBay Token Validity
 * 
 * Tests if the eBay OAuth token is valid and can make API calls
 */

import { eBayAdapter } from '../src/platforms/ebay/adapter.js';
import 'dotenv/config';

async function testEBayToken() {
  const token = process.env.EBAY_OAUTH_TOKEN || process.env.EBAY_AUTH_TOKEN;
  
  console.log('\n🔍 eBay Token Test\n');
  console.log('Token present:', token ? '✅ Yes' : '❌ No');
  
  if (!token) {
    console.error('\n❌ ERROR: EBAY_OAUTH_TOKEN or EBAY_AUTH_TOKEN not found in .env');
    console.log('\nTo get a token:');
    console.log('1. Go to: https://developer.ebay.com/my/keys');
    console.log('2. Click "Get a User Token Here"');
    console.log('3. Sign in and grant permissions');
    console.log('4. Copy the token (starts with v^1.1#)');
    console.log('5. Add to .env: EBAY_OAUTH_TOKEN="your_token_here"');
    process.exit(1);
  }
  
  console.log('Token length:', token.length);
  console.log('Token format:', token.startsWith('v^1.1#') ? '✅ eBay User Token format' : '⚠️  Unexpected format');
  console.log('Token preview:', token.substring(0, 50) + '...');
  
  const appId = process.env.EBAY_APP_ID;
  if (!appId) {
    console.error('\n❌ ERROR: EBAY_APP_ID not found in .env');
    console.log('\nYou need both:');
    console.log('  - EBAY_APP_ID (your App ID/Client ID)');
    console.log('  - EBAY_OAUTH_TOKEN (your User Token)');
    console.log('\nYour App ID should be: DailinWa-recordpl-PRD-672dab605-b3c26e79');
    process.exit(1);
  }
  
  console.log('App ID:', appId);
  console.log('Sandbox mode:', process.env.EBAY_SANDBOX === 'true' ? 'Yes' : 'No (Production)');
  
  try {
    const adapter = new eBayAdapter({
      appId: appId,
      authToken: token,
      sandbox: process.env.EBAY_SANDBOX === 'true',
    });
    
    console.log('\n🧪 Testing API call...');
    const results = await adapter.search({
      query: 'The Beatles Abbey Road',
      limit: 5,
    });
    
    console.log('\n✅ SUCCESS! Token is valid');
    console.log(`Found ${results.length} listings`);
    if (results.length > 0) {
      console.log('Sample listing:', results[0].title);
    }
  } catch (error: any) {
    console.error('\n❌ ERROR: Token validation failed');
    console.error('Status:', error.response?.status);
    console.error('Message:', error.message);
    
    if (error.response?.status === 401) {
      console.error('\n🔧 Token is invalid or expired');
      console.log('\nTo fix:');
      console.log('1. Go to: https://developer.ebay.com/my/keys');
      console.log('2. Click "Get a User Token Here"');
      console.log('3. Sign in and generate a NEW token');
      console.log('4. Copy the new token');
      console.log('5. Update .env: EBAY_OAUTH_TOKEN="new_token_here"');
      console.log('6. Restart the service');
    } else {
      console.error('\nFull error:', error);
    }
    process.exit(1);
  }
}

testEBayToken().catch(console.error);

