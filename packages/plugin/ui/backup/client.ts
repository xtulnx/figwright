import {
  BackupSnapshotSchema,
  BackupTransferStartSchema,
  BackupTransferChunkSchema,
  DEFAULT_BACKUP_CAPTURE_CHARS,
  MAX_BACKUP_CAPTURE_CHARS,
  collectBackupImages,
  planBackupRestore,
  RestorePayloadSchema,
  RestoreResultSchema,
  RestoreJobStatusSchema,
  backupBase64Encode,
  newId,
} from '@figwright/shared';
import { z } from 'zod';

import { encodePanelBackup, type decodePanelBackup } from './archive.js';

export type PanelArchive = Awaited<ReturnType<typeof decodePanelBackup>>;
export type LocalDispatch = (method: string, args: unknown) => Promise<unknown>;
export type BackupProgress = (message: string, percent?: number) => void;
export class LocalBackupCancelled extends Error {}
export class LocalRestoreUncertain extends Error {}
const check = (cancelled: () => boolean): void => {
  if (cancelled()) throw new LocalBackupCancelled('Cancelled');
};

/** Uses only the panel↔sandbox bridge. No relay, HTTP, AI, or MCP client participates. */
export const capturePanelBackup = async (
  dispatch: LocalDispatch,
  pageId: string,
  pluginVersion: string,
  progress: BackupProgress,
  cancelled: () => boolean,
) => {
  progress('Reading the page…');
  const start = BackupTransferStartSchema.parse(
    await dispatch('backup_design', {
      mode: 'start',
      pageId,
      maxChars: DEFAULT_BACKUP_CAPTURE_CHARS,
    }),
  );
  let snapshot: z.infer<typeof BackupSnapshotSchema>;
  try {
    check(cancelled);
    if (start.maxChars !== DEFAULT_BACKUP_CAPTURE_CHARS || start.totalChars > start.maxChars)
      throw new Error('Plugin did not honor the capture limit');
    const chunks: string[] = [];
    let offset = 0;
    while (offset < start.totalChars) {
      check(cancelled);
      const chunk = BackupTransferChunkSchema.parse(
        // eslint-disable-next-line no-await-in-loop
        await dispatch('backup_design', { mode: 'read', captureId: start.captureId, offset }),
      );
      if (
        chunk.captureId !== start.captureId ||
        chunk.offset !== offset ||
        chunk.text.length === 0 ||
        chunk.nextOffset !== offset + chunk.text.length ||
        chunk.nextOffset > start.totalChars ||
        chunk.done !== (chunk.nextOffset === start.totalChars)
      )
        throw new Error('Inconsistent backup transfer');
      chunks.push(chunk.text);
      offset = chunk.nextOffset;
      progress('Reading the page…', Math.round((offset / start.totalChars) * 100));
    }
    check(cancelled);
    snapshot = BackupSnapshotSchema.parse(JSON.parse(chunks.join('')));
    if (snapshot.pageIds.length !== 1 || snapshot.pageIds[0] !== pageId)
      throw new Error('Plugin did not capture the selected page');
  } finally {
    await dispatch('backup_design', { mode: 'release', captureId: start.captureId }).catch(
      () => {},
    );
  }
  check(cancelled);
  progress('Collecting original images…');
  const collected = await collectBackupImages(snapshot, async (method, args) => {
    check(cancelled);
    return dispatch(method, args);
  });
  check(cancelled);
  progress('Compressing and checking the backup…');
  const bytes = await encodePanelBackup(collected.snapshot, collected.images, pluginVersion);
  check(cancelled);
  return { bytes, snapshot: collected.snapshot, images: collected.images.size };
};

const startSchema = z.object({ restoreId: z.string().min(1), received: z.literal(0) });
const appendSchema = z.object({ received: z.number().int().nonnegative() });
const delay = () => new Promise<void>(resolve => setTimeout(resolve, 250));
const displayPhase = (phase: string): string =>
  phase.startsWith('font ') || phase.includes('font ')
    ? 'Loading fonts…'
    : phase === 'queued'
      ? 'Waiting for other edits…'
      : phase.startsWith('instance ') || phase.startsWith('override intent ')
        ? 'Rebuilding components and overrides…'
        : phase.endsWith('.reactions')
          ? 'Restoring interactions…'
          : 'Restoring layers and design resources…';

