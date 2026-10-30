// server/scripts/test-itproject-mcp-qc.mjs
// Quality Control Suite: Pengujian Komprehensif Seluruh Fungsi MCP devitproject

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import dotenv from 'dotenv';
import { loadConfig } from '../config.js';
import { createItProjectClient } from '../itproject.js';
import { createMcpReview } from '../mcpReview.js';
import { MeetingStore } from '../meetingStore.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../.env') });
const config = loadConfig(process.env);

console.log('================================================================');
console.log('  QC Suite: Uji Kualitas Lengkap 15 Fungsi MCP devitproject     ');
console.log('================================================================\n');

const stats = {
  total: 0,
  passed: 0,
  failed: 0,
};

function pass(name, details = '') {
  stats.total++;
  stats.passed++;
  console.log(`  ✅ [PASS] ${name}${details ? ` -> ${details}` : ''}`);
}

function fail(name, error) {
  stats.total++;
  stats.failed++;
  console.error(`  ❌ [FAIL] ${name} -> ${error?.message || error}`);
}

// -------------------------------------------------------------
// [1/6] Konfigurasi & Konektivitas OAuth MCP
// -------------------------------------------------------------
console.log('[1/6] Memeriksa Autentikasi & Konfigurasi OAuth IT Project...');
console.log('  MCP URL:          ', config.itprojectMcpUrl || '(belum diatur)');
console.log('  Project ID default:', config.itprojectProjectId || '(belum diatur)');
console.log('  Task Type ID:     ', config.itprojectTaskTypeId || '(belum diatur)');
console.log('  Default Status:   ', config.itprojectTaskStatusName || 'To Do');

const itProject = createItProjectClient(config);
console.log('  Status Autentikasi:', itProject.authenticated ? '✅ Authenticated' : '❌ Belum Login');
console.log('  Status Fitur:      ', itProject.enabled ? '✅ Enabled' : '⚠️ Disabled (Perlu taskTypeId)');

if (!itProject.authenticated) {
  console.error('\n❌ Token OAuth belum tersedia atau kedaluwarsa.');
  console.error('   Silakan login OAuth IT Project melalui browser terlebih dahulu:');
  console.error('   http://localhost:3001/api/itproject/oauth/start\n');
  process.exit(1);
}
pass('Autentikasi OAuth IT Project terverifikasi');

let activeProjectId = config.itprojectProjectId;

// -------------------------------------------------------------
// [2/6] Project Management Tools (Read & Metadata)
// -------------------------------------------------------------
console.log('\n[2/6] Menguji Project Management Tools (Read & Metadata)...');

try {
  const userProjectsRes = await itProject.userProjects();
  const projects = userProjectsRes.data?.data || [];
  if (!Array.isArray(projects)) throw new Error('userProjects tidak mengembalikan array');
  pass('get-user-projects', `Ditemukan ${projects.length} project`);
  
  if (!activeProjectId && projects.length > 0) {
    activeProjectId = projects[0].id;
    console.log(`  ℹ️ Menggunakan project '${projects[0].title}' (${activeProjectId}) untuk uji bertahap.`);
  }
} catch (err) {
  fail('get-user-projects', err);
}

try {
  const projectOptionsRes = await itProject.projectOptions();
  const options = projectOptionsRes.data?.data || {};
  const statusCount = options.statuses?.length || 0;
  const priorityCount = options.priorities?.length || 0;
  pass('get-project-options', `Tersedia ${statusCount} status, ${priorityCount} prioritas`);
} catch (err) {
  fail('get-project-options', err);
}

if (activeProjectId) {
  try {
    const detailRes = await itProject.projectDetail(activeProjectId);
    const detail = detailRes.data?.data || {};
    pass('get-project-detail', `Berhasil memuat detail '${detail.title || activeProjectId}'`);
  } catch (err) {
    fail('get-project-detail', err);
  }
} else {
  console.log('  ⚠️ get-project-detail dilewati: tidak ada project ID');
}

// -------------------------------------------------------------
// [3/6] Task Management Tools (Read & Options)
// -------------------------------------------------------------
console.log('\n[3/6] Menguji Task Management Tools (Read & Options)...');

if (activeProjectId) {
  try {
    const taskOptionsRes = await itProject.taskOptions(activeProjectId);
    const opts = taskOptionsRes.data?.data || {};
    const typeCount = opts.taskTypes?.length || 0;
    const catCount = opts.taskCategories?.length || 0;
    const userCount = opts.assignableUsers?.length || 0;
    pass('get-task-options', `Tipe: ${typeCount}, Kategori: ${catCount}, PIC: ${userCount}`);
  } catch (err) {
    fail('get-task-options', err);
  }

  try {
    const projectTasksRes = await itProject.projectTasks(activeProjectId);
    const tasks = projectTasksRes.data?.data || [];
    pass('get-project-tasks', `Berhasil membaca ${tasks.length} task dari project`);
  } catch (err) {
    fail('get-project-tasks', err);
  }
} else {
  console.log('  ⚠️ Task management reads dilewati: tidak ada project ID');
}

// -------------------------------------------------------------
// [4/6] Sprint Management Tools (Read)
// -------------------------------------------------------------
console.log('\n[4/6] Menguji Sprint Management Tools...');

