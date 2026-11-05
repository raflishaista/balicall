import {useCallback,useEffect,useMemo,useState} from 'react';
import {Check, X, ShieldCheck, Loader2, ListChecks} from 'lucide-react';
import {apiRequest} from './api';
import './McpReviewPanel.css';

type ReviewOption = {
  id: string;
  name?: string;
  title?: string;
  project_no?: string;
  parent_id?: string | null;
  sub_task_recursive?: ReviewOption[];
  tasks?: ReviewOption[];
};

type ReviewOperation = {
  method: string;
  args: Record<string, unknown>;
};

type ReviewOptions = Record<string, any>;

export interface McpReview {
  isHost: boolean;
  revision: string;
  planDigest: string;
  status: string;
  canDecide: boolean;
  operations: ReviewOperation[];
  options?: ReviewOptions;
  evidence?: {
    field: string;
    index: number;
    sources: {utteranceId: string; speaker?: string; quote: string}[];
  }[];
  error?: string | null;
  note?: string | null;
  decidedBy?: string | null;
  results?: {index: number; method: string; status: string; id?: string | null}[];
}

const labels: Record<string, string> = {
  pending: 'Menunggu persetujuan host',
  ready: 'Menunggu persetujuan host',
  blocked: 'Tinjauan belum siap',
  rejected: 'Host memilih tidak mengirim',
  sending: 'Mengirim perubahan yang disetujui',
  sent: 'Perubahan telah dikirim',
  needs_check: 'Hasil perlu diperiksa di IT Project',
};

const evidenceLabels: Record<string, string> = {
  actionItems: 'Tindak lanjut',
  decisions: 'Keputusan',
  taskUpdates: 'Perubahan status task',
  taskEdits: 'Perubahan task',
  projectCreations: 'Proyek baru',
  projectUpdates: 'Perubahan proyek',
};

const actionLabels: Record<string, string> = {
  createTask: 'Buat task',
  createProject: 'Buat proyek',
  updateTask: 'Edit task',
  updateTaskStatus: 'Ubah status task',
  updateProject: 'Edit project',
  assignSprintTasks: 'Masukkan task ke sprint',
  createSprint: 'Buat sprint',
  updateSprint: 'Edit sprint',
  startSprint: 'Mulai sprint',
  completeSprint: 'Selesaikan sprint',
  deleteSprint: 'Hapus sprint',
  removeSprintTask: 'Kembalikan task ke backlog',
};

const fieldLabels: Record<string, string> = {
  title: 'Judul',
  description: 'Deskripsi',
  emoji: 'Emoji',
  start_date: 'Tanggal mulai',
  due_date: 'Due date',
  end_date: 'Tanggal akhir',
  status_id: 'Status',
  priority_id: 'Prioritas',
  type_id: 'Tipe task',
  task_category_id: 'Kategori',
  parent_id: 'Parent task',
  owned_id: 'Owner',
  assign_users: 'Assignee',
  unassign_users: 'Hapus assignee',
  tag_ids: 'Tag',
  remove_tag_ids: 'Hapus tag',
  name: 'Nama sprint',
  goal: 'Tujuan sprint',
  duration: 'Durasi',
  retrospective: 'Retrospektif',
  task_ids: 'Task dalam sprint',
  task: 'Task',
};

const editableFields: Record<string, string[]> = {
  updateProject: [
    'title', 'description', 'emoji', 'start_date', 'due_date',
    'status_id', 'priority_id',
  ],
  updateTask: [
    'title', 'description', 'emoji', 'start_date', 'due_date',
    'status_id', 'priority_id', 'type_id', 'task_category_id',
    'parent_id', 'owned_id', 'assign_users', 'unassign_users',
    'tag_ids', 'remove_tag_ids',
  ],
  updateTaskStatus: ['status_id', 'start_date', 'due_date'],
  updateSprint: ['name', 'goal', 'start_date', 'end_date', 'duration'],
  startSprint: ['goal', 'start_date', 'end_date', 'duration'],
  completeSprint: ['retrospective'],
  assignSprintTasks: ['task_ids'],
  removeSprintTask: ['task'],
};

