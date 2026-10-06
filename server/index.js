import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { initDb } from './db.js';

dotenv.config({ path: fileURLToPath(new URL('./.env', import.meta.url)) });
const config = loadConfig();
const { app } = createApp(config);

app.listen(config.port, async () => {
  console.log(`====================================================`);
  console.log(`🚀 BaliCall API: http://localhost:${config.port}`);
  console.log(`📡 LiveKit configured: ${config.livekitUrl} (checked by /api/health)`);
  console.log(`🧠 LLM Provider: ${config.llmProvider} (${config.llmModel})`);
  console.log(`🎙️ Speech-to-text: ${config.sttProvider}`);
  console.log(`💾 Meeting storage: ${config.dataFile}`);
  if (config.databaseUrl) {
    console.log(`🗄️ Initializing PostgreSQL database connection...`);
    await initDb();
  } else {
    console.log(`ℹ️ PostgreSQL DATABASE_URL not set in server/.env.`);
  }
  console.log(`====================================================`);
});
