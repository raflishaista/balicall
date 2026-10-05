import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { AccessToken, WebhookReceiver } from 'livekit-server-sdk';
import { GoogleGenAI } from '@google/genai';
import {
  initDb,
  isDbConnected,
  saveMeeting,
  saveMeetingSummary,
  saveTranscripts,
  saveAttendees,
  getMeetingSummaries,
  getMeetingDetails,
  verifyEmployeeId,
  getAllEmployees,
} from './db.js';

dotenv.config();

const app = express();
const port = process.env.PORT || 3001;

const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || 'devkey';
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || 'secret';
const LIVEKIT_URL = process.env.LIVEKIT_URL || 'ws://127.0.0.1:7880';
const OUTBOUND_WEBHOOK_URL = process.env.OUTBOUND_WEBHOOK_URL || '';

// LLM Provider Baseline Configuration
const LLM_PROVIDER = (process.env.LLM_PROVIDER || 'office').toLowerCase();
const LLM_KEY = process.env.LLM_KEY || process.env.LLM_API_KEY || '';
const LLM_BASE_URL = process.env.LLM_BASE_URL || 'http://10.7.1.21/v1';
const TEXT_MODEL = process.env.LLM_MODEL || process.env.TEXT_MODEL || 'qwen-35b';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';

app.use(cors());

// Preserve rawBody buffer for LiveKit cryptographic webhook signature verification
app.use(express.json({
  type: ['application/json', 'application/webhook+json'],
  verify: (req, _res, buf) => {
    req.rawBody = buf ? buf.toString('utf8') : '';
  }
}));

