import {
  decodeBackupContainer,
  encodeBackupContainer,
  MAX_BACKUP_ARCHIVE_BYTES,
  type BackupSnapshot,
} from '@figwright/shared';

/** Bound expanded output before concatenation; native streams run only in the panel. */
const gzip = async (
  bytes: Uint8Array,
  decompress: boolean,
  maxBytes = MAX_BACKUP_ARCHIVE_BYTES,
): Promise<Uint8Array> => {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || maxBytes > MAX_BACKUP_ARCHIVE_BYTES)
    throw new RangeError('Invalid backup archive byte limit');
  if (bytes.byteLength > maxBytes) throw new Error('Backup exceeds the 256 MiB limit');
  if (typeof CompressionStream === 'undefined' || typeof DecompressionStream === 'undefined')
    throw new Error('This Figma browser does not support local gzip. Update Figma and try again.');
  const stream = new Blob([new Uint8Array(bytes).buffer])
    .stream()
    .pipeThrough(decompress ? new DecompressionStream('gzip') : new CompressionStream('gzip'));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      // eslint-disable-next-line no-await-in-loop
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > maxBytes) throw new Error('Expanded backup exceeds the 256 MiB limit');
      chunks.push(chunk.value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
};
export const encodePanelBackup = async (
  snapshot: BackupSnapshot,
  images: ReadonlyMap<string, Uint8Array>,
  pluginVersion: string,
): Promise<Uint8Array> =>
  gzip(encodeBackupContainer(snapshot, 'standalone-plugin', images, pluginVersion), false);
export const decodePanelBackup = async (
  bytes: Uint8Array,
  maxBytes = MAX_BACKUP_ARCHIVE_BYTES,
): Promise<ReturnType<typeof decodeBackupContainer>> =>
  decodeBackupContainer(await gzip(bytes, true, maxBytes), maxBytes);
