import { SUMMARY_VERSION, summaryTranscriptDigest } from './summaryGrounding.js';
import { SEA_LIVE_MODEL, seaLiveCapabilities, seaSessionDiarized } from './seaLiveConfig.js';
import express from 'express';
import { attachAuth, isOriginAllowed } from './auth.js';
import cors from 'cors';
import PDFDocument from 'pdfkit';
import { existsSync, statSync, realpathSync } from 'node:fs';
import { join, basename, relative, isAbsolute } from 'node:path';
import { randomUUID, randomBytes, createHmac, createHash } from 'node:crypto';
import { AccessToken, TokenVerifier, RoomServiceClient, WebhookReceiver, EgressClient } from 'livekit-server-sdk';
import { MeetingStore } from './meetingStore.js';
import { createAttendanceFinalizer } from './attendanceFinalizer.js';
import { createGuestAccess } from './guestAccess.js';
import { WorkspaceStore } from './workspaceStore.js';
import { attachWorkspaceApi } from './workspaceApi.js';
import { createNotifications } from './notifications.js';
import { effectiveLlm, ServiceError, summarize, transcribeAudio, batchDiarizeAudio, normalizeTranscriptText } from './providers.js';
import { attachRecordingUploads } from './recordingUploads.js';
import { createPostMeetingBatch, publicBatch } from './postMeetingBatch.js';
import { availableSttModels, QWEN_STT_MODEL } from './config.js';
import { qwenDiarizationReady } from './qwenCapabilities.js';
import { createItProjectClient } from './itproject.js';
import { QWEN_LIVE_MODEL, qwenLiveCapabilities, validateLiveFinal, speakerAliasKey, applySpeakerAliases } from './qwenLiveConfig.js';
import {
  isDbConnected,
  saveMeeting,
  saveMeetingSummary,
  savePostMeetingBatch,
  saveTranscripts,
  saveAttendees,
  getMeetingSummaries,
  getMeetingDetails,
  verifyEmployeeId,
  getAllEmployees,
  createSchedule,
  getUpcomingSchedules,
  cancelSchedule,
  updateSchedule,
} from './db.js';

const nonEmpty = (value, max = 160) => typeof value === 'string' && Boolean(value.trim()) && value.length <= max;
const requestIdValid = value => typeof value === 'string' && /^[\w-]{1,128}$/.test(value);
const asyncRoute = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const publicParticipant = ({ guestSessionHash, guestSessionExpiresAt, ...person }) => person;

const asArray = value => {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return value.trim() ? [value] : [];
    }
  }
  return [];
};

const pdfText = value => {
  if (value === null || value === undefined) return '';
  return String(value);
};