// Initialize LiveKit Webhook Receiver & in-memory event logger
const webhookReceiver = new WebhookReceiver(LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
const webhookLogs = [];

// In-memory meeting store: roomName -> active meeting session
// Archive of completed calls is stored in meetingHistory
const meetings = new Map();
const meetingHistory = [];

function getOrCreateMeeting(roomName, forceNew = false) {
  const existing = meetings.get(roomName);
  if (existing && !forceNew) {
    // If the meeting was marked as ended (summarized or finished), archive it and start fresh
    if (existing.status === 'ended') {
      meetingHistory.push({
        ...existing,
        participants: Array.from(existing.participants.values()),
      });
      meetings.delete(roomName);
    } else {
      return existing;
    }
  }

  if (existing && forceNew) {
    meetingHistory.push({
      ...existing,
      participants: Array.from(existing.participants.values()),
    });
    meetings.delete(roomName);
  }

  const newMeeting = {
    id: `call-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    roomName,
    createdAt: new Date().toISOString(),
    status: 'active',
    participants: new Map(),
    transcripts: [],
    summary: null,
  };
  meetings.set(roomName, newMeeting);
  return newMeeting;
}

// 1. Health check & provider info
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    livekitUrl: LIVEKIT_URL,
    llmProvider: LLM_PROVIDER,
    llmModel: TEXT_MODEL,
    llmBaseUrl: LLM_BASE_URL,
    hasLlmKey: Boolean(LLM_KEY || GEMINI_API_KEY),
    activeRooms: Array.from(meetings.keys()),
    totalCompletedCalls: meetingHistory.length,
    webhookEndpoint: '/api/livekit/webhook',
    totalWebhookEvents: webhookLogs.length,
    outboundWebhookConfigured: Boolean(OUTBOUND_WEBHOOK_URL),
    database: {
      connected: isDbConnected(),
      configured: Boolean(process.env.DATABASE_URL),
    },
  });
});

// 2. Generate LiveKit Access Token for an Employee (with Database Employee ID Verification)
app.post('/api/token', async (req, res) => {
  try {
    const { roomName, employeeId, employeeName, department, newSession } = req.body;

    if (!roomName || !employeeId) {
      return res.status(400).json({ error: 'roomName and employeeId are required' });
    }

    // 🔒 1. Check if the Employee ID exists and is active in company database
    const empCheck = await verifyEmployeeId(employeeId);
    if (!empCheck.valid) {
      const errorMsg = empCheck.inactive
        ? `Akses ditolak: Status karyawan dengan ID "${employeeId}" sedang non-aktif.`
        : `Akses ditolak: Employee ID "${employeeId}" tidak terdaftar di database resmi perusahaan. Harap periksa kembali ID Anda atau hubungi admin.`;
      
      console.warn(`[AUTH] ⛔ Access denied for Employee ID "${employeeId}": ${empCheck.reason}`);
      return res.status(403).json({
        error: errorMsg,
        code: 'EMPLOYEE_NOT_FOUND',
        employeeId,
        verifiedAgainstDb: empCheck.checked,
      });
    }

    // 👤 2. Use authoritative name and department from DB if registered
    const verifiedName = empCheck.employee?.name || employeeName || employeeId;
    const verifiedDept = empCheck.employee?.department || department || 'General';
    const verifiedRole = empCheck.employee?.position || 'Staff';

    console.log(`[AUTH] 🟢 Employee verified: ${verifiedName} (${employeeId} - ${verifiedDept}) [Source: ${empCheck.checked ? 'PostgreSQL DB' : 'Standby Roster'}]`);

    const meeting = getOrCreateMeeting(roomName, Boolean(newSession));
    
    // Asynchronously ensure meeting is registered in PostgreSQL
    saveMeeting(meeting).catch(e => console.error('[DB] Note:', e.message));

    // Register participant in attendance with verified profile
    meeting.participants.set(employeeId, {
      employeeId,
      employeeName: verifiedName,
      department: verifiedDept,
      position: verifiedRole,
      joinedAt: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
    });

    const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
      identity: employeeId,
      name: verifiedName,
      metadata: JSON.stringify({
        employeeId,
        employeeName: verifiedName,
        department: verifiedDept,
        position: verifiedRole,
        app: 'BaliTower-Attendance-Voice',
      }),
    });

    at.addGrant({
      room: roomName,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });

    const token = await at.toJwt();

    res.json({
      token,
      url: LIVEKIT_URL,
      roomName,
      employee: {
        employeeId,
        employeeName: verifiedName,
        department: verifiedDept,
        position: verifiedRole,
        dbVerified: empCheck.checked,
      },
    });
  } catch (error) {
    console.error('Error generating token:', error);
    res.status(500).json({ error: 'Failed to generate token' });
  }
});

// 2b. List authorized company employees
app.get('/api/employees', async (req, res) => {
  try {
    const list = await getAllEmployees();
    res.json({
      success: true,
      count: list.length,
      databaseConnected: isDbConnected(),
      employees: list,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch employees list', details: err.message });
  }
});

// 3. Post a transcript line (sent from client or agent)
app.post('/api/meetings/:roomName/transcript', (req, res) => {
  const { roomName } = req.params;
  const { speakerId, speakerName, text, timestamp, id } = req.body;

  if (!text || !speakerId) {
    return res.status(400).json({ error: 'speakerId and text are required' });
  }

  const meeting = getOrCreateMeeting(roomName);

  // If entry with this id already exists, return existing (prevents duplicate from data channel + http)
  if (id) {
    const existing = meeting.transcripts.find(t => t.id === id);
    if (existing) {
      return res.json({ success: true, entry: existing });
    }
  }

  const entry = {
    id: id || `${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
    speakerId,
    speakerName: speakerName || speakerId,
    text: text.trim(),
    timestamp: timestamp || new Date().toISOString(),
  };

  meeting.transcripts.push(entry);

  if (meeting.participants.has(speakerId)) {
    meeting.participants.get(speakerId).lastSeen = new Date().toISOString();
  }

  res.json({ success: true, entry });
});

// 4. Get active transcript & attendance for a room
app.get('/api/meetings/:roomName/transcript', (req, res) => {
  const { roomName } = req.params;
  const meeting = meetings.get(roomName);

  if (!meeting || meeting.status === 'ended') {
    return res.json({
      roomName,
      callId: null,
      transcripts: [],
      participants: [],
      summary: null,
    });
  }

  res.json({
    roomName,
    callId: meeting.id,
    transcripts: meeting.transcripts,
    participants: Array.from(meeting.participants.values()),
    summary: meeting.summary,
  });
});

// 5. Reset/clear active call session for a room (guarantees fresh transcripts for new call)
app.post('/api/meetings/:roomName/reset', (req, res) => {
  const { roomName } = req.params;
  const meeting = getOrCreateMeeting(roomName, true);
  res.json({
    success: true,
    message: `Meeting session for ${roomName} reset successfully.`,
    callId: meeting.id,
  });
});

// 6. View completed meeting history (in-memory)
app.get('/api/meetings/history', (req, res) => {
  res.json({
    history: meetingHistory,
  });
});

// 6b. View persisted meeting summaries from PostgreSQL database
app.get('/api/meetings/db-summaries', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 20;
    const summaries = await getMeetingSummaries(limit);
    res.json({
      success: true,
      count: summaries.length,
      databaseConnected: isDbConnected(),
      summaries,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve summaries from DB', details: err.message });
  }
});

// 6c. View comprehensive meeting record (summary, transcripts, attendees) from PostgreSQL
app.get('/api/meetings/db-details/:meetingId', async (req, res) => {
  try {
    const details = await getMeetingDetails(req.params.meetingId);
    if (!details) {
      return res.status(404).json({ error: 'Meeting not found in database', meetingId: req.params.meetingId });
    }
    res.json({
      success: true,
      ...details,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve meeting details', details: err.message });
  }
});

// ==========================================
// 📡 LIVEKIT SFU INBOUND WEBHOOK RECEIVER
// ==========================================
// LiveKit automatically sends HTTP POST notifications on room and participant lifecycle changes
app.post('/api/livekit/webhook', async (req, res) => {
  try {
    const rawBody = req.rawBody || (typeof req.body === 'string' ? req.body : JSON.stringify(req.body));
    const authHeader = req.headers['authorization'] || req.headers['authorize'];

    let event;
    const isDev = process.env.NODE_ENV !== 'production';

    // Verify cryptographic signature via LiveKit WebhookReceiver
    try {
      event = await webhookReceiver.receive(rawBody, authHeader);
    } catch (verifyErr) {
      if (isDev && req.body && req.body.event) {
        console.warn(`[WEBHOOK] Notice: Auth header check bypassed for dev simulation: ${verifyErr.message}`);
        event = req.body;
      } else {
        console.error(`[WEBHOOK] Invalid webhook signature:`, verifyErr.message);
        return res.status(401).json({ error: 'Unauthorized webhook signature', details: verifyErr.message });
      }
    }

    const eventName = event.event;
    const room = event.room;
    const participant = event.participant;
    const roomName = room?.name;

    // Record event in memory log (latest 50)
    const logItem = {
      id: `wh-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      time: new Date().toISOString(),
      event: eventName,
      roomName: roomName || 'N/A',
      participant: participant?.name || participant?.identity || 'N/A',
      details: {
        roomSid: room?.sid,
        participantIdentity: participant?.identity,
      },
    };
    webhookLogs.unshift(logItem);
    if (webhookLogs.length > 50) webhookLogs.pop();

    console.log(`[LIVEKIT WEBHOOK] 🔔 Event: ${eventName} | Room: ${roomName || 'N/A'}`);

    // Synchronize meeting and attendance state with LiveKit truth
    switch (eventName) {
      case 'participant_joined': {
        if (roomName && participant) {
          const meeting = getOrCreateMeeting(roomName);
          let dept = 'General';
          try {
            const meta = JSON.parse(participant.metadata || '{}');
            if (meta.department) dept = meta.department;
          } catch (e) {}

          const joinTime = participant.joinedAt
            ? new Date(Number(participant.joinedAt) * 1000).toISOString()
            : new Date().toISOString();

          meeting.participants.set(participant.identity, {
            employeeId: participant.identity,
            employeeName: participant.name || participant.identity,
            department: dept,
            joinedAt: joinTime,
            lastSeen: new Date().toISOString(),
            status: 'connected',
          });
          console.log(`[WEBHOOK] 👤 Attendance marked: ${participant.name || participant.identity} (${dept})`);
        }
        break;
      }

      case 'participant_left': {
        if (roomName && participant) {
          const meeting = meetings.get(roomName);
          if (meeting && meeting.participants.has(participant.identity)) {
            const p = meeting.participants.get(participant.identity);
            p.status = 'disconnected';
            p.leftAt = new Date().toISOString();
            console.log(`[WEBHOOK] 🚪 Participant left: ${participant.name || participant.identity}`);
          }
        }
        break;
      }

      case 'room_started': {
        if (roomName) {
          const meeting = getOrCreateMeeting(roomName);
          meeting.status = 'active';
          console.log(`[WEBHOOK] 🟢 Room active: ${roomName} (SID: ${room?.sid})`);
        }
        break;
      }

      case 'room_finished': {
        if (roomName) {
          const meeting = meetings.get(roomName);
          if (meeting) {
            meeting.status = 'ended';
            meeting.endedAt = new Date().toISOString();
            console.log(`[WEBHOOK] 🔴 Room finished: ${roomName}`);
          }
        }
        break;
      }

      case 'track_published': {
        console.log(`[WEBHOOK] 🎙️ Track published by ${participant?.identity || 'unknown'} (${event.track?.type || 'media'})`);
        break;
      }

      case 'track_unpublished': {
        console.log(`[WEBHOOK] 🔇 Track unpublished by ${participant?.identity || 'unknown'}`);
        break;
      }

      default:
        console.log(`[WEBHOOK] Event ${eventName} recorded.`);
    }

    res.json({ success: true, event: eventName, loggedAt: logItem.time });
  } catch (error) {
    console.error(`[WEBHOOK ERROR]:`, error);
    res.status(500).json({ error: 'Failed to process webhook', message: error.message });
  }
});

// 8. Query recent webhook event logs
app.get('/api/livekit/webhooks', (req, res) => {
  res.json({
    totalEvents: webhookLogs.length,
    events: webhookLogs,
  });
});

// 9. Webhook simulation / test trigger endpoint
app.post('/api/livekit/webhook/test', (req, res) => {
  const {
    event = 'participant_joined',
    roomName = 'site-sync-tower-jakarta',
    employeeId = 'BT-10492',
    employeeName = 'Rafli Aditya',
    department = 'NOC & Core Network',
  } = req.body;

  const mockPayload = {
    event,
    room: { name: roomName, sid: `RM_${Date.now()}` },
    participant: {
      identity: employeeId,
      name: employeeName,
      joinedAt: Math.floor(Date.now() / 1000),
      metadata: JSON.stringify({ department }),
    },
    createdAt: Math.floor(Date.now() / 1000),
  };

  const meeting = getOrCreateMeeting(roomName);
  if (event === 'participant_joined') {
    meeting.participants.set(employeeId, {
      employeeId,
      employeeName,
      department,
      joinedAt: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
      status: 'connected',
    });
  }

  webhookLogs.unshift({
    id: `wh-test-${Date.now()}`,
    time: new Date().toISOString(),
    event,
    roomName,
    participant: employeeName,
    isSimulation: true,
  });
  if (webhookLogs.length > 50) webhookLogs.pop();

  res.json({
    success: true,
    message: `Test webhook [${event}] processed successfully`,
    simulatedPayload: mockPayload,
  });
});

// Outbound webhook notification helper (e.g. ERP, Teams, Telegram, Slack)
async function dispatchOutboundWebhook(payload) {
  if (!OUTBOUND_WEBHOOK_URL) return;
  try {
    console.log(`[OUTBOUND WEBHOOK] Forwarding event to ${OUTBOUND_WEBHOOK_URL}...`);
    await fetch(OUTBOUND_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    console.log(`[OUTBOUND WEBHOOK] Dispatched successfully.`);
  } catch (err) {
    console.warn(`[OUTBOUND WEBHOOK] Failed to dispatch:`, err.message);
  }
}

// Helper to extract JSON from LLM response text
function cleanJsonOutput(text) {
  try {
    return JSON.parse(text);
  } catch (e) {
    // Try finding ```json ... ``` block
    const match = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (match) {
      try {
        return JSON.parse(match[1]);
      } catch (err) {}
    }
    // Return fallback structure
    return null;
  }
}

// 5. Summarize meeting with configured LLM Provider ("office" | "gemini" | "demo")
app.post('/api/meetings/:roomName/summarize', async (req, res) => {
  const { roomName } = req.params;
  const meeting = getOrCreateMeeting(roomName);
  const explicitTranscripts = req.body.transcripts;

  const transcriptsToSummarize = (explicitTranscripts && explicitTranscripts.length > 0)
    ? explicitTranscripts
    : meeting.transcripts;

  if (!transcriptsToSummarize || transcriptsToSummarize.length === 0) {
    return res.status(400).json({
      error: 'No transcripts found to summarize. Please speak in the call or submit dialogue lines.',
    });
  }

  const formattedDialogue = transcriptsToSummarize
    .map(t => `[${t.speakerName || t.speakerId} (${t.speakerId})]: ${t.text}`)
    .join('\n');

  const attendeesList = Array.from(meeting.participants.values())
    .map(p => `${p.employeeName} (${p.employeeId} - ${p.department})`)
    .join(', ');

  const promptSystem = `You are the official AI Meeting Secretary for Bali Tower Telecom.
Analyze the provided meeting dialogue and produce a structured meeting summary in clean JSON format.
Always respond ONLY with valid JSON conforming to this schema:
{
  "title": "Clear meeting title",
  "executiveSummary": "Concise summary of objectives, problems discussed, and outcomes",
  "keyDiscussionPoints": ["Discussion point 1", "Discussion point 2"],
  "decisions": ["Decision agreed upon 1", "Decision agreed upon 2"],
  "actionItems": [
    {
      "task": "Specific task description",
      "assignee": "Employee Name or ID",
      "priority": "High" | "Medium" | "Low",
      "deadline": "Target deadline or Next Shift"
    }
  ],
  "attendanceSummary": ["List of active participants"]
}`;

  const promptUser = `Meeting Room: ${roomName}
Registered Attendees: ${attendeesList || 'N/A'}

Meeting Dialogue Transcript:
${formattedDialogue}`;

  try {
    let summaryResult = null;

    // PATH 1: Internal Office Gateway (e.g. http://10.7.1.21/v1, qwen-35b)
    if (LLM_PROVIDER === 'office') {
      if (!LLM_KEY) {
        console.warn('⚠️ Warning: LLM_KEY / LLM_API_KEY is not set in .env. Falling back to Demo Engine.');
      } else {
        console.log(`🌐 Calling Office LLM at ${LLM_BASE_URL} (Model: ${TEXT_MODEL})...`);
        const endpoint = `${LLM_BASE_URL.replace(/\/+$/, '')}/chat/completions`;
        
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${LLM_KEY}`,
          },
          body: JSON.stringify({
            model: TEXT_MODEL,
            messages: [
              { role: 'system', content: promptSystem },
              { role: 'user', content: promptUser },
            ],
            temperature: 0.3,
          }),
        });

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`Office LLM error (${response.status}): ${errText}`);
        }

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content || '';
        summaryResult = cleanJsonOutput(content);
        if (summaryResult) {
          summaryResult.provider = `Office (${TEXT_MODEL})`;
        }
      }
    }

    // PATH 2: Google Gemini (if provider is gemini or office key was not supplied)
    if (!summaryResult && (LLM_PROVIDER === 'gemini' || GEMINI_API_KEY)) {
      if (GEMINI_API_KEY) {
        console.log('🤖 Generating summary using Google Gemini...');
        const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
        const response = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: `${promptSystem}\n\n${promptUser}`,
          config: {
            responseMimeType: 'application/json',
          },
        });

        const rawText = response.text || '';
        summaryResult = cleanJsonOutput(rawText);
        if (summaryResult) {
          summaryResult.provider = 'Gemini 2.5 Flash';
        }
      }
    }

    // PATH 3: Fallback Smart Demo Engine (ensures zero broken states while setting up keys)
    if (!summaryResult) {
      console.log('Generating structured minutes via Smart Demo Engine...');
      const uniqueSpeakers = [...new Set(transcriptsToSummarize.map(t => t.speakerName || t.speakerId))];
      summaryResult = {
        title: `Bali Tower Operational Sync: ${roomName.toUpperCase()}`,
        executiveSummary: `This meeting synchronized field and network operations. ${uniqueSpeakers.length} participants actively logged ${transcriptsToSummarize.length} dialogue turns regarding site telemetry, transmission quality, and maintenance procedures.`,
        keyDiscussionPoints: transcriptsToSummarize.slice(0, 4).map(t => `${t.speakerName}: "${t.text.length > 80 ? t.text.slice(0, 77) + '...' : t.text}"`),
        decisions: [
          'Work orders and fiber health confirmed with operational control.',
          'Follow-up inspection verified and logged into attendance roster.',
        ],
        actionItems: uniqueSpeakers.map((speaker, idx) => ({
          task: `Complete action item discussed for room ${roomName}`,
          assignee: speaker,
          priority: idx === 0 ? 'High' : 'Medium',
          deadline: 'Next Shift',
        })),
        attendanceSummary: uniqueSpeakers,
        provider: 'Demo Engine (Offline / Standby)',
        note: !LLM_KEY
          ? `LLM_KEY is empty in server/.env. Add your key for ${TEXT_MODEL} at ${LLM_BASE_URL} to activate live model responses.`
          : undefined,
      };
    }

    meeting.summary = summaryResult;
    meeting.status = 'ended';
    meeting.endedAt = new Date().toISOString();

    // Persist to PostgreSQL database (balicall_meetings, balicall_transcripts, balicall_attendees, balicall_summaries)
    let dbSummaryRecord = null;
    try {
      await saveMeeting(meeting);
      await saveTranscripts(meeting.id, roomName, transcriptsToSummarize);
      await saveAttendees(meeting.id, Array.from(meeting.participants.values()));
      dbSummaryRecord = await saveMeetingSummary(meeting.id, roomName, summaryResult);
      if (dbSummaryRecord) {
        console.log(`[DB] ✅ Meeting minutes persisted to PostgreSQL for ${roomName} (Summary ID: ${dbSummaryRecord.id})`);
      }
    } catch (dbErr) {
      console.error('[DB] ⚠️ Error persisting meeting to database:', dbErr.message);
    }

    // Trigger outbound webhook if configured (e.g. ERP, Teams, Telegram, Slack)
    dispatchOutboundWebhook({
      event: 'meeting.summary.created',
      roomName,
      meetingId: meeting.id,
      summary: summaryResult,
      transcriptsCount: transcriptsToSummarize.length,
      attendees: Array.from(meeting.participants.values()).map(p => ({
        id: p.employeeId,
        name: p.employeeName,
        department: p.department,
        joinedAt: p.joinedAt,
      })),
      timestamp: new Date().toISOString(),
    });

    res.json({
      success: true,
      summary: summaryResult,
      dbSummaryId: dbSummaryRecord?.id || null,
      savedToDb: Boolean(dbSummaryRecord),
    });
  } catch (error) {
    console.error('Error generating meeting summary:', error);
    res.status(500).json({ error: 'Failed to generate summary', details: error.message });
  }
});

