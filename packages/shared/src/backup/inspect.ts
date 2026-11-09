import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import { BackupManifestSchema } from './manifest.js';

/**
 * Container-independent inspection. The eventual ZIP adapter must enforce decompression limits
 * before allocating bytes; this layer receives already bounded, uncompressed entries.
 */
export const inspectBackupEntries = (
  rawManifest: unknown,
  entries: ReadonlyMap<string, Uint8Array>,
): {
  integrity: 'valid' | 'invalid';
  recoverability: 'unknown';
  errors: { path: string; code: 'missing' | 'size' | 'hash' | 'unexpected' }[];
} => {
  const manifest = BackupManifestSchema.parse(rawManifest);
  const expected = new Set(manifest.entries.map(entry => entry.path));
  const errors: { path: string; code: 'missing' | 'size' | 'hash' | 'unexpected' }[] = [];
  for (const entry of manifest.entries) {
    const bytes = entries.get(entry.path);
    if (bytes === undefined) {
      errors.push({ path: entry.path, code: 'missing' });
      continue;
    }
    if (bytes.byteLength !== entry.bytes) errors.push({ path: entry.path, code: 'size' });
    if (bytesToHex(sha256(bytes)) !== entry.sha256) {
      errors.push({ path: entry.path, code: 'hash' });
    }
  }
  for (const path of entries.keys()) {
    if (!expected.has(path)) errors.push({ path, code: 'unexpected' });
  }
  // Byte integrity is independent of API support, fonts, permissions and payload semantics.
  return {
    integrity: errors.length === 0 ? 'valid' : 'invalid',
    recoverability: 'unknown',
    errors,
  };
};
