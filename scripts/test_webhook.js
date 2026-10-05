// Test script for LiveKit Webhook Receiver
import { AccessToken } from '../server/node_modules/livekit-server-sdk/dist/index.js';
import crypto from 'crypto';

const API_KEY = process.env.LIVEKIT_API_KEY || 'devkey';
const API_SECRET = process.env.LIVEKIT_API_SECRET || 'secret';
const WEBHOOK_URL = 'http://localhost:3001/api/livekit/webhook';

async function runTest() {
  console.log('🧪 Starting Webhook Integration Test...');

  const payloadObj = {
    event: 'participant_joined',
    room: { name: 'site-sync-tower-jakarta', sid: 'RM_test123' },
    participant: {
      identity: 'BT-10492',
      name: 'Rafli Aditya',
      metadata: JSON.stringify({ department: 'NOC & Core Network' }),
      joinedAt: Math.floor(Date.now() / 1000),
    },
    createdAt: Math.floor(Date.now() / 1000),
  };

  const payloadString = JSON.stringify(payloadObj);

  // Compute SHA256 base64 hash of body for LiveKit token claim
  const hash = crypto.createHash('sha256').update(payloadString).digest('base64');

  // Sign token using LiveKit AccessToken
  const at = new AccessToken(API_KEY, API_SECRET, {
    identity: 'livekit-server',
    ttl: '10m',
  });
  at.sha256 = hash;
  const token = await at.toJwt();

  console.log('📤 Sending signed webhook payload to:', WEBHOOK_URL);
  try {
    const res = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/webhook+json',
        'Authorization': token,
      },
      body: payloadString,
    });

    const data = await res.json();
    console.log('📥 Response status:', res.status);
    console.log('📥 Response body:', data);

    if (res.ok) {
      console.log('✅ Webhook verified and processed successfully!');
    } else {
      console.error('❌ Webhook failed:', data);
    }

    // Query webhook logs
    const logsRes = await fetch('http://localhost:3001/api/livekit/webhooks');
    if (logsRes.ok) {
      const logs = await logsRes.json();
      console.log(`📋 Total logged webhook events: ${logs.totalEvents}`);
      console.log('📋 Recent log sample:', logs.events?.[0]);
    }
  } catch (err) {
    console.error('Connection error (make sure server is running on port 3001):', err.message);
  }
}

runTest();
