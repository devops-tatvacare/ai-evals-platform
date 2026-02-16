/**
 * Files API - HTTP client for files API.
 *
 * Files are uploaded via multipart form data and
 * stored on backend filesystem.
 */
import { apiUpload, apiDownload, apiRequest } from './client';

interface FileRecord {
  id: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  storage_path: string;
  created_at: string;
}

export const filesRepository = {
  /**
   * Save a file. Returns the file ID (UUID).
   * Uploads to backend which saves to filesystem/blob storage.
   */
  async save(blob: Blob, filename?: string): Promise<string> {
    const result = await apiUpload<FileRecord>(
      '/api/files/upload',
      blob,
      filename || 'upload',
    );
    return result.id;
  },

  /**
   * Get file record by ID (metadata only).
   */
  async getById(id: string): Promise<FileRecord> {
    return apiRequest<FileRecord>(`/api/files/${id}`);
  },

  /**
   * Download file as Blob (for audio playback etc).
   * HTTP download from backend.
   */
  async getBlob(id: string): Promise<Blob> {
    return apiDownload(`/api/files/${id}/download`);
  },

  /**
   * Alias for backward compatibility.
   * Old code called: filesRepository.saveAudioBlob(blob, listingId)
   * The backend generates the file ID.
   */
  async saveAudioBlob(blob: Blob, _listingId?: string): Promise<string> {
    return this.save(blob, 'audio.webm');
  },

  async delete(id: string): Promise<void> {
    await apiRequest(`/api/files/${id}`, { method: 'DELETE' });
  },
};
