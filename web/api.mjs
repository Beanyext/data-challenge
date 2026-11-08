import { createDemoApi } from './demo.mjs';

export class ApiError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

function safeMessage(value) {
  const text = String(value || '');
  if (/\b(sig|token|api[_-]?key|authorization|password)\b/i.test(text)) {
    return 'Сервер вернул ошибку. Подробности с данными доступа скрыты.';
  }
  return text
    .replace(/https?:\/\/\S+/gi, '[адрес скрыт]')
    .replace(/[<>]/g, '')
    .slice(0, 240);
}

function arrayResult(value, key) {
  if (Array.isArray(value)) return value;
  if (value && Array.isArray(value[key])) return value[key];
  if (value && Array.isArray(value.records)) return value.records;
  if (value && Array.isArray(value.items)) return value.items;
  throw new ApiError('Сервер вернул неожиданный формат списка. Проверьте контракт API.');
}

/** Contract: reports/задачи.md. JSON objects are direct or wrapped in {data}.
 * Lists may be arrays or {dialogs/checklists/appeals: []}. Upload is multipart field file.
 * A real API error never enables demo mode automatically.
 */
export function createApi({ baseUrl = '/api', demo = false, timeout = 20000 } = {}) {
  if (demo) return createDemoApi();
  const base = String(baseUrl || '/api').replace(/\/+$/, '');
  if (/[?#]/.test(base) || /https?:\/\/[^/]*@/i.test(base)) {
    throw new ApiError('В адресе сервера не должно быть ключей, подписи или данных входа.');
  }
  if (!(base.startsWith('/') && !base.startsWith('//')) && !/^https?:\/\//i.test(base)) {
    throw new ApiError('Укажите путь /api или адрес сервера HTTP(S).');
  }

  async function request(path, { method = 'GET', body, multipart = false, wait = timeout } = {}) {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), wait);
    try {
      const response = await fetch(`${base}${path}`, {
        method,
        signal: abort.signal,
        credentials: 'same-origin',
        headers: { Accept: 'application/json', ...(body === undefined || multipart ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: multipart ? body : JSON.stringify(body) }),
      });
      let value;
      if (response.status === 204) return null;
      try { value = await response.json(); } catch {
        throw new ApiError(response.ok ? 'Сервер вернул не JSON. Проверьте адрес API.' : `Сервер недоступен: HTTP ${response.status}.`, response.status);
      }
      if (!response.ok || value?.isSuccess === false) {
        const detail = typeof value?.detail === 'string' ? value.detail : typeof value?.message === 'string' ? value.message : typeof value?.error === 'string' ? value.error : '';
        throw new ApiError(safeMessage(detail) || `Не удалось выполнить запрос: HTTP ${response.status}.`, response.status);
      }
      return value && typeof value === 'object' && !Array.isArray(value) && 'data' in value ? value.data : value;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (error?.name === 'AbortError') throw new ApiError('Сервер не ответил вовремя. Повторите запрос.');
      throw new ApiError('Нет соединения с сервером. Проверьте адрес API и запуск сервера.');
    } finally { clearTimeout(timer); }
  }

  const id = value => encodeURIComponent(String(value));
  return {
    demo: false,
    listDialogs: async () => arrayResult(await request('/dialogs'), 'dialogs'),
    getDialog: value => request(`/dialogs/${id(value)}`),
    listChecklists: async () => arrayResult(await request('/checklists'), 'checklists'),
    saveChecklist: checklist => request('/checklists', { method: 'POST', body: checklist }),
    // The model reads the wording before answering, so this call may take longer than ordinary requests.
    reviewCriterion: payload => request('/checklists/review-criterion', { method: 'POST', body: payload, wait: Math.max(timeout, 120000) }),
    importDialogs: groupId => request('/dialogs/import', { method: 'POST', body: { group_id: groupId } }),
    uploadDialog: file => {
      const body = new FormData(); body.append('file', file);
      return request('/dialogs/upload', { method: 'POST', body, multipart: true });
    },
    // reuse: after a new checklist version the server asks the model only about new and changed criteria.
    evaluate: (conversationIds, checklistId, reuse = false) => request('/evaluations', { method: 'POST', body: { conversation_ids: conversationIds, checklist_id: checklistId, ...(reuse ? { reuse: true } : {}) } }),
    getJob: value => request(`/jobs/${id(value)}`),
    getEvaluation: value => request(`/evaluations/${id(value)}`),
    listAppeals: async () => arrayResult(await request('/appeals'), 'appeals'),
    createAppeal: payload => request('/appeals', { method: 'POST', body: payload }),
    decideAppeal: (value, payload) => request(`/appeals/${id(value)}/decision`, { method: 'POST', body: payload }),
    getAudio: value => request(`/dialogs/${id(value)}/audio`),
    // {provider, model, estimate:{based_on, cost_per_dialog_usd, seconds_per_dialog, workers}} for the evaluation dialog.
    getHealth: () => request('/health'),
  };
}
