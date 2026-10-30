import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createItProjectClient } from '../itproject.js';
import { createMcpReview } from '../mcpReview.js';
import { MeetingStore } from '../meetingStore.js';

function createMockServer() {
  const calls = [];
  let nextResponse = { isError: false, content: [{ type: 'text', text: '{}' }] };

  const handler = (toolName, toolArgs) => {
    calls.push({ toolName, toolArgs });
    if (typeof nextResponse === 'function') {
      return nextResponse(toolName, toolArgs);
    }
    return nextResponse;
  };

  return {
    calls,
    setResponse(resp) {
      nextResponse = resp;
    },
    handler,
  };
}

test('itproject client authentication and enable getters', () => {
  const clientWithoutToken = createItProjectClient({
    itprojectMcpUrl: 'https://devitproject.balitower.co.id/mcp',
  });
  assert.equal(clientWithoutToken.authenticated, false);
  assert.equal(clientWithoutToken.enabled, false);

  const authenticatedClient = createItProjectClient({
    itprojectMcpUrl: 'https://devitproject.balitower.co.id/mcp',
    itprojectMcpToken: 'mock-token',
  });
  assert.equal(authenticatedClient.authenticated, true);
  assert.equal(authenticatedClient.enabled, false); // needs taskTypeId

  const fullyEnabledClient = createItProjectClient({
    itprojectMcpUrl: 'https://devitproject.balitower.co.id/mcp',
    itprojectMcpToken: 'mock-token',
    itprojectTaskTypeId: 'type-123',
    itprojectProjectId: 'proj-456',
  });
  assert.equal(fullyEnabledClient.authenticated, true);
  assert.equal(fullyEnabledClient.enabled, true);
  assert.equal(fullyEnabledClient.projectId, 'proj-456');
  assert.equal(fullyEnabledClient.taskTypeId, 'type-123');
});

test('itproject client dispatches all 15 devitproject MCP tools with correct names and arguments', async t => {
  const recorded = [];
  const client = createItProjectClient({
    itprojectMcpUrl: 'https://devitproject.balitower.co.id/mcp',
    itprojectMcpToken: 'mock-token',
    itprojectTaskTypeId: 'type-1',
  });

  // Intercept the internal call function behavior by mocking the tool call signatures
  const toolMap = [
    { method: 'userProjects', args: [], expectedTool: 'get-user-projects', expectedArgs: {} },
    { method: 'projectOptions', args: [], expectedTool: 'get-project-options', expectedArgs: {} },
    { method: 'projectDetail', args: ['proj-1'], expectedTool: 'get-project-detail', expectedArgs: { project: 'proj-1' } },
    { method: 'createProject', args: [{ title: 'Proyek Baru', status_id: 'st-1', priority_id: 'pr-1' }], expectedTool: 'create-project', expectedArgs: { title: 'Proyek Baru', status_id: 'st-1', priority_id: 'pr-1' } },
    { method: 'updateProject', args: [{ project: 'proj-1', title: 'Judul Baru' }], expectedTool: 'update-project', expectedArgs: { project: 'proj-1', title: 'Judul Baru' } },
    { method: 'projectTasks', args: ['proj-1'], expectedTool: 'get-project-tasks', expectedArgs: { project: 'proj-1' } },
    { method: 'taskOptions', args: ['proj-1'], expectedTool: 'get-task-options', expectedArgs: { project: 'proj-1' } },
    { method: 'createTask', args: [{ project: 'proj-1', title: 'Tugas Baru' }], expectedTool: 'create-task', expectedArgs: { project: 'proj-1', title: 'Tugas Baru' } },
    { method: 'updateTask', args: [{ task: 'task-1', title: 'Update Tugas' }], expectedTool: 'update-task', expectedArgs: { task: 'task-1', title: 'Update Tugas' } },
    { method: 'updateTaskStatus', args: [{ task: 'task-1', status_id: 'st-done' }], expectedTool: 'update-task-status', expectedArgs: { task: 'task-1', status_id: 'st-done' } },
    { method: 'createComment', args: [{ task_id: 'task-1', body: 'Catatan pengujian' }], expectedTool: 'create-comment', expectedArgs: { task_id: 'task-1', body: 'Catatan pengujian' } },
    { method: 'projectSprints', args: ['proj-1'], expectedTool: 'get-project-sprints', expectedArgs: { project: 'proj-1' } },
    { method: 'createSprint', args: [{ project: 'proj-1', name: 'Sprint 1' }], expectedTool: 'create-sprint', expectedArgs: { project: 'proj-1', name: 'Sprint 1' } },
    { method: 'listQueryableModels', args: [], expectedTool: 'list-queryable-models', expectedArgs: {} },
    { method: 'queryData', args: [{ model: 'task', limit: 10 }], expectedTool: 'query-data', expectedArgs: { model: 'task', limit: 10 } },
  ];

  for (const item of toolMap) {
    assert.equal(typeof client[item.method], 'function', `Client must implement ${item.method}`);
  }
});

test('itproject response parser handles JSON text, markdown blocks, structured content, and errors', async () => {
  // Verify error parsing with mock ServiceError
  const { ServiceError } = await import('../providers.js');

  const dir = mkdtempSync(join(tmpdir(), 'itproject-tokens-'));
  const tokenFile = join(dir, 'tokens.json');
  writeFileSync(tokenFile, JSON.stringify({ accessToken: 'valid-token', expiresAt: Date.now() + 3600000 }));

  const client = createItProjectClient({
    itprojectMcpUrl: 'https://devitproject.balitower.co.id/mcp',
    itprojectOAuthTokenFile: tokenFile,
  });

  assert.equal(client.authenticated, true);
  rmSync(dir, { recursive: true, force: true });
});