export function createApp(config, { fetchImpl = fetch, livekitProbe, authStore, workspaceStore, sendPush } = {}) {
  const app = express();
  const store = new MeetingStore(config.dataFile);
  const workspace=workspaceStore||new WorkspaceStore();
  const verifier = new TokenVerifier(config.livekitKey, config.livekitSecret);
  const webhookReceiver = new WebhookReceiver(config.livekitKey, config.livekitSecret);
  const roomService = new RoomServiceClient(config.livekitInternalUrl.replace(/^ws/, 'http'), config.livekitKey, config.livekitSecret, { requestTimeout: 1.5 });
  const egressClient = new EgressClient(config.livekitInternalUrl.replace(/^ws/, 'http'), config.livekitKey, config.livekitSecret);
  const probe = livekitProbe || (() => roomService.listRooms());
  const inFlightAudio = new Map();
  const inFlightSummarize = new Map();
  const meetingAudios = new Map();
  const postMeetingBatch = createPostMeetingBatch({ config, store, egress: egressClient, fetchImpl,
    summarize: meeting => summarize(meeting, config, fetchImpl),
    persist: async (meeting, result) => {
      if (config.databaseUrl) {
        await savePostMeetingBatch(meeting, publicBatch(result));
        await saveMeetingSummary(meeting.id, meeting.roomName, result.summary);
      }
      try {
        await syncActionItemsToItProject(meeting, result.summary);
      } catch (error) {
        console.warn('[ITPROJECT] Sinkronisasi action items dari batch gagal:', {
          meetingId: meeting.id,
          message: error.message,
        });
      }
    },
  });
  const webhookLogs = [];
  const itProject = createItProjectClient(config);
  const itprojectOAuthPending = new Map();
  const escapeHtml = value =>
    String(value ?? '').replace(/[&<>"']/g, char => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    })[char]);

  const isoDateInJakarta = value => {
    const parts = new Intl.DateTimeFormat('en', {
      timeZone: 'Asia/Jakarta',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date(value));

    const values = Object.fromEntries(
      parts.map(({ type, value }) => [type, value])
    );

    return `${values.year}-${values.month}-${values.day}`;
  };
  
  function flattenTaskTree(tasks = []) {
    return tasks.flatMap(task => [
      task,
      ...flattenTaskTree(task.sub_task_recursive || []),
    ]);
  }

  function normalizeTaskReference(value) {
    return String(value || '')
      .normalize('NFKC')
      .toLocaleLowerCase('id-ID')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim()
      .replace(/\s+/gu, ' ');
  }

  async function syncActionItemsToItProject(meeting, summary) {
    const actionItems = Array.isArray(summary.actionItems)
      ? summary.actionItems
      : [];
    const taskUpdates = Array.isArray(summary.taskUpdates)
      ? summary.taskUpdates
      : [];
    const taskEdits = Array.isArray(summary.taskEdits)
      ? summary.taskEdits
      : [];
    const projectCreations = Array.isArray(summary.projectCreations)
      ? summary.projectCreations
      : [];
    if (
      !itProject.authenticated ||
      (
        !projectCreations.length &&
        (actionItems.length || taskUpdates.length || taskEdits.length) &&
        !itProject.projectId
      )
    ) {
      console.warn('[ITPROJECT] Sync dilewati: autentikasi atau project tujuan tidak tersedia.', {
        meetingId: meeting.id,
        authenticated: itProject.authenticated,
        hasConfiguredProject: Boolean(itProject.projectId),
        projectCreations: projectCreations.length,
      });
      return;
    }

    if (!actionItems.length && !taskUpdates.length && !taskEdits.length && !projectCreations.length) {
      console.warn('[ITPROJECT] Sync dilewati: ringkasan tidak memiliki action item', {
        meetingId: meeting.id,
      });
      return;
    }

    // console.info('[ITPROJECT] Sync dimulai', {
    //   meetingId: meeting.id,
    //   actionItems: actionItems.length,
    //   taskUpdates: taskUpdates.length,
    //   taskEdits: taskEdits.length,
    //   projectId: targetProjectId,
    // });

    let targetProjectId = itProject.projectId;

    if (projectCreations.length) {
      // Versi awal mendukung satu project per rapat.
      // Hindari mengarahkan edit task lama ke project yang baru dibuat.
      if (taskUpdates.length || taskEdits.length) {
        console.warn('[ITPROJECT] Sync project baru dilewati: rapat yang sama juga mengubah task lama.', {
          meetingId: meeting.id,
        });
        return;
      }

      const requestedProject = projectCreations[0];
      const projectDispatchKey = createHash('sha256')
        .update(`${meeting.id}|${requestedProject.title.trim().toLowerCase()}`)
        .digest('hex');

      const previousProjectDispatch =
        store.get(meeting.id)?.itProjectProjectDispatch?.[projectDispatchKey];

      if (previousProjectDispatch?.status === 'created') {
        targetProjectId = previousProjectDispatch.projectId;
      } else if (
        previousProjectDispatch?.status === 'creating' ||
        previousProjectDispatch?.status === 'failed'
      ) {
        console.warn('[ITPROJECT] Create project tidak dicoba ulang otomatis; periksa dashboard untuk mencegah duplikat.', {
          meetingId: meeting.id,
          title: requestedProject.title,
          previousStatus: previousProjectDispatch.status,
          projectId: previousProjectDispatch.projectId || null,
        });
        return;
      } else {
        const projectOptionsResult = await itProject.projectOptions();
        const projectOptions = projectOptionsResult.data?.data;

        if (!projectOptions?.statuses || !projectOptions?.priorities) {
          throw new Error('Opsi status atau prioritas project tidak tersedia.');
        }

        const requestedStatus =
          projectOptions.statuses.find(option =>
            option.name?.trim().toLowerCase() ===
            requestedProject.status.trim().toLowerCase()
          );

        const requestedPriority =
          projectOptions.priorities.find(option =>
            option.name?.trim().toLowerCase() ===
            requestedProject.priority.trim().toLowerCase()
          );

        if (!requestedStatus || !requestedPriority) {
          throw new Error('Status atau prioritas project tidak cocok dengan opsi IT Project.');
        }

        const monthNumbers = {
          januari: '01',
          februari: '02',
          maret: '03',
          april: '04',
          mei: '05',
          juni: '06',
          juli: '07',
          agustus: '08',
          september: '09',
          oktober: '10',
          november: '11',
          desember: '12',
        };

        const parseProjectDate = value => {
          const text = String(value || '').trim();

          if (!text) return '';

          if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
            return text;
          }

          const match = text.match(
            /(\d{1,2})\s+(Januari|Februari|Maret|April|Mei|Juni|Juli|Agustus|September|Oktober|November|Desember)\s+(\d{4})/i
          );

          if (!match) {
            throw new Error(`Tanggal project tidak dikenali: '${text}'.`);
          }

          return `${match[3]}-${monthNumbers[match[2].toLowerCase()]}-${match[1].padStart(2, '0')}`;
        };

        const startDate =
          parseProjectDate(requestedProject.startDate) ||
          isoDateInJakarta(summary.generatedAt || meeting.createdAt || Date.now());

        const dueDate = parseProjectDate(requestedProject.dueDate);

        if (dueDate && dueDate < startDate) {
          throw new Error('Due date project tidak boleh sebelum start date.');
        }

        store.transact(() => {
          const current = store.get(meeting.id);
          current.itProjectProjectDispatch ||= {};
          current.itProjectProjectDispatch[projectDispatchKey] = {
            status: 'creating',
            title: requestedProject.title,
            startedAt: new Date().toISOString(),
          };
        });

        try {
          const projectResult = await itProject.createProject({
            title: requestedProject.title.trim(),
            description: `<p>${escapeHtml(requestedProject.description)}</p>`,
            emoji: requestedProject.emoji,
            start_date: startDate,
            ...(dueDate ? { due_date: dueDate } : {}),
            status_id: requestedStatus.id,
            priority_id: requestedPriority.id,
          });

          const createdProject =
            projectResult.data?.data ||
            projectResult.data?.project ||
            projectResult.data;

          if (!createdProject?.id) {
            throw new Error('Respons create-project tidak berisi ID project.');
          }

          targetProjectId = createdProject.id;

          store.transact(() => {
            const current = store.get(meeting.id);
            current.itProjectProjectDispatch[projectDispatchKey] = {
              status: 'created',
              title: requestedProject.title,
              projectId: targetProjectId,
              projectNo: createdProject.project_no || null,
              createdAt: new Date().toISOString(),
            };
          });

          console.info('[ITPROJECT] Project berhasil dibuat dari rapat.', {
            meetingId: meeting.id,
            projectId: targetProjectId,
            projectNo: createdProject.project_no || null,
            title: requestedProject.title,
          });
        } catch (error) {
          store.transact(() => {
            const current = store.get(meeting.id);
            current.itProjectProjectDispatch[projectDispatchKey] = {
              status: 'failed',
              title: requestedProject.title,
              error: error.message,
              failedAt: new Date().toISOString(),
            };
          });

          console.warn('[ITPROJECT] Project gagal dibuat dari rapat.', {
            meetingId: meeting.id,
            title: requestedProject.title,
            message: error.message,
          });
          return;
        }
      }
    }

    if (!targetProjectId && actionItems.length) {
      console.warn('[ITPROJECT] Task dilewati: tidak ada ID project tujuan.', {
        meetingId: meeting.id,
      });
      return;
    }

    console.info('[ITPROJECT] Sync dimulai', {
      meetingId: meeting.id,
      actionItems: actionItems.length,
      taskUpdates: taskUpdates.length,
      taskEdits: taskEdits.length,
      projectId: targetProjectId,
    });

    const optionsResult = await itProject.taskOptions(targetProjectId);
    const options = optionsResult.data?.data;

    if (!options?.taskStatuses || !options.taskPriorities ||
        !options.taskTypes || !options.assignableUsers) {
      throw new Error('Opsi task IT Project tidak lengkap.');
    }

    const existingTasks = taskUpdates.length || taskEdits.length
      ? flattenTaskTree(
          (await itProject.projectTasks(itProject.projectId)).data?.data || []
        )
      : [];

    const activeSprint = (options.sprints || []).find(
      sprint => sprint.status?.name?.trim().toLowerCase() === 'active'
    );

    if (!activeSprint) {
      console.warn('[ITPROJECT] Tidak ada sprint aktif; task akan tetap di backlog.', {
        projectId: targetProjectId,
      });
    }

    const numericIdByEncodedId = new Map([
      ['UJeeXo83zdG0pYJFV7r6', '1'],
      ['1moX49HDcroSUIwOANWL', '2'],
      ['bNiTmH27qshwj46Fc8fi', '3'],
      ['UCeeXo83zdG0pYJFV7r6', '4'],
      ['BGpapXmIwrE2LC6eY1VT', '5'],
    ]);

    const status = options.taskStatuses.find(
      option => option.name?.trim().toLowerCase() ===
        itProject.taskStatusName.trim().toLowerCase()
    );


    const defaultType = options.taskTypes.find(
      option => option.id === itProject.taskTypeId
    );

    if (!status || !defaultType) {
      throw new Error('ID status atau tipe fallback tidak cocok dengan opsi project.');
    }
    const numericStatusId = numericIdByEncodedId.get(status.id);

    if (!numericStatusId) {
      throw new Error('Status awal task belum punya pemetaan numerik.');
    }
    const normalizeActionStatus = value => {
    const key = String(value || '').trim().toLocaleLowerCase('id-ID');
    const aliases = {
      'to do': 'To Do',
      todo: 'To Do',
      blocked: 'Blocked',
      terhambat: 'Blocked',
      'in progress': 'In Progress',
      'sedang dikerjakan': 'In Progress',
      finished: 'Finished',
      'selesai dikerjakan': 'Finished',
      'in review': 'In Review',
      'sedang ditinjau': 'In Review',
      completed: 'Completed',
      komplit: 'Completed',
      tuntas: 'Completed',
    };

    return aliases[key] || '';
  };

    for (const item of actionItems) {
      const title = String(item.task || '').trim();
      if (!title) continue;
      const explicitStatusMatch = title.match(
        /\bstatus(?:nya)?\s+(to\s+do|blocked|in\s+progress|finished|in\s+review|completed|komplit|tuntas)\b/i
      );

      const statusFromTaskText = explicitStatusMatch
        ? normalizeActionStatus(explicitStatusMatch[1])
        : '';

      const requestedStatusName =
        statusFromTaskText ||
        normalizeActionStatus(item.status) ||
        status.name;

      const selectedStatus = options.taskStatuses.find(
        option => option.name?.trim().toLowerCase() ===
          requestedStatusName.toLowerCase()
      );

      if (!selectedStatus) {
        console.warn('[ITPROJECT] Status task tidak tersedia; task dilewati.', {
          meetingId: meeting.id,
          title,
          requestedStatus: item.status || '',
        });
        continue;
      }
      const requestedTypeName = String(item.type || '').trim().toLowerCase();
      const selectedType = requestedTypeName
        ? options.taskTypes.find(
            option => option.name?.trim().toLowerCase() === requestedTypeName
          )
        : null;

      const type = selectedType || defaultType;
      const numericTypeId = numericIdByEncodedId.get(type.id);

      if (!numericTypeId) {
        console.warn('[ITPROJECT] Tipe task tidak punya pemetaan numerik; task dilewati.', {
          meetingId: meeting.id,
          title,
          requestedType: item.type || '',
        });
        continue;
      }

      const key = createHash('sha256')
        .update([
          meeting.id,
          title.toLowerCase(),
          String(item.assignee || '').trim().toLowerCase(),
          String(item.deadline || '').trim().toLowerCase(),
        ].join('|'))
        .digest('hex');

      // Jangan kirim ulang item yang pernah dicoba agar tidak membuat duplikat
      // jika respons server hilang setelah task sebenarnya berhasil dibuat.
      const previousDispatch =
        store.get(meeting.id)?.itProjectTaskDispatch?.[key];

      if (
        previousDispatch?.status === 'created' ||
        previousDispatch?.status === 'creating'
      ) {
        continue;
      }

      const priorityName = String(item.priority || '').trim().toLowerCase();
      const priority = options.taskPriorities.find(
        option => option.name?.trim().toLowerCase() === priorityName
      );

      const numericPriorityId = priority
        ? numericIdByEncodedId.get(priority.id)
        : null;

      if (!priority) {
        store.transact(() => {
          const current = store.get(meeting.id);
          current.itProjectTaskDispatch ||= {};
          current.itProjectTaskDispatch[key] = {
            status: 'failed',
            title,
            error: `Prioritas '${item.priority}' tidak tersedia atau belum punya pemetaan numerik.`,
          };
        });
        continue;
      }

      const assigneeName = String(item.assignee || '').trim();
      const matches = assigneeName
        ? options.assignableUsers.filter(user =>
            user.name?.trim().toLowerCase() === assigneeName.toLowerCase() ||
            user.email?.trim().toLowerCase() === assigneeName.toLowerCase())
        : [];
      const owner = matches.length === 1 ? matches[0] : null;

      const description = [
        `<p>Sumber: rapat ${escapeHtml(meeting.roomName)} (${escapeHtml(meeting.id)})</p>`,
        assigneeName
          ? `<p>PIC dari notulen: ${escapeHtml(assigneeName)}${owner ? '' : ' (belum cocok dengan anggota project)'}</p>`
          : '',
        item.deadline
          ? `<p>Tenggat dari notulen: ${escapeHtml(item.deadline)}</p>`
          : '',
      ].filter(Boolean).join('');

      const dueDateMatch = String(item.deadline || '').match(
        /(\d{1,2})\s+(Januari|Februari|Maret|April|Mei|Juni|Juli|Agustus|September|Oktober|November|Desember)\s+(\d{4})/i
      );

      const mentionedStartDate = String(item.startDate || '').trim();
      const startDate = /^\d{4}-\d{2}-\d{2}$/.test(mentionedStartDate)
        ? mentionedStartDate
        : isoDateInJakarta(
            summary.generatedAt || meeting.createdAt || Date.now()
          );

      const monthNumbers = {
        januari: '01',
        februari: '02',
        maret: '03',
        april: '04',
        mei: '05',
        juni: '06',
        juli: '07',
        agustus: '08',
        september: '09',
        oktober: '10',
        november: '11',
        desember: '12',
      };

      const deadlineText = String(item.deadline || '').trim();
      const isoDeadlineMatch = deadlineText.match(/\b(\d{4}-\d{2}-\d{2})\b/);

      const dueDate = isoDeadlineMatch
        ? isoDeadlineMatch[1]
        : dueDateMatch
          ? `${dueDateMatch[3]}-${monthNumbers[dueDateMatch[2].toLowerCase()]}-${dueDateMatch[1].padStart(2, '0')}`
          : '';
          
      store.transact(() => {
        const current = store.get(meeting.id);
        current.itProjectTaskDispatch ||= {};
        current.itProjectTaskDispatch[key] = {
          status: 'creating',
          title,
          startedAt: new Date().toISOString(),
        };
      });

      try {
        let task = null;

        // Jika percobaan sebelumnya gagal setelah mulai mengirim create-task,
        // cari task yang mungkin sudah dibuat sebelum mengirim ulang.
        if (previousDispatch?.status === 'failed' && previousDispatch.startedAt) {
          const existingResult = await itProject.projectTasks(itProject.projectId);
          const existingTasks = flattenTaskTree(existingResult.data?.data || []);
          const previousStartedAt = Date.parse(previousDispatch.startedAt);

          task = existingTasks.find(candidate =>
            candidate.title?.trim().toLowerCase() === title.toLowerCase() &&
            Number.isFinite(Date.parse(candidate.created_at)) &&
            Date.parse(candidate.created_at) >= previousStartedAt - 60_000
          ) || null;
        }

        if (!task) {
          const result = await itProject.createTask({
            project: targetProjectId,
            title,
            status_id: numericStatusId,
            priority_id: numericPriorityId,
            type_id: numericTypeId,
            task_category_id: itProject.taskCategoryId,
            assign_users: owner ? [owner.id] : [],
            description,
            start_date: startDate,
            ...(dueDate ? { due_date: dueDate } : {}),
          });

          task = result.data?.data;
        }

        if (!task?.id) {
          throw new Error('Respons create-task tidak berisi ID task.');
        }

        let statusUpdate = 'unchanged';

        if (selectedStatus.id !== status.id) {
          const selectedStatusName = selectedStatus.name.trim().toLowerCase();
          const statusNeedsDueDate =
            !['to do', 'blocked'].includes(selectedStatusName);
          const statusDueDate = dueDate || task.due_date || '';

          if (statusNeedsDueDate && !statusDueDate) {
            statusUpdate = 'skipped_missing_due_date';
            console.warn('[ITPROJECT] Status task tidak diubah karena due date wajib belum tersedia.', {
              meetingId: meeting.id,
              taskId: task.id,
              requestedStatus: selectedStatus.name,
            });
          } else {
            await itProject.updateTaskStatus({
              task: task.id,
              status_id: selectedStatus.id,
              ...(statusDueDate ? { due_date: statusDueDate } : {}),
            });
            statusUpdate = 'updated';
          }
        }

        let sprintAssignment = 'no_active_sprint';

        if (activeSprint?.id) {
          try {
            await itProject.assignSprintTasks({
              sprint: activeSprint.id,
              task_ids: [task.id],
            });
            sprintAssignment = 'assigned';
          } catch (error) {
            sprintAssignment = 'failed';
            console.warn('[ITPROJECT] Task dibuat, tetapi gagal ditambahkan ke sprint aktif:', {
              meetingId: meeting.id,
              taskId: task.id,
              sprintId: activeSprint.id,
              sprintName: activeSprint.name,
              message: error.message,
            });
          }
        }

        store.transact(() => {
          const current = store.get(meeting.id);
          current.itProjectTaskDispatch[key] = {
            status: 'created',
            title,
            taskId: task.id,
            sprintAssignment,
            createdAt: new Date().toISOString(),
          };
        });
        console.info('[ITPROJECT] Task berhasil dibuat', {
          meetingId: meeting.id,
          taskId: task.id,
          title,
          taskType: type.name,
          startDate,
          dueDate: dueDate || null,
          deadlineFromSummary: item.deadline || null,
          sprintAssignment,
          sprintName: activeSprint?.name || null,
          taskStatus: selectedStatus.name,
          statusUpdate,
        });
      } catch (error) {
        store.transact(() => {
          const current = store.get(meeting.id);
          const previous = current.itProjectTaskDispatch?.[key];
          current.itProjectTaskDispatch[key] = {
            status: 'failed',
            title,
            error: error.message,
            startedAt: previous?.startedAt,
            failedAt: new Date().toISOString(),
          };
        });
        console.warn('[ITPROJECT] Task gagal dibuat:', {
          meetingId: meeting.id,
          message: error.message,
        });
      }
    }
      for (const update of taskUpdates) {
        const reference = normalizeTaskReference(update.task);

        const matches = existingTasks.filter(candidate => {
          const candidateTitle = normalizeTaskReference(candidate.title);
          return (
            candidateTitle === reference ||
            (reference.length >= 12 && candidateTitle.includes(reference))
          );
        });

        if (matches.length !== 1) {
          console.warn('[ITPROJECT] Update status task lama dilewati: referensi tidak unik.', {
            meetingId: meeting.id,
            taskReference: update.task,
            matches: matches.length,
          });
          continue;
        }

        const existingTask = matches[0];
        const selectedStatus = options.taskStatuses.find(
          option =>
            option.name?.trim().toLowerCase() ===
            String(update.status).trim().toLowerCase()
        );

        if (!selectedStatus) {
          console.warn('[ITPROJECT] Update status task lama dilewati: status tidak tersedia.', {
            meetingId: meeting.id,
            taskId: existingTask.id,
            requestedStatus: update.status,
          });
          continue;
        }

        if (existingTask.status?.id === selectedStatus.id) {
          console.info('[ITPROJECT] Status task lama tidak berubah.', {
            meetingId: meeting.id,
            taskId: existingTask.id,
            title: existingTask.title,
            status: selectedStatus.name,
          });
          continue;
        }

        const existingDueDate = existingTask.due_date || '';
        const statusNeedsDueDate =
          !['to do', 'blocked'].includes(selectedStatus.name.trim().toLowerCase());

        if (statusNeedsDueDate && !existingDueDate) {
          console.warn('[ITPROJECT] Update status task lama dilewati: task belum memiliki due date.', {
            meetingId: meeting.id,
            taskId: existingTask.id,
            title: existingTask.title,
            requestedStatus: selectedStatus.name,
          });
          continue;
        }

        try {
          await itProject.updateTaskStatus({
            task: existingTask.id,
            status_id: selectedStatus.id,
            ...(existingDueDate ? { due_date: existingDueDate } : {}),
          });

          console.info('[ITPROJECT] Status task lama berhasil diubah.', {
            meetingId: meeting.id,
            taskId: existingTask.id,
            title: existingTask.title,
            previousStatus: existingTask.status?.name || null,
            newStatus: selectedStatus.name,
          });
        } catch (error) {
          console.warn('[ITPROJECT] Update status task lama gagal.', {
            meetingId: meeting.id,
            taskId: existingTask.id,
            title: existingTask.title,
            requestedStatus: selectedStatus.name,
            message: error.message,
          });
        }
      }
      for (const edit of taskEdits) {
        const reference = normalizeTaskReference(edit.task);
        const changes = edit.changes || {};

        const matches = existingTasks.filter(candidate => {
          const candidateTitle = normalizeTaskReference(candidate.title);

          // Izinkan judul lengkap atau frasa khas dari judul.
          // Tetap wajib cocok ke tepat satu task.
          return (
            candidateTitle === reference ||
            (
              reference.length >= 12 &&
              candidateTitle.length >= 12 &&
              (
                candidateTitle.includes(reference) ||
                reference.includes(candidateTitle)
              )
            )
          );
        });

        if (matches.length !== 1) {
          console.warn('[ITPROJECT] Edit task lama dilewati: referensi tidak unik.', {
            meetingId: meeting.id,
            taskReference: edit.task,
            matches: matches.length,
          });
          continue;
        }

        const existingTask = matches[0];
        const updateArgs = { task: existingTask.id };
        const changedFields = [];

        // Mencocokkan nama opsi secara persis setelah normalisasi.
        // Jika tidak ada atau hasilnya ambigu, jangan menebak ID.
        const findUniqueOption = (list, name, fieldName) => {
          const normalizedName = normalizeTaskReference(name);
          const found = (list || []).filter(option =>
            normalizeTaskReference(option.name) === normalizedName
          );

          if (found.length !== 1) {
            throw new Error(
              `Opsi ${fieldName} '${name}' tidak ditemukan atau tidak unik.`
            );
          }

          return found[0];
        };

        const findUniqueUser = name => {
          const normalizedName = normalizeTaskReference(name);
          const found = (options.assignableUsers || []).filter(user =>
            normalizeTaskReference(user.name) === normalizedName ||
            normalizeTaskReference(user.email) === normalizedName
          );

          if (found.length !== 1) {
            throw new Error(
              `Anggota project '${name}' tidak ditemukan atau tidak unik.`
            );
          }

          return found[0];
        };

        const parseEditDate = value => {
          const text = String(value || '').trim();

          if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
            return text;
          }

          const match = text.match(
            /(\d{1,2})\s+(Januari|Februari|Maret|April|Mei|Juni|Juli|Agustus|September|Oktober|November|Desember)\s+(\d{4})/i
          );

          if (!match) {
            throw new Error(
              `Tanggal '${text}' tidak dikenali. Gunakan tanggal lengkap yang dapat diubah ke YYYY-MM-DD.`
            );
          }

          const monthNumbers = {
            januari: '01',
            februari: '02',
            maret: '03',
            april: '04',
            mei: '05',
            juni: '06',
            juli: '07',
            agustus: '08',
            september: '09',
            oktober: '10',
            november: '11',
            desember: '12',
          };

          return `${match[3]}-${monthNumbers[match[2].toLowerCase()]}-${match[1].padStart(2, '0')}`;
        };

        try {
          if (Object.hasOwn(changes, 'title')) {
            const value = String(changes.title || '').trim();
            if (!value) {
              throw new Error('Judul baru kosong.');
            }
            updateArgs.title = value;
            changedFields.push('title');
          }

          if (Object.hasOwn(changes, 'description')) {
            const value = String(changes.description || '').trim();
            updateArgs.description = value
              ? `<p>${escapeHtml(value)}</p>`
              : '';
            changedFields.push('description');
          }

          if (Object.hasOwn(changes, 'emoji')) {
            const value = String(changes.emoji || '').trim();
            if (!value) {
              throw new Error('Emoji baru kosong.');
            }
            updateArgs.emoji = value;
            changedFields.push('emoji');
          }

          if (Object.hasOwn(changes, 'startDate')) {
            updateArgs.start_date = parseEditDate(changes.startDate);
            changedFields.push('start_date');
          }

          if (Object.hasOwn(changes, 'dueDate')) {
            updateArgs.due_date = parseEditDate(changes.dueDate);
            changedFields.push('due_date');
          }

          if (
            updateArgs.start_date &&
            updateArgs.due_date &&
            updateArgs.due_date < updateArgs.start_date
          ) {
            throw new Error('Due date tidak boleh sebelum start date.');
          }

          if (Object.hasOwn(changes, 'priority')) {
            const option = findUniqueOption(
              options.taskPriorities,
              changes.priority,
              'prioritas'
            );
            updateArgs.priority_id = option.id;
            changedFields.push('priority');
          }

          if (Object.hasOwn(changes, 'type')) {
            const option = findUniqueOption(
              options.taskTypes,
              changes.type,
              'tipe task'
            );
            updateArgs.type_id = option.id;
            changedFields.push('type');
          }

          if (Object.hasOwn(changes, 'category')) {
            const value = String(changes.category || '').trim();

            // String kosong hanya untuk permintaan eksplisit menghapus kategori.
            updateArgs.task_category_id = value
              ? findUniqueOption(
                  options.taskCategories,
                  value,
                  'kategori'
                ).id
              : '';
            changedFields.push('category');
          }

          if (Object.hasOwn(changes, 'parent')) {
            const value = String(changes.parent || '').trim();

            if (!value) {
              updateArgs.parent_id = '';
            } else {
              const parent = findUniqueOption(
                options.taskParents,
                value,
                'parent task'
              );

              const descendants = new Set(
                flattenTaskTree(existingTask.sub_task_recursive || [])
                  .map(task => task.id)
              );

              if (
                parent.id === existingTask.id ||
                descendants.has(parent.id)
              ) {
                throw new Error(
                  'Task tidak boleh menjadi parent dirinya sendiri atau subtaksnya.'
                );
              }

              updateArgs.parent_id = parent.id;
            }

            changedFields.push('parent');
          }

          if (Object.hasOwn(changes, 'owner')) {
            const owner = findUniqueUser(changes.owner);
            updateArgs.owned_id = owner.id;
            changedFields.push('owner');
          }

          if (Object.hasOwn(changes, 'assignUsers')) {
            const users = changes.assignUsers.map(findUniqueUser);
            if (users.length) {
              updateArgs.assign_users = users.map(user => user.id);
              changedFields.push('assignUsers');
            }
          }

          if (Object.hasOwn(changes, 'unassignUsers')) {
            const users = changes.unassignUsers.map(findUniqueUser);
            if (users.length) {
              updateArgs.unassign_users = users.map(user => user.id);
              changedFields.push('unassignUsers');
            }
          }

          if (Object.hasOwn(changes, 'tags')) {
            const tags = changes.tags.map(name =>
              findUniqueOption(options.tags, name, 'tag')
            );
            if (tags.length) {
              updateArgs.tag_ids = tags.map(tag => tag.id);
              changedFields.push('tags');
            }
          }

          if (Object.hasOwn(changes, 'removeTags')) {
            const tags = changes.removeTags.map(name =>
              findUniqueOption(options.tags, name, 'tag')
            );
            if (tags.length) {
              updateArgs.remove_tag_ids = tags.map(tag => tag.id);
              changedFields.push('removeTags');
            }
          }

          if (!changedFields.length) {
            console.info('[ITPROJECT] Edit task lama dilewati: tidak ada field yang berubah.', {
              meetingId: meeting.id,
              taskId: existingTask.id,
              title: existingTask.title,
            });
            continue;
          }

          // Tool meminta tanggal untuk task yang statusnya bukan To Do/Blocked.
          // Jika tidak diedit dalam rapat, teruskan tanggal lama agar nilainya tetap.
          const currentStatus = existingTask.status?.name
            ?.trim()
            .toLowerCase();

          if (!['to do', 'blocked'].includes(currentStatus)) {
            updateArgs.start_date ||= existingTask.start_date || '';
            updateArgs.due_date ||= existingTask.due_date || '';

            if (!updateArgs.start_date || !updateArgs.due_date) {
              console.warn('[ITPROJECT] Edit task lama dilewati: start date atau due date task belum tersedia.', {
                meetingId: meeting.id,
                taskId: existingTask.id,
                title: existingTask.title,
                requestedFields: changedFields,
              });
              continue;
            }
          }

          await itProject.updateTask(updateArgs);

          console.info('[ITPROJECT] Field task lama berhasil diubah.', {
            meetingId: meeting.id,
            taskId: existingTask.id,
            title: existingTask.title,
            changedFields,
          });
        } catch (error) {
          console.warn('[ITPROJECT] Edit task lama gagal atau dilewati.', {
            meetingId: meeting.id,
            taskId: existingTask.id,
            title: existingTask.title,
            requestedFields: changedFields,
            message: error.message,
          });
        }
      }
  }

  app.use('/api', (req,res,next)=>{
    req.requestId=randomUUID();
    res.setHeader('X-Request-ID',req.requestId);
    next();
  });
  app.use(cors({ credentials: true, exposedHeaders:['X-Request-ID'], origin(origin, callback) {
    callback(null, isOriginAllowed(origin, config));
  } }));

  // Preserve rawBody buffer for LiveKit cryptographic webhook signature verification
  app.use('/api/profile',express.json({limit:'2mb'}));
  app.use(express.json({
    limit: '256kb',
    type: ['application/json', 'application/webhook+json'],
    verify: (req, _res, buf) => {
      req.rawBody = buf ? buf.toString('utf8') : '';
    },
  }));

  attachAuth(app, config, authStore, createGuestAccess(store));
  attachWorkspaceApi(app,config,workspace);
  attachRecordingUploads(app, config, { fetchImpl });
  const notifications=config.authEnabled?createNotifications({workspace,meetings:()=>store.meetings,schedules:getUpcomingSchedules,config,sendPush}):null;

  app.get('/api/itproject/project-options', asyncRoute(async (_req, res) => {
    if (!config.itprojectProjectCreationTestEnabled) {
      return res.status(404).json({ error: 'Endpoint uji project tidak aktif.' });
    }
    if (!itProject.authenticated) {
      return res.status(401).json({ error: 'Login OAuth IT Project belum dilakukan.' });
    }

    const result = await itProject.projectOptions();
    res.set('Cache-Control', 'no-store').json(result.data);
  }));

  app.post('/api/itproject/projects', asyncRoute(async (req, res) => {
    if (!config.itprojectProjectCreationTestEnabled) {
      return res.status(404).json({ error: 'Endpoint uji project tidak aktif.' });
    }
    if (!itProject.authenticated) {
      return res.status(401).json({ error: 'Login OAuth IT Project belum dilakukan.' });
    }

    const {
      title,
      description,
      emoji,
      start_date: startDate,
      due_date: dueDate,
      status_id: statusId,
      priority_id: priorityId,
    } = req.body || {};

    const validDate = value => {
      if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
      const parsed = new Date(`${value}T00:00:00.000Z`);
      return !Number.isNaN(parsed.valueOf()) &&
        parsed.toISOString().slice(0, 10) === value;
    };

    if (!nonEmpty(title, 160) || !nonEmpty(description, 8000) ||
        !nonEmpty(emoji, 16) || !validDate(startDate) ||
        !nonEmpty(statusId, 128) || !nonEmpty(priorityId, 128)) {
      return res.status(400).json({
        error: 'Isi title, description, emoji, start_date, status_id, dan priority_id dengan benar.',
      });
    }

    if (dueDate && (!validDate(dueDate) || dueDate < startDate)) {
      return res.status(400).json({
        error: 'due_date harus berformat YYYY-MM-DD dan tidak boleh sebelum start_date.',
      });
    }

    const result = await itProject.createProject({
      title: title.trim(),
      description,
      emoji,
      start_date: startDate,
      ...(dueDate ? { due_date: dueDate } : {}),
      status_id: statusId,
      priority_id: priorityId,
    });

    res.status(201).set('Cache-Control', 'no-store').json({
      success: true,
      result: result.data,
    });
  }));

  async function dispatchOutboundWebhook(url, payload) {
    if (!url) return;
    try {
      await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      console.warn('[OUTBOUND WEBHOOK] Dispatch note:', err.message);
    }
  }

  app.get('/api/itproject/task-options', asyncRoute(async (req, res) => {
    if (!config.itprojectProjectCreationTestEnabled) {
      return res.status(404).json({ error: 'Endpoint uji project tidak aktif.' });
    }
    if (!itProject.authenticated) {
      return res.status(401).json({ error: 'Login OAuth IT Project belum dilakukan.' });
    }

    const project = typeof req.query.project === 'string'
      ? req.query.project
      : '';

    if (!nonEmpty(project, 128)) {
      return res.status(400).json({ error: 'Isi project dengan ID project ter-encode.' });
    }

    const result = await itProject.taskOptions(project);
    res.set('Cache-Control', 'no-store').json(result.data);
  }));

  app.post('/api/itproject/tasks', asyncRoute(async (req, res) => {
    if (!config.itprojectProjectCreationTestEnabled) {
      return res.status(404).json({ error: 'Endpoint uji project tidak aktif.' });
    }
    if (!itProject.authenticated) {
      return res.status(401).json({ error: 'Login OAuth IT Project belum dilakukan.' });
    }

    const {
      project,
      title,
      status_id: statusId,
      priority_id: priorityId,
      type_id: typeId,
      task_category_id: taskCategoryId,
      description = '',
    } = req.body || {};

    if (!nonEmpty(project, 128) || !nonEmpty(title, 160) ||
        !nonEmpty(statusId, 128) || !nonEmpty(priorityId, 128) ||
        !nonEmpty(typeId, 128) ||
        (taskCategoryId && !nonEmpty(taskCategoryId, 128)) ||
        typeof description !== 'string' || description.length > 8000) {
      return res.status(400).json({
        error: 'Isi project, title, status_id, priority_id, dan type_id dengan benar.',
      });
    }

    const result = await itProject.createTask({
      project,
      title: title.trim(),
      status_id: statusId,
      priority_id: priorityId,
      type_id: typeId,
      ...(taskCategoryId ? { task_category_id: taskCategoryId } : {}),
      assign_users: [],
      description,
    });

    res.status(201).set('Cache-Control', 'no-store').json({
      success: true,
      result: result.data,
    });
  }));

  app.get('/api/itproject/oauth/start', (req, res) => {
  if (!config.itprojectOAuthClientId || !config.itprojectOAuthRedirectUri) {
    return res.status(503).send('Konfigurasi OAuth IT Project belum lengkap.');
  }

  const now = Date.now();
  for (const [state, pending] of itprojectOAuthPending) {
    if (pending.expiresAt <= now) itprojectOAuthPending.delete(state);
  }

  const state = randomBytes(32).toString('base64url');
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');

  itprojectOAuthPending.set(state, {
    verifier,
    expiresAt: now + 10 * 60 * 1000,
  });

  const authorizeUrl = new URL(
    'https://devitproject.balitower.co.id/oauth/authorize'
  );
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('client_id', config.itprojectOAuthClientId);
  authorizeUrl.searchParams.set('redirect_uri', config.itprojectOAuthRedirectUri);
  authorizeUrl.searchParams.set('scope', 'mcp:use');
  authorizeUrl.searchParams.set('resource', 'https://devitproject.balitower.co.id/mcp');
  authorizeUrl.searchParams.set('state', state);
  authorizeUrl.searchParams.set('code_challenge', challenge);
  authorizeUrl.searchParams.set('code_challenge_method', 'S256');

  res.set('Cache-Control', 'no-store').redirect(authorizeUrl.toString());
});

  app.get('/oauth/callback', asyncRoute(async (req, res) => {
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const pending = itprojectOAuthPending.get(state);

    itprojectOAuthPending.delete(state);

    if (!pending || pending.expiresAt <= Date.now() || !code) {
      return res.status(400).send('Callback OAuth tidak valid atau sudah kedaluwarsa.');
    }

    const form = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: config.itprojectOAuthClientId,
      code,
      redirect_uri: config.itprojectOAuthRedirectUri,
      code_verifier: pending.verifier,
      resource: 'https://devitproject.balitower.co.id/mcp',
    });

    const response = await fetchImpl('https://devitproject.balitower.co.id/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form,
    });

    if (!response.ok) {
      return res.status(502).send('IT Project gagal menerbitkan token OAuth.');
    }

    const tokens = await response.json();
    if (!tokens.access_token) {
      return res.status(502).send('Respons OAuth tidak berisi access token.');
    }

    try {
      itProject.setOAuthTokens(tokens);
    } catch (error) {
      console.error('[ITPROJECT] OAuth tokens could not be persisted:', error.message);
      return res.status(500).send(
        'Login OAuth IT Project berhasil. Token tersimpan untuk digunakan kembali setelah backend restart.'
      );
    }

    res.set('Cache-Control', 'no-store').send(
      'Login OAuth IT Project berhasil. Token tersimpan sementara di memori backend.'
    );
  }));

  // 1. Health check & provider/database info
  app.get('/api/health', asyncRoute(async (_req, res) => {
    let livekitStatus = 'unavailable';
    try { await probe(); livekitStatus = 'reachable'; } catch { /* API health is independent of SFU. */ }
    const llmEffectiveProvider = effectiveLlm(config);
    const [qwenLive, seaLive] = await Promise.all([qwenLiveCapabilities(config, fetchImpl), seaLiveCapabilities(config, fetchImpl)]);
    const seaLivePilotReady = config.seaLivePilotEnabled && seaLive.ready;
    res.json({
      status: 'ok',
      livekitUrl: config.livekitUrl,
      livekitStatus,
      llmProvider: config.llmProvider,
      llmModel: config.llmModel,
      llmEffectiveProvider,
      hasLlmKey: llmEffectiveProvider !== 'demo',
      sttProvider: config.sttProvider,
      sttConfigured: Boolean(config.sttModel && (config.sttModel === QWEN_STT_MODEL ? config.qwenSttBaseUrl : config.sttBaseUrl)),
      sttDiarization: Boolean(config.sttDiarization),
      qwenDiarizationReady: await qwenDiarizationReady(config, fetchImpl),
      qwenLiveReady: qwenLive.ready,
      qwenBatchConfigured: postMeetingBatch.configured,
      qwenBatchWorkerReady: await postMeetingBatch.workerReady(),
      qwenLiveDiarizationReady: qwenLive.diarization,
      seaLivePilotReady,
      seaLiveDiarizationReady: seaLivePilotReady && seaLive.diarization,
      sttModel: config.sttModel,
      sttModels: [...availableSttModels(config),
        ...(config.liveSttUrl && config.liveSttSecret ? ['whisperlivekit-small'] : []),
        ...(qwenLive.ready ? [QWEN_LIVE_MODEL] : []),
        ...(seaLivePilotReady ? [SEA_LIVE_MODEL] : [])],
      database: {
        connected: isDbConnected(),
        configured: Boolean(config.databaseUrl),
      },
      outboundWebhookConfigured: Boolean(config.outboundWebhookUrl),
      totalWebhookEvents: webhookLogs.length,
    });
  }));

  // 2. Authorized employee directory
  app.get('/api/employees', asyncRoute(async (_req, res) => {
    const list = await getAllEmployees();
    res.json({
      success: true,
      count: list.length,
      databaseConnected: isDbConnected(),
      employees: list,
    });
  }));

  // 3. Generate LiveKit token with database employee verification
  app.post('/api/token', asyncRoute(async (req, res) => {
    if (req.auth) req.body = { ...req.body, employeeId: req.auth.user.employeeId, employeeName: req.auth.user.name, department: req.auth.user.department };
    let { roomName, employeeId, employeeName, department = 'General' } = req.body || {};
    if (!nonEmpty(department)) department = 'General';

    if (![roomName, employeeId, employeeName].every(value => nonEmpty(value))) {
      return res.status(400).json({ error: 'Room, employee ID, and name must be non-empty strings (max 160 characters)' });
    }

    const cleanId = employeeId.trim();
    const guestMeeting = req.auth?.user.isGuest ? store.get(req.auth.user.guestMeetingId) : null;
    if (req.auth?.user.isGuest && (!guestMeeting || guestMeeting.status !== 'active' || guestMeeting.attendanceFinalization || guestMeeting.closingForUploads || roomName.trim() !== guestMeeting.roomName)) return res.status(403).json({ error: 'Undangan tamu tidak berlaku untuk ruang ini.' });

    // Verify employee ID format and database registration
    if (config.verifyEmployeeId && !req.auth?.user.isGuest) {
      const empCheck = await verifyEmployeeId(cleanId);
      if (!empCheck.valid) {
        if (empCheck.formatError) {
          console.warn(`[AUTH] ⚠️ Format ID Salah: "${cleanId}"`);
          return res.status(400).json({
            error: 'Format ID Salah.',
            code: 'INVALID_ID_FORMAT',
            employeeId: cleanId,
            hint: 'Format resmi ID karyawan harus berupa "BT-XXXXX" (contoh: BT-10492).',
          });
        }

        const errorMsg = empCheck.inactive
          ? `Akses ditolak: Status karyawan dengan ID "${cleanId}" sedang non-aktif.`
          : `Akses ditolak: Employee ID "${cleanId}" tidak terdaftar di database resmi perusahaan. Harap periksa kembali ID Anda atau hubungi admin.`;

        console.warn(`[AUTH] ⛔ Access denied for Employee ID "${cleanId}": ${empCheck.reason}`);
        return res.status(403).json({
          error: errorMsg,
          code: 'EMPLOYEE_NOT_FOUND',
          employeeId: cleanId,
          verifiedAgainstDb: empCheck.checked,
        });
      }

      // Use authoritative name and department from company DB if registered
      if (empCheck.employee?.name) employeeName = empCheck.employee.name;
      if (empCheck.employee?.department) department = empCheck.employee.department;
      if(req.auth)employeeName=req.auth.user.name;
    }

    const active = [...store.meetings.values()].find(meeting => meeting.roomName === roomName.trim() && meeting.status === 'active');
    const duplicate = active?.participants.get(cleanId);
    if (duplicate && !duplicate.leftAt && (!req.auth?.user.isGuest || duplicate.guestTokenIssued) && Date.now() - Date.parse(duplicate.lastSeen) < 45000) {
      return res.status(409).json({ error: 'This employee is already joining or connected. Use a different identity for another test window.' });
    }
    // const meeting = guestMeeting || store.join(roomName.trim(), { employeeId: cleanId, employeeName: employeeName.trim(), department: department.trim() });
    let scheduledHostId = '';

    if (!guestMeeting) {
      const schedules = await getUpcomingSchedules().catch(() => []);
      const now = Date.now();

      const scheduled = schedules.find(item =>
        item.roomName === roomName.trim() &&
        item.hostId &&
        Date.parse(item.scheduledStart) <= now + 60_000 &&
        Date.parse(item.scheduledEnd) > now
      );

      scheduledHostId = scheduled?.hostId || '';
    }

    const meeting = guestMeeting || store.join(roomName.trim(), {
      employeeId: cleanId,
      employeeName: employeeName.trim(),
      department: department.trim(),
      hostId: scheduledHostId || cleanId,
    });
    if (guestMeeting) store.transact(() => { const person = meeting.participants.get(cleanId); person.guestTokenIssued = true; person.leftAt = null; person.lastSeen = new Date().toISOString(); });
    
    // Asynchronously record meeting in PostgreSQL if configured
    saveMeeting({ id: meeting.id, roomName: meeting.roomName, status: 'active', createdAt: meeting.createdAt }).catch(() => {});
    const participant = meeting.participants.get(cleanId);
    const microphoneIsRestricted = Boolean(participant?.moderatorMuted);

    const at = new AccessToken(config.livekitKey, config.livekitSecret, {
      identity: cleanId,
      name: employeeName.trim(),
      ttl: '12h',
      metadata: JSON.stringify({
        meetingId: meeting.id,
        department: department.trim(),
        employeeId: cleanId,
        isGuest: Boolean(req.auth?.user.isGuest),
      }),
    });

    const grant = {
      room: meeting.livekitRoom,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    };

    if (microphoneIsRestricted) {
      // TrackSource: camera=1, microphone=2,
      // screen_share=3, screen_share_audio=4.
      grant.canPublishSources = [1, 3, 4];
    }

    at.addGrant(grant);

    res.json({
      token: await at.toJwt(),
      url: config.livekitUrl,
      roomName: meeting.roomName,
      meetingId: meeting.id,
      sttProvider: config.sttProvider,
    });
  }));

  // 4. Meeting scheduling & calendar endpoints
  app.get('/api/schedules', asyncRoute(async (_req, res) => {
    const schedules = await getUpcomingSchedules();
    res.json({
      success: true,
      count: schedules.length,
      schedules,
    });
  }));

  app.post('/api/schedules', asyncRoute(async (req, res) => {
    if (req.auth) req.body = { ...req.body, hostId: req.auth.user.employeeId, hostName: req.auth.user.name, department: req.auth.user.department };
    const {
      roomName,
      title,
      description = '',
      hostId = '',
      hostName = '',
      department = 'General',
      scheduledStart,
      scheduledEnd,
    } = req.body || {};

    if (!nonEmpty(title) || !nonEmpty(roomName)) {
      return res.status(400).json({ error: 'Judul rapat dan nama ruang wajib diisi (maksimal 160 karakter).' });
    }

    if (!scheduledStart || !scheduledEnd) {
      return res.status(400).json({ error: 'Waktu mulai dan waktu selesai rapat wajib ditentukan.' });
    }

    const startTime = Date.parse(scheduledStart);
    const endTime = Date.parse(scheduledEnd);

    if (isNaN(startTime) || isNaN(endTime)) {
      return res.status(400).json({ error: 'Format tanggal atau waktu rapat tidak valid.' });
    }

    // Validation: Start time cannot be in the past (allow 60s tolerance for network latency)
    if (startTime < Date.now() - 60000) {
      return res.status(400).json({
        error: 'Waktu mulai rapat tidak boleh di masa lalu. Harap pilih tanggal dan jam yang akan datang.',
        code: 'PAST_TIME_NOT_ALLOWED',
      });
    }

    // Validation: End time must be after start time
    if (endTime <= startTime) {
      return res.status(400).json({
        error: 'Waktu selesai rapat harus setelah waktu mulai.',
        code: 'INVALID_TIME_RANGE',
      });
    }

    // Host Employee verification if provided and enabled
    let finalHostName = hostName || 'Penyelenggara BaliCall';
    let finalDepartment = department || 'General';
    if (hostId && config.verifyEmployeeId) {
      const cleanHostId = hostId.trim();
      const empCheck = await verifyEmployeeId(cleanHostId);
      if (!empCheck.valid) {
        if (empCheck.formatError) {
          return res.status(400).json({
            error: 'Format ID Salah.',
            code: 'INVALID_ID_FORMAT',
            hostId: cleanHostId,
          });
        }
        return res.status(403).json({
          error: `Host ID "${cleanHostId}" tidak terdaftar di database karyawan.`,
          code: 'EMPLOYEE_NOT_FOUND',
        });
      }
      if (empCheck.employee) {
        finalHostName = empCheck.employee.name;
        finalDepartment = empCheck.employee.department;
      }
    }

    const schedule = await createSchedule({
      roomName: roomName.trim(),
      title: title.trim(),
      description: (description || '').trim(),
      hostId: (hostId || '').trim(),
      hostName: finalHostName,
      department: finalDepartment,
      scheduledStart,
      scheduledEnd,
    });

    res.status(201).json({
      success: true,
      schedule,
    });
  }));

  app.delete('/api/schedules/:id', asyncRoute(async (req, res) => {
    const { id } = req.params;
    if (req.auth) {
      const schedule = (await getUpcomingSchedules()).find(item => item.id === id);
      if (!schedule) return res.status(404).json({ error: 'Jadwal rapat tidak ditemukan.' });
      if (schedule.hostId !== req.auth.user.employeeId) return res.status(403).json({ error: 'Hanya penyelenggara yang dapat mengubah jadwal ini.' });
    }
    const ok = await cancelSchedule(id);
    if (!ok) {
      return res.status(404).json({ error: 'Jadwal rapat tidak ditemukan atau sudah dibatalkan.' });
    }
    res.json({ success: true, message: 'Jadwal rapat berhasil dibatalkan.' });
  }));

  app.put('/api/schedules/:id', asyncRoute(async (req, res) => {
    const { id } = req.params;
    if (req.auth) {
      const schedule = (await getUpcomingSchedules()).find(item => item.id === id);
      if (!schedule) return res.status(404).json({ error: 'Jadwal rapat tidak ditemukan.' });
      if (schedule.hostId !== req.auth.user.employeeId) return res.status(403).json({ error: 'Hanya penyelenggara yang dapat mengubah jadwal ini.' });
    }
    const {
      scheduledStart,
      scheduledEnd,
      title,
      description,
      roomName,
    } = req.body || {};

    if (!scheduledStart || !scheduledEnd) {
      return res.status(400).json({ error: 'Waktu mulai dan waktu selesai rapat baru wajib ditentukan.' });
    }

    const startTime = Date.parse(scheduledStart);
    const endTime = Date.parse(scheduledEnd);

    if (isNaN(startTime) || isNaN(endTime)) {
      return res.status(400).json({ error: 'Format tanggal atau waktu rapat tidak valid.' });
    }

    // Validation: Start time cannot be in the past (allow 60s tolerance for network latency)
    if (startTime < Date.now() - 60000) {
      return res.status(400).json({
        error: 'Waktu mulai rapat tidak boleh di masa lalu. Harap pilih tanggal dan jam yang akan datang.',
        code: 'PAST_TIME_NOT_ALLOWED',
      });
    }

    // Validation: End time must be after start time
    if (endTime <= startTime) {
      return res.status(400).json({
        error: 'Waktu selesai rapat harus setelah waktu mulai.',
        code: 'INVALID_TIME_RANGE',
      });
    }

    const updated = await updateSchedule(id, {
      scheduledStart,
      scheduledEnd,
      title: title ? title.trim() : undefined,
      description: description !== undefined ? description.trim() : undefined,
      roomName: roomName ? roomName.trim() : undefined,
    });

    if (!updated) {
      return res.status(404).json({ error: 'Jadwal rapat tidak ditemukan atau sudah dibatalkan.' });
    }

    res.json({
      success: true,
      message: 'Jadwal rapat berhasil diperbarui.',
      schedule: updated,
    });
  }));

  // Meeting authorization middleware
  app.use('/api/meetings/:id', asyncRoute(async (req, res, next) => {
    if (['db-summaries', 'db-details'].includes(req.params.id) || req.path === '/recording' || req.path === '/recording/download' || req.path.startsWith('/export')) return next();
    const meeting = store.get(req.params.id);
    if (!meeting) return res.status(404).json({ error: 'Meeting session not found' });
    const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
    if (!token) return res.status(401).json({ error: 'A meeting token is required' });
    let claims;
    try { claims = await verifier.verify(token); } catch { return res.status(401).json({ error: 'Meeting token is invalid or expired' }); }
    if (claims.video?.room !== meeting.livekitRoom || !claims.video?.roomJoin || !meeting.participants.has(claims.sub)) return res.status(403).json({ error: 'This token cannot access the meeting' });
    req.meetingId = meeting.id;
    if (req.auth && claims.sub !== req.auth.user.employeeId) return res.status(403).json({ error: 'Token rapat bukan milik akun ini.' });
    req.speakerId = claims.sub;
    next();
  }));

  function getMeetingRecordingInfo(meetingId, storeMeeting = null) {
    const cleanId = String(meetingId || '').replace(/^meeting-/, '');
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(cleanId)) return {hasRecording:false};
    const names = [...new Set(['mp4','ogg'].flatMap(ext => [`meeting-${cleanId}.${ext}`, `${cleanId}.${ext}`]))];
    const recordedName = storeMeeting?.recording?.filepath && basename(storeMeeting.recording.filepath);
    if (names.includes(recordedName)) names.unshift(recordedName);
    const roots = [...new Set([config.livekitRecordingsDir, config.qwenBatchRecordingsDir].filter(Boolean))];
    for (const root of roots) {
      let base;
      try { base = realpathSync(root); } catch { continue; }
      for (const name of names) {
        try {
          const filePath = realpathSync(join(base,name));
          const rel = relative(base,filePath);
          if (!rel || rel.startsWith('..') || isAbsolute(rel)) continue;
          const stats = statSync(filePath);
          if (stats.isFile() && stats.size > 0) return {hasRecording:true,filePath,
            fileName:basename(filePath),fileSize:stats.size};
        } catch { /* Missing files are normal while Egress finishes writing. */ }
      }
    }
    return {hasRecording:false};
  }

  function writable(req, res) {
    const meeting = store.get(req.meetingId);
    if (meeting.status !== 'active' || meeting.closingForUploads || meeting.participants.get(req.speakerId).leftAt) {
      res.status(409).json({ error: 'You have left this meeting. Start or join another session to add speech.' });
      return false;
    }
    return true;
  }

  function requireMeetingManager(req, res, allowedRoles = ['host', 'co-host']) {
    const meeting = store.get(req.meetingId);

    if (!meeting || meeting.status !== 'active') {
      res.status(409).json({ error: 'Meeting tidak aktif atau tidak ditemukan.' });
      return null;
    }

    const actor = meeting.participants.get(req.speakerId);

    if (!actor || actor.leftAt) {
      res.status(403).json({ error: 'Peserta tidak lagi aktif dalam meeting.' });
      return null;
    }

    if (req.auth?.user?.isGuest) {
      res.status(403).json({ error: 'Tamu tidak memiliki izin mengelola peserta.' });
      return null;
    }

    const role = actor.employeeId === meeting.hostId
      ? 'host'
      : (meeting.coHostIds || []).includes(actor.employeeId)
        ? 'co-host'
        : 'participant';

    if (!allowedRoles.includes(role)) {
      res.status(403).json({ error: 'Anda tidak memiliki izin untuk tindakan ini.' });
      return null;
    }

    return { meeting, actor, role };
  }

  app.patch(
    '/api/meetings/:id/participants/:participantId/role',
    (req, res) => {
      const access = requireMeetingManager(req, res, ['host']);
      if (!access) return;

      const { role } = req.body || {};

      if (!['co-host', 'participant'].includes(role)) {
        return res.status(400).json({
          error: 'Role harus co-host atau participant.',
        });
      }

      const result = store.setCoHost(
        req.meetingId,
        req.speakerId,
        req.params.participantId,
        role === 'co-host'
      );

      res.json({ success: true, participant: result });
    }
  );

  app.post(
    '/api/meetings/:id/participants/:participantId/mute',
    asyncRoute(async (req, res) => {
      const access = requireMeetingManager(req, res);
      if (!access) return;

      const targetId = req.params.participantId;
      const target = access.meeting.participants.get(targetId);

      if (!target || target.leftAt) {
        return res.status(404).json({
          error: 'Peserta tidak ditemukan atau sudah meninggalkan meeting.',
        });
      }

      if (targetId === req.speakerId) {
        return res.status(400).json({
          error: 'Gunakan kontrol mikrofon sendiri untuk mute diri Anda.',
        });
      }

      if (
        access.role === 'co-host' &&
        (
          targetId === access.meeting.hostId ||
          (access.meeting.coHostIds || []).includes(targetId)
        )
      ) {
        return res.status(403).json({
          error: 'Co-host hanya dapat mute peserta biasa.',
        });
      }

      // Simpan pembatasan terlebih dahulu agar status tetap ada saat reconnect.
      store.setModeratorMute(access.meeting.id, targetId, true);

      try {
        const participants = await roomService.listParticipants(
          access.meeting.livekitRoom
        );

        const liveParticipant = participants.find(
          person => person.identity === targetId
        );

        if (liveParticipant) {
          const currentPermission = liveParticipant.permission || {};

          // Pertahankan izin yang ada, tetapi cabut izin publish mikrofon.
          const currentSources = currentPermission.canPublishSources;
          const allowedSources = Array.isArray(currentSources)
            ? currentSources.filter(source => Number(source) !== 2)
            : [1, 3, 4];

          await roomService.updateParticipant(
            access.meeting.livekitRoom,
            targetId,
            {
              permission: {
                canSubscribe: currentPermission.canSubscribe ?? true,
                canPublish: currentPermission.canPublish ?? true,
                canPublishData: currentPermission.canPublishData ?? true,
                canPublishSources: allowedSources,
              },
            }
          );
          
          const audioTracks = (liveParticipant.tracks || []).filter(
            track => Number(track.type) === 0 && !track.muted
          );

          for (const track of audioTracks) {
            await roomService.mutePublishedTrack(
              access.meeting.livekitRoom,
              targetId,
              track.sid,
              true
            );
          }
        }

        return res.json({ success: true, muted: true });
      } catch (error) {
        console.error('Gagal menerapkan pembatasan mikrofon:', error);

        return res.status(502).json({
          error:
            'Status mute sudah tersimpan, tetapi izin LiveKit gagal diperbarui. Periksa koneksi LiveKit.',
        });
      }
    })
  );

  // Peserta meminta izin untuk berbicara.
  app.post(
    '/api/meetings/:id/request-to-speak',
    asyncRoute(async (req, res) => {
      const meeting = store.get(req.meetingId);

      if (!meeting || meeting.status !== 'active') {
        return res.status(409).json({ error: 'Meeting tidak aktif.' });
      }

      const participant = meeting.participants.get(req.speakerId);

      if (!participant || participant.leftAt) {
        return res.status(404).json({ error: 'Peserta tidak ditemukan.' });
      }

      const result = store.requestToSpeak(meeting.id, req.speakerId);

      return res.json({
        success: true,
        speakRequestAt: result.speakRequestAt,
      });
    })
  );

  // Host/co-host menyetujui permintaan bicara.
  app.post(
    '/api/meetings/:id/participants/:participantId/approve-speak',
    asyncRoute(async (req, res) => {
      const access = requireMeetingManager(req, res);
      if (!access) return;

      const targetId = req.params.participantId;
      const target = access.meeting.participants.get(targetId);

      if (!target || target.leftAt) {
        return res.status(404).json({
          error: 'Peserta tidak ditemukan atau sudah meninggalkan meeting.',
        });
      }

      if (
        access.role === 'co-host' &&
        (
          targetId === access.meeting.hostId ||
          (access.meeting.coHostIds || []).includes(targetId)
        )
      ) {
        return res.status(403).json({
          error: 'Co-host hanya dapat menyetujui peserta biasa.',
        });
      }

      if (!target.moderatorMuted || !target.speakRequestAt) {
        return res.status(409).json({
          error: 'Tidak ada permintaan izin bicara yang menunggu.',
        });
      }

      // Hapus pembatasan yang tersimpan.
      store.setModeratorMute(access.meeting.id, targetId, false);

      try {
        const participants = await roomService.listParticipants(
          access.meeting.livekitRoom
        );

        const liveParticipant = participants.find(
          person => person.identity === targetId
        );

        if (liveParticipant) {
          const permission = liveParticipant.permission || {};
          const sources = Array.isArray(permission.canPublishSources)
            ? permission.canPublishSources.map(Number)
            : [1, 2, 3, 4];

          if (!sources.includes(2)) sources.push(2);

          await roomService.updateParticipant(
            access.meeting.livekitRoom,
            targetId,
            {
              permission: {
                canSubscribe: permission.canSubscribe ?? true,
                canPublish: permission.canPublish ?? true,
                canPublishData: permission.canPublishData ?? true,
                canPublishSources: sources,
              },
            }
          );
        }

        return res.json({
          success: true,
          microphoneRestricted: false,
          // Persetujuan tidak menyalakan mikrofon secara otomatis.
        });
      } catch (error) {
        console.error('Gagal memperbarui izin bicara:', error);

        return res.status(502).json({
          error: 'Izin bicara tersimpan, tetapi izin LiveKit gagal diperbarui.',
        });
      }
    })
  );

  app.delete(
    '/api/meetings/:id/participants/:participantId',
    asyncRoute(async (req, res) => {
      const access = requireMeetingManager(req, res);
      if (!access) return;

      const targetId = req.params.participantId;
      const target = access.meeting.participants.get(targetId);

      if (!target || target.leftAt) {
        return res.status(404).json({
          error: 'Peserta tidak ditemukan atau sudah meninggalkan meeting.',
        });
      }

      if (targetId === req.speakerId) {
        return res.status(400).json({
          error: 'Anda tidak dapat mengeluarkan diri sendiri melalui fitur ini.',
        });
      }

      if (
        access.role === 'co-host' &&
        (targetId === access.meeting.hostId ||
          (access.meeting.coHostIds || []).includes(targetId))
      ) {
        return res.status(403).json({
          error: 'Co-host hanya dapat mengeluarkan peserta biasa.',
        });
      }

      await roomService.removeParticipant(
        access.meeting.livekitRoom,
        targetId
      );

      res.json({ success: true, removed: targetId });
    })
  );

  app.post('/api/meetings/:id/guest-invite', (req, res) => {
    if (!config.authEnabled) return res.status(409).json({ error: 'Aktifkan login sebelum mengundang tamu.' });
    if (!writable(req, res)) return;
    const meeting = store.get(req.meetingId);
    // This endpoint is excluded from guest authorization above.
    store.transact(() => { meeting.guestInviteCode ||= randomBytes(16).toString('base64url'); });
    res.json({ inviteCode: meeting.guestInviteCode });
  });
  app.post('/api/meetings/:id/employee-invites',asyncRoute(async(req,res)=>{
    if(!req.auth?.user||req.auth.user.isGuest)return res.status(403).json({error:'Masuk dengan akun karyawan untuk mengundang.'});
    if(!writable(req,res))return;
    const ids=req.body?.employeeIds;
    if(!Array.isArray(ids)||ids.length<1||ids.length>20||ids.some(id=>typeof id!=='string'||!/^BT-\d{4,6}$/.test(id)))return res.status(400).json({error:'Pilih 1–20 NIK karyawan.'});
    const meeting=store.get(req.meetingId);
    for(const id of new Set(ids))await workspace.notify(id,{key:`invitation:${meeting.id}:${id}`,kind:'invitation',roomName:meeting.roomName,meetingId:meeting.id});
    res.json({success:true});
  }));

  app.post('/api/meetings/:id/live-session', asyncRoute(async (req, res) => {
    if (!writable(req, res)) return;
    const { language, model, diarize = false, streamId } = req.body || {};
    if (model === SEA_LIVE_MODEL) {
      if (!config.seaLivePilotEnabled) return res.status(503).json({error:'SEA Live pilot belum diaktifkan. Pilih model lain.'});
      const capabilities = await seaLiveCapabilities(config, fetchImpl);
      if (!capabilities.ready) return res.status(503).json({error:'SEA Live worker belum siap. Pilih model lain.'});
      if (language !== 'id' || typeof diarize !== 'boolean') return res.status(400).json({error:'Mode SEA Live tidak valid; gunakan Bahasa Indonesia.'});
      if (diarize && !capabilities.diarization) return res.status(503).json({error:'Nemotron untuk SEA belum siap. Gunakan mikrofon pribadi atau coba lagi.'});
      if (streamId !== undefined && (typeof streamId !== 'string' || !/^[a-zA-Z0-9_-]{16,100}$/.test(streamId))) return res.status(400).json({error:'Sesi mikrofon tidak valid.'});
      const payload=Buffer.from(JSON.stringify({meetingId:req.meetingId,speakerId:req.speakerId,language,model,
        diarize,...(streamId?{streamId}:{}),exp:(capabilities.workerTime ?? Math.floor(Date.now()/1000))+60,nonce:randomUUID()})).toString('base64url');
      const signature=createHmac('sha256',config.seaLiveSttSecret).update(payload).digest('base64url');
      return res.set('Cache-Control','no-store').json({url:`${config.seaLiveSttUrl}?ticket=${payload}.${signature}`});
    }
    if (model === QWEN_LIVE_MODEL) {
      const capabilities = await qwenLiveCapabilities(config, fetchImpl);
      if (!capabilities.ready || (diarize && !capabilities.diarization)) return res.status(503).json({ error: 'Qwen streaming atau diarization belum siap.' });
      if (!['id','en'].includes(language) || typeof diarize !== 'boolean') return res.status(400).json({ error: 'Bahasa atau mode streaming tidak valid.' });
      if (streamId !== undefined && (typeof streamId !== 'string' || !/^[a-zA-Z0-9_-]{16,100}$/.test(streamId))) return res.status(400).json({error:'Sesi mikrofon tidak valid.'});
      const payload = Buffer.from(JSON.stringify({ meetingId:req.meetingId,speakerId:req.speakerId,
        language,model,diarize,...(streamId?{streamId}:{}),exp:(capabilities.workerTime ?? Math.floor(Date.now()/1000))+60,nonce:randomUUID() })).toString('base64url');
      const signature = createHmac('sha256',config.qwenLiveSttSecret).update(payload).digest('base64url');
      return res.set('Cache-Control','no-store').json({url:`${config.qwenLiveSttUrl}?ticket=${payload}.${signature}`});
    }
    if (!config.liveSttSecret || !config.liveSttUrl) return res.status(503).json({ error: 'WhisperLiveKit belum dikonfigurasi.' });
    if (!['id', 'en'].includes(language) || model !== 'whisperlivekit-small') return res.status(400).json({ error: 'Bahasa atau model streaming tidak valid.' });
    const payload = Buffer.from(JSON.stringify({ meetingId: req.meetingId, speakerId: req.speakerId,
      language, model, exp: Math.floor(Date.now() / 1000) + 60, nonce: randomUUID() })).toString('base64url');
    const signature = createHmac('sha256', config.liveSttSecret).update(payload).digest('base64url');
    res.set('Cache-Control', 'no-store').json({ url: `${config.liveSttUrl}?ticket=${payload}.${signature}` });
  }));

  app.get('/api/meetings/:id/transcript', (req, res) => {
    const meeting = store.get(req.meetingId);
    const currentParticipant = meeting.participants.get(req.speakerId);

    const currentRole = currentParticipant
      ? currentParticipant.employeeId === meeting.hostId
        ? 'host'
        : (meeting.coHostIds || []).includes(currentParticipant.employeeId)
          ? 'co-host'
          : 'participant'
      : 'participant';
    res.json({
      meetingId: meeting.id,
      roomName: meeting.roomName,
      status: meeting.status,
      isSummarizing: inFlightSummarize.has(meeting.id),
      hostId: meeting.hostId,
      coHostIds: meeting.coHostIds || [],
      currentRole,
      recording: meeting.recording || null,
      transcripts: meeting.postMeetingBatch?.status === 'done' ? meeting.postMeetingBatch.transcripts : meeting.transcripts,
      postMeetingBatch: publicBatch(meeting.postMeetingBatch),
      participants: [...meeting.participants.values()].map(publicParticipant),
      summary: meeting.postMeetingBatch?.status === 'done' ? meeting.postMeetingBatch.summary : meeting.summary,
      attendanceFinalization: meeting.attendanceFinalization || null,
      microphoneRestricted: Boolean(
        meeting.participants.get(req.speakerId)?.moderatorMuted
      ),
      speakRequestAt:
        meeting.participants.get(req.speakerId)?.speakRequestAt || null,
      pendingSpeakRequests: [...meeting.participants.values()]
        .filter(
          person =>
            !person.leftAt &&
            person.moderatorMuted &&
            person.speakRequestAt
        )
        .map(person => ({
          identity: person.employeeId,
          name: person.name,
          speakRequestAt: person.speakRequestAt,
        })),
    });
  });

  app.post('/api/meetings/:id/speaker-name', asyncRoute(async (req,res)=>{
    if (!writable(req,res)) return;
    const meeting=store.get(req.meetingId);
    if (inFlightSummarize.has(meeting.id)) return res.status(409).json({error:'Tunggu proses notulen selesai sebelum mengganti nama.'});
    const {sourceId,sessionId,speaker,name}=req.body || {};
    if (![sourceId,sessionId,speaker].every(value=>typeof value==='string' && value.length>0 && value.length<=100)
      || typeof name!=='string' || name.length>80 || /[\u0000-\u001f\u007f]/.test(name)) return res.status(400).json({error:'Nama pembicara tidak valid (maksimal 80 karakter).'});
    const manager=req.speakerId===meeting.hostId || (meeting.coHostIds || []).includes(req.speakerId);
    if (req.speakerId!==sourceId && !manager) return res.status(403).json({error:'Hanya pemilik mikrofon atau host yang dapat mengubah nama pembicara.'});
    const key=speakerAliasKey({sourceId,sessionId,speaker});
    const matches=entry=>[QWEN_LIVE_MODEL,SEA_LIVE_MODEL].includes(entry.sttModel) && entry.segments?.some(segment=>speakerAliasKey(segment)===key && segment.attribution==='assigned');
    if (!meeting.transcripts.some(matches)) return res.status(404).json({error:'Pembicara yang dapat diberi nama tidak ditemukan.'});
    const updatedEntries=store.transact(()=>{
      meeting.speakerAliases ||= {};
      if (name.trim()) meeting.speakerAliases[key]=name.trim();else delete meeting.speakerAliases[key];
      meeting.summary=null;
      return meeting.transcripts.filter(matches).map(entry=>{
        entry.segments=entry.segments.map(segment=>{
          if (speakerAliasKey(segment)!==key) return segment;
          const next={...segment};delete next.speakerName;
          return name.trim()?{...next,speakerName:name.trim()}:next;
        });
        entry.revision=(entry.revision || 0)+1;
        return entry;
      });
    });
    await saveTranscripts(meeting.id,meeting.roomName,meeting.transcripts);
    res.json({success:true,transcripts:meeting.transcripts,updatedEntries});
  }));

  app.post('/api/meetings/:id/transcript', (req, res) => {
    if ([QWEN_LIVE_MODEL,SEA_LIVE_MODEL].includes(req.body?.sttModel)) {
      let final;
      try {
        final = validateLiveFinal(req.body.final,req.speakerId);
        if (req.body.sttModel === SEA_LIVE_MODEL && !seaSessionDiarized(req.body.final,config,req.meetingId,req.speakerId)) {
          if (req.body.final.attribution !== 'unknown') throw Error('SEA personal mode cannot assign acoustic speakers');
          final.segments = final.segments.map(segment => ({ ...segment, speaker:'Peserta', attribution:'participant' }));
        }
      }
      catch { return res.status(400).json({error:'Segmen streaming tidak valid.'}); }
      if ([QWEN_LIVE_MODEL,SEA_LIVE_MODEL].includes(req.body.sttModel)) final.segments=applySpeakerAliases(store.get(req.meetingId),final.segments);
      const existing = store.findEntry(store.get(req.meetingId),req.speakerId,final.requestId);
      if (existing) return res.json({success:true,entry:existing});
      if (!writable(req,res)) return;
      const entry = store.append(req.meetingId,req.speakerId,final.text,final.requestId,final.segments,req.body.sttModel);
      return res.json({success:true,entry});
    }
    const { text, requestId = randomUUID() } = req.body || {};
    if (!nonEmpty(text, 10000) || !requestIdValid(requestId)) return res.status(400).json({ error: 'Non-empty text and a valid requestId are required' });
    const cleanText = normalizeTranscriptText(text);
    const previous = store.findEntry(store.get(req.meetingId), req.speakerId, requestId);
    if (previous) return res.json({ success: true, entry: previous });
    if (!writable(req, res)) return;
    res.json({ success: true, entry: store.append(req.meetingId, req.speakerId, cleanText, requestId) });
  });

  app.post('/api/meetings/:id/presence', (req, res) => {
    if (typeof req.body?.connected !== 'boolean') return res.status(400).json({ error: 'connected must be boolean' });
    if (!writable(req, res)) return;
    res.json({ participant: publicParticipant(store.presence(req.meetingId, req.speakerId, req.body.connected)) });
  });

  app.post('/api/meetings/:id/recording/start', asyncRoute(async (req, res) => {
    if (!requireMeetingManager(req, res)) return;
    const meeting = store.get(req.meetingId);
    const batchRequested = req.body?.postMeetingBatch === true;
    if (batchRequested && (req.speakerId !== meeting.hostId || !postMeetingBatch.configured)) return res.status(503).json({ error: 'Batch Qwen hanya dapat diaktifkan host setelah worker dan folder rekaman dikonfigurasi.' });
    if (batchRequested && ((meeting.recordingRuns || 0) > 0 || !['id', 'en'].includes(req.body?.language || 'id'))) return res.status(400).json({ error: 'Batch memerlukan satu rekaman utuh dan bahasa id/en. Mulai dari rapat baru.' });

    if (meeting.status !== 'active') {
      return res.status(409).json({ error: 'Meeting sudah selesai.' });
    }

    if (meeting.recording?.status === 'active') {
      return res.status(409).json({
        error: 'Recording sudah berjalan.',
        recording: meeting.recording,
      });
    }

    const audioOnly = batchRequested;
    const filepath = `/out/${meeting.livekitRoom}.${audioOnly ? 'ogg' : 'mp4'}`;

    const result = await egressClient.startRoomCompositeEgress(
      meeting.livekitRoom,
      {
        file: {
          filepath,
          fileType: audioOnly ? 2 : 1,
        },
      },
      // Empty layout skips the default template's screen-share focus switch.
      // Explicit grid keeps camera tiles equal and promotes screen sharing.
      audioOnly ? { audioOnly: true, ...(config.qwenBatchEgressMode === 'sdk' ? {} : { layout: 'grid' }) } : { layout: 'grid' },
    );

    const recording = {
      egressId: result.egressId,
      audioOnly,
      status: 'active',
      startedAt: new Date().toISOString(),
      stoppedAt: null,
      filepath,
    };

    store.transact(() => {
      store.get(req.meetingId).recording = recording;
      store.get(req.meetingId).recordingRuns = (store.get(req.meetingId).recordingRuns || 0) + 1;
      if (batchRequested) store.get(req.meetingId).postMeetingBatchRequested = { language: req.body?.language || 'id' };
    });

    res.json({
      success: true,
      recording,
    });
  }));

  app.post('/api/meetings/:id/leave', asyncRoute(async (req, res) => {
    const updated = store.leave(req.meetingId, req.speakerId);

    if (
      updated.status === 'ended' &&
      updated.recording?.egressId &&
      updated.recording.status === 'active'
    ) {
      try {
        await egressClient.stopEgress(updated.recording.egressId);

        store.transact(() => {
          const meeting = store.get(req.meetingId);

          if (meeting.recording?.status === 'active') {
            meeting.recording = {
              ...meeting.recording,
              status: 'stopped',
              stoppedAt: new Date().toISOString(),
            };
          }
        });
      } catch (recordingError) {
        console.warn(
          '[RECORDING] Could not stop Egress:',
          recordingError.message,
        );
      }
    }

    postMeetingBatch.schedule(updated.id);
    try {
      await saveMeeting(updated);
      await saveAttendees(updated.id, [...updated.participants.values()]);

      if (updated.transcripts?.length) {
        await saveTranscripts(updated.id, updated.roomName, updated.transcripts);
      }
    } catch (dbErr) {
      console.warn('[DB] Could not update leave status in database:', dbErr.message);
    }

    res.json({
      success: true,
      status: updated.status,
      recording: store.get(req.meetingId).recording,
    });
  }));

  app.post('/api/meetings/:id/recording/stop', asyncRoute(async (req, res) => {
    if (!requireMeetingManager(req, res)) return;
    const meeting = store.get(req.meetingId);
    const recording = meeting.recording;

    if (!recording?.egressId || recording.status !== 'active') {
      return res.json({
        success: true,
        alreadyStopped: true,
        recording: recording || { status: 'stopped' },
      });
    }

    try {
      await egressClient.stopEgress(recording.egressId);
    } catch (egressErr) {
      console.warn('[RECORDING] stopEgress note:', egressErr.message);
      return res.status(502).json({
        error: 'Belum dapat menghentikan rekaman. Coba lagi; rekaman mungkin masih berjalan.',
        recording,
      });
    }

    const stoppedAt = new Date().toISOString();

    store.transact(() => {
      store.get(req.meetingId).recording = {
        ...recording,
        status: 'stopped',
        stoppedAt,
      };
    });

    res.json({
      success: true,
      recording: store.get(req.meetingId).recording,
    });
  }));

  app.get('/api/meetings/:id/recording', asyncRoute(async (req, res) => {
    if (req.auth?.user?.isGuest) {
      return res.status(403).json({ error: 'Tamu tidak diizinkan mengakses rekaman rapat.' });
    }
    const storeMeeting = store.get(req.params.id);
    const rec = getMeetingRecordingInfo(req.params.id, storeMeeting);
    res.json({
      success: true,
      meetingId: req.params.id,
      hasRecording: rec.hasRecording,
      recordingSize: rec.fileSize || null,
      fileName: rec.fileName || null,
    });
  }));

  app.get('/api/meetings/:id/recording/download', asyncRoute(async (req, res) => {
    if (req.auth?.user?.isGuest) {
      return res.status(403).json({ error: 'Tamu tidak diizinkan mengunduh rekaman rapat.' });
    }
    const storeMeeting = store.get(req.params.id);
    const rec = getMeetingRecordingInfo(req.params.id, storeMeeting);
    if (!rec.hasRecording || !rec.filePath) {
      return res.status(404).json({ error: 'Berkas rekaman tidak ditemukan untuk rapat ini.' });
    }

    const downloadFileName = rec.fileName || `meeting-${req.params.id}.mp4`;
    res.download(rec.filePath, downloadFileName, (err) => {
      if (err && !res.headersSent) {
        console.warn('[RECORDING] Download error:', err.message);
        res.status(500).json({ error: 'Gagal mengunduh berkas rekaman.' });
      }
    });
  }));

  app.post('/api/meetings/:id/audio', express.raw({ type: ['audio/*', 'application/octet-stream'], limit: '5mb' }), asyncRoute(async (req, res) => {
    const requestId = req.get('X-Request-Id');
    const language = req.get('X-Speech-Language') || 'id';
    const model = req.get('X-Speech-Model') || config.sttModel;
    const diarizeHeader = req.get('X-Speech-Diarize');
    const diarize = diarizeHeader !== undefined ? diarizeHeader === 'true' : (model !== QWEN_STT_MODEL && config.sttDiarization);
    if (!requestIdValid(requestId) || !['id', 'en'].includes(language) || !Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'Audio, a request ID and language id/en are required' });
    const previous = store.findEntry(store.get(req.meetingId), req.speakerId, requestId);
    if (previous) return res.json({ success: true, entry: previous, text: previous.text });
    if (store.hasEmptyAudioRequest(req.meetingId, req.speakerId, requestId)) return res.json({ success: true, text: '', entry: null });
    const allowedModels = availableSttModels(config);
    if (model && !allowedModels.includes(model)) return res.status(400).json({ error: 'Model transkripsi tidak tersedia di server' });
    if (!writable(req, res)) return;
    const key = `${req.meetingId}:${req.speakerId}:${requestId}`;
    if (!inFlightAudio.has(key)) {
      const work = (async () => {
        // Buffer meeting audio chunk immediately for post-meeting batch diarization
        if (!meetingAudios.has(req.meetingId)) meetingAudios.set(req.meetingId, []);
        const meetingChunks = meetingAudios.get(req.meetingId);
        if (meetingChunks.length < 200) {
          meetingChunks.push({ buffer: req.body, mimeType: req.get('Content-Type') || 'audio/webm', speakerId: req.speakerId });
        }

        const { text, segments } = await transcribeAudio(req.body, req.get('Content-Type') || '', language, { ...config, sttModel: model, sttDiarization: diarize }, fetchImpl);
        const meeting = store.get(req.meetingId);
        if (meeting.status !== 'active' || meeting.participants.get(req.speakerId).leftAt) throw new ServiceError('Meeting ended before audio could be saved', 409);
        if (!text) store.saveEmptyAudioRequest(req.meetingId, req.speakerId, requestId);
        return { success: true, text, entry: text ? store.append(req.meetingId, req.speakerId, text, requestId, segments, model) : null };
      })();
      inFlightAudio.set(key, work);
    }
    const work = inFlightAudio.get(key);
    try { res.json(await work); } finally { if (inFlightAudio.get(key) === work) inFlightAudio.delete(key); }
  }));

  async function summarizeMeeting(id) {
    const meeting = store.get(id);
    
    if (
      meeting.summary?.summaryVersion === SUMMARY_VERSION &&
      meeting.summary.transcriptCount === meeting.transcripts.length &&
      meeting.summary.transcriptDigest === summaryTranscriptDigest(meeting)
    ) {
      try {
        await syncActionItemsToItProject(meeting, meeting.summary);
      } catch (error) {
        console.warn('[ITPROJECT] Retry sinkronisasi gagal:', {
          meetingId: meeting.id,
          message: error.message,
        });
      }

      return meeting.summary;
    }
    if (!inFlightSummarize.has(id)) {
      const task = (async () => {
        for (let snapshotAttempt = 0; snapshotAttempt < 2; snapshotAttempt++) {
          const snapshot = structuredClone(store.get(id));
          const transcriptDigest = summaryTranscriptDigest(snapshot);
          const summary = { ...await summarize(snapshot, config, fetchImpl), transcriptDigest, transcriptCount: snapshot.transcripts.length, generatedAt: new Date().toISOString() };
          const current = store.get(id);
          if (!current || summaryTranscriptDigest(current) !== transcriptDigest) {
            if (current && snapshotAttempt === 0) continue;
            throw new ServiceError('Transkrip masih berubah saat notulen dibuat. Tunggu ucapan terakhir selesai lalu coba kembali.', 409);
          }
          if (current) {
            store.transact(() => {
              store.get(id).summary = summary;
            });
          }

          // Persist to PostgreSQL database
          try {
            await saveMeeting(snapshot);
            await saveTranscripts(snapshot.id, snapshot.roomName, snapshot.transcripts);
            await saveAttendees(snapshot.id, [...snapshot.participants.values()]);
            const dbSummary = await saveMeetingSummary(snapshot.id, snapshot.roomName, summary);
            if (dbSummary) summary.dbSummaryId = dbSummary.id;
          } catch (dbErr) {
            console.warn('[DB] Could not persist meeting to database:', dbErr.message);
          }
          try {
            await syncActionItemsToItProject(snapshot, summary);
          } catch (error) {
            // Jangan gagalkan ringkasan rapat jika IT Project sedang tidak tersedia.
            console.warn('[ITPROJECT] Sinkronisasi action items dilewati:', {
              meetingId: snapshot.id,
              message: error.message,
            });
          }

          // Trigger outbound webhook if configured
          if (config.outboundWebhookUrl) {
            dispatchOutboundWebhook(config.outboundWebhookUrl, {
              event: 'meeting.summary.created',
              meetingId: snapshot.id,
              roomName: snapshot.roomName,
              summary,
              transcriptsCount: snapshot.transcripts.length,
              attendees: [...snapshot.participants.values()].map(publicParticipant),
              timestamp: new Date().toISOString(),
            });
          }

          return summary;
        }
      })();
      inFlightSummarize.set(id, task);
    }

    const task = inFlightSummarize.get(id);
    try { return await task; }
    finally { if (inFlightSummarize.get(id) === task) inFlightSummarize.delete(id); }
  }

  const attendanceFinalizer = createAttendanceFinalizer({
    store,
    pendingAudio: id => [...inFlightAudio].filter(([key]) => key.startsWith(`${id}:`)).map(([, work]) => work),
    persist: async meeting => {
      postMeetingBatch.schedule(meeting.id);
      await saveMeeting(meeting);
      await saveAttendees(meeting.id, [...meeting.participants.values()]);
      if (meeting.transcripts.length) await saveTranscripts(meeting.id, meeting.roomName, meeting.transcripts);
    },
    summarize: summarizeMeeting,
  });

  app.get('/api/meetings/:id/post-meeting-batch', (req, res) => {
    res.set('Cache-Control', 'no-store').json({ configured: postMeetingBatch.configured, requested: Boolean(store.get(req.meetingId).postMeetingBatchRequested), job: publicBatch(store.get(req.meetingId).postMeetingBatch) });
  });
  app.post('/api/meetings/:id/post-meeting-batch', asyncRoute(async (req, res) => {
    const meeting = store.get(req.meetingId);
    if (req.speakerId !== meeting.hostId || req.auth?.user?.isGuest) return res.status(403).json({ error: 'Hanya host rapat yang dapat memulai batch Qwen.' });
    if (inFlightSummarize.has(meeting.id)) return res.status(409).json({ error: 'Tunggu pembuatan notulen live selesai sebelum memulai batch.' });
    const job = await postMeetingBatch.start(meeting.id, req.body?.language || 'id');
    res.status(job.status === 'done' ? 200 : 202).json({ job: publicBatch(job) });
  }));

  app.post('/api/meetings/:id/batch-diarize', express.raw({ type: ['audio/*', 'application/octet-stream'], limit: '50mb' }), asyncRoute(async (req, res) => {
    const meeting = store.get(req.meetingId);
    if (!meeting) return res.status(404).json({ error: 'Rapat tidak ditemukan.' });
    const hasLive = () => meeting.transcripts.some(entry => [QWEN_LIVE_MODEL,SEA_LIVE_MODEL].includes(entry.sttModel));
    if (hasLive()) return res.status(409).json({ error: 'Transkrip live tidak dapat diganti dengan batch audio yang hanya memuat sebagian rapat.' });

    let audioBuffers = [];
    let mimeType = 'audio/webm';

    if (Buffer.isBuffer(req.body) && req.body.length > 0) {
      audioBuffers = req.body;
      mimeType = req.get('Content-Type') || 'audio/wav';
    } else {
      const stored = meetingAudios.get(req.meetingId) || [];
      if (!stored.length) {
        return res.status(400).json({ error: 'Tidak ada rekaman audio pertemuan yang tersimpan untuk diarisasi.' });
      }
      audioBuffers = stored.map(s => s.buffer);
      mimeType = stored[0]?.mimeType || 'audio/webm';
    }

    const language = req.get('X-Speech-Language') || 'id';

    const result = await batchDiarizeAudio(audioBuffers, mimeType, language, config, fetchImpl);
    if (hasLive()) return res.status(409).json({ error: 'Transkrip Qwen Live masuk saat batch berjalan; transkrip rapat dipertahankan.' });
    if (!result.segments?.length) {
      return res.status(422).json({ error: 'Diarisasi pasca-rapat tidak menghasilkan segmen ucapan.' });
    }

    const host = meeting.participants.get(meeting.hostId) || { employeeName: 'Ruang Rapat' };
    const newTranscripts = result.segments.map(seg => ({
      id: randomUUID(),
      speakerId: req.speakerId || meeting.hostId,
      speakerName: host.employeeName,
      text: seg.text,
      timestamp: new Date(Date.now() - Math.max(0, (result.duration - seg.start) * 1000)).toISOString(),
      segments: [{ speaker: seg.speaker, text: seg.text, start: seg.start, end: seg.end }],
      sttModel: 'nemotron-batch-diarization',
    }));

    store.transact(() => {
      meeting.transcripts = newTranscripts;
      meeting.summary = null;
    });

    try {
      await saveTranscripts(meeting.id, meeting.roomName, newTranscripts);
    } catch (dbErr) {
      console.warn('[DB] Could not update transcripts after batch diarization:', dbErr.message);
    }

    res.json({
      success: true,
      transcripts: newTranscripts,
      speakerCount: result.speakerCount,
      speakers: result.speakers,
      duration: result.duration,
    });
  }));

  app.post('/api/audio/batch-diarize', express.raw({ type: ['audio/*', 'application/octet-stream'], limit: '50mb' }), asyncRoute(async (req, res) => {
    if (!Buffer.isBuffer(req.body) || !req.body.length) {
      return res.status(400).json({ error: 'File audio diperlukan untuk batch diarization.' });
    }
    const mimeType = req.get('Content-Type') || 'audio/wav';
    const language = req.get('X-Speech-Language') || 'id';
    const roomName = req.get('X-Room-Name') || `batch-${Date.now().toString(36)}`;

    const result = await batchDiarizeAudio(req.body, mimeType, language, config, fetchImpl);

    const participant = {
      employeeId: 'BT-BATCH',
      employeeName: 'Audio Ingestion',
      department: 'Engineering',
      joinedAt: new Date().toISOString(),
      connected: false,
    };
    const joinResult = store.join(roomName, participant);
    const meeting = store.get(joinResult.meeting.id);

    const transcripts = result.segments.map(seg => ({
      id: randomUUID(),
      speakerId: 'BT-BATCH',
      speakerName: 'Audio Ingestion',
      text: seg.text,
      timestamp: new Date(Date.now() - Math.max(0, (result.duration - seg.start) * 1000)).toISOString(),
      segments: [{ speaker: seg.speaker, text: seg.text, start: seg.start, end: seg.end }],
      sttModel: 'nemotron-batch-diarization',
    }));

    store.transact(() => {
      meeting.transcripts = transcripts;
    });

    const summary = await summarizeMeeting(meeting.id);

    res.json({
      success: true,
      meetingId: meeting.id,
      roomName: meeting.roomName,
      transcripts,
      summary,
      speakerCount: result.speakerCount,
      speakers: result.speakers,
      duration: result.duration,
    });
  }));

  app.post('/api/meetings/:id/summarize', asyncRoute(async (req, res) => {
    const meeting = store.get(req.meetingId);
    if (meeting.postMeetingBatch?.status === 'done') return res.json({ success: true,
      summary: meeting.postMeetingBatch.summary, transcripts: meeting.postMeetingBatch.transcripts, meetingStatus: meeting.status });
    const shouldBatch = req.query.batchDiarize === 'true' || req.body?.batchDiarize === true;
    const hasLive = () => meeting.transcripts.some(entry => [QWEN_LIVE_MODEL,SEA_LIVE_MODEL].includes(entry.sttModel));

    if (shouldBatch && !hasLive() && meetingAudios.get(req.meetingId)?.length) {
      try {
        const stored = meetingAudios.get(req.meetingId);
        const language = req.get('X-Speech-Language') || 'id';
        const batchResult = await batchDiarizeAudio(stored.map(s => s.buffer), stored[0]?.mimeType || 'audio/webm', language, config, fetchImpl);
        if (batchResult.segments?.length && !hasLive()) {
          const host = meeting.participants.get(meeting.hostId) || { employeeName: 'Ruang Rapat' };
          const newTranscripts = batchResult.segments.map(seg => ({
            id: randomUUID(),
            speakerId: req.speakerId || meeting.hostId,
            speakerName: host.employeeName,
            text: seg.text,
            timestamp: new Date(Date.now() - Math.max(0, (batchResult.duration - seg.start) * 1000)).toISOString(),
            segments: [{ speaker: seg.speaker, text: seg.text, start: seg.start, end: seg.end }],
            sttModel: 'nemotron-batch-diarization',
          }));
          store.transact(() => {
            meeting.transcripts = newTranscripts;
            meeting.summary = null;
          });
          try { await saveTranscripts(meeting.id, meeting.roomName, newTranscripts); } catch (e) {}
        }
      } catch (batchErr) {
        console.warn('[Batch Diarize in Summarize Warning]', batchErr.message);
      }
    }

    if (!meeting.transcripts.length) return res.status(400).json({ error: 'No saved speech to summarize. Speak or add text first.' });
    const summary = await summarizeMeeting(req.meetingId);
    if (store.get(req.meetingId).attendanceFinalization?.status === 'failed') store.transact(() => {
      const final = store.get(req.meetingId).attendanceFinalization;
      final.status = 'complete'; final.error = null;
    });
    const rec = getMeetingRecordingInfo(req.meetingId, store.get(req.meetingId));
    res.json({
      success: true,
      summary,
      meetingStatus: store.get(req.meetingId).status,
      transcripts: store.get(req.meetingId).transcripts,
      hasRecording: rec.hasRecording,
      recordingSize: rec.fileSize || null,
    });
  }));

  // Persisted summaries and details from PostgreSQL + in-memory store
  app.get('/api/meetings/db-summaries', asyncRoute(async (req, res) => {
    const limit = parseInt(req.query.limit, 10) || 20;
    const summaries = await getMeetingSummaries(limit);

    const enrichedSummaries = summaries.map(s => {
      const rec = getMeetingRecordingInfo(s.meeting_id, store.get(s.meeting_id));
      return {
        ...s,
        hasRecording: rec.hasRecording,
        recordingSize: rec.fileSize || null,
      };
    });

    const inProgress = [];
    if (store && store.meetings) {
      for (const [id, meeting] of store.meetings.entries()) {
        if (inFlightSummarize.has(id)) {
          const rec = getMeetingRecordingInfo(id, meeting);
          inProgress.push({
            meetingId: id,
            roomName: meeting.roomName,
            status: 'summarizing',
            transcriptCount: meeting.transcripts.length,
            participants: [...meeting.participants.values()].map(publicParticipant),
            createdAt: meeting.createdAt,
            hasRecording: rec.hasRecording,
            recordingSize: rec.fileSize || null,
          });
        }
      }
    }

    res.json({
      success: true,
      count: enrichedSummaries.length,
      databaseConnected: isDbConnected(),
      inProgress,
      summaries: enrichedSummaries,
    });
  }));

  app.get('/api/meetings/db-details/:meetingId', asyncRoute(async (req, res) => {
    const details = await getMeetingDetails(req.params.meetingId);
    const storeMeeting = store.get(req.params.meetingId);
    const rec = getMeetingRecordingInfo(req.params.meetingId, storeMeeting);

    if (!details) {
      if (storeMeeting) {
        return res.json({
          success: true,
          meeting: {
            id: storeMeeting.id,
            room_name: storeMeeting.roomName,
            status: storeMeeting.status,
            created_at: storeMeeting.createdAt,
            ended_at: storeMeeting.endedAt,
          },
          summary: storeMeeting.postMeetingBatch?.status === 'done' ? storeMeeting.postMeetingBatch.summary : storeMeeting.summary,
          transcripts: storeMeeting.postMeetingBatch?.status === 'done' ? storeMeeting.postMeetingBatch.transcripts : storeMeeting.transcripts,
          postMeetingBatch: publicBatch(storeMeeting.postMeetingBatch),
          attendees: [...storeMeeting.participants.values()].map(publicParticipant),
          hasRecording: rec.hasRecording,
          recordingSize: rec.fileSize || null,
        });
      }
      return res.status(404).json({ error: 'Meeting not found in database', meetingId: req.params.meetingId });
    }
    res.json({
      success: true,
      ...details,
      hasRecording: rec.hasRecording,
      recordingSize: rec.fileSize || null,
    });
  }));

    // Meeting report export authorization.
  // Export routes are outside the single-segment /api/meetings/:id middleware,
  // so they verify the meeting token explicitly.
  async function authorizeExport(req, res, meetingId) {
    const meeting = store.get(meetingId);

    if (!meeting) {
      res.status(404).json({ error: 'Meeting session not found' });
      return null;
    }

    const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];

    if (!token) {
      res.status(401).json({ error: 'A meeting token is required' });
      return null;
    }

    let claims;

    try {
      claims = await verifier.verify(token);
    } catch {
      res.status(401).json({ error: 'Meeting token is invalid or expired' });
      return null;
    }

    if (
      claims.video?.room !== meeting.livekitRoom ||
      !claims.video?.roomJoin ||
      !meeting.participants.has(claims.sub)
    ) {
      res.status(403).json({ error: 'This token cannot access the meeting' });
      return null;
    }

    return meeting;
  }

  // Structured meeting report export.
  app.get('/api/meetings/:meetingId/export/json', asyncRoute(async (req, res) => {
    const meeting = await authorizeExport(req, res, req.params.meetingId);
    if (!meeting) return;

    const details = await getMeetingDetails(req.params.meetingId);

    if (!details) {
      return res.status(404).json({
        error: 'Meeting report is not available in database',
        meetingId: req.params.meetingId,
      });
    }

    const filename = `balicall-meeting-${req.params.meetingId}.json`;

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    res.json({
      exportType: 'meeting-report',
      exportedAt: new Date().toISOString(),
      meeting: details.meeting,
      summary: details.summary,
      attendees: details.attendees,
      transcripts: details.transcripts,
    });
  }));

  // Formal meeting minutes PDF export.
  app.get('/api/meetings/:meetingId/export/pdf', asyncRoute(async (req, res) => {
    const meeting = await authorizeExport(req, res, req.params.meetingId);
    if (!meeting) return;

    const details = await getMeetingDetails(req.params.meetingId);

    if (!details) {
      return res.status(404).json({
        error: 'Meeting report is not available in database',
        meetingId: req.params.meetingId,
      });
    }

    const summary = details.summary || {};
    const attendees = Array.isArray(details.attendees) ? details.attendees : [];
    const transcripts = Array.isArray(details.transcripts) ? details.transcripts : [];

    const discussionPoints = asArray(summary.key_discussion_points);
    const decisions = asArray(summary.decisions);
    const actionItems = asArray(summary.action_items);
    const attendanceSummary = asArray(summary.attendance_summary);

    const filename = `balicall-meeting-${req.params.meetingId}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    const doc = new PDFDocument({
      size: 'A4',
      margins: {
        top: 50,
        bottom: 50,
        left: 55,
        right: 55,
      },
      info: {
        Title: pdfText(summary.title || `Notulen ${details.meeting?.room_name || 'Meeting'}`),
        Author: 'BaliCall',
        Subject: 'Formal Meeting Minutes',
      },
    });

    doc.pipe(res);

    const pageWidth = 485;

    const heading = (title, level = 1) => {
      if (level === 1) {
        doc
          .moveDown(0.8)
          .font('Helvetica-Bold')
          .fontSize(14)
          .text(title)
          .moveDown(0.35);
      } else {
        doc
          .moveDown(0.45)
          .font('Helvetica-Bold')
          .fontSize(11)
          .text(title)
          .moveDown(0.2);
      }
    };

    const bulletList = items => {
      if (!items.length) {
        doc.font('Helvetica').fontSize(10).text('Tidak ada data yang tercatat.');
        return;
      }

      items.forEach(item => {
        doc
          .font('Helvetica')
          .fontSize(10)
          .text(`• ${pdfText(item)}`, {
            width: pageWidth,
            lineGap: 3,
          });
      });
    };

    const numberedList = items => {
      if (!items.length) {
        doc.font('Helvetica').fontSize(10).text('Tidak ada data yang tercatat.');
        return;
      }

      items.forEach((item, index) => {
        doc
          .font('Helvetica')
          .fontSize(10)
          .text(`${index + 1}. ${pdfText(item)}`, {
            width: pageWidth,
            lineGap: 3,
          });
      });
    };

    // Header
    doc
      .font('Helvetica-Bold')
      .fontSize(20)
      .text('BaliCall', { align: 'center' });

    doc
      .font('Helvetica')
      .fontSize(9)
      .text('Bali Tower Sentra — Internal Meeting & AI Minutes', { align: 'center' })
      .moveDown(0.8);

    doc
      .moveTo(55, doc.y)
      .lineTo(540, doc.y)
      .stroke()
      .moveDown(0.8);

    doc
      .font('Helvetica-Bold')
      .fontSize(16)
      .text(pdfText(summary.title || 'Notulen Rapat'), {
        align: 'center',
      })
      .moveDown(0.7);

    // Meeting metadata
    const meetingDate = details.meeting?.created_at
      ? new Date(details.meeting.created_at).toLocaleString('id-ID')
      : '-';

    const endedDate = details.meeting?.ended_at
      ? new Date(details.meeting.ended_at).toLocaleString('id-ID')
      : '-';

    doc
      .font('Helvetica')
      .fontSize(10)
      .text(`Ruang Rapat: ${pdfText(details.meeting?.room_name || meeting.roomName || '-')}`)
      .text(`Meeting ID: ${req.params.meetingId}`)
      .text(`Dimulai: ${meetingDate}`)
      .text(`Selesai: ${endedDate}`)
      .text(`Layanan AI: ${pdfText(summary.provider || 'Tidak diketahui')}`)
      .text(`Jumlah Ucapan: ${transcripts.length}`)
      .moveDown(0.5);

    heading('1. Ringkasan Rapat');
    doc
      .font('Helvetica')
      .fontSize(10)
      .text(pdfText(summary.executive_summary || 'Belum tersedia.'), {
        width: pageWidth,
        align: 'justify',
        lineGap: 3,
      });

    heading('2. Pokok Pembahasan');
    bulletList(discussionPoints);

    heading('3. Keputusan Rapat');
    numberedList(decisions);

    heading('4. Tindak Lanjut');

    if (!actionItems.length) {
      doc
        .font('Helvetica')
        .fontSize(10)
        .text('Tidak ada tindak lanjut yang tercatat.');
    } else {
      actionItems.forEach((item, index) => {
        const task = typeof item === 'object' ? item.task : item;
        const assignee = typeof item === 'object' ? item.assignee : '';
        const priority = typeof item === 'object' ? item.priority : '';
        const deadline = typeof item === 'object' ? item.deadline : '';

        doc
          .font('Helvetica-Bold')
          .fontSize(10)
          .text(`${index + 1}. ${pdfText(task || 'Tugas tidak ditentukan')}`);

        doc
          .font('Helvetica')
          .fontSize(9)
          .text(`   PIC / Penanggung jawab: ${pdfText(assignee || 'Belum ditentukan')}`)
          .text(`   Prioritas: ${pdfText(priority || 'Belum ditentukan')}`)
          .text(`   Tenggat / Syarat: ${pdfText(deadline || 'Belum ditentukan')}`)
          .moveDown(0.25);
      });
    }

    heading('5. Kehadiran');

    if (attendanceSummary.length) {
      bulletList(attendanceSummary);
    } else if (attendees.length) {
      attendees.forEach(attendee => {
        doc
          .font('Helvetica')
          .fontSize(10)
          .text(
            `• ${pdfText(attendee.employee_name || attendee.employee_id || 'Peserta')} — ${pdfText(attendee.department || 'Departemen tidak tersedia')}`,
            { lineGap: 3 },
          );
      });
    } else {
      doc
        .font('Helvetica')
        .fontSize(10)
        .text('Data peserta tidak tersedia.');
    }

    heading('6. Pengesahan');

    doc
      .font('Helvetica')
      .fontSize(10)
      .text(
        'Dokumen ini merupakan hasil pencatatan rapat dan peringkasan berbantuan AI. ' +
        'Dokumen dapat digunakan sebagai draft notulen untuk ditinjau dan disahkan oleh pihak yang berwenang.'
      )
      .moveDown(1.2);

    // Signature area
    const signatureY = doc.y;

    doc
      .font('Helvetica')
      .fontSize(10)
      .text('Disusun oleh,', 75, signatureY)
      .text('Disetujui oleh,', 355, signatureY);

    doc
      .moveTo(75, signatureY + 65)
      .lineTo(225, signatureY + 65)
      .stroke();

    doc
      .moveTo(355, signatureY + 65)
      .lineTo(505, signatureY + 65)
      .stroke();

    doc
      .font('Helvetica')
      .fontSize(9)
      .text('BaliCall / AI Meeting Assistant', 75, signatureY + 72)
      .text('Pihak yang berwenang', 355, signatureY + 72);

    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor('#666666')
      .text(
        `Diekspor pada ${new Date().toLocaleString('id-ID')}`,
        55,
        780,
        { width: pageWidth, align: 'center' },
      );

    doc.end();
  }));

  // Inbound LiveKit Webhook Receiver
  app.post('/api/livekit/webhook', asyncRoute(async (req, res) => {
    const rawBody = req.rawBody || (typeof req.body === 'string' ? req.body : JSON.stringify(req.body));
    const authHeader = req.headers['authorization'] || req.headers['authorize'];
    let event;

    try {
      event = await webhookReceiver.receive(rawBody, authHeader);
    } catch (verifyErr) {
      return res.status(401).json({ error: 'Unauthorized webhook signature' });
    }

    const logItem = {
      id: `wh-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      time: new Date().toISOString(),
      event: event.event,
      roomName: event.room?.name || 'N/A',
      participant: event.participant?.name || event.participant?.identity || 'N/A',
      details: { roomSid: event.room?.sid, participantIdentity: event.participant?.identity },
    };
    webhookLogs.unshift(logItem);
    if (webhookLogs.length > 50) webhookLogs.pop();

    const applied = store.applyLivekitEvent(event, config.attendanceGraceMs ?? 10000);
    if (applied.meetingId) postMeetingBatch.schedule(applied.meetingId);
    if (applied.meetingId && !applied.duplicate) {
      const meeting = store.get(applied.meetingId);
      await saveMeeting(meeting);
      await saveAttendees(meeting.id, [...meeting.participants.values()]);
    }
    if (applied.finalize || applied.duplicate) attendanceFinalizer.enqueue(applied.meetingId);
    res.json({ success: true, event: event.event, ...applied });
  }));

  app.get('/api/livekit/webhooks', (_req, res) => {
    res.json({ success: true, count: webhookLogs.length, logs: webhookLogs });
  });

  // Outbound Webhook Manual Dispatcher
  app.post('/api/meetings/:id/dispatch-webhook', asyncRoute(async (req, res) => {
    const meeting = store.get(req.params.id);
    const targetUrl = req.body?.targetUrl || config.outboundWebhookUrl;
    if (!targetUrl) return res.status(400).json({ error: 'No targetUrl provided in request body or OUTBOUND_WEBHOOK_URL config' });

    const payload = {
      event: 'meeting.summary.dispatched',
      meetingId: req.params.id,
      roomName: meeting?.roomName || null,
      summary: meeting?.summary || req.body?.summary || null,
      dispatchedAt: new Date().toISOString(),
    };

    const response = await fetchImpl(targetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    res.json({ success: true, targetUrl, status: response.status });
  }));

  app.use('/api', (_req, res) => res.status(404).json({ error: 'API endpoint not found' }));

  if (existsSync(join(config.clientDist, 'index.html'))) {
    app.use(express.static(config.clientDist));
    app.get('*', (_req, res) => res.sendFile(join(config.clientDist, 'index.html')));
  }

  app.use((error, req, res, _next) => {
    if (res.headersSent) return _next(error);
    const status = error.status || (error.type === 'entity.too.large' ? 413 : 500);
    if (status >= 500) console.error('API request failed:', {requestId:req.requestId,method:req.method,path:req.route?.path||req.path,status,message:error.message});
    res.status(status).json({ error: status === 500 ? 'Server could not complete the request. Check service logs and data storage.' : error.message,requestId:req.requestId });
  });

  return { app, store, notificationTick:()=>notifications?.tick(), close(){postMeetingBatch.close();attendanceFinalizer.close();notifications?.close();} };
}
