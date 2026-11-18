/**
 * Files shared in a staff meeting's chat. The rules live here so the browser (to say no early, nicely) and the classroom server (which enforces them,
 * trusting nothing the browser says) apply exactly the same ones.
 *
 * What is allowed is a list of extensions, not a list of what is forbidden: anything that is not named here is refused, so a new kind of dangerous file
 * is never let through by default. The list is documents, spreadsheets, slides, images, audio, video, text and a zip. Nothing that RUNS is on it
 * (programs, scripts, installers, shortcuts, and the macro-enabled Office formats), and a name like "report.pdf.exe" is judged by its last extension.
 * The content type used to show a file comes from its extension, never from what the sender said it was.
 */

export const MAX_CHAT_FILE_BYTES = 10_000_000;
export const MAX_CHAT_FILE_NAME = 120;

interface FileKind { type: string; kind: 'image' | 'document' | 'media' | 'archive' }

const DOC = (type: string): FileKind => ({ type, kind: 'document' });
const IMG = (type: string): FileKind => ({ type, kind: 'image' });
const MEDIA = (type: string): FileKind => ({ type, kind: 'media' });

export const CHAT_FILE_TYPES: Record<string, FileKind> = {
  // Documents
  pdf: DOC('application/pdf'),
  doc: DOC('application/msword'),
  docx: DOC('application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
  dotx: DOC('application/vnd.openxmlformats-officedocument.wordprocessingml.template'),
  odt: DOC('application/vnd.oasis.opendocument.text'),
  rtf: DOC('application/rtf'),
  txt: DOC('text/plain'),
  md: DOC('text/markdown'),
  tex: DOC('text/x-tex'),
  epub: DOC('application/epub+zip'),
  pages: DOC('application/vnd.apple.pages'),
  // Spreadsheets
  xls: DOC('application/vnd.ms-excel'),
  xlsx: DOC('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
  ods: DOC('application/vnd.oasis.opendocument.spreadsheet'),
  csv: DOC('text/csv'),
  tsv: DOC('text/tab-separated-values'),
  numbers: DOC('application/vnd.apple.numbers'),
  // Slides
  ppt: DOC('application/vnd.ms-powerpoint'),
  pptx: DOC('application/vnd.openxmlformats-officedocument.presentationml.presentation'),
  ppsx: DOC('application/vnd.openxmlformats-officedocument.presentationml.slideshow'),
  odp: DOC('application/vnd.oasis.opendocument.presentation'),
  key: DOC('application/vnd.apple.keynote'),
  // Data and notebooks a maths or science tutor shares
  json: DOC('application/json'),
  ipynb: DOC('application/x-ipynb+json'),
  // Images (png, jpg, gif and webp are also shown in the chat itself; the rest are downloads)
  png: IMG('image/png'),
  jpg: IMG('image/jpeg'),
  jpeg: IMG('image/jpeg'),
  gif: IMG('image/gif'),
  webp: IMG('image/webp'),
  avif: IMG('image/avif'),
  bmp: IMG('image/bmp'),
  tif: IMG('image/tiff'),
  tiff: IMG('image/tiff'),
  heic: IMG('image/heic'),
  heif: IMG('image/heif'),
  svg: IMG('image/svg+xml'),
  // Audio and video
  mp3: MEDIA('audio/mpeg'),
  wav: MEDIA('audio/wav'),
  m4a: MEDIA('audio/mp4'),
  ogg: MEDIA('audio/ogg'),
  flac: MEDIA('audio/flac'),
  aac: MEDIA('audio/aac'),
  mp4: MEDIA('video/mp4'),
  m4v: MEDIA('video/x-m4v'),
  mov: MEDIA('video/quicktime'),
  webm: MEDIA('video/webm'),
  // Several files at once
  zip: { type: 'application/zip', kind: 'archive' },
};

/** The images the chat may draw in the page itself. SVG is deliberately not one of them: it can carry script, so it is only ever a download. */
const INLINE_IMAGES = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp']);

export const extensionOf = (name: string): string => {
  const dot = name.lastIndexOf('.');
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase() : '';
};

/** A name that is safe to show and to save under: no folders, no control characters, not too long, and still ending in its real extension. */
export function safeFileName(name: string): string {
  // eslint-disable-next-line no-control-regex
  const base = name.replace(/[\\/]+/g, '/').split('/').pop()!.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '').trim().replace(/\s+/g, ' ');
  const ext = extensionOf(base);
  const stem = ext ? base.slice(0, base.length - ext.length - 1) : base;
  const room = MAX_CHAT_FILE_NAME - (ext ? ext.length + 1 : 0);
  const cut = (stem.length > room ? stem.slice(0, room) : stem).replace(/^\.+/, '') || 'file';
  return ext ? `${cut}.${ext}` : cut;
}

/** Why a file may not be shared, or null if it may. */
export function chatFileProblem(name: string, bytes: number): string | null {
  const ext = extensionOf(name);
  if (!ext || !CHAT_FILE_TYPES[ext]) return `${ext ? `.${ext} files` : 'That file'} cannot be shared here. Documents, spreadsheets, slides, images, audio, video, text and zip files can.`;
  if (!Number.isFinite(bytes) || bytes <= 0) return 'That file is empty.';
  if (bytes > MAX_CHAT_FILE_BYTES) return `That file is over ${Math.round(MAX_CHAT_FILE_BYTES / 1_000_000)} MB. Send a smaller file, or share a link.`;
  return null;
}

/** The content type to give a received file, from its extension (never from the sender). */
export const contentTypeFor = (name: string): string => CHAT_FILE_TYPES[extensionOf(name)]?.type ?? 'application/octet-stream';

/** Whether the chat may draw this file as a picture: only the raster image types, never SVG. */
export const isInlineImage = (name: string): boolean => INLINE_IMAGES.has(extensionOf(name));

/** The value for a file input's `accept`: every extension that may be shared. */
export const CHAT_FILE_ACCEPT = Object.keys(CHAT_FILE_TYPES).map((ext) => `.${ext}`).join(',');

export function formatFileSize(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${Math.round(bytes / 1000)} KB`;
  return `${(bytes / 1_000_000).toFixed(bytes < 10_000_000 ? 1 : 0)} MB`;
}
