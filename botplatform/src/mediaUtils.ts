import path from 'path';

export type MediaType = 'photo' | 'video' | 'document' | 'audio';

const MIME_EXTENSION_MAP: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
  'audio/ogg': '.ogg',
  'audio/mpeg': '.mp3',
  'audio/mp3': '.mp3',
  'audio/mp4': '.m4a',
  'audio/x-m4a': '.m4a',
  'audio/aac': '.aac',
  'audio/wav': '.wav',
  'audio/x-wav': '.wav',
  'audio/webm': '.webm',
  'application/pdf': '.pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/msword': '.doc',
  'text/plain': '.txt',
  'application/zip': '.zip',
  'application/json': '.json',
};

const DEFAULT_EXTENSIONS: Record<MediaType, string> = {
  photo: '.jpg',
  video: '.mp4',
  audio: '.ogg',
  document: '.bin',
};

export interface ExtensionMeta {
  originalName?: string;
  mimeType?: string;
  remotePath?: string;
}

/**
 * Возвращает расширение файла, пытаясь сохранить оригинальное.
 */
export function guessFileExtension(type: MediaType, meta: ExtensionMeta = {}): string {
  const fromOriginal = meta.originalName ? path.extname(meta.originalName) : '';
  if (fromOriginal) {
    return normalizeExtension(fromOriginal);
  }

  const mime = meta.mimeType?.toLowerCase();
  if (mime && MIME_EXTENSION_MAP[mime]) {
    return MIME_EXTENSION_MAP[mime];
  }

  const fromRemote = meta.remotePath ? path.extname(meta.remotePath) : '';
  if (fromRemote) {
    return normalizeExtension(fromRemote);
  }

  return DEFAULT_EXTENSIONS[type];
}

/**
 * Строит безопасное имя файла для сохранения на диске.
 */
export function buildStoredFileName(
  type: MediaType,
  extension: string,
  options: { originalName?: string; uniqueSuffix?: string } = {}
): string {
  const parsed = options.originalName ? path.parse(options.originalName) : null;
  const base = parsed?.name || type;
  const safeBase = sanitizeFileName(base);
  const suffix = options.uniqueSuffix || Date.now().toString();
  const normalizedExtension = normalizeExtension(extension);
  return `${safeBase}_${suffix}${normalizedExtension}`;
}

/**
 * Удаляет опасные символы из имени файла.
 */
export function sanitizeFileName(input: string): string {
  const trimmed = input.trim();
  const replaced = trimmed.replace(/[^a-zA-Z0-9._-]/g, '_');
  const collapsed = replaced.replace(/_+/g, '_');
  const dotsNormalized = collapsed.replace(/\.+/g, '.');
  const noEdgeSpecials = dotsNormalized.replace(/^[_\.]+/, '').replace(/[_\.]+$/, '');
  return noEdgeSpecials.slice(0, 80) || 'file';
}

function normalizeExtension(ext: string): string {
  if (!ext.startsWith('.')) {
    return `.${ext}`;
  }
  return ext.toLowerCase();
}
