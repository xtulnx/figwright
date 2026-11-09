import { randomUUID } from 'node:crypto';
import { link, mkdir, open, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';

import {
  encodeBackupContainer,
  decodeBackupContainer,
  type BackupSnapshot,
  MAX_BACKUP_ARCHIVE_BYTES,
} from '@figwright/shared';

export const encodeBackupArchive = (
  snapshot: BackupSnapshot,
  serverVersion: string,
  images: ReadonlyMap<string, Uint8Array> = new Map(),
): Buffer => gzipSync(encodeBackupContainer(snapshot, serverVersion, images));

export const decodeBackupArchive = (
  bytes: Uint8Array,
  maxBytes = MAX_BACKUP_ARCHIVE_BYTES,
): ReturnType<typeof decodeBackupContainer> => {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || maxBytes > MAX_BACKUP_ARCHIVE_BYTES)
    throw new RangeError('Invalid backup archive byte limit');
  if (bytes.byteLength > maxBytes)
    throw new Error(`Backup container has ${bytes.byteLength} bytes, exceeding limit ${maxBytes}`);
  return decodeBackupContainer(gunzipSync(bytes, { maxOutputLength: maxBytes }), maxBytes);
};

/**
 * Publish only a validated archive, without replacing an existing backup. A hard link in the same
 * directory makes publication atomic; cleanup only removes this operation's temporary file.
 */
export const writeBackupArchive = async (outPath: string, bytes: Uint8Array): Promise<string> => {
  decodeBackupArchive(bytes);
  const path = resolve(outPath);
  await mkdir(dirname(path), { recursive: true });
  const temporary = join(dirname(path), `.figwright-backup-${randomUUID()}.tmp`);
  const handle = await open(temporary, 'wx');
  try {
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    await link(temporary, path);
  } finally {
    await handle.close();
    await unlink(temporary);
  }
  return path;
};

export const readBackupArchive = async (
  path: string,
): Promise<ReturnType<typeof decodeBackupArchive>> => {
  // readFile is bounded by the file handle's size before allocation, including files replaced or
  // grown while being read. Do not allocate an arbitrarily large user-selected archive.
  const handle = await open(path, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_BACKUP_ARCHIVE_BYTES)
      throw new Error('Invalid backup file or size');
    const bytes = Buffer.alloc(stat.size + 1);
    let count = 0;
    while (count < bytes.length) {
      // eslint-disable-next-line no-await-in-loop
      const { bytesRead } = await handle.read(bytes, count, bytes.length - count, count);
      if (bytesRead === 0) break;
      count += bytesRead;
    }
    if (count !== stat.size) throw new Error('Backup file changed while reading');
    return decodeBackupArchive(bytes.subarray(0, count));
  } finally {
    await handle.close();
  }
};
