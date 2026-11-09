import {
  MAX_BACKUP_ARCHIVE_BYTES,
  planBackupRestore,
  RestoreJobStatusSchema,
  RestoreResultSchema,
} from '@figwright/shared';
import { computed, reactive, type Ref, onScopeDispose } from 'vue';
import type { z } from 'zod';

import type { PluginContextEvent } from '../../protocol/bridge.js';
import { decodePanelBackup } from '../backup/archive.js';
import {
  capturePanelBackup,
  restorePanelBackup,
  LocalBackupCancelled,
  LocalRestoreUncertain,
  type PanelArchive,
  type LocalDispatch,
} from '../backup/client.js';
import { text, t, type UiText } from '../lib/i18n.js';

export const useBackup = (
  dispatch: LocalDispatch,
  context: Ref<PluginContextEvent | null>,
  version: string,
) => {
  let archive: PanelArchive | null = null;
  let downloadBytes: Uint8Array | null = null;
  let downloadUrl: string | null = null;
  let downloadName = '';
  let cancelled = false;
  const state = reactive({
    busy: false,
    phase: '',
    percent: null as number | null,
    error: '',
    message: '' as UiText,
    restoreOutcome: '',
    revision: 0,
    fileName: '',
    selectedPage: '',
    pageName: '',
    allowPartial: false,
    jobId: '',
    uncertainJob: false,
    downloadReady: false,
    downloadFileName: '',
    exportedIssues: 0,
    exportedIssueList: [] as { code: string; message: string }[],
    pages: [] as { id: string; name: string }[],
    result: null as z.infer<typeof RestoreResultSchema> | null,
  });
  const messageText = computed(() =>
    typeof state.message === 'string'
      ? text(state.message)
      : t(state.message.key, { ...state.message.values, outcome: t(state.restoreOutcome) }),
  );
  const canUse = computed(() => context.value?.editorType === 'figma');
  const plan = computed(() => {
    void state.revision;
    if (!archive) return null;
    const result = planBackupRestore(archive.snapshot, state.selectedPage || undefined);
    return {
      nodes: result.nodes,
      roots: result.roots,
      issues: result.issues,
      unsupportedNodes: result.unsupportedNodes,
    };
  });
  const progress = (message: string, percent?: number): void => {
    state.phase = message;
    state.percent = percent ?? null;
  };
  const releaseDownload = (): void => {
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    downloadUrl = null;
    downloadBytes = null;
    state.downloadReady = false;
    state.downloadFileName = '';
    state.exportedIssues = 0;
    state.exportedIssueList = [];
  };
  const start = (): void => {
    state.busy = true;
    cancelled = false;
    state.error = '';
    state.message = '';
    state.restoreOutcome = '';
    state.result = null;
    state.percent = null;
  };
  const finishError = (error: unknown): void => {
    if (error instanceof LocalBackupCancelled) state.message = error.message;
    else state.error = (error instanceof Error ? error.message : String(error)).slice(0, 1600);
  };
  const exportPage = async (): Promise<void> => {
    if (state.busy || !canUse.value || !context.value || state.uncertainJob) return;
    const pageId = context.value.pageId;
    start();
    releaseDownload();
    try {
      const result = await capturePanelBackup(dispatch, pageId, version, progress, () => cancelled);
      downloadBytes = result.bytes;
      const page = result.snapshot.nodes.find(node => node.id === pageId)?.properties.name;
      const name =
        `${result.snapshot.source.name}-${page?.state === 'value' ? String(page.value) : 'page'}-${Date.now()}`
          // eslint-disable-next-line no-control-regex -- filenames must not contain ASCII control characters
          .replace(/[<>:"/\\|?*\u0000-\u001f]/gu, '_')
          .slice(0, 160);
      downloadName = `${name}.figwright-backup`;
      state.downloadFileName = downloadName;
      state.downloadReady = true;
      state.exportedIssues = result.snapshot.issues.length;
      state.exportedIssueList = result.snapshot.issues;
      state.message = {
        key: 'Ready to download · {nodes} nodes · {images} images',
        values: { nodes: result.snapshot.nodes.length, images: result.images },
      };
    } catch (error) {
      finishError(error);
    } finally {
      state.busy = false;
      state.percent = null;
    }
  };
  const download = (): void => {
    if (!downloadBytes || state.busy) return;
    try {
      if (!downloadUrl)
        downloadUrl = URL.createObjectURL(
          new Blob([new Uint8Array(downloadBytes).buffer], { type: 'application/octet-stream' }),
        );
      const anchor = document.createElement('a');
      anchor.href = downloadUrl;
      anchor.download = downloadName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      state.message = 'Download requested. Check your downloads.';
    } catch (error) {
      finishError(error);
    }
  };
  const load = async (file: File): Promise<void> => {
    if (state.busy || state.uncertainJob) return;
    start();
    archive = null;
    state.pages = [];
    state.fileName = '';
    state.revision++;
    state.allowPartial = false;
    progress('Checking the backup…');
    try {
      if (file.size > MAX_BACKUP_ARCHIVE_BYTES)
        throw new Error('Backup exceeds the 256 MiB file limit');
      const result = await decodePanelBackup(new Uint8Array(await file.arrayBuffer()));
      if (cancelled) throw new LocalBackupCancelled('Cancelled');
      if (!result.snapshot.pageIds.length) throw new Error('Backup has no pages to restore');
      archive = result;
      state.fileName = file.name;
      const nodes = new Map(result.snapshot.nodes.map(node => [node.id, node]));
      state.pages = result.snapshot.pageIds.map(id => {
        const name = nodes.get(id)?.properties.name;
        return { id, name: name?.state === 'value' ? String(name.value) : id };
      });
      state.selectedPage = state.pages[0]?.id ?? '';
      state.pageName = '';
      state.revision++;
      state.message = 'Archive integrity verified. Review coverage before restoring.';
    } catch (error) {
      finishError(error);
    } finally {
      state.busy = false;
      state.percent = null;
    }
  };
  const restore = async (): Promise<void> => {
    if (state.busy || !archive || !canUse.value || state.uncertainJob) return;
    start();
    state.jobId = '';
    try {
      state.result = await restorePanelBackup(
        dispatch,
        archive,
        {
          ...(state.selectedPage ? { pageId: state.selectedPage } : {}),
          ...(state.pageName.trim() ? { pageName: state.pageName.trim() } : {}),
          allowPartial: state.allowPartial,
        },
        progress,
        () => cancelled,
        id => {
          state.jobId = id;
        },
      );
      state.message = {
        key: 'Created {pages} new page(s) · {nodes} nodes. {outcome}',
        values: { pages: state.result.pages.length, nodes: state.result.nodes },
      };
      state.restoreOutcome =
        state.result.status === 'partial'
          ? 'Partial restore — review the report.'
          : 'Restore finished.';
    } catch (error) {
      finishError(error);
      // A transport error can hide a still-running task. Prevent another upload until checked.
      if (error instanceof LocalRestoreUncertain) state.uncertainJob = true;
    } finally {
      state.busy = false;
      state.percent = null;
    }
  };
  const checkJob = async (cancel = false): Promise<void> => {
    if (!state.jobId || state.busy) return;
    start();
    try {
      const job = RestoreJobStatusSchema.parse(
        await dispatch('restore_backup', {
          mode: cancel ? 'cancel' : 'status',
          restoreId: state.jobId,
        }),
      );
      state.uncertainJob = job.state === 'running';
      if (job.state === 'completed') {
        state.result = RestoreResultSchema.parse(job.result);
        state.message = 'Restore finished. Review the report.';
      } else if (job.state === 'failed') {
        state.error = job.error ?? 'Restore failed';
      } else
        state.message = cancel
          ? 'Cancellation requested. Check the task until cleanup finishes.'
          : 'Restore is still running. Keep the plugin open and check again.';
    } catch (error) {
      finishError(error);
      state.uncertainJob = true;
    } finally {
      state.busy = false;
    }
  };
  onScopeDispose(releaseDownload);
  return {
    state,
    messageText,
    plan,
    canUse,
    exportPage,
    download,
    load,
    restore,
    checkJob,
    cancel: () => {
      cancelled = true;
      progress('Cancelling…');
    },
    report: () =>
      JSON.stringify(
        {
          sourceFile: state.fileName,
          captureIssues: archive?.manifest.issues,
          exportIssues: state.exportedIssueList,
          preflight: plan.value
            ? {
                nodes: plan.value.nodes.length,
                unsupportedNodes: plan.value.unsupportedNodes,
                issues: plan.value.issues,
              }
            : null,
          restore: state.result,
          error: state.error,
          jobId: state.jobId,
        },
        null,
        2,
      ),
  };
};
export type BackupController = ReturnType<typeof useBackup>;
