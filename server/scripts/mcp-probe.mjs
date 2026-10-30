import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { loadItProjectOAuthTokens } from '../itprojectOAuthStore.js';
import { fileURLToPath } from 'node:url';

const [name, argsJson = '{}'] = process.argv.slice(2);
const defaultTokenFile = fileURLToPath(new URL('../data/itproject-oauth.json', import.meta.url));
const persisted = loadItProjectOAuthTokens(process.env.ITPROJECT_OAUTH_TOKEN_FILE || defaultTokenFile);
const token = process.env.ITPROJECT_MCP_TOKEN || persisted?.accessToken || '';
const headers = token ? { Authorization: `Bearer ${token}` } : {};

const client = new Client({ name: 'balicall-probe', version: '1.0.0' });
await client.connect(new StreamableHTTPClientTransport(new URL(process.env.ITPROJECT_MCP_URL || 'https://devitproject.balitower.co.id/mcp'), { requestInit: { headers } }));
const result = await client.request({ method: 'tools/call', params: { name, arguments: JSON.parse(argsJson) } }, CallToolResultSchema);
console.log(JSON.stringify(result, null, 2));
await client.close();