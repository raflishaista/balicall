import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { loadConfig } from './config.js';

dotenv.config({ path: fileURLToPath(new URL('./.env', import.meta.url)) });
const config = loadConfig();
const { app } = createApp(config);
app.listen(config.port, () => {
  console.log(`BaliCall API: http://localhost:${config.port}`);
  console.log(`LiveKit configured: ${config.livekitUrl} (checked by /api/health)`);
  console.log(`Speech-to-text: ${config.sttProvider}`);
  console.log(`Meeting storage: ${config.dataFile}`);
});
