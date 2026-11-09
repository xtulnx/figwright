import { z } from 'zod';

import { BackupDefinitionsSchema } from './definitions.js';

/**
 * Raw API values, without codegen rounding, token resolution or deduplication. A tagged wrapper
 * distinguishes Figma's mixed symbol from an actual string or object with the same spelling.
 */
export const BackupSnapshotSchema = z
  .strictObject({
    captureVersion: z.literal(1),
    definitions: BackupDefinitionsSchema.optional(),
    images: z.record(z.string().min(1), z.string().min(1)).optional(),
    source: z.strictObject({ name: z.string(), editorType: z.literal('figma') }),
    nodes: z.array(
      z.strictObject({
        id: z.string().min(1),
        type: z.string().min(1),
        parentId: z.string().nullable(),
        children: z.array(z.string()),
        properties: z.record(
          z.string(),
          z.discriminatedUnion('state', [
            z.strictObject({ state: z.literal('value'), value: z.json() }),
            z.strictObject({ state: z.literal('mixed') }),
            z.strictObject({ state: z.literal('unreadable'), message: z.string() }),
          ]),
        ),
      }),
    ),
    pageIds: z.array(z.string()),
    issues: z.array(
      z.strictObject({
        code: z.string(),
        severity: z.enum(['unsupported', 'missing', 'unknown']),
        message: z.string(),
        objectId: z.string().optional(),
        property: z.string().optional(),
      }),
    ),
  })
  .superRefine((snapshot, ctx) => {
    const ids = new Map(snapshot.nodes.map(node => [node.id, node]));
    const bad = (message: string): void => ctx.addIssue({ code: 'custom', message });
    if (ids.size !== snapshot.nodes.length) bad('Duplicate node id');
    if (new Set(snapshot.pageIds).size !== snapshot.pageIds.length) bad('Duplicate page id');
    const pages = new Set(snapshot.pageIds);
    for (const id of pages) {
      const page = ids.get(id);
      if (page?.type !== 'PAGE' || page.parentId !== null) bad(`Invalid page ${id}`);
    }
    for (const node of snapshot.nodes) {
      if (new Set(node.children).size !== node.children.length)
        bad(`Duplicate children on ${node.id}`);
      if (node.type === 'PAGE' ? !pages.has(node.id) : node.parentId === null)
        bad(`Orphan node ${node.id}`);
      if (node.parentId !== null && !ids.get(node.parentId)?.children.includes(node.id))
        bad(`Invalid parent of ${node.id}`);
      for (const child of node.children) {
        if (ids.get(child)?.parentId !== node.id) bad(`Invalid child ${child} on ${node.id}`);
      }
    }
    // Iterative traversal catches isolated cycles and avoids recursion on deeply nested files.
    const reached = new Set<string>();
    const pending = [...pages];
    while (pending.length > 0) {
      const id = pending.pop()!;
      if (reached.has(id)) {
        bad(`Cycle or repeated child ${id}`);
        continue;
      }
      reached.add(id);
      pending.push(...(ids.get(id)?.children ?? []));
    }
    if (reached.size !== ids.size) bad('Unreachable nodes');
  });

export type BackupSnapshot = z.infer<typeof BackupSnapshotSchema>;
