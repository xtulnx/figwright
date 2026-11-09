import type { BackupSnapshot } from '@figwright/shared';
import { describe, expect, it, vi } from 'vitest';

import { decodeBackupArchive, encodeBackupArchive } from '../../src/backup/archive.js';
import { collectBackupImages } from '../../src/backup/images.js';

const fixture = (): BackupSnapshot => ({
  captureVersion: 1,
  source: { name: 'Design', editorType: 'figma' },
  pageIds: ['p'],
  nodes: [
    { id: 'p', type: 'PAGE', parentId: null, children: ['a', 'b'], properties: {} },
    ...['a', 'b'].map(id => ({
      id,
      type: 'RECTANGLE',
      parentId: 'p',
      children: [],
      properties: {
        fills: {
          state: 'value' as const,
          value: [{ type: 'IMAGE', imageHash: 'shared', filters: { exposure: 0.1 } }],
        },
      },
    })),
  ],
  issues: ['a', 'b'].map(objectId => ({
    code: 'MEDIA_BYTES_NOT_CAPTURED',
    severity: 'missing',
    objectId,
    message: 'Missing media',
  })),
});

describe('original image backup', () => {
  it('extracts a shared hash once, keeps filters and round trips original bytes in the archive', async () => {
    const snapshot = fixture();
    const bytes = Buffer.from([137, 80, 78, 71, 0, 255]);
    const dispatch = vi.fn<(tool: string, args: unknown) => Promise<unknown>>(async () => ({
      nodes: [{ nodeId: 'a', images: [{ index: 0, imageHash: 'shared', base64: null, bytes }] }],
    }));
    const collected = await collectBackupImages(snapshot, dispatch);
    expect(dispatch).toHaveBeenCalledOnce();
    expect(dispatch).toHaveBeenCalledWith('save_image_fills', { nodeIds: ['a'], binary: true });
    expect(collected.snapshot.issues).toEqual([]);
    expect(snapshot.issues).toHaveLength(2);
    const archive = decodeBackupArchive(
      encodeBackupArchive(collected.snapshot, '0.7.0', collected.images),
    );
    expect(archive.images.get('shared')).toEqual(bytes);
    expect(archive.snapshot.nodes[1]!.properties).toEqual(snapshot.nodes[1]!.properties);
    expect(archive.manifest.entries.filter(entry => entry.kind === 'asset')).toHaveLength(1);
    expect(archive.snapshot.images?.shared).toMatch(/^assets\/[a-f0-9]{64}$/u);
    expect(() => encodeBackupArchive(archive.snapshot, '0.7.0')).toThrow(
      /without original asset bytes/u,
    );
  });

  it('deduplicates identical asset bytes even when Figma hashes differ', () => {
    const archive = decodeBackupArchive(
      encodeBackupArchive(
        fixture(),
        '0.7.0',
        new Map([
          ['one', Buffer.from('same')],
          ['two', Buffer.from('same')],
        ]),
      ),
    );
    expect(archive.images.size).toBe(2);
    expect(archive.manifest.entries.filter(entry => entry.kind === 'asset')).toHaveLength(1);
  });

  it('retries another usage on failure, and refuses bytes from changed/unexpected hashes', async () => {
    const dispatch = vi
      .fn<(tool: string, args: unknown) => Promise<unknown>>()
      .mockRejectedValueOnce(new Error('Source removed'))
      .mockResolvedValueOnce({
        nodes: [
          {
            nodeId: 'b',
            images: [
              { index: 0, imageHash: 'different', base64: null, bytes: Buffer.from('wrong') },
            ],
          },
        ],
      });
    const result = await collectBackupImages(fixture(), dispatch);
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(result.images.size).toBe(0);
    expect(result.snapshot.issues).toHaveLength(1);
    expect(result.snapshot.issues[0]!.code).toBe('IMAGE_BYTES_UNAVAILABLE');
  });

  it('reports nested-only image references without pretending the top-level tool extracted them', async () => {
    const snapshot = fixture();
    snapshot.nodes[1]!.properties = {
      styledTextSegments: {
        state: 'value',
        value: [{ fills: [{ type: 'IMAGE', imageHash: 'nested' }] }],
      },
    };
    snapshot.nodes[2]!.properties = {};
    const dispatch = vi.fn<(tool: string, args: unknown) => Promise<unknown>>();
    const result = await collectBackupImages(snapshot, dispatch);
    expect(dispatch).not.toHaveBeenCalled();
    expect(result.snapshot.issues[0]!.message).toContain('nested');
  });
});
