import { type BackupSnapshot, type RestorePayload } from '@figwright/shared';
import { describe, expect, it, vi } from 'vitest';

import { sameBackupValue } from '../../src/backup/raw-value.js';
import { createRestoreTransferHandler } from '../../src/backup/restore-transfer.js';
import { restoreBackupSnapshot } from '../../src/backup/restore.js';

const hasInstanceAncestor = (entry: unknown): boolean =>
  !!entry &&
  typeof entry === 'object' &&
  ((entry as { type: string }).type === 'INSTANCE' ||
    hasInstanceAncestor((entry as { parent: unknown }).parent));
type FakeNode = ReturnType<typeof fixture>['original'];
const fixture = () => {
  let sequence = 0;
  const all: Record<string, unknown>[] = [];
  const make = (type: string) => {
    const node = {
      id: `new:${++sequence}`,
      type,
      name: '',
      removed: false,
      parent: null as unknown as { children: unknown[] } | null,
      children: [] as unknown[],
      width: 100,
      height: 100,
      x: 0,
      y: 0,
      relativeTransform: [
        [1, 0, 0],
        [0, 1, 0],
      ],
      fills: [] as unknown[],
      fillStyleId: '',
      boundVariables: {} as Record<string, unknown>,
      explicitVariableModes: {} as Record<string, string>,
      async setFillStyleIdAsync(id: string) {
        this.fillStyleId = id;
      },
      setBoundVariable(field: string, variable: { id: string }) {
        this.boundVariables[field] = { type: 'VARIABLE_ALIAS', id: variable.id };
      },
      setExplicitVariableModeForCollection(collection: { id: string }, mode: string) {
        this.explicitVariableModes[collection.id] = mode;
      },
      clipsContent: true,
      opacity: 1,
      characters: '',
      fontName: { family: 'Inter', style: 'Regular' },
      fontSize: 12,
      textAutoResize: 'NONE',
      layoutMode: 'NONE',
      strokesIncludedInLayout: true,
      layoutSizingHorizontal: 'FIXED',
      runs: [] as unknown[],
      reactions: [] as unknown[],
      flowStartingPoints: [] as { nodeId: string; name: string }[],
      appendChild(child: { parent: { children: unknown[] } | null }) {
        if (child.parent) child.parent.children.splice(child.parent.children.indexOf(child), 1);
        this.children.push(child);
        child.parent = this;
      },
      insertChild(index: number, child: { parent: { children: unknown[] } | null }) {
        if (hasInstanceAncestor(this)) throw new Error('Cannot move nodes inside an instance');
        this.appendChild(child);
        this.children.splice(this.children.indexOf(child), 1);
        this.children.splice(index, 0, child);
      },
      remove() {
        this.removed = true;
        if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1);
        for (const child of [...this.children] as { remove(): void }[]) child.remove();
      },
      resize(width: number, height: number) {
        this.width = width;
        this.height = height;
      },
      setRangeFontName(start: number, end: number, font: unknown) {
        this.runs.push({ start, end, font });
      },
      setRangeFontSize(start: number, end: number, size: unknown) {
        this.runs.push({ start, end, size });
      },
      setRangeHyperlink(start: number, end: number, link: unknown) {
        this.runs.push({ start, end, link });
      },
      async setReactionsAsync(reactions: unknown[]) {
        this.reactions = reactions;
      },
    };
    all.push(node);
    return node;
  };
  const root = make('DOCUMENT');
  const original = make('PAGE');
  original.name = 'Original';
  root.appendChild(original);
  const ctx = {
    editorType: 'figma',
    root,
    currentPage: original,
    createPage: () => {
      const node = make('PAGE');
      root.appendChild(node);
      return node;
    },
    createFrame: () => {
      const node = make('FRAME');
      original.appendChild(node);
      return node;
    },
    createComponent: () => {
      const component = make('COMPONENT');
      original.appendChild(component);
      return Object.assign(component, {
        createInstance: () => {
          const instance = make('INSTANCE');
          const recorded = new Map<string, Set<string>>();
          Object.defineProperty(instance, 'overrides', {
            get: () => [...recorded].map(([id, fields]) => ({ id, overriddenFields: [...fields] })),
          });
          original.appendChild(instance);
          const copy = (master: ReturnType<typeof make>, clone: ReturnType<typeof make>): void => {
            for (const key of [
              'name',
              'width',
              'height',
              'fills',
              'fontSize',
              'characters',
              'opacity',
            ] as const) {
              let overridden = false;
              let override: unknown;
              Object.defineProperty(clone, key, {
                configurable: true,
                enumerable: true,
                get: () => (overridden ? override : master[key]),
                set: value => {
                  if (!overridden && sameBackupValue(value, master[key])) return;
                  overridden = true;
                  override = value;
                  const fields = recorded.get(clone.id) ?? new Set<string>();
                  fields.add(key);
                  recorded.set(clone.id, fields);
                },
              });
            }
            for (const child of master.children as ReturnType<typeof make>[]) {
              const cloned = make(child.type);
              cloned.id = `I${instance.id};${child.id}`;
              clone.appendChild(cloned);
              copy(child, cloned);
            }
          };
          copy(component, instance);
          return Object.assign(instance, { getMainComponentAsync: async () => component });
        },
      });
    },
    createRectangle: () => {
      const node = make('RECTANGLE');
      original.appendChild(node);
      return node;
    },
    createText: () => {
      const node = make('TEXT');
      original.appendChild(node);
      return node;
    },
    group: (children: ReturnType<typeof make>[], parent: ReturnType<typeof make>) => {
      const node = make('GROUP');
      parent.appendChild(node);
      for (const child of children) node.appendChild(child);
      return node;
    },
    loadFontAsync: vi.fn<(font: unknown) => Promise<void>>(async () => {}),
    createImage: vi.fn<() => { hash: string }>(() => ({ hash: 'new-image' })),
    base64Decode: (text: string) => Uint8Array.from(Buffer.from(text, 'base64')),
  };
  return { ctx: ctx as unknown as typeof figma, original, root, all, api: ctx };
};
const value = (rawValue: never) => ({ state: 'value' as const, value: rawValue });
const node = (
  id: string,
  type: string,
  parentId: string | null,
  children: string[],
  props: Record<string, unknown> = {},
): BackupSnapshot['nodes'][number] => ({
  id,
  type,
  parentId,
  children,
  properties: Object.fromEntries(Object.entries(props).map(([key, v]) => [key, value(v as never)])),
});
const payload = (
  nodes: BackupSnapshot['nodes'],
  extra: Partial<RestorePayload> = {},
): RestorePayload => ({
  snapshot: {
    captureVersion: 1,
    source: { name: 'Design', editorType: 'figma' },
    nodes,
    pageIds: ['p'],
    issues: [],
  },
  images: {},
  allowPartial: false,
  ...extra,
});

