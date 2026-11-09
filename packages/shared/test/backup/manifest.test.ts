import { describe, expect, it } from 'vitest';

import { BackupManifestSchema } from '../../src/backup/manifest.js';

const fixture = () => ({
  format: 'figwright-backup',
  version: 1,
  createdAt: '2026-11-06T00:00:00Z',
  producer: { serverVersion: '0.7.0', pluginVersion: '0.7.0' },
  source: { name: 'Design', editorType: 'figma' },
  entries: [{ path: 'document.json', kind: 'document', bytes: 2, sha256: 'a'.repeat(64) }],
  issues: [],
});

describe('backup manifest v1', () => {
  it('preserves the manifest rather than stripping unrecognized fields', () => {
    expect(BackupManifestSchema.parse(fixture())).toEqual(fixture());
    expect(BackupManifestSchema.safeParse({ ...fixture(), complete: true }).success).toBe(false);
    const value = fixture();
    expect(
      BackupManifestSchema.safeParse({ ...value, source: { ...value.source, extra: 1 } }).success,
    ).toBe(false);
  });

  it.each([
    '../escape',
    '/absolute',
    'C:/file',
    'dir\\file',
    'dir//file',
    './file',
    'file.',
    'file ',
    'NUL.json',
    'dir/COM1',
    'bad\u0000file',
    'dir/../file',
  ])('rejects unsafe path %j', path => {
    const value = fixture();
    value.entries[0]!.path = path;
    expect(BackupManifestSchema.safeParse(value).success).toBe(false);
  });

  it.each(['DOCUMENT.JSON', 'document.json/subfile', 'manifest.json', 'MANIFEST.JSON/subfile'])(
    'rejects path alias or collision %s',
    path => {
      const value = fixture();
      value.entries.push({ ...value.entries[0]!, path, kind: 'asset' });
      expect(BackupManifestSchema.safeParse(value).success).toBe(false);
    },
  );

  it('rejects Unicode aliases', () => {
    const value = fixture();
    value.entries.push({ ...value.entries[0]!, path: 'é.png', kind: 'asset' });
    value.entries.push({ ...value.entries[0]!, path: 'e\u0301.png', kind: 'asset' });
    expect(BackupManifestSchema.safeParse(value).success).toBe(false);
  });

  it('requires exactly one document', () => {
    const value = fixture();
    value.entries.push({ ...value.entries[0]!, path: 'other.json' });
    expect(BackupManifestSchema.safeParse(value).success).toBe(false);
    value.entries.pop();
    value.entries[0]!.kind = 'page';
    expect(BackupManifestSchema.safeParse(value).success).toBe(false);
  });

  it('rejects unknown versions and invalid checksums or lengths', () => {
    expect(BackupManifestSchema.safeParse({ ...fixture(), version: 2 }).success).toBe(false);
    for (const bytes of [-1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      const value = fixture();
      value.entries[0]!.bytes = bytes;
      expect(BackupManifestSchema.safeParse(value).success).toBe(false);
    }
    const value = fixture();
    value.entries[0]!.sha256 = 'not-a-hash';
    expect(BackupManifestSchema.safeParse(value).success).toBe(false);
  });
});
