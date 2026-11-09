import { BACKUP_NODE_FIELDS } from './fields.js';
import type { BackupSnapshot } from './snapshot.js';

export interface NativeBackupInstance {
  mainId: string;
  overrides: Map<string, Set<string>>;
}
const raw = (node: BackupSnapshot['nodes'][number], key: string): unknown => {
  const property = node.properties[key];
  return property?.state === 'value' ? property.value : undefined;
};

/**
 * Native support is deliberately bounded: ordinary local components with no nested instances,
 * component properties or variant semantics. Every other case remains explicitly unsupported.
 */
export const planNativeBackupInstances = (
  snapshot: BackupSnapshot,
  selected: ReadonlySet<string>,
) => {
  const byId = new Map(snapshot.nodes.map(node => [node.id, node]));
  const native = new Map<string, NativeBackupInstance>();
  const unsupported = new Map<string, string>();
  const fields = new Set([...BACKUP_NODE_FIELDS, 'mainComponentId']);
  for (const source of snapshot.nodes) {
    if (source.type !== 'INSTANCE' || !selected.has(source.id)) continue;
    try {
      const mainId = raw(source, 'mainComponentId');
      const main = typeof mainId === 'string' ? byId.get(mainId) : undefined;
      if (!main || main.type !== 'COMPONENT' || !selected.has(main.id))
        throw new Error('main component is outside the selected archive scope');
      if (
        Object.keys((raw(main, 'componentPropertyDefinitions') ?? {}) as object).length ||
        Object.keys((raw(source, 'componentProperties') ?? {}) as object).length
      )
        throw new Error('component properties and variants are not supported yet');
      if (main.parentId && byId.get(main.parentId)?.type === 'COMPONENT_SET')
        throw new Error('variant sets are not supported yet');
      const pending = [...main.children];
      while (pending.length) {
        const child = byId.get(pending.pop()!)!;
        if (child.type === 'INSTANCE' || child.type === 'COMPONENT_SET')
          throw new Error('nested component instances are not supported yet');
        if (
          ![
            'FRAME',
            'RECTANGLE',
            'ELLIPSE',
            'LINE',
            'POLYGON',
            'STAR',
            'VECTOR',
            'TEXT',
            'SECTION',
            'GROUP',
          ].includes(child.type)
        )
          throw new Error(`Unsupported master child ${child.type}`);
        pending.push(...child.children);
      }
      const captured = raw(source, 'overrides');
      if (!Array.isArray(captured)) throw new Error('override metadata is missing');
      const descendants = new Set<string>();
      const stack = [source.id];
      while (stack.length) {
        const id = stack.pop()!;
        descendants.add(id);
        stack.push(...byId.get(id)!.children);
      }
      const overrides = new Map<string, Set<string>>();
      for (const item of captured) {
        if (
          !item ||
          typeof item !== 'object' ||
          typeof item.id !== 'string' ||
          !descendants.has(item.id) ||
          !Array.isArray(item.overriddenFields) ||
          item.overriddenFields.some(
            (field: unknown) => typeof field !== 'string' || !fields.has(field),
          )
        )
          throw new Error('unrecognized override metadata');
        const set = new Set(item.overriddenFields as string[]);
        if (set.has('width') !== set.has('height'))
          throw new Error('independent width/height override is not supported');
        for (const field of set)
          if (byId.get(item.id)!.properties[field]?.state === 'mixed')
            throw new Error('mixed range override intent cannot be reconstructed exactly');
        overrides.set(item.id, set);
      }
      native.set(source.id, { mainId: main.id, overrides });
    } catch (error) {
      unsupported.set(source.id, error instanceof Error ? error.message : String(error));
    }
  }
  return { native, unsupported };
};