describe('page restore engine', () => {
  it('rebuilds hierarchy, sibling order, geometry, images, mixed fonts and remapped links on a new page', async () => {
    const f = fixture();
    const input = payload(
      [
        node('p', 'PAGE', null, ['f'], { name: 'UI' }),
        node('f', 'FRAME', 'p', ['r', 't'], {
          name: 'Card',
          strokesIncludedInLayout: false,
          width: 320,
          height: 180,
          relativeTransform: [
            [1, 0, 12.125],
            [0, 1, -4.5],
          ],
        }),
        node('r', 'RECTANGLE', 'f', [], {
          name: 'Photo',
          width: 40,
          height: 50,
          fills: [{ type: 'IMAGE', imageHash: 'old-image', scaleMode: 'FILL' }],
          reactions: [{ actions: [{ type: 'NODE', destinationId: 't' }] }],
        }),
        node('t', 'TEXT', 'f', [], {
          characters: 'A中😀',
          fontSize: 17,
          styledTextSegments: [
            { start: 0, end: 1, fontName: { family: 'Inter', style: 'Regular' } },
            {
              start: 1,
              end: 4,
              fontName: { family: 'Noto Sans', style: 'Bold' },
              fontSize: 22,
              hyperlink: { type: 'NODE', value: 'r' },
            },
          ],
        }),
      ],
      { images: { 'old-image': 'AQID' } },
    );
    const result = await restoreBackupSnapshot(f.ctx, input);
    expect(result).toMatchObject({ status: 'restored', nodes: 4, issueCount: 0 });
    expect(f.original.children).toEqual([]);
    expect(f.ctx.currentPage).toBe(f.original);
    const restored = f.root.children[1] as FakeNode;
    expect(restored.name).toBe('UI (restored)');
    const frame = restored.children[0] as FakeNode;
    const [rect, text] = frame.children as FakeNode[];
    expect(frame).toMatchObject({
      width: 320,
      height: 180,
      strokesIncludedInLayout: false,
      relativeTransform: [
        [1, 0, 12.125],
        [0, 1, -4.5],
      ],
    });
    expect(rect!.fills).toEqual([{ type: 'IMAGE', imageHash: 'new-image', scaleMode: 'FILL' }]);
    expect(rect!.reactions).toEqual([{ actions: [{ type: 'NODE', destinationId: text!.id }] }]);
    expect(text!.characters).toBe('A中😀');
    expect(text!.runs).toContainEqual({
      start: 1,
      end: 4,
      font: { family: 'Noto Sans', style: 'Bold' },
    });
    expect(text!.runs).toContainEqual({
      start: 1,
      end: 4,
      link: { type: 'NODE', value: rect!.id },
    });
    expect(input.snapshot.nodes[2]!.properties.fills).toEqual(
      value([{ type: 'IMAGE', imageHash: 'old-image', scaleMode: 'FILL' }] as never),
    );
  });
  it('restores node style links, scalar bindings and explicit collection modes with new IDs', async () => {
    const f = fixture();
    const removed: string[] = [];
    Object.assign(f.api, {
      variables: {
        createVariableCollection: () => ({
          id: 'new-c',
          defaultModeId: 'new-mode',
          hiddenFromPublishing: false,
          renameMode() {},
          remove() {
            removed.push('collection');
          },
        }),
        createVariable: () => ({
          id: 'new-v',
          description: '',
          hiddenFromPublishing: false,
          scopes: [],
          setValueForMode() {},
          remove() {
            removed.push('variable');
          },
        }),
      },
      createPaintStyle: () => ({
        id: 'new-style',
        name: '',
        description: '',
        paints: [],
        remove() {
          removed.push('style');
        },
      }),
    });
    const input = payload([
      node('p', 'PAGE', null, ['r'], { explicitVariableModes: { c: 'mode' } }),
      node('r', 'RECTANGLE', 'p', [], {
        fillStyleId: 'style',
        opacity: 0.75,
        boundVariables: { opacity: { type: 'VARIABLE_ALIAS', id: 'v' } },
      }),
    ]);
    input.snapshot.definitions = {
      collections: [
        {
          id: 'c',
          name: 'Theme',
          defaultModeId: 'mode',
          modes: [{ modeId: 'mode', name: 'Default' }],
          hiddenFromPublishing: false,
        },
      ],
      variables: [
        {
          id: 'v',
          name: 'Opacity',
          collectionId: 'c',
          resolvedType: 'FLOAT',
          valuesByMode: { mode: 0.75 },
          description: '',
          scopes: ['OPACITY'],
          codeSyntax: {},
          hiddenFromPublishing: false,
        },
      ],
      styles: [{ id: 'style', type: 'PAINT', properties: { name: 'Paint', paints: [] } }],
    };
    expect(await restoreBackupSnapshot(f.ctx, input)).toMatchObject({
      status: 'restored',
      issueCount: 0,
    });
    const page = f.root.children[1] as FakeNode;
    const shape = page.children[0] as FakeNode;
    expect(page.explicitVariableModes).toEqual({ 'new-c': 'new-mode' });
    expect(shape.boundVariables).toEqual({ opacity: { type: 'VARIABLE_ALIAS', id: 'new-v' } });
    expect(shape.fillStyleId).toBe('new-style');
    expect(removed).toEqual([]);
    input.snapshot.nodes[1]!.properties.nonexistent = { state: 'value', value: true };
    await expect(restoreBackupSnapshot(f.ctx, input)).rejects.toThrow('Unknown backup property');
    expect(removed).toEqual(['style', 'variable', 'collection']);
  });
  it('recreates ordinary native instances with original override intent and inherited master changes', async () => {
    const f = fixture();
    const input = payload([
      node('p', 'PAGE', null, ['i', 'c']),
      node('i', 'INSTANCE', 'p', ['Ii;r'], {
        mainComponentId: 'c',
        name: 'Master',
        width: 20,
        height: 10,
        overrides: [
          { id: 'i', overriddenFields: ['width', 'height'] },
          { id: 'Ii;r', overriddenFields: ['name'] },
        ],
      }),
      node('Ii;r', 'RECTANGLE', 'i', [], {
        name: 'Custom',
        width: 20,
        height: 10,
        fills: [{ type: 'SOLID', color: { r: 0, g: 0, b: 1 } }],
      }),
      node('c', 'COMPONENT', 'p', ['r'], {
        name: 'Master',
        width: 20,
        height: 10,
        componentPropertyDefinitions: {},
      }),
      node('r', 'RECTANGLE', 'c', [], {
        name: 'Child',
        width: 20,
        height: 10,
        fills: [{ type: 'SOLID', color: { r: 0, g: 0, b: 1 } }],
      }),
    ]);
    expect(await restoreBackupSnapshot(f.ctx, input)).toMatchObject({
      status: 'restored',
      nodes: 5,
      issueCount: 0,
    });
    const page = f.root.children[1] as FakeNode;
    const [instance, main] = page.children as FakeNode[];
    expect(instance!.type).toBe('INSTANCE');
    expect(main!.type).toBe('COMPONENT');
    expect(instance).toMatchObject({ width: 20, height: 10 });
    const masterChild = main!.children[0] as FakeNode;
    const child = instance!.children[0] as FakeNode;
    expect(child.name).toBe('Custom');
    main!.width = 80;
    main!.height = 60;
    expect(instance).toMatchObject({ width: 20, height: 10 });
    masterChild.name = 'Changed master';
    masterChild.fills = [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 } }];
    expect(child.name).toBe('Custom');
    expect(child.fills).toEqual(masterChild.fills);
    expect(f.original.children).toEqual([]);
  });
  it('maps prototype flow starting points after target nodes exist', async () => {
    const f = fixture();
    const input = payload([
      node('p', 'PAGE', null, ['f'], { flowStartingPoints: [{ nodeId: 'f', name: 'Start' }] }),
      node('f', 'FRAME', 'p', []),
    ]);
    expect(await restoreBackupSnapshot(f.ctx, input)).toMatchObject({
      status: 'restored',
      issueCount: 0,
    });
    const page = f.root.children[1] as FakeNode;
    expect(page.flowStartingPoints).toEqual([
      { nodeId: (page.children[0] as FakeNode).id, name: 'Start' },
    ]);
  });
  it('rejects missing fonts before creating pages', async () => {
    const f = fixture();
    f.api.loadFontAsync.mockRejectedValue(new Error('Font unavailable'));
    await expect(
      restoreBackupSnapshot(
        f.ctx,
        payload([
          node('p', 'PAGE', null, ['t']),
          node('t', 'TEXT', 'p', [], { fontName: { family: 'Missing', style: 'Bold' } }),
        ]),
      ),
    ).rejects.toThrow('Font unavailable');
    expect(f.root.children).toEqual([f.original]);
  });
  it('rejects unsupported native semantics before writes unless partial restoration is explicit', async () => {
    const f = fixture();
    const input = payload([node('p', 'PAGE', null, ['i']), node('i', 'INSTANCE', 'p', [])]);
    await expect(restoreBackupSnapshot(f.ctx, input)).rejects.toThrow('preflight');
    expect(f.root.children).toEqual([f.original]);
    const result = await restoreBackupSnapshot(f.ctx, { ...input, allowPartial: true });
    expect(result.status).toBe('partial');
    expect(result.issues[0]!.message).toContain('INSTANCE');
  });
  it('rolls back new pages and temporary nodes after property failure in strict mode', async () => {
    const f = fixture();
    await expect(
      restoreBackupSnapshot(
        f.ctx,
        payload([
          node('p', 'PAGE', null, ['r']),
          node('r', 'RECTANGLE', 'p', [], { nonexistent: 1 }),
        ]),
      ),
    ).rejects.toThrow('Unknown backup property');
    expect(f.root.children).toEqual([f.original]);
    expect(f.original.children).toEqual([]);
  });
  it('cleans already-created pages if a later page exceeds the Figma plan limit', async () => {
    const f = fixture();
    const create = f.api.createPage;
    vi.spyOn(f.api, 'createPage')
      .mockImplementationOnce(create)
      .mockImplementationOnce(() => {
        throw new Error('Page limit');
      });
    const input = payload([node('p', 'PAGE', null, []), node('p2', 'PAGE', null, [])]);
    input.snapshot.pageIds.push('p2');
    await expect(restoreBackupSnapshot(f.ctx, input)).rejects.toThrow('Page limit');
    expect(f.root.children).toEqual([f.original]);
    expect(f.original.children).toEqual([]);
  });
  it('retains resolved paint values in partial mode and reports dropped bindings', async () => {
    const f = fixture();
    const input = payload(
      [
        node('p', 'PAGE', null, ['r']),
        node('r', 'RECTANGLE', 'p', [], {
          fills: [
            {
              type: 'SOLID',
              color: { r: 0.1, g: 0.2, b: 0.3 },
              boundVariables: { color: { type: 'VARIABLE_ALIAS', id: 'missing' } },
            },
          ],
        }),
      ],
      { allowPartial: true },
    );
    const result = await restoreBackupSnapshot(f.ctx, input);
    expect(result).toMatchObject({ status: 'partial', issueCount: 1 });
    const restored = (f.root.children[1] as FakeNode).children[0] as FakeNode;
    expect(restored.fills).toEqual([{ type: 'SOLID', color: { r: 0.1, g: 0.2, b: 0.3 } }]);
    expect(result.issues[0]!.message).toContain('resolved value retained');
  });
  it('keeps a native group and excludes its temporary placeholder from restored children', async () => {
    const f = fixture();
    const result = await restoreBackupSnapshot(
      f.ctx,
      payload([
        node('p', 'PAGE', null, ['g']),
        node('g', 'GROUP', 'p', ['r']),
        node('r', 'RECTANGLE', 'g', []),
      ]),
    );
    expect(result.status).toBe('restored');
    const group = (f.root.children[1] as FakeNode).children[0] as FakeNode;
    expect(group.type).toBe('GROUP');
    expect(group.children).toHaveLength(1);
    expect((group.children[0] as FakeNode).type).toBe('RECTANGLE');
  });
  it('reports unresolved image bytes and cross-page destinations explicitly', async () => {
    const f = fixture();
    const result = await restoreBackupSnapshot(
      f.ctx,
      payload(
        [
          node('p', 'PAGE', null, ['r']),
          node('r', 'RECTANGLE', 'p', [], {
            fills: [{ type: 'IMAGE', imageHash: 'absent' }],
            reactions: [{ destinationId: 'other-page' }],
          }),
        ],
        { allowPartial: true },
      ),
    );
    expect(result.status).toBe('partial');
    expect(result.issueCount).toBe(2);
    expect(result.issues.map(i => i.message).join(' ')).toMatch(
      /image bytes.*prototype destination/u,
    );
  });
});

