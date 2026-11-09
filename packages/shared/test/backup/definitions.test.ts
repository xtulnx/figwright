import { describe, expect, it } from 'vitest';

import { BackupDefinitionsSchema } from '../../src/backup/definitions.js';
import { planBackupRestore } from '../../src/backup/restore.js';
import type { BackupSnapshot } from '../../src/backup/snapshot.js';

const definitions = () => ({
  collections: [
    {
      id: 'c',
      name: 'Theme',
      defaultModeId: 'm',
      modes: [{ modeId: 'm', name: 'Default' }],
      hiddenFromPublishing: false,
    },
  ],
  variables: [
    {
      id: 'v',
      name: 'Size',
      collectionId: 'c',
      resolvedType: 'FLOAT',
      valuesByMode: { m: 0.123456789 },
      description: '',
      scopes: ['ALL_SCOPES'],
      codeSyntax: {},
      hiddenFromPublishing: false,
    },
  ],
  styles: [],
});
describe('backup definition graph', () => {
  it('retains precision and rejects duplicate identities, missing collections and dangling modes', () => {
    expect(BackupDefinitionsSchema.parse(definitions()).variables[0]!.valuesByMode.m).toBe(
      0.123456789,
    );
    const duplicate = definitions();
    duplicate.variables.push(duplicate.variables[0]!);
    expect(BackupDefinitionsSchema.safeParse(duplicate).success).toBe(false);
    const absent = definitions();
    absent.collections = [];
    expect(BackupDefinitionsSchema.safeParse(absent).success).toBe(false);
    const mode = definitions();
    mode.collections[0]!.defaultModeId = 'missing';
    expect(BackupDefinitionsSchema.safeParse(mode).success).toBe(false);
    const values = definitions();
    values.variables[0]!.valuesByMode = { other: 1 } as unknown as { m: number };
    expect(BackupDefinitionsSchema.safeParse(values).success).toBe(false);
  });
});
const instanceSnapshot = (): BackupSnapshot => ({
  captureVersion: 1,
  source: { name: 'F', editorType: 'figma' },
  pageIds: ['p'],
  issues: [],
  nodes: [
    { id: 'p', type: 'PAGE', parentId: null, children: ['c', 'i'], properties: {} },
    {
      id: 'c',
      type: 'COMPONENT',
      parentId: 'p',
      children: [],
      properties: { componentPropertyDefinitions: { state: 'value', value: {} } },
    },
    {
      id: 'i',
      type: 'INSTANCE',
      parentId: 'p',
      children: [],
      properties: {
        mainComponentId: { state: 'value', value: 'c' },
        overrides: { state: 'value', value: [] },
      },
    },
  ],
});
describe('native instance preflight', () => {
  it('accepts ordinary local instances but refuses missing masters or override metadata', () => {
    const source = instanceSnapshot();
    expect(planBackupRestore(source).unsupportedNodes).toBe(0);
    delete source.nodes[2]!.properties.overrides;
    expect(planBackupRestore(source).issues[0]!.message).toContain('override metadata');
  });
  it('refuses variant/property/nested semantics rather than advertising native restore', () => {
    const source = instanceSnapshot();
    source.nodes[1]!.properties.componentPropertyDefinitions = {
      state: 'value',
      value: { text: { type: 'TEXT', defaultValue: '' } },
    };
    expect(planBackupRestore(source).unsupportedNodes).toBe(1);
    source.nodes[1]!.properties.componentPropertyDefinitions = { state: 'value', value: {} };
    source.nodes[1]!.children = ['nested'];
    source.nodes.push({ ...source.nodes[2]!, id: 'nested', parentId: 'c' });
    expect(planBackupRestore(source).instances.unsupported.get('i')).toContain('nested');
  });
});