const sprintMethods = new Set([
  'assignSprintTasks',
  'createSprint',
  'updateSprint',
  'startSprint',
  'completeSprint',
  'deleteSprint',
  'removeSprintTask',
]);

const durations = ['1 week', '2 weeks', '3 weeks', '4 weeks', 'Custom'];

function asArray<T = any>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

function flattenTasks(values: unknown, seen = new Set<string>()): ReviewOption[] {
  const result: ReviewOption[] = [];

  for (const task of asArray<ReviewOption>(values)) {
    if (task?.id && !seen.has(task.id)) {
      seen.add(task.id);
      result.push(task);
    }

    result.push(...flattenTasks(task?.sub_task_recursive, seen));
    result.push(...flattenTasks(task?.tasks, seen));
  }

  return result;
}

function optionLabel(option: ReviewOption): string {
  return option.name || option.title || option.project_no || option.id;
}

function getOptionsForField(
  method: string,
  field: string,
  options: ReviewOptions,
  args: Record<string, unknown>,
): ReviewOption[] {
  const taskOptions = options.taskOptions || {};
  const projectOptions = options.projectOptions || {};
  const sprintData = options.projectSprints || {};

  if (field === 'status_id') {
    return asArray(method === 'updateProject'
      ? projectOptions.statuses
      : taskOptions.taskStatuses);
  }

  if (field === 'priority_id') {
    return asArray(method === 'updateProject'
      ? projectOptions.priorities
      : taskOptions.taskPriorities);
  }

  if (field === 'type_id') return asArray(taskOptions.taskTypes);
  if (field === 'task_category_id') return asArray(taskOptions.taskCategories);

  if (['owned_id', 'assign_users', 'unassign_users'].includes(field)) {
    return asArray(taskOptions.assignableUsers);
  }

  if (field === 'parent_id') return asArray(taskOptions.taskParents);

  if (['tag_ids', 'remove_tag_ids'].includes(field)) {
    return asArray(taskOptions.tags);
  }

  if (field === 'task_ids') {
    const sprintTasks = asArray<ReviewOption>(sprintData.sprints)
      .flatMap(sprint => asArray(sprint.tasks));

    return flattenTasks([
      ...asArray(sprintData.backlog),
      ...asArray(sprintData.epics),
      ...sprintTasks,
      ...asArray(options.projectTasks),
    ]);
  }

  if (field === 'task' && method === 'removeSprintTask') {
    const sprint = asArray<ReviewOption>(sprintData.sprints)
      .find(item => item.id === args.sprint);

    return asArray(sprint?.tasks);
  }

  return [];
}

function getTaskTitle(taskId: unknown, options: ReviewOptions): string | undefined {
  if (typeof taskId !== 'string') return undefined;

  return flattenTasks(options.projectTasks)
    .find(task => task.id === taskId)?.title;
}

function groupForMethod(method: string): string {
  if (method === 'updateProject' || method === 'createProject') return 'Project';
  if (sprintMethods.has(method) || method === 'createSprint') return 'Sprint';
  if (['createTask', 'updateTask', 'updateTaskStatus'].includes(method)) {
    return 'Task dan subtask';
  }
  return 'Lainnya';
}

function getTargetTitle(operation: ReviewOperation, options: ReviewOptions): string {
  const args = operation.args;

  if (typeof args.title === 'string' && args.title) return args.title;

  if (operation.method === 'updateProject') {
    const detail =
      options.projectDetail?.project ||
      options.projectDetail?.data?.project ||
      options.projectDetail;

    return detail?.title || String(args.project || 'Project');
  }

  if (['updateTask', 'updateTaskStatus'].includes(operation.method)) {
    return getTaskTitle(args.task, options) || String(args.task || 'Task');
  }

  if (sprintMethods.has(operation.method)) {
    const sprint = asArray<ReviewOption>(options.projectSprints?.sprints)
      .find(item => item.id === args.sprint);

    return sprint?.name || String(args.name || args.sprint || 'Sprint');
  }

  return String(args.task || args.project || 'Perubahan');
}