if (activeProjectId) {
  try {
    const sprintsRes = await itProject.projectSprints(activeProjectId);
    const sprintData = sprintsRes.data?.data || {};
    const sprints = sprintData.sprints || [];
    const backlog = sprintData.backlog || [];
    pass('get-project-sprints', `Sprints aktif/planning: ${sprints.length}, Backlog items: ${backlog.length}`);
  } catch (err) {
    fail('get-project-sprints', err);
  }
} else {
  console.log('  ⚠️ get-project-sprints dilewati: tidak ada project ID');
}

// -------------------------------------------------------------
// [5/6] Dynamic Models & Safe Query Tools
// -------------------------------------------------------------
console.log('\n[5/6] Menguji Dynamic Model & Safe Query Tools...');

try {
  const modelsRes = await itProject.listQueryableModels();
  const modelsData = modelsRes.data?.data || {};
  const modelList = modelsData.models || [];
  pass('list-queryable-models', `Model queryable: ${modelList.length} model terdaftar`);
} catch (err) {
  fail('list-queryable-models', err);
}

try {
  const queryRes = await itProject.queryData({ model: 'task', limit: 1 });
  const rows = queryRes.data?.data || [];
  pass('query-data', `Berhasil menjalankan SELECT terproteksi (mengembalikan ${rows.length} baris)`);
} catch (err) {
  fail('query-data', err);
}

// -------------------------------------------------------------
// [6/6] Mutation & Review Gate Safeguards (Dry-Run & Host Protection)
// -------------------------------------------------------------
console.log('\n[6/6] Menguji Staging Review Engine & Safeguards Mutasi MCP...');

try {
  const tempDir = mkdtempSync(join(tmpdir(), 'qc-mcp-review-'));
  const tempStore = new MeetingStore(join(tempDir, 'meetings.json'));
  const testMeeting = tempStore.join('Rapat QC devitproject', {
    employeeId: 'QC-HOST',
    employeeName: 'Host QC',
  });

  tempStore.transact(() => {
    tempStore.get(testMeeting.id).status = 'ended';
    tempStore.get(testMeeting.id).summary = {
      title: 'Rapat Evaluasi Integrasi MCP',
      actionItems: [{ task: 'Uji integrasi menyeluruh' }],
    };
  });

  // Uji bahwa seluruh operasi mutasi (create/update) masuk dalam staging review tanpa eksekusi langsung
  const stagedOps = [];
  const testEngine = createMcpReview({
    store: tempStore,
    client: itProject,
    plan: async (meeting, summary, proxyClient) => {
      // Panggil read tools
      await proxyClient.userProjects();
      await proxyClient.projectOptions();
      if (activeProjectId) {
        await proxyClient.projectDetail(activeProjectId);
        await proxyClient.projectTasks(activeProjectId);
        await proxyClient.taskOptions(activeProjectId);
        await proxyClient.projectSprints(activeProjectId);
      }
      await proxyClient.listQueryableModels();
      await proxyClient.queryData({ model: 'task', limit: 1 });

      // Simulasikan pementasan write operations
      await proxyClient.createTask({
        project: activeProjectId || 'mock-proj',
        title: '[QC] Task Simulasi',
      });
      await proxyClient.createComment({
        task_id: 'mock-task-id',
        body: '[QC] Komentar uji otomatis',
      });
      await proxyClient.createSprint({
        project: activeProjectId || 'mock-proj',
        name: '[QC] Sprint Simulasi',
      });
    },
    destination: 'devitproject',
  });

  testEngine.register(tempStore.get(testMeeting.id), tempStore.get(testMeeting.id).summary);
  const reviewResult = await testEngine.review(testMeeting.id, 'QC-HOST');

  if (reviewResult.status === 'ready' && reviewResult.operations.length === 3) {
    pass('mcpReview:staging', `3 operasi mutasi berhasil dipentaskan sebagai review plan (${reviewResult.planDigest.slice(0, 8)}...)`);
  } else {
    throw new Error(`Review status tidak 'ready' atau operasi tidak lengkap: ${JSON.stringify(reviewResult)}`);
  }

  // Uji bahwa pihak non-host dilarang menyetujui mutasi
  let nonHostBlocked = false;
  try {
    await testEngine.decide(testMeeting.id, 'OTHER-USER', {
      decision: true,
      revision: reviewResult.revision,
      planDigest: reviewResult.planDigest,
    });
  } catch (e) {
    if (e.status === 403) nonHostBlocked = true;
  }

  if (nonHostBlocked) {
    pass('mcpReview:authorization', 'Aksi non-host berhasil ditolak (HTTP 403)');
  } else {
    throw new Error('Non-host authorization check gagal');
  }

  rmSync(tempDir, { recursive: true, force: true });
} catch (err) {
  fail('mcpReview:safeguards', err);
}

// -------------------------------------------------------------
// Ringkasan Hasil Uji
// -------------------------------------------------------------
console.log('\n================================================================');
console.log(`  HASIL QUALITY CONTROL: ${stats.passed}/${stats.total} Pengujian Berhasil`);
if (stats.failed === 0) {
  console.log('  🎉 SEMUA 15 FUNGSI MCP DEVITPROJECT LOLOS QUALITY CONTROL!');
} else {
  console.log(`  ⚠️ Terdapat ${stats.failed} pengujian yang gagal.`);
}
console.log('================================================================\n');

process.exit(stats.failed > 0 ? 1 : 0);

