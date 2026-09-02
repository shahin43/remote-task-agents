import { hashSkillTree } from './hash.js';
import { readSkillMetadata } from './parse.js';
import type { CatalogSkill, SkillFinding, SkillSourceKind, SkillTree } from './types.js';

export interface SkillValidationLimits {
  /** Total bytes across the skill tree. Mirrors the remote guest staging cap. */
  maxTotalBytes: number;
  /** Bytes for any single file. */
  maxFileBytes: number;
}

export const DEFAULT_SKILL_LIMITS: SkillValidationLimits = {
  maxTotalBytes: 100 * 1024 * 1024,
  maxFileBytes: 10 * 1024 * 1024,
};

export interface SkillValidation {
  /** True when there are no `error`-level findings. */
  ok: boolean;
  findings: SkillFinding[];
  /** Present only when metadata parsed; may be set even when `ok` is false. */
  catalogSkill: CatalogSkill | null;
}

/**
 * Patterns for credentials that must never be published inside a skill. A skill is
 * instructions *plus files the agent can execute*, so publication is code review:
 * these checks run in the publish script, the API upload path, and CI alike.
 */
const SECRET_PATTERNS: ReadonlyArray<{ code: string; label: string; pattern: RegExp }> = [
  { code: 'openai_key', label: 'OpenAI API key', pattern: /\bsk-[A-Za-z0-9_-]{20,}/ },
  { code: 'cloud_access_key_id', label: 'cloud access key id', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { code: 'github_token', label: 'GitHub token', pattern: /\bgh[pousr]_[A-Za-z0-9]{16,}/ },
  { code: 'git_token', label: 'host git personal access token', pattern: /\bglpat-[A-Za-z0-9_-]{16,}/ },
  { code: 'slack_token', label: 'Slack token', pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}/ },
  {
    code: 'private_key',
    label: 'private key block',
    pattern: /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----/,
  },
];

/**
 * Validate one skill directory: schema, size, path safety, embedded secrets.
 *
 * Pure so the same rules apply wherever a skill enters the platform. Returns a
 * `CatalogSkill` when metadata parsed, so a caller that only warns (dev) and one
 * that blocks (publish) share the code path.
 */
export function validateSkillTree(
  tree: SkillTree,
  options: {
    source?: SkillSourceKind;
    contentRef?: string;
    limits?: Partial<SkillValidationLimits>;
  } = {},
): SkillValidation {
  const limits = { ...DEFAULT_SKILL_LIMITS, ...options.limits };
  const { metadata, findings } = readSkillMetadata(tree);

  let totalBytes = 0;
  for (const file of tree.files) {
    const bytes = Buffer.byteLength(file.content, 'utf8');
    totalBytes += bytes;

    if (!isSafeRelativePath(file.path)) {
      findings.push({
        level: 'error',
        code: 'unsafe_path',
        message: `Skill file path "${file.path}" escapes the skill directory or is absolute.`,
        path: file.path,
      });
    }
    if (bytes > limits.maxFileBytes) {
      findings.push({
        level: 'error',
        code: 'file_too_large',
        message: `File exceeds ${limits.maxFileBytes} bytes (${bytes}).`,
        path: file.path,
      });
    }
    for (const secret of SECRET_PATTERNS) {
      if (secret.pattern.test(file.content)) {
        findings.push({
          level: 'error',
          code: 'secret_detected',
          message: `Possible ${secret.label} found; skills must never carry credentials.`,
          path: file.path,
        });
      }
    }
  }

  if (totalBytes > limits.maxTotalBytes) {
    findings.push({
      level: 'error',
      code: 'skill_too_large',
      message: `Skill exceeds ${limits.maxTotalBytes} bytes (${totalBytes}).`,
    });
  }

  const ok = !findings.some((f) => f.level === 'error');
  const catalogSkill: CatalogSkill | null = metadata
    ? {
        metadata,
        contentHash: hashSkillTree(tree.files),
        source: options.source ?? 'platform',
        contentRef: options.contentRef ?? tree.folder,
        tree,
      }
    : null;

  return { ok, findings, catalogSkill };
}

/** Reject absolute paths, `..` traversal, and Windows drive/UNC forms. */
function isSafeRelativePath(path: string): boolean {
  if (path.length === 0) return false;
  if (path.startsWith('/') || path.startsWith('\\')) return false;
  if (/^[A-Za-z]:/.test(path)) return false;
  return !path.split(/[\\/]/).includes('..');
}
