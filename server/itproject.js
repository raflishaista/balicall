import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { ServiceError } from './providers.js';
import {
  loadItProjectOAuthTokens,
  saveItProjectOAuthTokens,
} from './itprojectOAuthStore.js';

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
    const persistedTokens = loadItProjectOAuthTokens(config.itprojectOAuthTokenFile);

    if (!config.itprojectMcpToken && persistedTokens) {
      config.itprojectMcpToken = persistedTokens.accessToken;
      config.itprojectOAuthRefreshToken = persistedTokens.refreshToken;
      config.itprojectOAuthExpiresAt = persistedTokens.expiresAt;
    }

    function setOAuthTokens(tokens) {
      if (!tokens.access_token) {
        throw new Error('Respons OAuth tidak berisi access token.');
      }

      config.itprojectMcpToken = tokens.access_token;
      config.itprojectOAuthRefreshToken =
        tokens.refresh_token || config.itprojectOAuthRefreshToken || '';
      config.itprojectOAuthExpiresAt =
        Date.now() + (Number(tokens.expires_in) || 3600) * 1000;

      saveItProjectOAuthTokens(config.itprojectOAuthTokenFile, {
        accessToken: config.itprojectMcpToken,
        refreshToken: config.itprojectOAuthRefreshToken,
        expiresAt: config.itprojectOAuthExpiresAt,
      });
    }

    async function refreshAccessToken() {
      if (!config.itprojectOAuthRefreshToken) {
        throw new Error(
          config.itprojectMcpToken
            ? 'Access token kedaluwarsa dan refresh token tidak tersedia. Login OAuth lagi.'
            : 'Login OAuth IT Project belum dilakukan.'
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
        throw new Error(
          `Refresh token IT Project ditolak (HTTP ${response.status}). Login OAuth lagi jika token sudah dicabut atau kedaluwarsa.`
        );
      }

      const tokens = await response.json();
      setOAuthTokens(tokens);
      return config.itprojectMcpToken;
    }

    async function getAccessToken() {
      const hasAccessToken = Boolean(config.itprojectMcpToken);
      const hasKnownExpiry = Boolean(config.itprojectOAuthExpiresAt);

      // Token statis dari env tidak memiliki waktu kedaluwarsa yang diketahui.
      if (hasAccessToken && !hasKnownExpiry) {
        return config.itprojectMcpToken;
      }

      // Jika access token belum ada atau hampir kedaluwarsa, pakai refresh token.
      if (!hasAccessToken || Date.now() >= config.itprojectOAuthExpiresAt - 60_000) {
        return refreshAccessToken();
      }

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
        error.message?.includes('Login OAuth') || error.message?.includes('token')
          ? error.message
          : (error.message || 'IT Project tidak dapat dijangkau atau menolak permintaan.'),
        error.status || 502
      );
    } finally {
      await client.close().catch(() => {});
    }
  }

  return {
    setOAuthTokens,
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

    projectTasks(project) {
      return call('get-project-tasks', { project });
    },

    createTask(arguments_) {
      return call('create-task', arguments_);
    },
    
    updateTaskStatus(arguments_) {
      return call('update-task-status', arguments_);
    },

    updateTask(arguments_) {
      return call('update-task', arguments_);
    },

    assignSprintTasks(arguments_) {
      return call('assign-sprint-tasks', arguments_);
    },

    projectSprints(project) {
      return call('get-project-sprints', { project });
    },

    createSprint(arguments_) {
      return call('create-sprint', arguments_);
    },

    updateSprint(arguments_) {
      return call('update-sprint', arguments_);
    },

    startSprint(arguments_) {
      return call('start-sprint', arguments_);
    },

    completeSprint(arguments_) {
      return call('complete-sprint', arguments_);
    },

    deleteSprint(arguments_) {
      return call('delete-sprint', arguments_);
    },

    removeSprintTask(arguments_) {
      return call('remove-sprint-task', arguments_);
    },

    projectOptions() {
      return call('get-project-options', {});
    },

    async userProjects() {
      try {
        return await call('get-user-projects', {});
      } catch (error) {
        // Fallback jika server devitproject mengalami error format tanggal di get-user-projects
        if (
          error.message?.includes('format()') ||
          error.message?.includes('null') ||
          error.message?.includes('IT Project tidak dapat dijangkau') ||
          error.message?.includes('menolak permintaan')
        ) {
          console.warn('[ITPROJECT] get-user-projects gagal pada server upstream; menggunakan fallback query-data model project.');
          try {
            return await call('query-data', { model: 'project' });
          } catch {
            // Jika fallback juga gagal, lempar error asli
          }
        }
        throw error;
      }
    },

    projectDetail(project) {
      return call('get-project-detail', { project });
    },

    updateProject(arguments_) {
      return call('update-project', arguments_);
    },
    createProject(arguments_) {
      return call('create-project', arguments_);
    },
    createComment(arguments_) {
      return call('create-comment', arguments_);
    },

    listQueryableModels() {
      return call('list-queryable-models', {});
    },

    queryData(arguments_) {
      return call('query-data', arguments_);
    },
  };
}
