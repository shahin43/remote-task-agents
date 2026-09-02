const TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  md: 'text/markdown; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  json: 'application/json; charset=utf-8',
  yaml: 'text/yaml; charset=utf-8',
  yml: 'text/yaml; charset=utf-8',
  sql: 'text/plain; charset=utf-8',
  py: 'text/x-python; charset=utf-8',
  sh: 'text/x-shellscript; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  ts: 'text/typescript; charset=utf-8',
  patch: 'text/plain; charset=utf-8',
  html: 'text/html; charset=utf-8',
};

export type PreviewKind = 'pdf' | 'image' | 'text' | 'download';

export function contentTypeForPath(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  return TYPES[ext] ?? 'application/octet-stream';
}

export function previewKindForPath(filePath: string): PreviewKind {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'pdf') return 'pdf';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) return 'image';
  const type = contentTypeForPath(filePath);
  if (type.startsWith('text/') || type.includes('json') || type.includes('javascript') || type.includes('typescript')) {
    return 'text';
  }
  return 'download';
}

export function basenameOf(filePath: string): string {
  const parts = filePath.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || 'download';
}
