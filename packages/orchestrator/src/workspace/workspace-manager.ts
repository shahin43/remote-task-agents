import fs from 'node:fs/promises';
import path from 'node:path';

export interface WorkspaceManagerOptions {
  baseDir: string;  // e.g. ./workspaces or ./runs
}

export interface SessionWorkspace {
  sessionId: string;
  rootPath: string;
  contextDir: string;    // <root>/context — orchestrator-injected files
  repoDir: string;       // <root>/repo — cloned/linked git repo
  outputDir: string;     // <root>/output — worker artifacts
}

export class WorkspaceManager {
  constructor(private readonly opts: WorkspaceManagerOptions) {}

  async create(sessionId: string): Promise<SessionWorkspace> {
    const rootPath = path.join(this.opts.baseDir, sessionId);
    const contextDir = path.join(rootPath, 'context');
    const repoDir = path.join(rootPath, 'repo');
    const outputDir = path.join(rootPath, 'output');

    await fs.mkdir(contextDir, { recursive: true });
    await fs.mkdir(repoDir, { recursive: true });
    await fs.mkdir(outputDir, { recursive: true });

    return { sessionId, rootPath, contextDir, repoDir, outputDir };
  }

  async injectFile(workspace: SessionWorkspace, relativePath: string, content: string): Promise<string> {
    const fullPath = path.join(workspace.contextDir, relativePath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content, 'utf8');
    return fullPath;
  }

  async injectSessionContext(
    workspace: SessionWorkspace,
    context: {
      goal: string;
      ticket?: { key: string; title: string; description?: string; url?: string };
      repo?: { provider: string; projectId: string; baseBranch: string; targetPaths: string[] };
      orchestratorNotes?: string;
      parentSessionId: string;
      channelOrigin?: string;
    },
  ): Promise<void> {
    const lines: string[] = [
      '# Worker Session Context',
      '',
      `## Goal`,
      '',
      context.goal,
      '',
    ];

    if (context.ticket) {
      lines.push(
        `## Source Ticket`,
        '',
        `- Key: ${context.ticket.key}`,
        `- Title: ${context.ticket.title}`,
        context.ticket.url ? `- URL: ${context.ticket.url}` : '',
        '',
        '### Description',
        '',
        context.ticket.description ?? '(no description)',
        '',
      );
    }

    if (context.repo) {
      lines.push(
        `## Repository`,
        '',
        `- Provider: ${context.repo.provider}`,
        `- Project: ${context.repo.projectId}`,
        `- Base branch: ${context.repo.baseBranch}`,
        `- Target paths: ${context.repo.targetPaths.length > 0 ? context.repo.targetPaths.join(', ') : '(entire repo)'}`,
        '',
      );
    }

    if (context.orchestratorNotes) {
      lines.push(
        `## Orchestrator Notes`,
        '',
        context.orchestratorNotes,
        '',
      );
    }

    lines.push(
      `## Session Info`,
      '',
      `- Parent session: ${context.parentSessionId}`,
      `- Channel: ${context.channelOrigin ?? '(none)'}`,
      '',
    );

    await this.injectFile(workspace, 'session-context.md', lines.filter(l => l !== undefined).join('\n'));
  }

  async cloneRepo(workspace: SessionWorkspace, sourcePath: string, gitPolicy: 'include' | 'exclude' = 'exclude'): Promise<void> {
    const source = path.resolve(sourcePath);
    await fs.cp(source, workspace.repoDir, {
      recursive: true,
      force: true,
      filter: gitPolicy === 'include'
        ? undefined
        : (entry) => {
            const relative = path.relative(source, entry);
            return relative !== '.git' && !relative.startsWith(`.git${path.sep}`);
          },
    });
  }

  async listWorkspaceContents(workspace: SessionWorkspace): Promise<{ context: string[]; repo: string[]; output: string[] }> {
    const listDir = async (dir: string): Promise<string[]> => {
      try {
        const entries: string[] = [];
        const walk = async (d: string, prefix: string) => {
          const items = await fs.readdir(d, { withFileTypes: true });
          for (const item of items) {
            const rel = prefix ? `${prefix}/${item.name}` : item.name;
            if (item.isDirectory()) {
              await walk(path.join(d, item.name), rel);
            } else {
              entries.push(rel);
            }
          }
        };
        await walk(dir, '');
        return entries.sort();
      } catch {
        return [];
      }
    };
    return {
      context: await listDir(workspace.contextDir),
      repo: await listDir(workspace.repoDir),
      output: await listDir(workspace.outputDir),
    };
  }

  async cleanup(workspace: SessionWorkspace): Promise<void> {
    await fs.rm(workspace.rootPath, { recursive: true, force: true });
  }
}