// 10. Manual dispatch to external webhook URL
app.post('/api/meetings/:roomName/dispatch-webhook', async (req, res) => {
  const { roomName } = req.params;
  const meeting = meetings.get(roomName);
  const targetUrl = req.body.targetUrl || OUTBOUND_WEBHOOK_URL;

  if (!targetUrl) {
    return res.status(400).json({ error: 'No webhook target URL provided in body or server/.env' });
  }

  const payload = {
    event: 'meeting.summary.dispatched',
    roomName,
    summary: meeting?.summary || req.body.summary || null,
    dispatchedAt: new Date().toISOString(),
  };

  try {
    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    res.json({ success: true, targetUrl, status: response.status });
  } catch (err) {
    res.status(500).json({ error: 'Failed to dispatch outbound webhook', details: err.message });
  }
});

app.listen(port, async () => {
  console.log(`====================================================`);
  console.log(`🚀 Bali Tower Voice Call Server running on port ${port}`);
  console.log(`📡 Connected LiveKit SFU: ${LIVEKIT_URL}`);
  console.log(`🧠 LLM Provider: ${LLM_PROVIDER.toUpperCase()}`);
  if (LLM_PROVIDER === 'office') {
    console.log(`🏢 Office Endpoint: ${LLM_BASE_URL}`);
    console.log(`🤖 Model: ${TEXT_MODEL}`);
    console.log(`🔑 Key Set: ${Boolean(LLM_KEY) ? 'YES' : 'NO (Add LLM_KEY in server/.env)'}`);
  } else {
    console.log(`🤖 Gemini API Key: ${Boolean(GEMINI_API_KEY) ? 'YES' : 'NO'}`);
  }
  
  // Initialize Database connection and verify tables
  await initDb();
  console.log(`====================================================`);
});
