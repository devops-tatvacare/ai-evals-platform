/**
 * HTTP client for FastAPI backend.
 * All repository implementations use this to make API calls.
 *
 * In dev: Vite proxy routes /api/* to localhost:8721
 * In prod: Reverse proxy routes /api/* to the backend service
 */

const API_BASE = ''; // Empty = use same origin (Vite proxy handles it)

export class ApiError extends Error {
  status: number;
  data?: unknown;

  constructor(status: number, message: string, data?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

export async function apiRequest<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const url = `${API_BASE}${path}`;
  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
    ...options,
  });

  if (!response.ok) {
    const text = await response.text();
    let errorData: unknown = text;
    try {
      errorData = JSON.parse(text);
    } catch {
      // keep as plain text
    }
    throw new ApiError(
      response.status,
      `API error ${response.status}: ${response.statusText}`,
      errorData,
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

  const response = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    body: formData,
    // Do NOT set Content-Type - browser handles multipart boundary
  });

  if (!response.ok) {
    throw new ApiError(response.status, `Upload failed: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Download a file as a Blob.
 */
export async function apiDownload(path: string): Promise<Blob> {
  const response = await fetch(`${API_BASE}${path}`);
  if (!response.ok) {
    throw new ApiError(response.status, `Download failed: ${response.statusText}`);
  }
  return response.blob();
}