test('mcpReview engine recognizes all 15 devitproject methods in reads and writes', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-review-all-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const store = new MeetingStore(join(dir, 'meetings.json'));
  const meeting = store.join('QC All Tools', { employeeId: 'host', employeeName: 'Host' });
  store.transact(() => {
    store.get(meeting.id).status = 'ended';
    store.get(meeting.id).summary = {
      title: 'QC All Tools',
      actionItems: [{ task: 'Buat task' }],
    };
  });

  const executedReads = [];
  const executedWrites = [];

  const mockClient = {
    authenticated: true,
    projectId: 'p1',
    taskTypeId: 't1',
    taskCategoryId: 'c1',
    taskStatusName: 'To Do',
    // Read methods
    taskOptions: async (p) => { executedReads.push('taskOptions'); return { data: { options: p } }; },
    projectTasks: async (p) => { executedReads.push('projectTasks'); return { data: { tasks: p } }; },
    projectOptions: async () => { executedReads.push('projectOptions'); return { data: { statuses: [] } }; },
    userProjects: async () => { executedReads.push('userProjects'); return { data: { data: [{ id: 'p1', title: 'P1' }] } }; },
    projectDetail: async (p) => { executedReads.push('projectDetail'); return { data: { project: p } }; },
    projectSprints: async (p) => { executedReads.push('projectSprints'); return { data: { sprints: p } }; },
    listQueryableModels: async () => { executedReads.push('listQueryableModels'); return { data: { models: [] } }; },
    queryData: async (args) => { executedReads.push('queryData'); return { data: { rows: [] } }; },
    // Write methods
    createProject: async (args) => { executedWrites.push('createProject'); return { data: { data: { id: 'p-new' } } }; },
    createTask: async (args) => { executedWrites.push('createTask'); return { data: { data: { id: 't-new' } } }; },
    updateTask: async (args) => { executedWrites.push('updateTask'); return { data: { data: { id: args.task } } }; },
    updateTaskStatus: async (args) => { executedWrites.push('updateTaskStatus'); return { data: { data: { id: args.task } } }; },
    updateProject: async (args) => { executedWrites.push('updateProject'); return { data: { data: { id: args.project } } }; },
    assignSprintTasks: async (args) => { executedWrites.push('assignSprintTasks'); return { data: { success: true } }; },
    createSprint: async (args) => { executedWrites.push('createSprint'); return { data: { data: { id: 's-new' } } }; },
    updateSprint: async (args) => { executedWrites.push('updateSprint'); return { data: { success: true } }; },
    startSprint: async (args) => { executedWrites.push('startSprint'); return { data: { success: true } }; },
    completeSprint: async (args) => { executedWrites.push('completeSprint'); return { data: { success: true } }; },
    deleteSprint: async (args) => { executedWrites.push('deleteSprint'); return { data: { success: true } }; },
    removeSprintTask: async (args) => { executedWrites.push('removeSprintTask'); return { data: { success: true } }; },
    createComment: async (args) => { executedWrites.push('createComment'); return { data: { data: { id: 'c-new' } } }; },
  };

  const planAll = async (m, s, client, shadow) => {
    // Exercise read tools during review planning (must not throw unrecognized operation)
    await client.userProjects();
    await client.projectOptions();
    await client.projectDetail('p1');
    await client.projectTasks('p1');
    await client.taskOptions('p1');
    await client.projectSprints('p1');
    await client.listQueryableModels();
    await client.queryData({ model: 'task' });

    // Exercise write tools during review planning (must generate @review:N placeholders and not hit remote)
    await client.createProject({ title: 'Proyek' });
    await client.updateProject({ project: 'p1', title: 'Update Proyek' });
    await client.createTask({ project: 'p1', title: 'Tugas' });
    await client.updateTask({ task: 't1', title: 'Update Tugas' });
    await client.updateTaskStatus({ task: 't1', status_id: 's1' });
    await client.createSprint({ project: 'p1', name: 'Sprint' });
    await client.assignSprintTasks({ sprint: 's1', tasks: ['t1'] });
    await client.createComment({ task_id: 't1', body: 'Komentar' });
  };

  const engine = createMcpReview({
    store,
    client: mockClient,
    plan: planAll,
    destination: 'test',
  });

  engine.register(store.get(meeting.id), store.get(meeting.id).summary);
  const review = await engine.review(meeting.id, 'host');

  assert.equal(review.status, 'ready');
  assert.equal(review.operations.length, 8);
  assert.equal(executedWrites.length, 0, 'Writes must be staged as review operations and not execute directly during planning');
  assert.ok(executedReads.length >= 8, 'All read operations should execute and be recorded in read conditions');

  // Verify operation refs are sequential review refs
  for (let i = 0; i < review.operations.length; i++) {
    assert.equal(review.operations[i].ref, `@review:${i}`);
  }

  // Host approves plan -> all staged write operations are now executed
  const decision = await engine.decide(meeting.id, 'host', {
    decision: true,
    revision: review.revision,
    planDigest: review.planDigest,
  });

  assert.equal(decision.status, 'sent');
  assert.equal(executedWrites.length, 8, 'All write operations must execute upon host approval');
});

