import { decode, encode } from '@msgpack/msgpack';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { z } from 'zod';

import { backupBase64Decode, backupBase64Encode } from './binary.js';
import { inspectBackupEntries } from './inspect.js';
import { MAX_BACKUP_ARCHIVE_BYTES } from './limits.js';
import { BackupManifestSchema } from './manifest.js';
import { BackupSnapshotSchema, type BackupSnapshot } from './snapshot.js';

// This codec runs in Node or the browser panel, never in Figma's API sandbox.
declare const TextEncoder: { new (): { encode(value: string): Uint8Array } };
declare const TextDecoder: {
  new (label?: string, options?: { fatal?: boolean }): { decode(value: Uint8Array): string };
};

const hashBackupBytes = (bytes: Uint8Array): string => bytesToHex(sha256(bytes));

const legacyContainerSchema = z.strictObject({
  container: z.literal('figwright-backup-gzip-json'),
  version: z.literal(1),
  manifest: BackupManifestSchema,
  files: z.array(z.strictObject({ path: z.string(), base64: z.string() })),
});
const binaryContainerSchema = z.strictObject({
  container: z.literal('figwright-backup-msgpack'),
  version: z.literal(2),
  manifest: BackupManifestSchema,
  files: z.array(z.strictObject({ path: z.string(), bytes: z.instanceof(Uint8Array) })),
});

/**
 * V2 uses msgpack binary entries before gzip. Base64-wrapping the JSON disrupted gzip's repeated
 * property dictionary (measured 7.34 MB vs 1.82 MB on identical captured bytes). Payload schemas,
 * hashes and precision stay unchanged; the reader still accepts v1 gzip/JSON archives.
 */
export const encodeBackupContainer = (
  snapshot: BackupSnapshot,
  serverVersion: string,
  images: ReadonlyMap<string, Uint8Array> = new Map(),
  pluginVersion = 'unreported',
): Uint8Array => {
  const files: { path: string; bytes: Uint8Array }[] = [];
  const imageIndex: Record<string, string> = Object.create(null);
  const paths = new Set<string>();
  for (const [hash, bytes] of images) {
    const path = `assets/${hashBackupBytes(bytes)}`;
    imageIndex[hash] = path;
    if (!paths.has(path)) {
      files.push({ path, bytes });
      paths.add(path);
    }
  }
  if (
    snapshot.images !== undefined &&
    Object.keys(snapshot.images).some(hash => !images.has(hash))
  ) {
    throw new Error('Cannot re-encode image references without original asset bytes');
  }
  const validated = BackupSnapshotSchema.parse(
    images.size > 0 ? { ...snapshot, images: imageIndex } : snapshot,
  );
  const document = new TextEncoder().encode(JSON.stringify(validated));
  const manifest = BackupManifestSchema.parse({
    format: 'figwright-backup',
    version: 1,
    createdAt: new Date().toISOString(),
    producer: { serverVersion, pluginVersion },
    source: validated.source,
    entries: [
      {
        path: 'document.json',
        kind: 'document',
        bytes: document.length,
        sha256: hashBackupBytes(document),
      },
      ...files.map(file => ({
        path: file.path,
        kind: 'asset',
        bytes: file.bytes.byteLength,
        sha256: hashBackupBytes(file.bytes),
      })),
    ],
    issues: validated.issues,
  });
  const packed = encode({
    container: 'figwright-backup-msgpack',
    version: 2,
    manifest,
    files: [{ path: 'document.json', bytes: document }, ...files],
  });
  if (packed.length > MAX_BACKUP_ARCHIVE_BYTES)
    throw new Error(
      `Backup container has ${packed.length} bytes, exceeding limit ${MAX_BACKUP_ARCHIVE_BYTES}`,
    );
  return packed;
};

export const decodeBackupContainer = (
  bytes: Uint8Array,
  maxBytes = MAX_BACKUP_ARCHIVE_BYTES,
): {
  manifest: z.infer<typeof BackupManifestSchema>;
  snapshot: BackupSnapshot;
  images: Map<string, Uint8Array>;
} => {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || maxBytes > MAX_BACKUP_ARCHIVE_BYTES) {
    throw new RangeError('Invalid backup archive byte limit');
  }
  if (bytes.byteLength > maxBytes)
    throw new Error(`Backup container has ${bytes.byteLength} bytes, exceeding limit ${maxBytes}`);
  const unpacked = bytes;
  // Legacy JSON permitted whitespace. Binary maps start with a msgpack map header, so format
  // detection remains unambiguous without changing any persisted v1 file.
  const first = unpacked.find(byte => ![0x09, 0x0a, 0x0d, 0x20].includes(byte));
  const container =
    first === 0x7b
      ? legacyContainerSchema.parse(
          JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(unpacked)),
        )
      : binaryContainerSchema.parse(
          decode(unpacked, {
            maxStrLength: maxBytes,
            maxBinLength: maxBytes,
            maxArrayLength: 100_000,
            maxMapLength: 100_000,
            maxExtLength: 0,
          }),
        );
  const entries = new Map<string, Uint8Array>();
  for (const file of container.files) {
    if (entries.has(file.path)) throw new Error(`Duplicate container file: ${file.path}`);
    const data = 'bytes' in file ? file.bytes : backupBase64Decode(file.base64);
    if ('base64' in file && backupBase64Encode(data) !== file.base64)
      throw new Error(`Invalid base64: ${file.path}`);
    entries.set(file.path, data);
  }
  const report = inspectBackupEntries(container.manifest, entries);
  if (report.integrity !== 'valid')
    throw new Error(`Backup integrity failed: ${JSON.stringify(report.errors)}`);
  const documentEntry = container.manifest.entries.find(entry => entry.kind === 'document')!;
  const snapshot = BackupSnapshotSchema.parse(
    JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(entries.get(documentEntry.path)!)),
  );
  if (
    JSON.stringify(snapshot.source) !== JSON.stringify(container.manifest.source) ||
    JSON.stringify(snapshot.issues) !== JSON.stringify(container.manifest.issues)
  ) {
    throw new Error('Backup manifest disagrees with document');
  }
  const images = new Map<string, Uint8Array>();
  const assetPaths = new Set(
    container.manifest.entries.filter(entry => entry.kind === 'asset').map(entry => entry.path),
  );
  for (const [hash, path] of Object.entries(snapshot.images ?? {})) {
    const data = entries.get(path);
    if (!assetPaths.has(path) || data === undefined)
      throw new Error(`Missing image asset reference: ${hash}`);
    images.set(hash, data);
  }
  return { manifest: container.manifest, snapshot, images };
};
