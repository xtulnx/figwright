import { type BackupDefinitions, type BackupSnapshot, type RestoreIssue } from '@figwright/shared';
import { describe, expect, it, vi } from 'vitest';

import { captureBackupDefinitions } from '../../src/backup/definitions-capture.js';
import {
  createRestoredDefinitions,
  remapBackupAliases,
  restoreBackupDefinitions,
} from '../../src/backup/definitions-restore.js';

const definitions = (): BackupDefinitions => ({
  collections: [
    {
      id: 'c',
      name: 'Theme',
      defaultModeId: 'light',
      modes: [
        { modeId: 'light', name: 'Light' },
        { modeId: 'dark', name: 'Dark' },
      ],
      hiddenFromPublishing: true,
    },
    {
      id: 'other',
      name: 'Primitives',
      defaultModeId: 'base',
      modes: [{ modeId: 'base', name: 'Base' }],
      hiddenFromPublishing: false,
    },
  ],
  variables: [
    {
      id: 'alias',
      name: 'Background',
      collectionId: 'c',
      resolvedType: 'COLOR',
      valuesByMode: {
        light: { type: 'VARIABLE_ALIAS', id: 'color' },
        dark: { color: { type: 'VARIABLE_ALIAS', id: 'color' }, opacity: 0.5 },
      },
      description: '精确颜色',
      scopes: ['ALL_SCOPES'],
      codeSyntax: { WEB: '--surface' },
      hiddenFromPublishing: false,
    },
    {
      id: 'color',
      name: 'Primary',
      collectionId: 'other',
      resolvedType: 'COLOR',
      valuesByMode: { base: { r: 0.123456789, g: 0.25, b: 0.5, a: 0.75 } },
      description: '',
      scopes: ['ALL_SCOPES'],
      codeSyntax: {},
      hiddenFromPublishing: false,
    },
  ],
  styles: [
    {
      id: 's',
      type: 'PAINT',
      properties: {
        name: 'Surface',
        description: '原始精度',
        paints: [
          {
            type: 'SOLID',
            color: { r: 0.123456789, g: 0.25, b: 0.5 },
            boundVariables: { color: { type: 'VARIABLE_ALIAS', id: 'alias' } },
          },
        ],
      },
    },
  ],
});
const captureFixture = () => {
  const defs = definitions();
  const collectionTable = new Map(defs.collections.map(c => [c.id, { ...c, isExtension: false }]));
  const variableTable = new Map(
    defs.variables.map(v => [v.id, { ...v, variableCollectionId: v.collectionId }]),
  );
  const styleTable = new Map(
    defs.styles.map(s => [s.id, { id: s.id, type: s.type, ...s.properties }]),
  );
  const ctx = {
    variables: {
      getVariableByIdAsync: vi.fn<(id: string) => Promise<unknown>>(
        async id => variableTable.get(id) ?? null,
      ),
      getVariableCollectionByIdAsync: vi.fn<(id: string) => Promise<unknown>>(
        async id => collectionTable.get(id) ?? null,
      ),
    },
    getStyleByIdAsync: vi.fn<(id: string) => Promise<unknown>>(
      async id => styleTable.get(id) ?? null,
    ),
  };
  const snapshot: BackupSnapshot = {
    captureVersion: 1,
    source: { name: 'Design', editorType: 'figma' },
    pageIds: ['p'],
    nodes: [
      {
        id: 'p',
        type: 'PAGE',
        parentId: null,
        children: [],
        properties: {
          fillStyleId: { state: 'value', value: 's' },
          explicitVariableModes: { state: 'value', value: { c: 'dark' } },
        },
      },
    ],
    issues: [],
  };
  return { ctx: ctx as unknown as typeof figma, api: ctx, snapshot, collectionTable };
};
const restoreFixture = () => {
  let next = 0;
  const resources: { id: string; removed: boolean; remove(): void }[] = [];
  const resource = () => {
    const r = {
      id: `new:${++next}`,
      removed: false,
      remove() {
        r.removed = true;
      },
    };
    resources.push(r);
    return r;
  };
  const collections: ReturnType<typeof createCollection>[] = [];
  const createCollection = (name: string) => {
    const c = {
      ...resource(),
      name,
      hiddenFromPublishing: false,
      defaultModeId: `mode:${++next}`,
      modes: [] as { modeId: string; name: string }[],
      renameMode(id: string, value: string) {
        const mode = this.modes.find(m => m.modeId === id)!;
        mode.name = value;
      },
      addMode(value: string) {
        const mode = { modeId: `mode:${++next}`, name: value };
        this.modes.push(mode);
        return mode.modeId;
      },
    };
    c.modes.push({ modeId: c.defaultModeId, name: 'Mode 1' });
    return c;
  };
  const variables: ReturnType<typeof createVariable>[] = [];
  const createVariable = (name: string, collection: { id: string }, resolvedType: string) => {
    const v = {
      ...resource(),
      name,
      variableCollectionId: collection.id,
      resolvedType,
      description: '',
      hiddenFromPublishing: false,
      scopes: [] as string[],
      codeSyntax: {} as Record<string, string>,
      valuesByMode: {} as Record<string, unknown>,
      setValueForMode(mode: string, value: unknown) {
        this.valuesByMode[mode] = value;
      },
      setVariableCodeSyntax(platform: string, syntax: string) {
        this.codeSyntax[platform] = syntax;
      },
    };
    return v;
  };
  const styles: ReturnType<typeof createStyle>[] = [];
  const createStyle = () => {
    const s = { ...resource(), name: '', description: '', paints: [] };
    return s;
  };
  const ctx = {
    variables: {
      createVariableCollection: (name: string) => {
        const c = createCollection(name);
        collections.push(c);
        return c;
      },
      createVariable: (name: string, collection: { id: string }, type: string) => {
        const v = createVariable(name, collection, type);
        variables.push(v);
        return v;
      },
    },
    loadFontAsync: vi.fn<(font: unknown) => Promise<void>>(async () => {}),
    createTextStyle: () => {
      const s = { ...createStyle(), fontName: { family: 'Inter', style: 'Regular' }, fontSize: 12 };
      styles.push(s);
      return s;
    },
    createPaintStyle: () => {
      const s = createStyle();
      styles.push(s);
      return s;
    },
  };
  return {
    ctx: ctx as unknown as typeof figma,
    api: ctx,
    resources,
    collections,
    variables,
    styles,
  };
};

