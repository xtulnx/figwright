import { describe, expect, it } from 'vitest';

import { BackupSnapshotSchema, type BackupSnapshot } from '../../src/backup/snapshot.js';

const fixture = (): BackupSnapshot => ({
  captureVersion: 1,
  source: { name: 'Design', editorType: 'figma' },
  nodes: [
    { id: 'p', type: 'PAGE', parentId: null, children: ['n'], properties: {} },
    {
      id: 'n',
      type: 'RECTANGLE',
      parentId: 'p',
      children: [],
      properties: { x: { state: 'value', value: 0.123456789 } },
    },
  ],
  pageIds: ['p'],
  issues: [],
});

describe('backup snapshot graph', () => {
  it('preserves precision and tagged mixed state', () => {
    const snapshot = fixture();
    snapshot.nodes[1]!.properties.radius = { state: 'mixed' };
    expect(BackupSnapshotSchema.parse(snapshot)).toEqual(snapshot);
  });

  it('rejects duplicate ids, missing children and mismatched parents', () => {
    const duplicate = fixture();
    duplicate.nodes.push(duplicate.nodes[1]!);
    expect(BackupSnapshotSchema.safeParse(duplicate).success).toBe(false);
    const missing = fixture();
    missing.nodes.pop();
    expect(BackupSnapshotSchema.safeParse(missing).success).toBe(false);
    const mismatch = fixture();
    mismatch.nodes[1]!.parentId = 'other';
    expect(BackupSnapshotSchema.safeParse(mismatch).success).toBe(false);
  });

  it('rejects isolated cycles even when all parent/child links agree', () => {
    const snapshot = fixture();
    snapshot.nodes[0]!.children = [];
    snapshot.nodes[1]!.children = ['n'];
    snapshot.nodes[1]!.parentId = 'n';
    expect(BackupSnapshotSchema.safeParse(snapshot).success).toBe(false);
  });

  it('requires every root to be a listed page', () => {
    const snapshot = fixture();
    snapshot.pageIds = [];
    expect(BackupSnapshotSchema.safeParse(snapshot).success).toBe(false);
  });
});
