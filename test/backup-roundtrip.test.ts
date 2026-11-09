import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { readBackupArchive } from '../packages/mcp/src/backup/archive.js';
import { handleBackupDesign } from '../packages/mcp/src/tools/backup-design.js';
import { handleInspectBackup } from '../packages/mcp/src/tools/inspect-backup.js';
import { handleRestoreBackup } from '../packages/mcp/src/tools/restore-backup.js';
import { createSandboxHandlers } from '../packages/plugin/src/handlers/registry.js';

describe('experimental backup capture → archive → inspection', () => {
  it('routes a read-only capture to the plugin and reports incomplete coverage after writing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'figwright-roundtrip-'));
    try {
      const page = {
        id: 'p',
        type: 'PAGE',
        name: 'Page',
        children: [],
        loadAsync: vi.fn<() => Promise<void>>(async () => {}),
      };
      const figmaCtx = {
        root: { name: 'Design', children: [page] },
        createPage: vi.fn<() => typeof page>(() => {
          const restored = { ...page, id: 'restored-page', name: 'New page' };
          figmaCtx.root.children.push(restored);
          return restored;
        }),
        commitUndo: vi.fn<() => void>(),
        editorType: 'figma',
        mixed: Symbol('mixed'),
        skipInvisibleInstanceChildren: false,
        on: vi.fn<(...args: unknown[]) => void>(),
        off: vi.fn<(...args: unknown[]) => void>(),
        loadAllPagesAsync: vi.fn<() => Promise<void>>(async () => {}),
      };
      const handlers = createSandboxHandlers(figmaCtx as unknown as typeof figma);
      const dispatch = vi.fn<(tool: string, args: unknown) => Promise<unknown>>(
        async (tool, args) => handlers[tool]!(args),
      );
      const path = join(dir, 'design.figwright-backup');
      const result = await handleBackupDesign(dispatch, { outPath: path }, '0.7.0');
      expect(dispatch).toHaveBeenCalledWith('backup_design', {
        mode: 'start',
        maxChars: 128_000_000,
      });
      expect(dispatch.mock.calls.map(call => (call[1] as { mode: string }).mode)).toEqual([
        'start',
        'read',
        'release',
      ]);
      expect(result).toMatchObject({ path, status: 'incomplete', pages: 1, nodes: 1 });
      expect(result.issues.some(issue => issue.code === 'EXPERIMENTAL_CAPTURE')).toBe(true);
      expect((await readBackupArchive(path)).snapshot.nodes[0]!.properties.name).toEqual({
        state: 'value',
        value: 'Page',
      });
      expect(await handleInspectBackup({ path })).toMatchObject({
        integrity: 'valid',
        recoverability: 'unknown',
        pages: 1,
        nodes: 1,
      });
      expect(figmaCtx.off).toHaveBeenCalledOnce();
      const restored = await handleRestoreBackup(dispatch, {
        path,
        pageId: 'p',
        dryRun: false,
        allowPartial: true,
      });
      expect(restored).toMatchObject({
        status: 'partial',
        nodes: 1,
        issueCount: 3,
        pages: [{ sourceId: 'p', nodeId: 'restored-page', name: 'Page (restored)' }],
      });
      expect(figmaCtx.root.children.map(node => node.id)).toEqual(['p', 'restored-page']);
      expect(figmaCtx.root.children[0]).toBe(page);
      expect(page.name).toBe('Page');
      expect(figmaCtx.commitUndo).toHaveBeenCalledOnce();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
