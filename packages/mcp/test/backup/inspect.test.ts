import { describe, expect, it } from 'vitest';

import { inspectBackup } from '../../src/backup/inspect.js';

// SHA-256 of '{}' pinned independently of the implementation.
const hash = '44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a';
const manifest = {
  format: 'figwright-backup',
  version: 1,
  createdAt: '2026-11-06T00:00:00Z',
  producer: { serverVersion: '0.7.0', pluginVersion: '0.7.0' },
  source: { name: 'Design', editorType: 'figma' },
  entries: [{ path: 'document.json', kind: 'document', bytes: 2, sha256: hash }],
  issues: [],
};

describe('inspectBackup', () => {
  it('verifies bytes without claiming semantic recoverability', () => {
    const entries = new Map([['document.json', Buffer.from('{}')]]);
    expect(inspectBackup(manifest, entries)).toEqual({
      integrity: 'valid',
      recoverability: 'unknown',
      errors: [],
    });
    expect(
      inspectBackup(
        {
          ...manifest,
          issues: [{ severity: 'unsupported', code: 'font', message: 'Cannot restore' }],
        },
        entries,
      ).recoverability,
    ).toBe('unknown');
  });

  it('detects same-length corruption', () => {
    expect(inspectBackup(manifest, new Map([['document.json', Buffer.from('[]')]]))).toEqual({
      integrity: 'invalid',
      recoverability: 'unknown',
      errors: [{ path: 'document.json', code: 'hash' }],
    });
  });

  it('reports missing and unexpected entries', () => {
    expect(inspectBackup(manifest, new Map([['extra', new Uint8Array()]])).errors).toEqual([
      { path: 'document.json', code: 'missing' },
      { path: 'extra', code: 'unexpected' },
    ]);
  });

  it('reports truncation and does not mutate input', () => {
    const bytes = Buffer.from('{');
    const entries = new Map([['document.json', bytes]]);
    expect(inspectBackup(manifest, entries).errors).toEqual([
      { path: 'document.json', code: 'size' },
      { path: 'document.json', code: 'hash' },
    ]);
    expect(bytes.toString()).toBe('{');
    expect(entries.size).toBe(1);
  });

  it('refuses unrecognized manifest data before reading entries', () => {
    expect(() => inspectBackup({ ...manifest, version: 2 }, new Map())).toThrow(/version/u);
  });
});
