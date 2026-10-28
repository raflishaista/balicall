import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';

const [name, argsJson = '{}'] = process.argv.slice(2);
const headers = process.env.ITPROJECT_MCP_TOKEN ? { Authorization: `Bearer ${process.env.ITPROJECT_MCP_TOKEN}` } : {};
const client = new Client({ name: 'balicall-probe', version: '1.0.0' });
await client.connect(new StreamableHTTPClientTransport(new URL(process.env.ITPROJECT_MCP_URL), { requestInit: { headers } }));
const result = await client.request({ method: 'tools/call', params: { name, arguments: JSON.parse(argsJson) } }, CallToolResultSchema);
console.log(JSON.stringify(result, null, 2));
await client.close();