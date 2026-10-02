import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { AccessToken } from 'livekit-server-sdk';
import { GoogleGenAI } from '@google/genai';

dotenv.config();

const app = express();
const port = process.env.PORT || 3001;

const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || 'devkey';
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || 'secret';
const LIVEKIT_URL = process.env.LIVEKIT_URL || 'ws://127.0.0.1:7880';

// LLM Provider Baseline Configuration
const LLM_PROVIDER = (process.env.LLM_PROVIDER || 'office').toLowerCase();
const LLM_KEY = process.env.LLM_KEY || process.env.LLM_API_KEY || '';
const LLM_BASE_URL = process.env.LLM_BASE_URL || 'http://10.7.1.21/v1';
const TEXT_MODEL = process.env.LLM_MODEL || process.env.TEXT_MODEL || 'qwen-35b';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';

app.use(cors());
app.use(express.json());

// In-memory meeting store: roomName -> { roomName, createdAt, participants: Map(), transcripts: [], summary: null }
const meetings = new Map();

function getOrCreateMeeting(roomName) {
  if (!meetings.has(roomName)) {
    meetings.set(roomName, {
      roomName,
      createdAt: new Date().toISOString(),
      participants: new Map(),
      transcripts: [],
      summary: null,
    });
  }
  return meetings.get(roomName);
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
  });
});

// 2. Generate LiveKit Access Token for an Employee
app.post('/api/token', async (req, res) => {
  try {
    const { roomName, employeeId, employeeName, department } = req.body;

    if (!roomName || !employeeId || !employeeName) {
      return res.status(400).json({ error: 'roomName, employeeId, and employeeName are required' });
    }

    const meeting = getOrCreateMeeting(roomName);
    
    // Register participant in attendance
    meeting.participants.set(employeeId, {
      employeeId,
      employeeName,
      department: department || 'General',
      joinedAt: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
    });

    const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
      identity: employeeId,
      name: employeeName,
      metadata: JSON.stringify({
        employeeId,
        employeeName,
        department: department || 'General',
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
        employeeName,
        department: department || 'General',
      },
    });
  } catch (error) {
    console.error('Error generating token:', error);
    res.status(500).json({ error: 'Failed to generate token' });
  }
});

// 3. Post a transcript line (sent from client or agent)
app.post('/api/meetings/:roomName/transcript', (req, res) => {
  const { roomName } = req.params;
  const { speakerId, speakerName, text, timestamp } = req.body;

  if (!text || !speakerId) {
    return res.status(400).json({ error: 'speakerId and text are required' });
  }

  const meeting = getOrCreateMeeting(roomName);
  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
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

  if (!meeting) {
    return res.json({
      roomName,
      transcripts: [],
      participants: [],
      summary: null,
    });
  }

  res.json({
    roomName,
    transcripts: meeting.transcripts,
    participants: Array.from(meeting.participants.values()),
    summary: meeting.summary,
  });
});

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
    res.json({ success: true, summary: summaryResult });
  } catch (error) {
    console.error('Error generating meeting summary:', error);
    res.status(500).json({ error: 'Failed to generate summary', details: error.message });
  }
});

app.listen(port, () => {
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
  console.log(`====================================================`);
});
