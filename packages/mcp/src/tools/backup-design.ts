import {
  BackupSnapshotSchema,
  BackupTransferStartSchema,
  BackupTransferChunkSchema,
  DEFAULT_BACKUP_CAPTURE_CHARS,
  MAX_BACKUP_CAPTURE_CHARS,
} from '@figwright/shared';
import { z } from 'zod';

import { encodeBackupArchive, writeBackupArchive } from '../backup/archive.js';
import { collectBackupImages } from '../backup/images.js';
import type { ToolSpec } from './spec.js';

export const BACKUP_DESIGN_TOOL_NAME = 'backup_design';
const inputSchema = z.object({
  pageId: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Capture only this page; omitted captures all pages. External dependencies are reported as incomplete.',
    ),
  outPath: z
    .string()
    .min(1)
    .describe('New .figwright-backup file path; existing files are never replaced'),
  maxCaptureChars: z
    .number()
    .int()
    .positive()
    .max(MAX_BACKUP_CAPTURE_CHARS)
    .optional()
    .describe(
      'Total capture budget in JSON UTF-16 code units; default 128000000, maximum 256000000. Independent of 128000-character transfer chunks.',
    ),
});

export const backupDesignTool: ToolSpec = {
  name: BACKUP_DESIGN_TOOL_NAME,
  description:
    'EXPERIMENTAL, INCOMPLETE: capture selected or all pages into a custom local .figwright-backup snapshot. ' +
    'Preserves raw captured properties and text runs without codegen rounding. Includes resolvable original IMAGE bytes, deduplicated by content; ' +
    'unavailable and nested/stroke-only image sources are reported. Includes reachable raw variable/style definitions. Video, animation definitions, extended collections and unlisted properties remain incomplete; this cannot replace a complete design backup. ' +
    'restore_backup can recreate supported nodes on new pages; full fidelity is not yet guaranteed. Fails on detected document changes, over 50000 nodes, the maxCaptureChars budget or the 256 MiB container limit. ' +
    'Reads without switching pages or editing designs. Returns path, node/page counts, status: incomplete and up to 50 missing-coverage issues (the archive keeps all). ' +
    'Requires both server and plugin builds supporting configurable capture budgets; reload the plugin after updating. Older builds reject the new maxChars argument or return METHOD_NOT_FOUND.',
  inputSchema,
  kind: 'local',
  serverOnlyArgs: ['outPath', 'maxCaptureChars'],
  injectedArgs: ['mode', 'captureId', 'offset', 'maxChars'],
};

export const handleBackupDesign = async (
  dispatch: (tool: string, args: unknown) => Promise<unknown>,
  rawArgs: unknown,
  serverVersion: string,
): Promise<{
  path: string;
  status: 'incomplete';
  pages: number;
  nodes: number;
  issueCount: number;
  capturedChars: number;
  captureBudget: number;
  imageAssets: number;
  variableDefinitions: number;
  styleDefinitions: number;
  issues: z.infer<typeof BackupSnapshotSchema>['issues'];
}> => {
  const args = inputSchema.parse(rawArgs);
  const maxChars = args.maxCaptureChars ?? DEFAULT_BACKUP_CAPTURE_CHARS;
  const start = BackupTransferStartSchema.safeParse(
    await dispatch(BACKUP_DESIGN_TOOL_NAME, {
      mode: 'start',
      maxChars,
      ...(args.pageId === undefined ? {} : { pageId: args.pageId }),
    }),
  );
  if (!start.success)
    throw new Error(
      'backup_design: chunked transfer v1 unavailable; reload the current development plugin',
    );
  const { captureId, totalChars } = start.data;
  const chunks: string[] = [];
  let offset = 0;
  let snapshot: z.infer<typeof BackupSnapshotSchema>;
  try {
    if (start.data.maxChars !== maxChars || totalChars > maxChars)
      throw new Error(
        'backup_design: plugin did not honor capture budget; reload the development plugin',
      );
    while (offset < totalChars) {
      const chunk = BackupTransferChunkSchema.parse(
        // eslint-disable-next-line no-await-in-loop -- each chunk supplies the next offset
        await dispatch(BACKUP_DESIGN_TOOL_NAME, { mode: 'read', captureId, offset }),
      );
      if (
        chunk.captureId !== captureId ||
        chunk.offset !== offset ||
        chunk.nextOffset !== offset + chunk.text.length ||
        chunk.nextOffset > totalChars ||
        chunk.done !== (chunk.nextOffset === totalChars)
      ) {
        throw new Error('backup_design: inconsistent chunk; no backup was written');
      }
      chunks.push(chunk.text);
      offset = chunk.nextOffset;
    }
    snapshot = BackupSnapshotSchema.parse(JSON.parse(chunks.join('')));
    if (
      args.pageId !== undefined &&
      (snapshot.pageIds.length !== 1 || snapshot.pageIds[0] !== args.pageId)
    )
      throw new Error(
        'backup_design: plugin did not honor pageId; reload the current plugin; no backup was written',
      );
  } finally {
    // A failed transfer must not reserve the plugin indefinitely. Expiry also bounds abandoned
    // captures when the server disconnects before this best-effort release can reach the plugin.
    await dispatch(BACKUP_DESIGN_TOOL_NAME, { mode: 'release', captureId }).catch(() => {});
  }
  const collected = await collectBackupImages(snapshot, dispatch);
  snapshot = collected.snapshot;
  const path = await writeBackupArchive(
    args.outPath,
    encodeBackupArchive(snapshot, serverVersion, collected.images),
  );
  return {
    path,
    status: 'incomplete',
    pages: snapshot.pageIds.length,
    nodes: snapshot.nodes.length,
    issueCount: snapshot.issues.length,
    capturedChars: totalChars,
    captureBudget: maxChars,
    imageAssets: collected.images.size,
    variableDefinitions: snapshot.definitions?.variables.length ?? 0,
    styleDefinitions: snapshot.definitions?.styles.length ?? 0,
    issues: snapshot.issues.slice(0, 50),
  };
};
