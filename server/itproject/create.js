import { createHash } from 'node:crypto';

export async function createProjectFromSummary({
  meeting,
  summary,
  projectCreations,
  taskUpdates,
  taskEdits,
  reviewClient,
  reviewStore,
  escapeHtml,
  isoDateInJakarta,
}) {
  // Hindari mengarahkan edit task lama ke project yang baru dibuat.
  if (taskUpdates.length || taskEdits.length) {
    console.warn(
      '[ITPROJECT] Sync project baru dilewati: rapat yang sama juga mengubah task lama.',
      { meetingId: meeting.id }
    );
    return { skipped: true };
  }

  const requestedProject = projectCreations[0];
  const projectDispatchKey = createHash('sha256')
    .update(`${meeting.id}|${requestedProject.title.trim().toLowerCase()}`)
    .digest('hex');

  const previousProjectDispatch =
    reviewStore.get(meeting.id)?.itProjectProjectDispatch?.[projectDispatchKey];

  if (previousProjectDispatch?.status === 'created') {
    return { projectId: previousProjectDispatch.projectId };
  }

  if (
    previousProjectDispatch?.status === 'creating' ||
    previousProjectDispatch?.status === 'failed'
  ) {
    console.warn(
      '[ITPROJECT] Create project tidak dicoba ulang otomatis; periksa dashboard untuk mencegah duplikat.',
      {
        meetingId: meeting.id,
        title: requestedProject.title,
        previousStatus: previousProjectDispatch.status,
        projectId: previousProjectDispatch.projectId || null,
      }
    );
    return { skipped: true };
  }

  const projectOptionsResult = await reviewClient.projectOptions();
  const projectOptions = projectOptionsResult.data?.data;

  if (!projectOptions?.statuses || !projectOptions?.priorities) {
    throw new Error('Opsi status atau prioritas project tidak tersedia.');
  }

  const requestedStatus = projectOptions.statuses.find(
    option =>
      option.name?.trim().toLowerCase() ===
      requestedProject.status.trim().toLowerCase()
  );

  const requestedPriority = projectOptions.priorities.find(
    option =>
      option.name?.trim().toLowerCase() ===
      requestedProject.priority.trim().toLowerCase()
  );

  if (!requestedStatus || !requestedPriority) {
    throw new Error(
      'Status atau prioritas project tidak cocok dengan opsi IT Project.'
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

  const parseProjectDate = value => {
    const text = String(value || '').trim();

    if (!text) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;

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

  reviewStore.transact(() => {
    const current = reviewStore.get(meeting.id);
    current.itProjectProjectDispatch ||= {};
    current.itProjectProjectDispatch[projectDispatchKey] = {
      status: 'creating',
      title: requestedProject.title,
      startedAt: new Date().toISOString(),
    };
  });

  try {
    const projectResult = await reviewClient.createProject({
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

    reviewStore.transact(() => {
      const current = reviewStore.get(meeting.id);
      current.itProjectProjectDispatch[projectDispatchKey] = {
        status: 'created',
        title: requestedProject.title,
        projectId: createdProject.id,
        projectNo: createdProject.project_no || null,
        createdAt: new Date().toISOString(),
      };
    });

    console.info('[ITPROJECT] Project berhasil dibuat dari rapat.', {
      meetingId: meeting.id,
      projectId: createdProject.id,
      projectNo: createdProject.project_no || null,
      title: requestedProject.title,
    });

    return { projectId: createdProject.id };
  } catch (error) {
    reviewStore.transact(() => {
      const current = reviewStore.get(meeting.id);
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

    return { skipped: true };
  }
}

const TASK_NUMERIC_ID_BY_ENCODED_ID = new Map([
  ['UJeeXo83zdG0pYJFV7r6', '1'],
  ['1moX49HDcroSUIwOANWL', '2'],
  ['bNiTmH27qshwj46Fc8fi', '3'],
  ['UCeeXo83zdG0pYJFV7r6', '4'],
  ['BGpapXmIwrE2LC6eY1VT', '5'],
]);

const TASK_MONTH_NUMBERS = {
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

function normalizeActionStatus(value) {
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
}

function resolveTaskCreationDefaults({
  meeting,
  actionItems,
  options,
  reviewClient,
  targetProjectId,
}) {
  const activeSprint = (options.sprints || []).find(
    sprint => sprint.status?.name?.trim().toLowerCase() === 'active'
  );

  if (actionItems.length && !activeSprint) {
    console.warn('[ITPROJECT] Tidak ada sprint aktif; task akan tetap di backlog.', {
      projectId: targetProjectId,
    });
  }

  const status = options.taskStatuses.find(
    option =>
      option.name?.trim().toLowerCase() ===
      reviewClient.taskStatusName.trim().toLowerCase()
  );

  const defaultType = options.taskTypes.find(
    option => option.id === reviewClient.taskTypeId
  );

  if (!status || !defaultType) {
    throw new Error('ID status atau tipe fallback tidak cocok dengan opsi project.');
  }

  const numericStatusId = TASK_NUMERIC_ID_BY_ENCODED_ID.get(status.id);

  if (!numericStatusId) {
    throw new Error('Status awal task belum punya pemetaan numerik.');
  }

  return { activeSprint, status, defaultType, numericStatusId };
}

function prepareTaskCreation({
  item,
  meeting,
  summary,
  options,
  reviewClient,
  reviewStore,
  escapeHtml,
  isoDateInJakarta,
  taskMatchesReference,
  createdTaskReferences,
  status,
  defaultType,
}) {
  const title = String(item.task || '').trim();
  if (!title) return null;

  const explicitStatusMatch = title.match(
    /\bstatus(?:nya)?\s+(to\s+do|blocked|in\s+progress|finished|in\s+review|completed|komplit|tuntas)\b/i
  );

  const requestedStatusName =
    (explicitStatusMatch && normalizeActionStatus(explicitStatusMatch[1])) ||
    normalizeActionStatus(item.status) ||
    status.name;

  const selectedStatus = options.taskStatuses.find(
    option =>
      option.name?.trim().toLowerCase() ===
      requestedStatusName.toLowerCase()
  );

  if (!selectedStatus) {
    console.warn('[ITPROJECT] Status task tidak tersedia; task dilewati.', {
      meetingId: meeting.id,
      title,
      requestedStatus: item.status || '',
    });
    return null;
  }

  const requestedTypeName = String(item.type || '').trim().toLowerCase();
  const selectedType = requestedTypeName
    ? options.taskTypes.find(
        option => option.name?.trim().toLowerCase() === requestedTypeName
      )
    : null;

  const type = selectedType || defaultType;
  const numericTypeId = TASK_NUMERIC_ID_BY_ENCODED_ID.get(type.id);

  if (!numericTypeId) {
    console.warn('[ITPROJECT] Tipe task tidak punya pemetaan numerik; task dilewati.', {
      meetingId: meeting.id,
      title,
      requestedType: item.type || '',
    });
    return null;
  }

  const key = createHash('sha256')
    .update([
      meeting.id,
      title.toLowerCase(),
      String(item.assignee || '').trim().toLowerCase(),
      String(item.deadline || '').trim().toLowerCase(),
    ].join('|'))
    .digest('hex');

  const previousDispatch =
    reviewStore.get(meeting.id)?.itProjectTaskDispatch?.[key];

  if (previousDispatch?.status === 'created') {
    return {
      existingReference: previousDispatch.taskId
        ? {
            id: previousDispatch.taskId,
            title: previousDispatch.title || title,
          }
        : null,
    };
  }

  if (previousDispatch?.status === 'creating') {
    return null;
  }

  const priorityName = String(item.priority || '').trim().toLowerCase();
  const priority = options.taskPriorities.find(
    option => option.name?.trim().toLowerCase() === priorityName
  );

  if (!priority) {
    reviewStore.transact(() => {
      const current = reviewStore.get(meeting.id);
      current.itProjectTaskDispatch ||= {};
      current.itProjectTaskDispatch[key] = {
        status: 'failed',
        title,
        error: `Prioritas '${item.priority}' tidak tersedia atau belum punya pemetaan numerik.`,
      };
    });
    return null;
  }

  const numericPriorityId =
    TASK_NUMERIC_ID_BY_ENCODED_ID.get(priority.id) || null;

  const assigneeName = String(item.assignee || '').trim();
  const matchingUsers = assigneeName
    ? options.assignableUsers.filter(
        user =>
          user.name?.trim().toLowerCase() === assigneeName.toLowerCase() ||
          user.email?.trim().toLowerCase() === assigneeName.toLowerCase()
      )
    : [];

  const owner = matchingUsers.length === 1 ? matchingUsers[0] : null;

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

  const deadlineText = String(item.deadline || '').trim();
  const isoDeadlineMatch = deadlineText.match(/\b(\d{4}-\d{2}-\d{2})\b/);

  const dueDate = isoDeadlineMatch
    ? isoDeadlineMatch[1]
    : dueDateMatch
      ? `${dueDateMatch[3]}-${TASK_MONTH_NUMBERS[dueDateMatch[2].toLowerCase()]}-${dueDateMatch[1].padStart(2, '0')}`
      : '';

  const parentReference = String(item.parent || '').trim();
  let parentId = '';

  if (parentReference) {
    const parentCandidates = new Map();

    for (const candidate of createdTaskReferences) {
      if (taskMatchesReference(candidate, parentReference)) {
        parentCandidates.set(candidate.id, candidate);
      }
    }

    for (const candidate of options.taskParents || []) {
      if (taskMatchesReference(candidate, parentReference)) {
        parentCandidates.set(candidate.id, candidate);
      }
    }

    if (parentCandidates.size !== 1) {
      console.warn('[ITPROJECT] Subtask dilewati: parent tidak ditemukan secara unik.', {
        meetingId: meeting.id,
        title,
        parentReference,
        matches: parentCandidates.size,
      });
      return null;
    }

    const selectedCategory = (options.taskCategories || []).find(
      category => category.id === reviewClient.taskCategoryId
    );

    if (selectedCategory?.name?.trim().toLowerCase() === 'epic') {
      console.warn('[ITPROJECT] Subtask dilewati: task berkategori Epic tidak boleh menjadi subtask.', {
        meetingId: meeting.id,
        title,
        parentReference,
      });
      return null;
    }

    parentId = [...parentCandidates.keys()][0];
  }

  return {
    item,
    title,
    key,
    previousDispatch,
    selectedStatus,
    type,
    numericTypeId,
    numericPriorityId,
    owner,
    description,
    startDate,
    dueDate,
    parentId,
  };
}

async function createPreparedTask({
  prepared,
  meeting,
  targetProjectId,
  reviewClient,
  reviewStore,
  flattenTaskTree,
  createdTaskReferences,
  activeSprint,
  status,
}) {
  const {
    item,
    title,
    key,
    previousDispatch,
    selectedStatus,
    type,
    numericTypeId,
    numericPriorityId,
    owner,
    description,
    startDate,
    dueDate,
    parentId,
  } = prepared;

  reviewStore.transact(() => {
    const current = reviewStore.get(meeting.id);
    current.itProjectTaskDispatch ||= {};
    current.itProjectTaskDispatch[key] = {
      status: 'creating',
      title,
      startedAt: new Date().toISOString(),
    };
  });

  try {
    let task = null;

    if (previousDispatch?.status === 'failed' && previousDispatch.startedAt) {
      const existingResult = await reviewClient.projectTasks(targetProjectId);
      const existingTasks = flattenTaskTree(existingResult.data?.data || []);
      const previousStartedAt = Date.parse(previousDispatch.startedAt);

      task = existingTasks.find(
        candidate =>
          candidate.title?.trim().toLowerCase() === title.toLowerCase() &&
          Number.isFinite(Date.parse(candidate.created_at)) &&
          Date.parse(candidate.created_at) >= previousStartedAt - 60_000
      ) || null;
    }

    if (!task) {
      const result = await reviewClient.createTask({
        project: targetProjectId,
        title,
        status_id: TASK_NUMERIC_ID_BY_ENCODED_ID.get(status.id),
        priority_id: numericPriorityId,
        type_id: numericTypeId,
        task_category_id: reviewClient.taskCategoryId,
        ...(parentId ? { parent_id: parentId } : {}),
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

    createdTaskReferences.push({ id: task.id, title });

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
        await reviewClient.updateTaskStatus({
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
        await reviewClient.assignSprintTasks({
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

    reviewStore.transact(() => {
      const current = reviewStore.get(meeting.id);
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
      projectId: targetProjectId,
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
    reviewStore.transact(() => {
      const current = reviewStore.get(meeting.id);
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

export async function createTasksFromSummary({
  meeting,
  summary,
  actionItems,
  targetProjectId,
  options,
  reviewClient,
  reviewStore,
  escapeHtml,
  isoDateInJakarta,
  flattenTaskTree,
  taskMatchesReference,
}) {
  const { activeSprint, status, defaultType } = resolveTaskCreationDefaults({
    meeting,
    actionItems,
    options,
    reviewClient,
    targetProjectId,
  });

  const createdTaskReferences = [];
  const orderedActionItems = [
    ...actionItems.filter(item => !String(item.parent || '').trim()),
    ...actionItems.filter(item => String(item.parent || '').trim()),
  ];

  for (const item of orderedActionItems) {
    const prepared = prepareTaskCreation({
      item,
      meeting,
      summary,
      options,
      reviewClient,
      reviewStore,
      escapeHtml,
      isoDateInJakarta,
      taskMatchesReference,
      createdTaskReferences,
      status,
      defaultType,
    });

    if (!prepared) continue;

    if (prepared.existingReference) {
      createdTaskReferences.push(prepared.existingReference);
      continue;
    }

    await createPreparedTask({
      prepared,
      meeting,
      targetProjectId,
      reviewClient,
      reviewStore,
      flattenTaskTree,
      createdTaskReferences,
      activeSprint,
      status,
    });
  }

  return createdTaskReferences;
}

export async function createSprintFromOperation({
  args,
  startDate,
  endDate,
  targetProjectId,
  reviewClient,
  details,
  createdSprints,
  normalizeSprintReference,
}) {
  const result = await reviewClient.createSprint({
    project: targetProjectId,
    ...(args.name ? { name: args.name.trim() } : {}),
    ...(args.goal ? { goal: args.goal } : {}),
    ...(startDate ? { start_date: startDate } : {}),
    ...(endDate ? { end_date: endDate } : {}),
    ...(args.duration ? { duration: args.duration } : {}),
  });

  const createdSprint =
    result.data?.data ||
    result.data?.sprint ||
    result.data;

  if (!createdSprint?.id) {
    throw new Error('Respons create-sprint tidak berisi ID sprint.');
  }

  const sprintName = createdSprint.name || args.name;

  createdSprints.set(
    normalizeSprintReference(sprintName),
    createdSprint
  );

  console.info('[ITPROJECT] Sprint berhasil dibuat.', {
    ...details,
    sprintId: createdSprint.id,
    sprintName,
  });

  return createdSprint;
}