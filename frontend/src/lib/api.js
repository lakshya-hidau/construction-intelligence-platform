/**
 * Axios client for the Construction Intelligence API.
 *
 * Responsibilities:
 *  - single base URL, sensible timeout, per-request request-id
 *  - normalise EVERY failure (network, timeout, HTTP, validation) into a uniform
 *    `ApiError` shape that the UI can render without defensive checks
 *  - never throw raw axios objects into components
 */

import axios from 'axios';

export const BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

export const http = axios.create({
  baseURL: BASE_URL,
  // Image analysis can be slow when an LLM is configured; keep headroom.
  timeout: 120_000,
  headers: { Accept: 'application/json' },
});

export class ApiError extends Error {
  constructor({ message, code, status, field, requestId, retryable }) {
    super(message);
    this.name = 'ApiError';
    this.code = code || 'unknown_error';
    this.status = status ?? 0;
    this.field = field ?? null;
    this.requestId = requestId ?? null;
    this.retryable = Boolean(retryable);
  }

  /** Short, human-readable hint shown under the error banner. */
  get hint() {
    if (this.status === 0) return 'The API server could not be reached. Is the backend running on port 8000?';
    if (this.status === 413) return 'Reduce the image size and try again.';
    if (this.status === 415) return 'Convert the photo to JPEG, PNG or WebP first.';
    if (this.status === 422) return this.field ? `Check the "${this.field}" field.` : 'One or more inputs are invalid.';
    if (this.status === 503) return 'The analysis engine is temporarily unavailable. Retry in a moment.';
    if (this.status >= 500) return 'The server hit an unexpected error. The request id is shown for support.';
    return null;
  }
}

function normaliseError(error) {
  if (error instanceof ApiError) return error;

  if (error?.code === 'ECONNABORTED') {
    return new ApiError({
      message: 'The request timed out before the server responded.',
      code: 'timeout',
      status: 0,
      retryable: true,
    });
  }

  const response = error?.response;
  if (!response) {
    return new ApiError({
      message: 'Could not reach the API server.',
      code: 'network_error',
      status: 0,
      retryable: true,
    });
  }

  const data = response.data || {};
  const detail = data.error || data.detail || {};

  // Handles the uniform envelope AND FastAPI's {"detail": {...}} / {"detail": "..."}
  const nested = detail?.error || detail;
  const message =
    (typeof nested === 'object' && nested?.message) ||
    (typeof detail === 'string' ? detail : null) ||
    (typeof data.detail === 'string' ? data.detail : null) ||
    `Request failed with status ${response.status}`;

  return new ApiError({
    message,
    code: (typeof nested === 'object' && nested?.code) || `http_${response.status}`,
    status: response.status,
    field: (typeof nested === 'object' && nested?.field) || null,
    requestId:
      (typeof nested === 'object' && nested?.request_id) ||
      response.headers?.['x-request-id'] ||
      null,
    retryable: response.status === 429 || response.status >= 500,
  });
}

http.interceptors.request.use((config) => {
  // Propagate a correlation id so server logs and the UI agree.
  config.headers['X-Request-ID'] =
    globalThis.crypto?.randomUUID?.().replace(/-/g, '') ?? `web-${Date.now()}`;
  return config;
});

http.interceptors.response.use(
  (response) => response,
  (error) => Promise.reject(normaliseError(error)),
);

// ---------------------------------------------------------------------------------------
// Typed endpoint helpers — the single place that knows about URL shapes.
// ---------------------------------------------------------------------------------------

export const api = {
  health: () => http.get('/health').then((r) => r.data),
  options: () => http.get('/api/options').then((r) => r.data),
  samples: () => http.get('/api/samples').then((r) => r.data.samples),

  /** Downloads a curated sample image and wraps it as a File for the upload flow. */
  loadSample: async (sample) => {
    const response = await http.get(sample.url.replace(/^\//, '/'), { responseType: 'blob' });
    return new File([response.data], `${sample.id}.jpg`, { type: 'image/jpeg' });
  },

  /**
   * @param {File} file
   * @param {{siteContext?: string, strictness?: 'standard'|'strict'}} opts
   * @param {(pct:number)=>void} [onProgress]
   */
  analyzeSafety: (file, { siteContext = '', strictness = 'standard' } = {}, onProgress) => {
    const form = new FormData();
    form.append('image', file, file.name);
    if (siteContext) form.append('site_context', siteContext);
    form.append('strictness', strictness);
    return http
      .post('/api/analysis/safety', form, {
        onUploadProgress: (e) => {
          if (onProgress && e.total) onProgress(Math.round((e.loaded / e.total) * 100));
        },
      })
      .then((r) => r.data);
  },

  analyzeCrack: (file, { notes = '', surfaceType = 'unknown' } = {}, onProgress) => {
    const form = new FormData();
    form.append('image', file, file.name);
    if (notes) form.append('notes', notes);
    form.append('surface_type', surfaceType);
    return http
      .post('/api/analysis/crack', form, {
        onUploadProgress: (e) => {
          if (onProgress && e.total) onProgress(Math.round((e.loaded / e.total) * 100));
        },
      })
      .then((r) => r.data);
  },

  valuation: (payload) => http.post('/api/valuation', payload).then((r) => r.data),
  plan: (payload) => http.post('/api/plan', payload).then((r) => r.data),

  weatherAdvisory: ({ city, activity }) =>
    http
      .get('/api/weather/advisory', { params: { city: city || undefined, activity } })
      .then((r) => r.data),

  assistant: (payload) => http.post('/api/assistant/chat', payload).then((r) => r.data),
  corpus: () => http.get('/api/assistant/corpus').then((r) => r.data),
};

export default api;
