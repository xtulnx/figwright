import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';

import type { BackupManifest, BackupSnapshot } from '@figwright/shared';
import { decode, encode } from '@msgpack/msgpack';
import { afterEach, describe, expect, it } from 'vitest';

import {
  decodeBackupArchive,
  encodeBackupArchive,
  readBackupArchive,
  writeBackupArchive,
} from '../../src/backup/archive.js';

const fixture = (): BackupSnapshot => ({
  captureVersion: 1,
  source: { name: '设计稿', editorType: 'figma' },
  nodes: [
    {
      id: 'p',
      type: 'PAGE',
      parentId: null,
      children: [],
      properties: { x: { state: 'value', value: 0.123456789 } },
    },
  ],
  pageIds: ['p'],
  issues: [{ code: 'UNVERIFIED', severity: 'unknown', message: 'Unknown coverage' }],
});
const unpack = (bytes: Uint8Array) =>
  decode(gunzipSync(bytes)) as {
    version: number;
    manifest: BackupManifest;
    files: { path: string; bytes: Uint8Array }[];
  };
const legacyFixture = () => {
  const snapshot = fixture();
  const bytes = Buffer.from(JSON.stringify(snapshot));
  return {
    container: 'figwright-backup-gzip-json',
    version: 1,
    manifest: {
      format: 'figwright-backup',
      version: 1,
      createdAt: '2026-11-07T00:00:00Z',
      producer: { serverVersion: '0.7.0', pluginVersion: 'unreported' },
      source: snapshot.source,
      entries: [
        {
          path: 'document.json',
          kind: 'document',
          bytes: bytes.length,
          sha256: createHash('sha256').update(bytes).digest('hex'),
        },
      ],
      issues: snapshot.issues,
    },
    files: [{ path: 'document.json', base64: bytes.toString('base64') }],
  };
};
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});
const directory = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), 'figwright-backup-'));
  dirs.push(dir);
  return dir;
};

describe('backup archive container', () => {
  it('rejects an image index that points at the document instead of an asset even with valid hashes', () => {
    const container = legacyFixture();
    const snapshot = { ...fixture(), images: { ghost: 'document.json' } };
    const document = Buffer.from(JSON.stringify(snapshot));
    container.files[0]!.base64 = document.toString('base64');
    container.manifest.entries[0]!.bytes = document.length;
    container.manifest.entries[0]!.sha256 = createHash('sha256').update(document).digest('hex');
    expect(() => decodeBackupArchive(gzipSync(JSON.stringify(container)))).toThrow(
      /Missing image asset reference/u,
    );
  });
  it.each([0, -1, Infinity, 256 * 1024 * 1024 + 1])('rejects unsafe decoder budgets %s', budget => {
    expect(() => decodeBackupArchive(new Uint8Array(), budget)).toThrow(
      /Invalid backup archive byte limit/u,
    );
  });
  it('round trips Unicode names, precise numbers, structure and coverage issues', () => {
    const result = decodeBackupArchive(encodeBackupArchive(fixture(), '0.7.0'));
    expect(result.snapshot).toEqual(fixture());
    expect(result.manifest.issues).toEqual(fixture().issues);
    expect(result.manifest.producer.pluginVersion).toBe('unreported');
  });

  it('detects tampering even if the gzip is valid', () => {
    const container = unpack(encodeBackupArchive(fixture(), '0.7.0'));
    container.files[0]!.bytes = Buffer.from('{}');
    expect(() => decodeBackupArchive(gzipSync(encode(container)))).toThrow(/integrity failed/u);
  });

  it('reads manually constructed legacy v1 archives, including JSON whitespace', () => {
    expect(decodeBackupArchive(gzipSync(' \n' + JSON.stringify(legacyFixture()))).snapshot).toEqual(
      fixture(),
    );
  });

  it('refuses duplicate binary entries and unknown versions', () => {
    const original = encodeBackupArchive(fixture(), '0.7.0');
    const duplicate = unpack(original);
    duplicate.files.push(duplicate.files[0]!);
    expect(() => decodeBackupArchive(gzipSync(encode(duplicate)))).toThrow(/Duplicate/u);
    const newer = unpack(original);
    newer.version = 3;
    expect(() => decodeBackupArchive(gzipSync(encode(newer)))).toThrow(/version/u);
  });

  it('continues rejecting invalid base64 in legacy archives', () => {
    const bad = legacyFixture();
    bad.files[0]!.base64 += '!';
    expect(() => decodeBackupArchive(gzipSync(JSON.stringify(bad)))).toThrow(/base64/u);
  });

  it('refuses manifest/document disagreement', () => {
    const container = unpack(encodeBackupArchive(fixture(), '0.7.0'));
    container.manifest.issues = [];
    expect(() => decodeBackupArchive(gzipSync(encode(container)))).toThrow(/disagrees/u);
  });

  it('limits decompression before parsing the payload', () => {
    const bomb = gzipSync(Buffer.alloc(1024 * 1024 + 1));
    expect(() => decodeBackupArchive(bomb, 1024 * 1024)).toThrow(/larger|length|size|limit/u);
  });

  it('publishes a validated archive and refuses to overwrite an existing backup', async () => {
    const dir = await directory();
    const path = join(dir, 'nested', 'design.figwright-backup');
    const bytes = encodeBackupArchive(fixture(), '0.7.0');
    expect(await writeBackupArchive(path, bytes)).toBe(path);
    expect((await readBackupArchive(path)).snapshot).toEqual(fixture());
    await expect(writeBackupArchive(path, bytes)).rejects.toThrow(/EEXIST/u);
    expect(await readFile(path)).toEqual(bytes);
    expect(await readdir(join(dir, 'nested'))).toEqual(['design.figwright-backup']);
  });

  it('validates before creating output and rejects non-files', async () => {
    const dir = await directory();
    await expect(writeBackupArchive(join(dir, 'invalid'), Buffer.from('invalid'))).rejects.toThrow(
      /header|compression/u,
    );
    expect(await readdir(dir)).toEqual([]);
    await expect(readBackupArchive(dir)).rejects.toThrow(/Invalid backup/u);
  });
});