export function McpReviewPanel({
  meetingId,
  token,
  summaryVersion,
  request = apiRequest,
}: {
  meetingId: string;
  token: string;
  summaryVersion?: string;
  request?: typeof apiRequest;
}) {
  const [review, setReview] = useState<McpReview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedIndexes, setSelectedIndexes] = useState<number[]>([]);
  const [drafts, setDrafts] =
    useState<Record<number, Record<string, unknown>>>({});

  const cleanMeetingId = meetingId
    ? meetingId.replace(/^meeting-/, '')
    : '';

  const load = useCallback(async (signal?: AbortSignal) => {
    if (!cleanMeetingId) return;

    setLoading(true);
    setError(null);

    try {
      const result = await request<McpReview>(
        `/mcp-reviews/${encodeURIComponent(cleanMeetingId)}`,
        {
          headers: token ? {Authorization: `Bearer ${token}`} : {},
          signal,
        },
        60000,
      );

      if (!signal?.aborted) setReview(result);
    } catch (e) {
      if (!signal?.aborted) {
        setReview(null);
        setError(e instanceof Error
          ? e.message
          : 'Status persetujuan belum dapat dimuat.');
      }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [cleanMeetingId, token, request]);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;

    const refresh = async () => {
      await load(controller.signal);
      if (!controller.signal.aborted) timer = setTimeout(refresh, 5000);
    };

    void refresh();

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [load, summaryVersion]);

  useEffect(() => {
    if (review) {
      setSelectedIndexes(review.operations.map((_, index) => index));
      setDrafts({});
    }
  }, [review?.planDigest]);

  const decide = async (decision: boolean, indexes?: number[]) => {
    if (!review || busy) return;

    setBusy(true);
    setError(null);

    try {
      const approvedIndexes = indexes ??
        review.operations.map((_, index) => index);

      const edits = Object.fromEntries(
        approvedIndexes
          .filter(index => drafts[index] &&
            Object.keys(drafts[index]).length > 0)
          .map(index => [index, drafts[index]]),
      );

      const result = await request<McpReview>(
        `/mcp-reviews/${encodeURIComponent(cleanMeetingId)}/decision`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? {Authorization: `Bearer ${token}`} : {}),
          },
          body: JSON.stringify({
            decision,
            approvedIndexes,
            edits,
            revision: review.revision,
            planDigest: review.planDigest,
          }),
        },
        120000,
      );

      setReview(result);
      if (result.status === 'pending') await load();
    } catch (e) {
      if ((e as {status?: number})?.status === 403) setReview(null);

      setError(e instanceof Error
        ? e.message
        : 'Keputusan belum dapat disimpan. Periksa status sebelum mencoba lagi.');
    } finally {
      setBusy(false);
    }
  };

  const options = review?.options || {};
  const selectedSet = useMemo(
    () => new Set(selectedIndexes),
    [selectedIndexes],
  );

  const updateDraft = (index: number, field: string, value: unknown) => {
    setDrafts(current => ({
      ...current,
      [index]: {
        ...current[index],
        [field]: value,
      },
    }));
  };

  const toggleSelected = (index: number) => {
    setSelectedIndexes(current =>
      current.includes(index)
        ? current.filter(item => item !== index)
        : [...current, index].sort((a, b) => a - b),
    );
  };

  const renderField = (
    index: number,
    operation: ReviewOperation,
    field: string,
  ) => {
    const {method, args} = operation;
    const value = drafts[index]?.[field] ?? args[field];
    const choices = getOptionsForField(method, field, options, args);
    const label = fieldLabels[field] || field;

    if (field === 'duration') {
      return (
        <select
          aria-label={label}
          disabled={busy || !review?.canDecide}
          value={String(value ?? '')}
          onChange={event => updateDraft(index, field, event.target.value)}
        >
          {durations.map(duration =>
            <option key={duration} value={duration}>{duration}</option>
          )}
        </select>
      );
    }

    if (['start_date', 'due_date', 'end_date'].includes(field)) {
      return (
        <input
          aria-label={label}
          type="date"
          disabled={busy || !review?.canDecide}
          value={String(value ?? '').slice(0, 10)}
          onChange={event => updateDraft(index, field, event.target.value)}
        />
      );
    }

    if (['description', 'goal', 'retrospective'].includes(field)) {
      return (
        <textarea
          aria-label={label}
          rows={3}
          disabled={busy || !review?.canDecide}
          value={String(value ?? '')}
          onChange={event => updateDraft(index, field, event.target.value)}
        />
      );
    }

    if ([
      'status_id', 'priority_id', 'type_id', 'task_category_id',
      'parent_id', 'owned_id', 'assign_users', 'unassign_users',
      'tag_ids', 'remove_tag_ids', 'task_ids', 'task',
    ].includes(field)) {
      if (!choices.length) {
        return <span className="mcp-review-no-options">
          Opsi IT Project belum tersedia untuk field ini.
        </span>;
      }

      if (Array.isArray(value)) {
        return (
          <select
            aria-label={label}
            multiple
            disabled={busy || !review?.canDecide}
            value={value.map(String)}
            onChange={event => updateDraft(
              index,
              field,
              Array.from(event.target.selectedOptions, option => option.value),
            )}
          >
            {choices.map(option =>
              <option key={option.id} value={option.id}>
                {optionLabel(option)}
              </option>
            )}
          </select>
        );
      }

      return (
        <select
          aria-label={label}
          disabled={busy || !review?.canDecide}
          value={String(value ?? '')}
          onChange={event => updateDraft(index, field, event.target.value)}
        >
          {field === 'task_category_id' &&
            <option value="">Tanpa kategori</option>}
          {field === 'parent_id' &&
            <option value="">Tanpa parent</option>}
          {choices.map(option =>
            <option key={option.id} value={option.id}>
              {optionLabel(option)}
            </option>
          )}
        </select>
      );
    }

    return (
      <input
        aria-label={label}
        disabled={busy || !review?.canDecide}
        value={String(value ?? '')}
        onChange={event => updateDraft(index, field, event.target.value)}
      />
    );
  };

  if (!cleanMeetingId || !review?.isHost) return null;

  const groups = ['Project', 'Task dan subtask', 'Sprint', 'Lainnya'];

  return (
    <section
      className="mcp-review"
      aria-label="Persetujuan pengiriman MCP"
      aria-busy={loading || busy}
    >
      <header>
        <ShieldCheck size={25}/>
        <div>
          <h2>Tinjau sebelum kirim ke MCP</h2>
          <p>Periksa dan edit setiap item. Lepas centang item yang tidak jadi dikirim.</p>
        </div>
        <span className="mcp-review-status" role="status">
          {loading
            ? 'Memuat tinjauan…'
            : labels[review.status] || review.status}
        </span>
      </header>

      {error && <p role="alert" className="mcp-review-error">{error}</p>}
      {review.error && <p role="alert" className="mcp-review-error">{review.error}</p>}
      {review.note && <p>{review.note}</p>}

      {groups.map(group => {
        const items = review.operations
          .map((operation, index) => ({operation, index}))
          .filter(item => {
            if (groupForMethod(item.operation.method) !== group) return false;

            // Tampilkan hanya operasi yang dapat diedit atau dipilih.
            return true;
          });

        if (!items.length) return null;

        return (
          <section className="mcp-review-group" key={group}>
            <h3>{group}</h3>
            <ol className="mcp-review-operations">
              {items.map(({operation, index}) => {
                const fields = editableFields[operation.method] || [];
                const args = {...operation.args, ...drafts[index]};

                return (
                  <li className="mcp-review-operation-card" key={`${operation.method}-${index}`}>
                    <div className="mcp-review-operation-head">
                      <label>
                        <input
                          type="checkbox"
                          checked={selectedSet.has(index)}
                          disabled={busy || !review.canDecide}
                          onChange={() => toggleSelected(index)}
                        />
                        Sertakan item ini
                      </label>
                      <strong>{actionLabels[operation.method] || operation.method}</strong>
                    </div>

                    <p className="mcp-review-target">
                      {getTargetTitle(operation, options)}
                    </p>

                    {fields.some(field => Object.hasOwn(operation.args, field)) && (
                      <div className="mcp-review-fields">
                        {fields
                          .filter(field => Object.hasOwn(operation.args, field))
                          .map(field => (
                            <label className="mcp-review-field" key={field}>
                              <span>{fieldLabels[field] || field}</span>
                              {renderField(index, operation, field)}
                            </label>
                          ))}
                      </div>
                    )}

                    <details>
                      <summary>Detail operasi MCP</summary>
                      <pre>{JSON.stringify(args, null, 2)}</pre>
                    </details>
                  </li>
                );
              })}
            </ol>
          </section>
        );
      })}

      {!!review.evidence?.length && (
        <details className="mcp-review-evidence">
          <summary>Rujukan ucapan rapat</summary>
          {review.evidence.map((item, index) => (
            <div key={index}>
              <strong>{evidenceLabels[item.field] || item.field} #{item.index + 1}</strong>
              {item.sources.map((source, sourceIndex) => (
                <blockquote key={sourceIndex}>
                  “{source.quote}”
                  <cite>{source.speaker || 'Pembicara'} · {source.utteranceId}</cite>
                </blockquote>
              ))}
            </div>
          ))}
        </details>
      )}

      {review.canDecide && !loading && (
        <>
          <p>
            {selectedIndexes.length} dari {review.operations.length} item dipilih.
          </p>
          <div className="mcp-review-buttons">
            <button
              type="button"
              className="button-primary"
              disabled={
                busy || !review.planDigest || !selectedIndexes.length ||
                !['ready', 'rejected'].includes(review.status)
              }
              onClick={() => void decide(true, selectedIndexes)}
            >
              {busy
                ? <Loader2 className="ui-spinner" size={17}/>
                : <Check size={17}/>}
              Kirim item terpilih
            </button>
            <button
              type="button"
              className="button-secondary"
              disabled={
                busy || !review.planDigest || !review.operations.length ||
                !['ready', 'rejected'].includes(review.status)
              }
              onClick={() => void decide(
                true,
                review.operations.map((_, index) => index),
              )}
            >
              <ListChecks size={17}/>Kirim semua
            </button>
            <button
              type="button"
              className="button-secondary"
              disabled={busy || review.status === 'rejected'}
              onClick={() => void decide(false, [])}
            >
              <X size={17}/>Batalkan semua
            </button>
          </div>
          <p className="mcp-review-help">
            Hanya host yang dapat mengirim perubahan. Item yang tidak dicentang tidak dikirim.
          </p>
        </>
      )}

      {review && !review.canDecide && review.status !== 'sent' &&
        <p>Persetujuan hanya dapat diberikan oleh host rapat.</p>}

      {!!review.results?.length && (
        <details>
          <summary>Hasil per aksi ({review.results.length})</summary>
          <ol>
            {review.results.map(result => (
              <li key={result.index}>
                {actionLabels[result.method] || result.method}:&nbsp;
                {result.status === 'sent' ? 'Terkirim' : result.status}
                {result.id ? ` · ${result.id}` : ''}
              </li>
            ))}
          </ol>
        </details>
      )}

      <button
        type="button"
        className="text-button"
        disabled={loading || busy}
        onClick={() => void load()}
      >
        Periksa status lagi
      </button>
    </section>
  );
}