export const ACCEPTED_AUDIO_TYPES = ['audio/wav', 'audio/mpeg', 'audio/mp3', 'audio/webm', 'audio/x-wav'];
export const ACCEPTED_TRANSCRIPT_TYPES = ['application/json', 'text/plain'];
export const ACCEPTED_EXTENSIONS = ['.wav', '.mp3', '.webm', '.json', '.txt'];

export const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB

export type FileCategory = 'audio' | 'transcript' | 'unknown';

export interface ValidatedFile {
  file: File;
  category: FileCategory;
  error?: string;
}

export function getFileExtension(filename: string): string {
  const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase();
  return ext;
}

export function categorizeFile(file: File): FileCategory {
  const ext = getFileExtension(file.name);
  
  if (['.wav', '.mp3', '.webm'].includes(ext)) {
    return 'audio';
  }
  if (['.json', '.txt'].includes(ext)) {
    return 'transcript';
  }
  
  // Fallback to MIME type
  if (ACCEPTED_AUDIO_TYPES.includes(file.type)) {
    return 'audio';
  }
  if (ACCEPTED_TRANSCRIPT_TYPES.includes(file.type)) {
    return 'transcript';
  }
  
  return 'unknown';
}

export function validateFile(file: File): ValidatedFile {
  const category = categorizeFile(file);
  
  if (category === 'unknown') {
    return {
      file,
      category,
      error: `Unsupported file type: ${file.name}. Accepted formats: ${ACCEPTED_EXTENSIONS.join(', ')}`,
    };
  }
  
  if (file.size > MAX_FILE_SIZE) {
    return {
      file,
      category,
      error: `File too large: ${file.name}. Maximum size is 100MB.`,
    };
  }
  
  return { file, category };
}

export function validateFiles(files: File[]): ValidatedFile[] {
  return files.map(validateFile);
}
