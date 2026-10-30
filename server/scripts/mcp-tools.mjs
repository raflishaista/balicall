// server/scripts/mcp-tools.mjs   (jalankan: node server/scripts/mcp-tools.mjs)
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { loadItProjectOAuthTokens } from '../itprojectOAuthStore.js';
import { fileURLToPath } from 'node:url';

const url = new URL(process.env.ITPROJECT_MCP_URL || 'https://devitproject.balitower.co.id/mcp');
const defaultTokenFile = fileURLToPath(new URL('../data/itproject-oauth.json', import.meta.url));
const persisted = loadItProjectOAuthTokens(process.env.ITPROJECT_OAUTH_TOKEN_FILE || defaultTokenFile);
const token = process.env.ITPROJECT_MCP_TOKEN || persisted?.accessToken || '';
const headers = token ? { Authorization: `Bearer ${token}` } : {};

const client = new Client({ name: 'balicall', version: '1.0.0' });
await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers } }));
const { tools } = await client.listTools();
for (const tool of tools) console.log(tool.name, '\n ', tool.description, '\n ', JSON.stringify(tool.inputSchema), '\n');
await client.close();