/**
 * HTTP client for FastAPI backend.
 * All repository implementations use this to make API calls.
 *
 * In dev: Vite proxy routes /api/* to localhost:8721
 * In prod: Reverse proxy routes /api/* to the backend service
 */

import { useAuthStore } from '@/stores/authStore';
import { parseApiErrorResponse } from './errorHandling';

const API_BASE = ''; // Empty = use same origin (Vite proxy handles it)

export class ApiError extends Error {
  status: number;
  data?: unknown;
  headers?: Headers;

  constructor(status: number, message: string, data?: unknown, headers?: Headers) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
    this.headers = headers;
  }
}

function getAuthHeaders(): Record<string, string> {
  const token = useAuthStore.getState().accessToken;
  const headers: Record<string, string> = {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

/**
 * Try to refresh the access token and retry the original request.
 * Returns null if refresh/retry failed (caller should throw).
 */
async function tryRefreshAndRetry(url: string, options?: RequestInit): Promise<Response | null> {
  const refreshed = await useAuthStore.getState().refreshToken();
  if (!refreshed) return null;

  const retryResponse = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
      ...options?.headers,
    },
    credentials: 'include',
  });

  // Only treat as auth failure if retry ALSO returns 401.
  // Other error codes (404, 400, 500) are legitimate responses —
  // returning null would incorrectly trigger logout.
  if (retryResponse.status === 401) return null;
  return retryResponse;
}

export async function apiRequest<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const url = `${API_BASE}${path}`;
  let response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
      ...options?.headers,
    },
    credentials: 'include',
  });

  if (response.status === 401) {
    const retryResponse = await tryRefreshAndRetry(url, options);
    if (!retryResponse) {
      useAuthStore.getState().logout();
      throw new ApiError(401, 'Session expired');
    }
    // Refresh succeeded — handle retried response normally
    response = retryResponse;
  }

  if (!response.ok) {
    const text = await response.text();
    const { errorData, detail } = parseApiErrorResponse(text);
    throw new ApiError(
      response.status,
      detail || `API error ${response.status}: ${response.statusText}`,
      errorData,
      response.headers,
    );
  }

  // Handle 204 No Content
  if (response.status === 204) {
    return undefined as T;
  }

  return response.json();
}

/**
 * Upload a file via multipart form data.
 * Does NOT set Content-Type header (browser sets it with boundary).
 */
export async function apiUpload<T>(
  path: string,
  file: File | Blob,
  filename?: string,
): Promise<T> {
  const formData = new FormData();
  formData.append('file', file, filename || 'upload');

  const url = `${API_BASE}${path}`;
  let response = await fetch(url, {
    method: 'POST',
    body: formData,
    headers: getAuthHeaders(),
    credentials: 'include',
  });

  if (response.status === 401) {
    const refreshed = await useAuthStore.getState().refreshToken();
    if (!refreshed) {
      useAuthStore.getState().logout();
      throw new ApiError(401, 'Session expired');
    }
    response = await fetch(url, {
      method: 'POST',
      body: formData,
      headers: getAuthHeaders(),
      credentials: 'include',
    });
    if (response.status === 401) {
      useAuthStore.getState().logout();
      throw new ApiError(401, 'Session expired');
    }
  }

  if (!response.ok) {
    const text = await response.text();
    const { errorData, detail } = parseApiErrorResponse(text);
    throw new ApiError(
      response.status,
      detail || `Upload failed: ${response.statusText}`,
      errorData,
    );
  }

  return response.json();
}

/**
 * Download a file as a Blob.
 */
export async function apiDownload(path: string): Promise<Blob> {
  const url = `${API_BASE}${path}`;
  let response = await fetch(url, {
    headers: getAuthHeaders(),
    credentials: 'include',
  });

  if (response.status === 401) {
    const refreshed = await useAuthStore.getState().refreshToken();
    if (!refreshed) {
      useAuthStore.getState().logout();
      throw new ApiError(401, 'Session expired');
    }
    response = await fetch(url, {
      headers: getAuthHeaders(),
      credentials: 'include',
    });
    if (response.status === 401) {
      useAuthStore.getState().logout();
      throw new ApiError(401, 'Session expired');
    }
  }

  if (!response.ok) {
    const text = await response.text();
    const { errorData, detail } = parseApiErrorResponse(text);
    throw new ApiError(
      response.status,
      detail || `Download failed: ${response.statusText}`,
      errorData,
    );
  }
  return response.blob();
}
