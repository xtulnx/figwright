import { ImageFillsResultSchema } from '../queries.js';
import { backupBinaryPayload } from './binary.js';
import { MAX_BACKUP_ARCHIVE_BYTES } from './limits.js';
import { type BackupSnapshot } from './snapshot.js';

/**
 * Inspect paints everywhere, including text runs and vector regions. Retrieval uses the existing
 * top-level-fill tool; a shared hash found there also satisfies nested/stroke usages elsewhere.
 */
const paints = (value: unknown): { hashes: Set<string>; video: boolean } => {
  const hashes = new Set<string>();
  let video = false;
  const pending = [value];
  while (pending.length > 0) {
    const item = pending.pop();
    if (item === null || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    if (record.type === 'IMAGE' && typeof record.imageHash === 'string')
      hashes.add(record.imageHash);
    if (record.type === 'VIDEO' || 'videoHash' in record) video = true;
    for (const child of Object.values(record)) pending.push(child);
  }
  return { hashes, video };
};

export const collectBackupImages = async (
  snapshot: BackupSnapshot,
  dispatch: (tool: string, args: unknown) => Promise<unknown>,
): Promise<{ snapshot: BackupSnapshot; images: Map<string, Uint8Array> }> => {
  const usage = new Map(snapshot.nodes.map(node => [node.id, paints(node.properties)]));
  for (const style of snapshot.definitions?.styles ?? [])
    usage.set(style.id, paints(style.properties));
  const sources = new Map<string, string[]>();
  for (const node of snapshot.nodes) {
    const fills = node.properties.fills;
    if (fills?.state !== 'value') continue;
    for (const hash of paints(fills.value).hashes) {
      const ids = sources.get(hash) ?? [];
      ids.push(node.id);
      sources.set(hash, ids);
    }
  }
  const images = new Map<string, Uint8Array>();
  const attempted = new Set<string>();
  let bytes = 0;
  for (const [hash, ids] of sources) {
    if (images.has(hash)) continue;
    for (const nodeId of ids) {
      if (attempted.has(nodeId)) continue;
      attempted.add(nodeId);
      try {
        const result = ImageFillsResultSchema.parse(
          // eslint-disable-next-line no-await-in-loop -- fall back to another source only on failure
          await dispatch('save_image_fills', { nodeIds: [nodeId], binary: true }),
        );
        for (const node of result.nodes) {
          if (node.nodeId !== nodeId) continue;
          for (const image of node.images) {
            if (
              image.imageHash === null ||
              !usage.get(nodeId)!.hashes.has(image.imageHash) ||
              images.has(image.imageHash)
            )
              continue;
            const data = backupBinaryPayload(image);
            if (data === null) continue;
            bytes += data.byteLength;
            if (bytes > MAX_BACKUP_ARCHIVE_BYTES)
              throw new RangeError('Original images exceed archive byte limit');
            images.set(image.imageHash, data);
          }
        }
      } catch (error) {
        if (error instanceof RangeError) throw error;
        // A removed source or an unavailable image can be retried from another captured usage.
      }
      if (images.has(hash)) break;
    }
  }
  const issues = snapshot.issues.filter(issue => {
    if (issue.code !== 'MEDIA_BYTES_NOT_CAPTURED' || issue.objectId === undefined) return true;
    const node = usage.get(issue.objectId);
    return node === undefined || node.video;
  });
  const missing = new Set<string>();
  for (const [nodeId, node] of usage) {
    for (const hash of node.hashes) {
      if (images.has(hash) || missing.has(hash)) continue;
      missing.add(hash);
      issues.push({
        code: 'IMAGE_BYTES_UNAVAILABLE',
        severity: 'missing',
        objectId: nodeId,
        message: `Original bytes unavailable for captured image hash ${hash}; nested/stroke-only fills may require a newer extraction path.`,
      });
    }
  }
  return { snapshot: { ...snapshot, issues }, images };
};