describe('backup definition closure', () => {
  it('follows referenced styles and cross-collection aliases without codegen rounding', async () => {
    const f = captureFixture();
    const result = await captureBackupDefinitions(f.ctx, f.snapshot);
    expect(result).toEqual(definitions());
    expect(f.snapshot.issues).toEqual([]);
    expect(f.api.variables.getVariableByIdAsync.mock.calls.map(c => c[0])).toEqual([
      'alias',
      'color',
    ]);
  });
  it('reports inaccessible or extended definitions instead of fabricating local equivalents', async () => {
    const f = captureFixture();
    f.collectionTable.get('c')!.isExtension = true;
    const result = await captureBackupDefinitions(f.ctx, f.snapshot);
    expect(result.variables).toEqual([]);
    expect(f.snapshot.issues.some(issue => issue.code === 'DEFINITION_UNAVAILABLE')).toBe(true);
  });
});
describe('backup definition restore', () => {
  it('rebuilds fresh identities, ordered modes, aliases, precision and publication/code metadata', async () => {
    const f = restoreFixture();
    const restored = createRestoredDefinitions();
    const issues: RestoreIssue[] = [];
    await restoreBackupDefinitions(f.ctx, definitions(), restored, issues, value =>
      remapBackupAliases(value, restored),
    );
    expect(issues).toEqual([]);
    expect(f.collections[0]!.modes.map(m => m.name)).toEqual(['Light', 'Dark']);
    expect(f.collections[0]!.hiddenFromPublishing).toBe(true);
    const [alias, color] = f.variables;
    expect(alias!.id).not.toBe('alias');
    expect(alias!.valuesByMode[f.collections[0]!.modes[0]!.modeId]).toEqual({
      type: 'VARIABLE_ALIAS',
      id: color!.id,
    });
    expect(alias!.valuesByMode[f.collections[0]!.modes[1]!.modeId]).toEqual({
      color: { type: 'VARIABLE_ALIAS', id: color!.id },
      opacity: 0.5,
    });
    expect(color!.valuesByMode[f.collections[1]!.defaultModeId]).toEqual({
      r: 0.123456789,
      g: 0.25,
      b: 0.5,
      a: 0.75,
    });
    expect(alias!.codeSyntax).toEqual({ WEB: '--surface' });
    expect(f.styles[0]!.paints).toEqual([
      {
        type: 'SOLID',
        color: { r: 0.123456789, g: 0.25, b: 0.5 },
        boundVariables: { color: { type: 'VARIABLE_ALIAS', id: alias!.id } },
      },
    ]);
    for (const item of restored.resources.toReversed()) item.remove();
    expect(f.resources.every(item => item.removed)).toBe(true);
  });
  it('uses preloaded style fonts without repeating a background font wait', async () => {
    const f = restoreFixture();
    const restored = createRestoredDefinitions();
    const issues: RestoreIssue[] = [];
    const font = { family: 'Noto Sans SC', style: 'Medium', variationSettings: { wght: 500 } };
    const source: BackupDefinitions = {
      collections: [],
      variables: [],
      styles: [
        {
          id: 'text',
          type: 'TEXT',
          properties: { name: 'Label', fontName: font, fontSize: 14.125 },
        },
      ],
    };
    await restoreBackupDefinitions(
      f.ctx,
      source,
      restored,
      issues,
      value => value,
      undefined,
      new Set([JSON.stringify(font)]),
    );
    expect(issues).toEqual([]);
    expect(f.api.loadFontAsync).not.toHaveBeenCalled();
    expect(restored.styles.get('text')).toMatchObject({
      name: 'Label',
      fontName: font,
      fontSize: 14.125,
    });
  });
  it('reports missing aliases and mode-plan limits for strict cleanup by the caller', async () => {
    const f = restoreFixture();
    const source = definitions();
    source.variables[0]!.valuesByMode.light = { type: 'VARIABLE_ALIAS', id: 'missing' };
    const restored = createRestoredDefinitions();
    const issues: RestoreIssue[] = [];
    await restoreBackupDefinitions(f.ctx, source, restored, issues, value =>
      remapBackupAliases(value, restored),
    );
    expect(issues.some(issue => issue.message.includes('missing'))).toBe(true);
    expect(() => remapBackupAliases({ type: 'VARIABLE_ALIAS', id: 'missing' }, restored)).toThrow(
      'unavailable',
    );
  });
});
