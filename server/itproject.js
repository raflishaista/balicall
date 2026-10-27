import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { ServiceError } from './providers.js';

const OAUTH_TOKEN_URL = 'https://devitproject.balitower.co.id/oauth/token';
const MCP_RESOURCE = 'https://devitproject.balitower.co.id/mcp';

function parseResult(result) {
  const text = (result.content || [])
    .filter(part => part.type === 'text')
    .map(part => part.text)
    .join('\n');

  let data = result.structuredContent ?? null;

  // Server IT Project mengirim data sebagai JSON text di content[].text.
  if (!data && text) {
    try {
      data = JSON.parse(text);
    } catch {
      const block = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
      if (block) {
        try {
          data = JSON.parse(block[1]);
        } catch {
          // Biarkan data sebagai text jika bukan JSON.
        }
      }
    }
  }

  if (result.isError) {
    throw new ServiceError(text || 'IT Project menolak permintaan.', 502);
  }

  return { isError: false, data, text };
}

export function createItProjectClient(config) {
  async function getAccessToken() {
    if (!config.itprojectMcpToken) {
      throw new Error('Login OAuth IT Project belum dilakukan.');
    }

    // Token statis dari env tidak memiliki waktu kedaluwarsa yang diketahui.
    if (!config.itprojectOAuthExpiresAt) {
      return config.itprojectMcpToken;
    }

    // Perbarui token 60 detik sebelum kedaluwarsa.
    if (Date.now() < config.itprojectOAuthExpiresAt - 60_000) {
      return config.itprojectMcpToken;
    }

    if (!config.itprojectOAuthRefreshToken) {
      throw new Error(
        'Access token kedaluwarsa dan refresh token tidak tersedia. Login OAuth lagi.'
      );
    }

    const form = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: config.itprojectOAuthClientId,
      refresh_token: config.itprojectOAuthRefreshToken,
      resource: MCP_RESOURCE,
    });

    const response = await fetch(OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form,
    });

    if (!response.ok) {
      config.itprojectMcpToken = '';
      config.itprojectOAuthRefreshToken = '';
      config.itprojectOAuthExpiresAt = 0;
      throw new Error('Refresh token IT Project ditolak. Login OAuth lagi.');
    }

    const tokens = await response.json();

    if (!tokens.access_token) {
      throw new Error('Respons refresh OAuth tidak berisi access token.');
    }

    config.itprojectMcpToken = tokens.access_token;

    // Beberapa server menerbitkan refresh token baru saat token diperbarui.
    if (tokens.refresh_token) {
      config.itprojectOAuthRefreshToken = tokens.refresh_token;
    }

    config.itprojectOAuthExpiresAt =
      Date.now() + (Number(tokens.expires_in) || 3600) * 1000;

    return config.itprojectMcpToken;
  }

  async function call(name, args) {
    const client = new Client({
      name: 'balicall',
      version: '1.0.0',
    });

    try {
      const token = await getAccessToken();
      const transport = new StreamableHTTPClientTransport(
        new URL(config.itprojectMcpUrl),
        {
          requestInit: {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          },
        }
      );

      await client.connect(transport);

      const result = await client.request(
        {
          method: 'tools/call',
          params: {
            name,
            arguments: args,
          },
        },
        CallToolResultSchema,
        { timeout: 30_000 }
      );

      return parseResult(result);
    } catch (error) {
      console.error('[ITPROJECT] call failed:', {
        name,
        message: error.message,
        code: error.code,
      });

      throw new ServiceError(
        error.message.includes('Login OAuth') ||
          error.message.includes('token')
          ? error.message
          : 'IT Project tidak dapat dijangkau atau menolak permintaan.',
        502
      );
    } finally {
      await client.close().catch(() => {});
    }
  }

  return {
    // Dipakai oleh endpoint uji project; tidak bergantung pada project ID lama.
    get authenticated() {
      return Boolean(
        config.itprojectMcpUrl &&
          (config.itprojectMcpToken ||
            config.itprojectOAuthRefreshToken)
      );
    },

    // Dipakai dispatcher action item dari ringkasan rapat.
    get enabled() {
      return Boolean(
        config.itprojectMcpUrl &&
          (config.itprojectMcpToken ||
            config.itprojectOAuthRefreshToken) &&
          config.itprojectProjectId &&
          config.itprojectTaskTypeId
      );
    },

    projectId: config.itprojectProjectId,
    taskTypeId: config.itprojectTaskTypeId,
    taskCategoryId: config.itprojectTaskCategoryId || '',
    taskStatusName: config.itprojectTaskStatusName || 'To Do',

    taskOptions(project) {
      return call('get-task-options', { project });
    },

    createTask(arguments_) {
      return call('create-task', arguments_);
    },

    projectOptions() {
      return call('get-project-options', {});
    },

    createProject(arguments_) {
      return call('create-project', arguments_);
    },
  };
}