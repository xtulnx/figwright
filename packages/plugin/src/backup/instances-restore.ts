import type { BackupSnapshot } from '@figwright/shared';

/**
 * Verify identities and topology before touching inherited descendants. Positional matching alone
 * can attach overrides to the wrong repeated layer and is intentionally not used.
 */
export const mapBackupInstanceChildren = (
  source: BackupSnapshot['nodes'][number],
  instance: InstanceNode,
  sourceNodes: ReadonlyMap<string, BackupSnapshot['nodes'][number]>,
  restored: Map<string, PageNode | SceneNode>,
): Map<string, PageNode | SceneNode> => {
  const mapped = new Map<string, PageNode | SceneNode>([[source.id, instance]]);
  const pending: { source: BackupSnapshot['nodes'][number]; target: SceneNode }[] = [
    { source, target: instance },
  ];
  while (pending.length) {
    const pair = pending.pop()!;
    const children = 'children' in pair.target ? pair.target.children : [];
    if (pair.source.children.length !== children.length)
      throw new Error(`Instance child count differs: ${pair.source.id}`);
    for (const [index, id] of pair.source.children.entries()) {
      const child = sourceNodes.get(id)!;
      const target = children[index]!;
      const oldMainChildId = child.id.split(';').at(-1)!;
      const mainChild = restored.get(oldMainChildId);
      const newMainChildId = target.id.split(';').at(-1);
      if (!mainChild || mainChild.id !== newMainChildId || child.type !== target.type)
        throw new Error(`Instance descendant identity differs: ${child.id}`);
      mapped.set(child.id, target);
      pending.push({ source: child, target });
    }
  }
  return mapped;
};
