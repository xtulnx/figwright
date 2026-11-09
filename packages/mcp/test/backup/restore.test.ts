import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { type BackupSnapshot, RestoreTransferRequestSchema } from '@figwright/shared';
import { describe, expect, it, vi } from 'vitest';

import { encodeBackupArchive } from '../../src/backup/archive.js';
import { handleRestoreBackup } from '../../src/tools/restore-backup.js';

const snapshot = (name = 'Page'): BackupSnapshot => ({
  captureVersion: 1,
  source: { name: 'Design', editorType: 'figma' },
  nodes: [
    {
      id: 'p',
      type: 'PAGE',
      parentId: null,
      children: [],
      properties: { name: { state: 'value', value: name } },
    },
  ],
  pageIds: ['p'],
  issues: [],
});
const withArchive = async (snap: BackupSnapshot, run: (path: string) => Promise<void>) => {
  const dir = await mkdtemp(join(tmpdir(), 'figwright-restore-'));
  try {
    const path = join(dir, 'test.figwright-backup');
    await writeFile(path, encodeBackupArchive(snap, '0.7.0'));
    await run(path);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

describe('restore MCP orchestration', () => {
  it('defaults to a local dry run without dispatching or claiming property validation', async () => {
    await withArchive(snapshot(), async path => {
      const dispatch = vi.fn<() => Promise<null>>(async () => null);
      expect(await handleRestoreBackup(dispatch, { path })).toMatchObject({
        status: 'preflight',
        propertyValidation: 'pending',
        nodes: 1,
      });
      expect(dispatch).not.toHaveBeenCalled();
      await expect(handleRestoreBackup(dispatch, { path, pageId: 'missing' })).rejects.toThrow(
        'not a page',
      );
    });
  });
  it('rejects known incomplete snapshots before uploading unless allowPartial is explicit', async () => {
    const snap = snapshot();
    snap.issues.push({ code: 'MISSING', severity: 'missing', message: 'Definitions unavailable' });
    await withArchive(snap, async path => {
      const dispatch = vi.fn<() => Promise<null>>(async () => null);
      await expect(handleRestoreBackup(dispatch, { path, dryRun: false })).rejects.toThrow(
        'preflight',
      );
      expect(dispatch).not.toHaveBeenCalled();
    });
  });
  it('uploads lossless bounded UTF-8 chunks and commits exactly once after acknowledgment', async () => {
    await withArchive(snapshot('😀'.repeat(150_000)), async path => {
      let total = 0;
      let text = '';
      let commits = 0;
      const offsets: { expected: number; actual: number }[] = [];
      let committedLength = -1;
      const dispatch = vi.fn<(tool: string, args: unknown) => Promise<unknown>>(
        async (_tool, raw) => {
          const args = RestoreTransferRequestSchema.parse(raw);
          if (args.mode === 'start') {
            total = args.totalChars;
            return { restoreId: 'r', received: 0 };
          }
          if (args.mode === 'append') {
            offsets.push({ expected: text.length, actual: args.offset });
            text += Buffer.from(args.text).toString('utf8');
            return { received: text.length };
          }
          if (args.mode === 'commit') {
            commits++;
            committedLength = text.length;
            return {
              status: 'restored',
              pages: [{ sourceId: 'p', nodeId: 'new', name: 'New' }],
              nodes: 1,
              issueCount: 0,
              issues: [],
            };
          }
          return { released: true };
        },
      );
      expect(await handleRestoreBackup(dispatch, { path, dryRun: false })).toMatchObject({
        status: 'restored',
      });
      expect(JSON.parse(text).snapshot).toEqual(snapshot('😀'.repeat(150_000)));
      expect(commits).toBe(1);
      expect(committedLength).toBe(total);
      expect(offsets.length).toBeGreaterThan(1);
      for (const offset of offsets) expect(offset.actual).toBe(offset.expected);
      expect(dispatch).toHaveBeenLastCalledWith('restore_backup', {
        mode: 'release',
        restoreId: 'r',
      });
    });
  });
  it('releases failed uploads and never commits after an inconsistent acknowledgment', async () => {
    await withArchive(snapshot(), async path => {
      const dispatch = vi.fn<(tool: string, args: unknown) => Promise<unknown>>(
        async (_tool, args) => {
          const mode = (args as { mode: string }).mode;
          return mode === 'start' ? { restoreId: 'r', received: 0 } : { received: 1 };
        },
      );
      await expect(handleRestoreBackup(dispatch, { path, dryRun: false })).rejects.toThrow(
        'inconsistent offset',
      );
      expect(dispatch.mock.calls.map(c => (c[1] as { mode: string }).mode)).toEqual([
        'start',
        'append',
        'release',
      ]);
    });
  });
});

describe('restore job control', () => {
  it('checks or cancels an existing job without reading an archive or uploading', async () => {
    const job = { restoreId: 'job', state: 'running', phase: 'font Noto Sans SC/Regular' };
    const dispatch = vi.fn<(name: string, args: unknown) => Promise<unknown>>(async () => job);
    expect(await handleRestoreBackup(dispatch, { operation: 'status' })).toEqual(job);
    expect(dispatch).toHaveBeenLastCalledWith('restore_backup', { mode: 'status' });
    expect(await handleRestoreBackup(dispatch, { operation: 'cancel', restoreId: 'job' })).toEqual(
      job,
    );
    expect(dispatch).toHaveBeenLastCalledWith('restore_backup', {
      mode: 'cancel',
      restoreId: 'job',
    });
    await expect(handleRestoreBackup(dispatch, { operation: 'cancel' })).rejects.toThrow(
      'restoreId',
    );
  });
  it('follows the staged job result without submitting a second commit', async () => {
    await withArchive(snapshot(), async path => {
      const result = {
        status: 'restored',
        pages: [{ sourceId: 'p', nodeId: 'new', name: 'Page' }],
        nodes: 1,
        issueCount: 0,
        issues: [],
      };
      const modes: string[] = [];
      const dispatch = vi.fn<(name: string, args: unknown) => Promise<unknown>>(
        async (_name, raw) => {
          const args = RestoreTransferRequestSchema.parse(raw);
          modes.push(args.mode);
          if (args.mode === 'start') return { restoreId: 'job', received: 0 };
          if (args.mode === 'append') return { received: args.offset + args.text.length };
          if (args.mode === 'commit')
            return { restoreId: 'job', state: 'running', phase: 'queued' };
          if (args.mode === 'status')
            return { restoreId: 'job', state: 'completed', phase: 'completed', result };
          return { released: true };
        },
      );
      expect(await handleRestoreBackup(dispatch, { path, dryRun: false })).toEqual(result);
      expect(modes).toEqual(['start', 'append', 'commit', 'status', 'release']);
    });
  });
});