export const restorePanelBackup = async (
  dispatch: LocalDispatch,
  archive: PanelArchive,
  options: { pageId?: string; pageName?: string; allowPartial: boolean },
  progress: BackupProgress,
  cancelled: () => boolean,
  rememberJob: (id: string) => void,
) => {
  const plan = planBackupRestore(archive.snapshot, options.pageId);
  if (!options.allowPartial && plan.issues.length)
    throw new Error('Review the listed issues and explicitly allow a partial restore to proceed');
  check(cancelled);
  progress('Preparing the restore…');
  const payload = RestorePayloadSchema.parse({
    snapshot: archive.snapshot,
    images: Object.fromEntries(
      [...archive.images].map(([hash, bytes]) => [hash, backupBase64Encode(bytes)]),
    ),
    ...options,
  });
  const text = JSON.stringify(payload);
  if (text.length > MAX_BACKUP_CAPTURE_CHARS) throw new Error('Restore exceeds the transfer limit');
  const { restoreId } = startSchema.parse(
    await dispatch('restore_backup', { mode: 'start', totalChars: text.length }),
  );
  rememberJob(restoreId);
  let committed = false;
  let settled = false;
  try {
    let offset = 0;
    while (offset < text.length) {
      check(cancelled);
      let end = Math.min(offset + 128_000, text.length);
      const last = text.charCodeAt(end - 1);
      if (last >= 0xd800 && last <= 0xdbff) end--;
      const chunk = text.slice(offset, end);
      const reply = appendSchema.parse(
        // eslint-disable-next-line no-await-in-loop
        await dispatch('restore_backup', { mode: 'append', restoreId, offset, text: chunk }),
      );
      if (reply.received !== end) throw new Error('Inconsistent restore upload acknowledgment');
      offset = end;
      progress('Sending the backup to the canvas…', Math.round((offset / text.length) * 100));
    }
    check(cancelled);
    // Mark before sending: a lost reply must not be treated as proof that nothing was written.
    committed = true;
    let reply: unknown;
    try {
      reply = await dispatch('restore_backup', { mode: 'commit', restoreId, requestId: newId() });
    } catch {
      reply = await dispatch('restore_backup', { mode: 'status', restoreId });
    }
    const legacy = RestoreResultSchema.safeParse(reply);
    if (legacy.success) {
      settled = true;
      return legacy.data;
    }
    let job = RestoreJobStatusSchema.parse(reply);
    let cancelSent = false;
    while (job.state === 'running') {
      progress(cancelled() ? 'Cancelling and cleaning up…' : displayPhase(job.phase));
      if (cancelled() && !cancelSent) {
        // eslint-disable-next-line no-await-in-loop
        await dispatch('restore_backup', { mode: 'cancel', restoreId });
        cancelSent = true;
      }
      // eslint-disable-next-line no-await-in-loop
      await delay();
      job = RestoreJobStatusSchema.parse(
        // eslint-disable-next-line no-await-in-loop
        await dispatch('restore_backup', { mode: 'status', restoreId }),
      );
    }
    settled = true;
    if (job.state === 'failed') {
      if (cancelled() && job.error === 'Restore cancelled')
        throw new LocalBackupCancelled('Cancelled; newly created items were cleaned up');
      throw new Error(job.error ?? 'Restore failed');
    }
    return RestoreResultSchema.parse(job.result);
  } catch (error) {
    if (committed && !settled && !(error instanceof LocalBackupCancelled))
      throw new LocalRestoreUncertain(
        `${error instanceof Error ? error.message : String(error)}. Check the restore task before retrying (job ${restoreId}).`,
        { cause: error },
      );
    throw error;
  } finally {
    await dispatch('restore_backup', { mode: 'release', restoreId }).catch(() => {});
  }
};
