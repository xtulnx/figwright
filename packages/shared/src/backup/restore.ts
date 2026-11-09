import { z } from 'zod';

import { planNativeBackupInstances } from './instances.js';
import { MAX_BACKUP_CAPTURE_CHARS } from './limits.js';
import { BackupSnapshotSchema } from './snapshot.js';

export const RestorePayloadSchema = z.strictObject({
  snapshot: BackupSnapshotSchema,
  images: z.record(z.string().min(1), z.string()),
  pageId: z.string().min(1).optional(),
  pageName: z.string().min(1).optional(),
  allowPartial: z.boolean(),
});
export type RestorePayload = z.infer<typeof RestorePayloadSchema>;

/** Staging never edits Figma; only commit does. Offsets make chunk retries idempotent. */
export const RestoreTransferRequestSchema = z.discriminatedUnion('mode', [
  z.strictObject({
    mode: z.literal('status'),
    restoreId: z.string().min(1).optional(),
    requestId: z.string().min(1).optional(),
  }),
  z.strictObject({
    mode: z.literal('cancel'),
    restoreId: z.string().min(1),
    requestId: z.string().min(1).optional(),
  }),
  z.strictObject({
    mode: z.literal('start'),
    requestId: z.string().min(1).optional(),
    totalChars: z.number().int().positive().max(MAX_BACKUP_CAPTURE_CHARS),
  }),
  z.strictObject({
    mode: z.literal('append'),
    requestId: z.string().min(1).optional(),
    restoreId: z.string().min(1),
    offset: z.number().int().nonnegative(),
    text: z.string().min(1).max(128_000),
  }),
  z.strictObject({
    mode: z.enum(['commit', 'release']),
    restoreId: z.string().min(1),
    requestId: z.string().min(1).optional(),
  }),
]);

export const RestoreResultSchema = z.strictObject({
  status: z.enum(['restored', 'partial']),
  nativeInstances: z.number().int().nonnegative().optional(),
  resources: z
    .strictObject({
      collections: z.array(z.string()),
      variables: z.array(z.string()),
      styles: z.array(z.string()),
    })
    .optional(),
  pages: z.array(z.strictObject({ sourceId: z.string(), nodeId: z.string(), name: z.string() })),
  nodes: z.number().int().nonnegative(),
  issueCount: z.number().int().nonnegative(),
  issues: z.array(
    z.strictObject({
      objectId: z.string().optional(),
      property: z.string().optional(),
      message: z.string(),
    }),
  ),
});
export type RestoreIssue = z.infer<typeof RestoreResultSchema>['issues'][number];

export const RESTORABLE_NODE_TYPES: ReadonlySet<string> = new Set([
  'PAGE',
  'FRAME',
  'RECTANGLE',
  'ELLIPSE',
  'LINE',
  'POLYGON',
  'STAR',
  'VECTOR',
  'TEXT',
  'COMPONENT',
  'SECTION',
  'GROUP',
  'INSTANCE',
]);

/** A topology-only preflight. Writable-property/font validation also runs inside the plugin. */
export const planBackupRestore = (
  snapshot: z.infer<typeof BackupSnapshotSchema>,
  pageId?: string,
) => {
  const roots = pageId === undefined ? snapshot.pageIds : [pageId];
  if (roots.some(id => !snapshot.pageIds.includes(id)))
    throw new Error('Restore pageId is not a page in this archive');
  const byId = new Map(snapshot.nodes.map(node => [node.id, node]));
  const pending = roots.toReversed();
  const nodes: typeof snapshot.nodes = [];
  while (pending.length) {
    const node = byId.get(pending.pop()!)!;
    nodes.push(node);
    for (let i = node.children.length - 1; i >= 0; i--) pending.push(node.children[i]!);
  }
  const selected = new Set(nodes.map(node => node.id));
  const instances = planNativeBackupInstances(snapshot, selected);
  const issues: RestoreIssue[] = snapshot.issues
    .filter(
      issue =>
        issue.objectId === undefined || !byId.has(issue.objectId) || selected.has(issue.objectId),
    )
    .map(issue => {
      const result: RestoreIssue = { message: `Capture ${issue.code}: ${issue.message}` };
      if (issue.objectId !== undefined) result.objectId = issue.objectId;
      if (issue.property !== undefined) result.property = issue.property;
      return result;
    });
  for (const node of nodes) {
    if (
      !RESTORABLE_NODE_TYPES.has(node.type) ||
      (node.type === 'INSTANCE' && !instances.native.has(node.id))
    )
      issues.push({
        objectId: node.id,
        message: `Unsupported ${node.type}${instances.unsupported.has(node.id) ? ` (${instances.unsupported.get(node.id)})` : ''}; partial restore uses a frame and loses native semantics.`,
      });
    for (const [property, value] of Object.entries(node.properties)) {
      if (value.state === 'unreadable')
        issues.push({ objectId: node.id, property, message: value.message });
    }
  }
  return {
    nodes,
    roots,
    issues,
    instances,
    unsupportedNodes: nodes.filter(
      node =>
        !RESTORABLE_NODE_TYPES.has(node.type) ||
        (node.type === 'INSTANCE' && !instances.native.has(node.id)),
    ).length,
  };
};

export const RestoreJobStatusSchema = z.strictObject({
  restoreId: z.string().min(1),
  state: z.enum(['running', 'completed', 'failed']),
  phase: z.string(),
  result: RestoreResultSchema.optional(),
  error: z.string().optional(),
});