describe('restore upload staging', () => {
  it('exposes a cancellable job while font loading stalls, and never creates late pages', async () => {
    const f = fixture();
    let finish: (() => void) | undefined;
    f.api.loadFontAsync.mockImplementation(
      () =>
        new Promise<void>(resolve => {
          finish = resolve;
        }),
    );
    const handler = createRestoreTransferHandler(f.ctx);
    const text = JSON.stringify(
      payload([
        node('p', 'PAGE', null, ['t']),
        node('t', 'TEXT', 'p', [], { fontName: { family: 'Missing', style: 'Regular' } }),
      ]),
    );
    const { restoreId } = (await handler({ mode: 'start', totalChars: text.length })) as {
      restoreId: string;
    };
    await handler({ mode: 'append', restoreId, offset: 0, text });
    expect(await handler({ mode: 'commit', restoreId })).toMatchObject({ state: 'running' });
    expect(await handler({ mode: 'status', restoreId })).toMatchObject({
      state: 'running',
      phase: 'font Missing/Regular',
    });
    await handler({ mode: 'cancel', restoreId });
    await vi.waitFor(async () => {
      expect(await handler({ mode: 'status', restoreId })).toMatchObject({
        state: 'failed',
        error: 'Restore cancelled',
      });
    });
    finish!();
    await Promise.resolve();
    expect(f.root.children).toEqual([f.original]);
  });
  it('does not write during upload, accepts identical retries, and refuses changed offsets or incomplete commits', async () => {
    const f = fixture();
    const handler = createRestoreTransferHandler(f.ctx);
    const text = JSON.stringify(payload([node('p', 'PAGE', null, [], { name: 'Restored 😀' })]));
    const { restoreId } = (await handler({ mode: 'start', totalChars: text.length })) as {
      restoreId: string;
    };
    const args = { mode: 'append', restoreId, offset: 0, text: text.slice(0, 50) };
    expect(await handler(args)).toEqual({ received: 50 });
    expect(await handler(args)).toEqual({ received: 50 });
    await expect(handler({ ...args, text: 'changed' })).rejects.toThrow('offset');
    await expect(handler({ mode: 'commit', restoreId })).rejects.toThrow('incomplete');
    expect(f.root.children).toEqual([f.original]);
    await handler({ mode: 'append', restoreId, offset: 50, text: text.slice(50) });
    expect(await handler({ mode: 'commit', restoreId, requestId: 'commit-id' })).toMatchObject({
      state: 'running',
      restoreId,
    });
    await vi.waitFor(async () => {
      expect(await handler({ mode: 'status', restoreId })).toMatchObject({
        state: 'completed',
        result: { status: 'restored', nodes: 1 },
      });
    });
    expect(await handler({ mode: 'commit', restoreId })).toMatchObject({
      state: 'completed',
      restoreId,
    });
    await handler({ mode: 'release', restoreId });
    expect(await handler({ mode: 'status', restoreId })).toMatchObject({ state: 'completed' });
  });
});
