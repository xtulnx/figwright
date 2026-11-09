import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

import {
  MAX_BACKUP_CAPTURE_CHARS,
  planBackupRestore,
  RestorePayloadSchema,
  RestoreResultSchema,
  RestoreJobStatusSchema,
} from '@figwright/shared';
import { z } from 'zod';

import { readBackupArchive } from '../backup/archive.js';
import type { ToolSpec } from './spec.js';

export const RESTORE_BACKUP_TOOL_NAME = 'restore_backup';
const inputSchema = z.object({
  path: z
    .string()
    .min(1)
    .optional()
    .describe('Local .figwright-backup archive; required for restore/preflight'),
  operation: z
    .enum(['restore', 'status', 'cancel'])
    .optional()
    .describe(
      'Default restore; status/cancel inspect or interrupt the existing restoreId without uploading again',
    ),
  restoreId: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Job ID returned by a running restore; required for cancel, omitted status checks the latest retained job',
    ),
  pageId: z
    .string()
    .min(1)
    .optional()
    .describe('Source page ID from the archive; omitted restores all captured pages'),
  pageName: z
    .string()
    .min(1)
    .optional()
    .describe('Name of new restored pages; defaults to original name with (restored)'),
  dryRun: z
    .boolean()
    .optional()
    .describe(
      'Default true: inspect topology and capture issues without editing Figma. Property/font checks run during actual restore.',
    ),
  allowPartial: z
    .boolean()
    .optional()
    .describe(
      'Default false: reject incomplete capture or any apply failure and remove newly created pages. True explicitly allows a partial result with reported issues.',
    ),
});
export const restoreBackupTool: ToolSpec = {
  name: RESTORE_BACKUP_TOOL_NAME,
  description:
    'EXPERIMENTAL: inspect or restore a custom backup into NEW pages of the connected Figma Design file. Never replaces existing pages. Default dryRun true performs local topology preflight only. Actual restore (dryRun false) supports common shapes, frames, groups, components and mixed text with original image bytes. Reachable variable collections, modes, aliases, styles and bindings are recreated with fresh IDs. Ordinary local instances preserve native component links and supported overrides; nested/variant/property-based instances, booleans and other unsupported types require allowPartial and lose native semantics. Some properties remain unsupported. Errors in strict mode remove created pages. Capture issues are retained; partial does not mean a faithful backup. Long restores return a running job and restoreId; use operation status to follow it or cancel to interrupt pending API waits and clean up. Do not upload a duplicate job after a timeout.',
  inputSchema,
  kind: 'write',
  serverOnlyArgs: [
    'path',
    'pageId',
    'pageName',
    'dryRun',
    'allowPartial',
    'operation',
    'restoreId',
  ],
  injectedArgs: ['mode', 'restoreId', 'totalChars', 'offset', 'text', 'requestId'],
};
const startedSchema = z.object({ restoreId: z.string().min(1), received: z.literal(0) });
const appendedSchema = z.object({ received: z.number().int().nonnegative() });

export const handleRestoreBackup = async (
  dispatch: (tool: string, args: unknown) => Promise<unknown>,
  raw: unknown,
) => {
  const args = inputSchema.parse(raw);
  if (args.operation === 'status' || args.operation === 'cancel') {
    if (args.operation === 'cancel' && !args.restoreId)
      throw new Error('restoreId is required for cancel');
    return RestoreJobStatusSchema.parse(
      await dispatch(RESTORE_BACKUP_TOOL_NAME, {
        mode: args.operation,
        ...(args.restoreId === undefined ? {} : { restoreId: args.restoreId }),
      }),
    );
  }
  if (!args.path) throw new Error('path is required for restore/preflight');
  const { snapshot, images } = await readBackupArchive(args.path);
  const plan = planBackupRestore(snapshot, args.pageId);
  if (args.dryRun !== false)
    return {
      status: 'preflight',
      propertyValidation: 'pending',
      unsupportedNodes: plan.unsupportedNodes,
      pages: plan.roots,
      nodes: plan.nodes.length,
      issueCount: plan.issues.length,
      issues: plan.issues.slice(0, 100),
    };
  if (!args.allowPartial && plan.issues.length)
    throw new Error(
      'Restore preflight found incomplete capture or unsupported nodes; inspect issues before explicitly enabling allowPartial',
    );
  const payload = RestorePayloadSchema.parse({
    snapshot: { ...snapshot, nodes: plan.nodes, pageIds: plan.roots },
    images: Object.fromEntries(
      [...images].map(([hash, bytes]) => [hash, Buffer.from(bytes).toString('base64')]),
    ),
    pageId: args.pageId,
    pageName: args.pageName,
    allowPartial: args.allowPartial ?? false,
  });
  const text = JSON.stringify(payload);
  if (text.length > MAX_BACKUP_CAPTURE_CHARS)
    throw new Error('Restore payload exceeds transfer budget');
  const { restoreId } = startedSchema.parse(
    await dispatch(RESTORE_BACKUP_TOOL_NAME, { mode: 'start', totalChars: text.length }),
  );
  try {
    let offset = 0;
    while (offset < text.length) {
      let end = Math.min(offset + 128_000, text.length);
      const code = text.charCodeAt(end - 1);
      if (code >= 0xd800 && code <= 0xdbff) end--;
      const chunk = text.slice(offset, end);
      const response = appendedSchema.parse(
        // eslint-disable-next-line no-await-in-loop
        await dispatch(RESTORE_BACKUP_TOOL_NAME, {
          mode: 'append',
          restoreId,
          offset,
          text: chunk,
        }),
      );
      if (response.received !== end)
        throw new Error('Restore plugin acknowledged an inconsistent offset');
      offset = end;
    }
    const committed = await dispatch(RESTORE_BACKUP_TOOL_NAME, {
      mode: 'commit',
      restoreId,
      requestId: randomUUID(),
    });
    // Old development builds return the final result directly; current plugins return a job.
    const legacy = RestoreResultSchema.safeParse(committed);
    if (legacy.success) return legacy.data;
    let job = RestoreJobStatusSchema.parse(committed);
    for (let count = 0; count < 50 && job.state === 'running'; count++) {
      job = RestoreJobStatusSchema.parse(
        // eslint-disable-next-line no-await-in-loop
        await dispatch(RESTORE_BACKUP_TOOL_NAME, { mode: 'status', restoreId }),
      );
      // eslint-disable-next-line no-await-in-loop
      if (job.state === 'running') await delay(200);
    }
    if (job.state === 'completed') return RestoreResultSchema.parse(job.result);
    if (job.state === 'failed')
      throw new Error(`Restore job ${restoreId} failed: ${job.error ?? 'unknown error'}`);
    return job;
  } finally {
    await dispatch(RESTORE_BACKUP_TOOL_NAME, { mode: 'release', restoreId }).catch(() => {});
  }
};
