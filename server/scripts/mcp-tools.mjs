// server/scripts/mcp-tools.mjs   (jalankan: node server/scripts/mcp-tools.mjs)
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const url = new URL(process.env.ITPROJECT_MCP_URL);
const headers = process.env.ITPROJECT_MCP_TOKEN
  ? { Authorization: `Bearer ${process.env.ITPROJECT_MCP_TOKEN}` } : {};
const client = new Client({ name: 'balicall', version: '1.0.0' });
await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers } }));
const { tools } = await client.listTools();
for (const tool of tools) console.log(tool.name, '\n ', tool.description, '\n ', JSON.stringify(tool.inputSchema), '\n');
await client.close();