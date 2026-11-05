import { createSprintFromOperation } from './create.js';

export async function updateExistingTaskStatuses({
  meeting,
  taskUpdates,
  existingTasks,
  options,
  reviewClient,
  taskMatchesReference,
}) {
  for (const update of taskUpdates) {
    const matches = existingTasks.filter(candidate =>
      taskMatchesReference(candidate, update.task)
    );

    if (matches.length !== 1) {
      console.warn('[ITPROJECT] Update status task lama dilewati: referensi tidak unik.', {
        meetingId: meeting.id,
        taskReference: update.task,
        matches: matches.length,
      });
      continue;
    }

    const existingTask = matches[0];
    const selectedStatus = (options.taskStatuses || []).find(
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
      !['to do', 'blocked'].includes(
        selectedStatus.name.trim().toLowerCase()
      );

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
      await reviewClient.updateTaskStatus({
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
}

export async function editExistingTasks({
  meeting,
  taskEdits,
  existingTasks,
  options,
  reviewClient,
  normalizeTaskReference,
  flattenTaskTree,
  escapeHtml,
}) {
  for (const edit of taskEdits) {
    const reference = normalizeTaskReference(edit.task);
    const changes = edit.changes || {};

    const matches = existingTasks.filter(candidate => {
      const candidateTitle = normalizeTaskReference(candidate.title);

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

    const findUniqueOption = (list, name, fieldName) => {
      const normalizedName = normalizeTaskReference(name);

      const aliases = {
        prioritas: {},
        'tipe task': {
          dokumentasi: 'documentation',
        },
        kategori: {
          isu: 'issue',
        },
        'parent task': {},
        tag: {
          tes: 'test',
        },
      };

      const canonicalName =
        aliases[fieldName]?.[normalizedName] || normalizedName;

      const found = (list || []).filter(
        option =>
          normalizeTaskReference(option.name) === canonicalName
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
      const userAliases = {
        saini: 'bima',
      };
      const canonicalName =
        userAliases[normalizedName] || normalizedName;

      const found = (options.assignableUsers || []).filter(user =>
        normalizeTaskReference(user.name) === canonicalName ||
        normalizeTaskReference(user.email) === canonicalName
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
        if (!value) throw new Error('Judul baru kosong.');
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
        if (!value) throw new Error('Emoji baru kosong.');
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
        updateArgs.priority_id = findUniqueOption(
          options.taskPriorities,
          changes.priority,
          'prioritas'
        ).id;
        changedFields.push('priority');
      }

      if (Object.hasOwn(changes, 'type')) {
        updateArgs.type_id = findUniqueOption(
          options.taskTypes,
          changes.type,
          'tipe task'
        ).id;
        changedFields.push('type');
      }

      if (Object.hasOwn(changes, 'category')) {
        const value = String(changes.category || '').trim();
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
        updateArgs.owned_id = findUniqueUser(changes.owner).id;
        changedFields.push('owner');
      }

      const usersToAssign = Object.hasOwn(changes, 'assignUsers')
        ? changes.assignUsers.map(findUniqueUser)
        : [];

      const assignedUserIds = new Set(
        usersToAssign.map(user => user.id)
      );

      const usersToUnassign = Object.hasOwn(changes, 'unassignUsers')
        ? changes.unassignUsers
            .map(findUniqueUser)
            .filter(user => !assignedUserIds.has(user.id))
        : [];

      if (usersToAssign.length) {
        updateArgs.assign_users = usersToAssign.map(user => user.id);
        changedFields.push('assignUsers');
      }

      if (usersToUnassign.length) {
        updateArgs.unassign_users = usersToUnassign.map(user => user.id);
        changedFields.push('unassignUsers');
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

      await reviewClient.updateTask(updateArgs);

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

export async function editExistingProjects({
  meeting,
  projectUpdates,
  targetProjectId,
  reviewStore,
  reviewClient,
  normalizeTaskReference,
  escapeHtml,
}) {
  if (!projectUpdates.length) return;

  const projects = [...reviewStore.meetings.values()].flatMap(sourceMeeting =>
    Object.values(sourceMeeting.itProjectProjectDispatch || {})
      .filter(dispatch =>
        dispatch.status === 'created' && dispatch.projectId
      )
      .map(dispatch => ({
        id: dispatch.projectId,
        title: dispatch.title,
        project_no: dispatch.projectNo || null,
      }))
  );

  const projectOptionsResult = await reviewClient.projectOptions();
  const projectOptions = projectOptionsResult.data?.data;

  if (!projectOptions?.statuses || !projectOptions?.priorities) {
    throw new Error('Opsi status atau prioritas project tidak tersedia.');
  }

  const parseProjectUpdateDate = value => {
    const text = String(value || '').trim();

    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;

    const match = text.match(
      /(\d{1,2})\s+(Januari|Februari|Maret|April|Mei|Juni|Juli|Agustus|September|Oktober|November|Desember)\s+(\d{4})/i
    );

    if (!match) {
      throw new Error(`Tanggal project tidak dikenali: '${text}'.`);
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

  const findUniqueProjectOption = (list, name, fieldName) => {
    const normalizedName = normalizeTaskReference(name);
    const matches = (list || []).filter(
      option => normalizeTaskReference(option.name) === normalizedName
    );

    if (matches.length !== 1) {
      throw new Error(
        `Opsi ${fieldName} '${name}' tidak ditemukan atau tidak unik.`
      );
    }

    return matches[0];
  };

  for (const edit of projectUpdates) {
    const reference = normalizeTaskReference(edit.project);
    const matches = targetProjectId
        ? [{ id: targetProjectId }]
        : projects.filter(project => {
            const title = normalizeTaskReference(project.title);
            const number = normalizeTaskReference(project.project_no);

            return (
                title === reference ||
                number === reference ||
                (
                reference.length >= 12 &&
                title.length >= 12 &&
                (title.includes(reference) || reference.includes(title))
                )
            );
        });

    if (matches.length !== 1) {
      console.warn('[ITPROJECT] Edit project dilewati: referensi tidak unik.', {
        meetingId: meeting.id,
        projectReference: edit.project,
        matches: matches.length,
      });
      continue;
    }

    const existingProject = matches[0];
    const changes = edit.changes || {};
    const updateArgs = { project: existingProject.id };
    const changedFields = [];

    try {
      const detailResult = await reviewClient.projectDetail(existingProject.id);
      const projectDetail =
        detailResult.data?.data?.project ||
        detailResult.data?.project ||
        detailResult.data;

      if (!projectDetail?.id) {
        throw new Error('Detail project tidak berisi data project.');
      }

      if (Object.hasOwn(changes, 'title')) {
        const value = String(changes.title || '').trim();
        if (!value) throw new Error('Judul project baru kosong.');
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
        if (!value) throw new Error('Emoji project baru kosong.');
        updateArgs.emoji = value;
        changedFields.push('emoji');
      }

      if (Object.hasOwn(changes, 'startDate')) {
        updateArgs.start_date = parseProjectUpdateDate(changes.startDate);
        changedFields.push('start_date');
      }

      if (Object.hasOwn(changes, 'dueDate')) {
        updateArgs.due_date = parseProjectUpdateDate(changes.dueDate);
        changedFields.push('due_date');
      }

      const existingStartDate = projectDetail.start_date
        ? String(projectDetail.start_date).slice(0, 10)
        : '';
      const existingDueDate = projectDetail.due_date
        ? String(projectDetail.due_date).slice(0, 10)
        : '';

      if (!updateArgs.start_date && existingStartDate) {
        updateArgs.start_date = existingStartDate;
      }

      if (!updateArgs.due_date && existingDueDate) {
        updateArgs.due_date = existingDueDate;
      }

      const startDate = updateArgs.start_date || existingStartDate;
      const dueDate = updateArgs.due_date || existingDueDate;

      if (!dueDate) {
        console.warn('[ITPROJECT] Edit project dilewati: project belum memiliki due date.', {
          meetingId: meeting.id,
          projectId: existingProject.id,
          title: existingProject.title,
          requestedFields: changedFields,
        });
        continue;
      }

      if (startDate && dueDate < startDate) {
        throw new Error('Due date project tidak boleh sebelum start date.');
      }

      if (Object.hasOwn(changes, 'status')) {
        updateArgs.status_id = findUniqueProjectOption(
          projectOptions.statuses,
          changes.status,
          'status project'
        ).id;
        changedFields.push('status');
      }

      if (Object.hasOwn(changes, 'priority')) {
        updateArgs.priority_id = findUniqueProjectOption(
          projectOptions.priorities,
          changes.priority,
          'prioritas project'
        ).id;
        changedFields.push('priority');
      }

      if (!changedFields.length) {
        console.info('[ITPROJECT] Edit project dilewati: tidak ada field yang berubah.', {
          meetingId: meeting.id,
          projectId: existingProject.id,
          title: existingProject.title,
        });
        continue;
      }

      await reviewClient.updateProject(updateArgs);

      console.info('[ITPROJECT] Project lama berhasil diubah.', {
        meetingId: meeting.id,
        projectId: existingProject.id,
        projectNo: existingProject.project_no || null,
        title: existingProject.title,
        changedFields,
      });
    } catch (error) {
      console.warn('[ITPROJECT] Edit project gagal atau dilewati.', {
        meetingId: meeting.id,
        projectId: existingProject.id,
        title: existingProject.title,
        requestedFields: changedFields,
        message: error.message,
      });
    }
  }
}

export async function applySprintOperations({
  meeting,
  sprintOperations,
  targetProjectId,
  reviewClient,
  flattenTaskTree,
  normalizeTaskReference,
  taskMatchesReference,
  createdTaskReferences,
}) {
  if (!sprintOperations.length) return;

  const sprintResult = await reviewClient.projectSprints(targetProjectId);
  const sprintData = sprintResult.data?.data;

  if (!Array.isArray(sprintData?.sprints)) {
    throw new Error('Respons get-project-sprints tidak berisi daftar sprint.');
  }

  const sprints = sprintData.sprints;
  const backlog = Array.isArray(sprintData.backlog)
    ? sprintData.backlog
    : [];

  const needsTaskLookup = sprintOperations.some(
    operation => operation.operation === 'assign_tasks'
  );

  const projectTaskResult = needsTaskLookup
    ? await reviewClient.projectTasks(targetProjectId)
    : null;

  const projectTaskTree = flattenTaskTree(
    projectTaskResult?.data?.data || []
  );

  const createdSprints = new Map();
  const sprintAliases = new Map();

  const normalizeSprintReference = value =>
    normalizeTaskReference(value).replace(
      /\b(nol|satu|dua|tiga|empat|lima|enam|tujuh|delapan|sembilan|sepuluh)\b/g,
      word => ({
        nol: '0',
        satu: '1',
        dua: '2',
        tiga: '3',
        empat: '4',
        lima: '5',
        enam: '6',
        tujuh: '7',
        delapan: '8',
        sembilan: '9',
        sepuluh: '10',
      })[word]
    ).replace(/^sprint\s+/, '');

  const findSprint = reference => {
    const normalized = normalizeSprintReference(reference);
    const created = createdSprints.get(normalized);
    const alias = sprintAliases.get(normalized);

    if (created) return [created];
    if (alias) return [alias];

    return sprints.filter(sprint =>
      taskMatchesReference(
        { title: normalizeSprintReference(sprint.name || '') },
        normalized
      )
    );
  };

  const findTasks = reference => {
    const normalized = normalizeTaskReference(reference);
    const candidates = [
      ...backlog,
      ...sprints.flatMap(sprint => sprint.tasks || []),
      ...projectTaskTree,
      ...createdTaskReferences,
    ];
    const matches = new Map();

    for (const task of candidates) {
      if (taskMatchesReference(task, normalized)) {
        matches.set(task.id, task);
      }
    }

    return [...matches.values()];
  };

  const sprintDate = value => {
    const date = String(value || '').trim();
    if (!date) return '';

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new Error(
        `Tanggal sprint '${date}' harus dalam format YYYY-MM-DD.`
      );
    }

    return date;
  };

  for (const operation of sprintOperations) {
    const details = {
      meetingId: meeting.id,
      operation: operation.operation,
      projectId: targetProjectId,
      sprint: operation.sprint || operation.name || null,
      tasks: operation.tasks || [],
    };

    try {
      const args = operation;

      if (
        args.duration &&
        !['1 week', '2 weeks', '3 weeks', '4 weeks', 'Custom']
          .includes(args.duration)
      ) {
        throw new Error(`Durasi sprint '${args.duration}' tidak valid.`);
      }

      const startDate = sprintDate(args.startDate);
      const endDate = sprintDate(args.endDate);

      if (startDate && endDate && endDate < startDate) {
        throw new Error('Tanggal akhir sprint tidak boleh sebelum tanggal mulai.');
      }
      
      if (operation.operation === 'create') {
        console.info('[ITPROJECT] Create sprint dilewati.', {
          meetingId: meeting.id,
          projectId: targetProjectId,
          sprint: operation.name || null,
        });
        continue;
      }

      if (operation.operation === 'create') {
        await createSprintFromOperation({
          args,
          startDate,
          endDate,
          targetProjectId,
          reviewClient,
          details,
          createdSprints,
          normalizeSprintReference,
        });
        continue;
      }

      const sprintMatches = findSprint(args.sprint);

      if (sprintMatches.length !== 1) {
        console.warn('[ITPROJECT] Operasi sprint dilewati: referensi sprint tidak unik.', {
          ...details,
          matches: sprintMatches.length,
        });
        continue;
      }

      const sprint = sprintMatches[0];

      if (operation.operation === 'update') {
        const updateArgs = { sprint: sprint.id };

        if (args.name) updateArgs.name = args.name.trim();
        if (args.goal) updateArgs.goal = args.goal;
        if (startDate) updateArgs.start_date = startDate;
        if (endDate) updateArgs.end_date = endDate;
        if (args.duration) updateArgs.duration = args.duration;

        if (Object.keys(updateArgs).length === 1) {
          console.info('[ITPROJECT] Update sprint dilewati: tidak ada field perubahan.', details);
          continue;
        }

        await reviewClient.updateSprint(updateArgs);
        sprintAliases.set(normalizeSprintReference(args.sprint), sprint);

        if (args.name) {
          sprintAliases.set(normalizeSprintReference(args.name), sprint);
          sprint.name = args.name.trim();
        }

        console.info('[ITPROJECT] Sprint berhasil diperbarui.', details);
        continue;
      }

      if (operation.operation === 'start') {
        await reviewClient.startSprint({
          sprint: sprint.id,
          ...(args.goal ? { goal: args.goal } : {}),
          ...(startDate ? { start_date: startDate } : {}),
          ...(endDate ? { end_date: endDate } : {}),
          ...(args.duration ? { duration: args.duration } : {}),
        });

        console.info('[ITPROJECT] Sprint berhasil dimulai.', details);
        continue;
      }

      if (operation.operation === 'complete') {
        const completeArgs = { sprint: sprint.id };

        if (args.retrospective) {
          completeArgs.retrospective = args.retrospective;
        }

        const destination = normalizeTaskReference(args.moveIncompleteTo);

        if (destination === 'backlog') {
          completeArgs.move_incomplete_to = { other: 'backlog' };
        } else if (destination === 'new sprint') {
          completeArgs.move_incomplete_to = { other: 'new_sprint' };
        } else if (destination) {
          const destinationMatches = findSprint(args.moveIncompleteTo);

          if (destinationMatches.length !== 1) {
            console.warn('[ITPROJECT] Complete sprint dilewati: sprint tujuan task belum cocok unik.', {
              ...details,
              destination: args.moveIncompleteTo,
              matches: destinationMatches.length,
            });
            continue;
          }

          completeArgs.move_incomplete_to = {
            existing_sprint: destinationMatches[0].id,
          };
        }

        await reviewClient.completeSprint(completeArgs);
        console.info('[ITPROJECT] Sprint berhasil diselesaikan.', details);
        continue;
      }

      if (operation.operation === 'delete') {
        if (sprint.status?.name?.trim().toLowerCase() === 'active') {
          console.warn('[ITPROJECT] Sprint aktif tidak dihapus; selesaikan sprint terlebih dahulu.', details);
          continue;
        }

        await reviewClient.deleteSprint({ sprint: sprint.id });
        console.info('[ITPROJECT] Sprint berhasil dihapus.', details);
        continue;
      }

      if (operation.operation === 'assign_tasks') {
        const taskIds = new Set();

        for (const reference of args.tasks) {
          const matches = findTasks(reference);

          if (matches.length !== 1) {
            throw new Error(
              `Task '${reference}' tidak ditemukan secara unik di project.`
            );
          }

          if (matches[0].category?.name?.trim().toLowerCase() === 'epic') {
            throw new Error(
              `Epic '${reference}' tidak bisa ditambahkan langsung ke sprint.`
            );
          }

          taskIds.add(matches[0].id);
        }

        if (!taskIds.size) {
          console.info('[ITPROJECT] Assign sprint dilewati: tidak ada task yang disebut.', details);
          continue;
        }

        await reviewClient.assignSprintTasks({
          sprint: sprint.id,
          task_ids: [...taskIds],
        });

        console.info('[ITPROJECT] Task berhasil ditambahkan ke sprint.', {
          ...details,
          taskIds: [...taskIds],
        });
        continue;
      }

      if (operation.operation === 'remove_task') {
        const matches = (sprint.tasks || []).filter(task =>
          taskMatchesReference(task, args.task)
        );

        if (matches.length !== 1) {
          console.warn('[ITPROJECT] Remove task dari sprint dilewati: task tidak cocok unik.', {
            ...details,
            task: args.task,
            matches: matches.length,
          });
          continue;
        }

        await reviewClient.removeSprintTask({
          sprint: sprint.id,
          task: matches[0].id,
        });

        console.info('[ITPROJECT] Task berhasil dikembalikan ke backlog.', {
          ...details,
          taskId: matches[0].id,
          title: matches[0].title,
        });
      }
    } catch (error) {
      console.warn('[ITPROJECT] Operasi sprint gagal atau dilewati.', {
        ...details,
        message: error.message,
      });
    }
  }
}