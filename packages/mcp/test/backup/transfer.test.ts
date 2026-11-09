import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { handleBackupDesign } from '../../src/tools/backup-design.js';

describe('backup transfer validation', () => {
  it.each([0, -1, Infinity, 256_000_001])(
    'rejects unsafe capture budgets before dispatch: %s',
    async maxCaptureChars => {
      const dispatch = vi.fn<(tool: string, args: unknown) => Promise<unknown>>(async () => null);
      await expect(
        handleBackupDesign(dispatch, { outPath: 'unused', maxCaptureChars }, '0.7.0'),
      ).rejects.toThrow(/maxCaptureChars/u);
      expect(dispatch).not.toHaveBeenCalled();
    },
  );
  it.each([
    { totalChars: 10, budget: undefined },
    { totalChars: 72_000_000, budget: undefined },
    { totalChars: 10, budget: 4096 },
  ])(
    'refuses mixed chunks, releases capture and honors budget ($totalChars, $budget)',
    async ({ totalChars, budget }) => {
      const dir = await mkdtemp(join(tmpdir(), 'figwright-transfer-'));
      try {
        const dispatch = vi.fn<(tool: string, args: unknown) => Promise<unknown>>(
          async (_tool, args) => {
            const mode = (args as { mode: string }).mode;
            if (mode === 'start')
              return {
                transferVersion: 1,
                captureId: 'capture',
                totalChars,
                maxChars: budget ?? 128_000_000,
              };
            if (mode === 'release') return { released: true };
            return {
              transferVersion: 1,
              captureId: 'wrong',
              offset: 0,
              nextOffset: 1,
              text: 'x',
              done: false,
            };
          },
        );
        await expect(
          handleBackupDesign(
            dispatch,
            { outPath: join(dir, 'backup'), maxCaptureChars: budget },
            '0.7.0',
          ),
        ).rejects.toThrow(/inconsistent chunk/u);
        expect(dispatch).toHaveBeenCalledWith('backup_design', {
          mode: 'start',
          maxChars: budget ?? 128_000_000,
        });
        expect(dispatch).toHaveBeenLastCalledWith('backup_design', {
          mode: 'release',
          captureId: 'capture',
        });
        expect(await readdir(dir)).toEqual([]);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  );

  it('makes an incompatible plugin response actionable', async () => {
    const dispatch = vi.fn<(tool: string, args: unknown) => Promise<unknown>>(async () => ({
      captureVersion: 1,
    }));
    await expect(handleBackupDesign(dispatch, { outPath: 'unused' }, '0.7.0')).rejects.toThrow(
      /reload/u,
    );
    expect(dispatch).toHaveBeenCalledOnce();
  });
});
