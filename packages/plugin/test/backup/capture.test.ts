import { describe, expect, it, vi } from 'vitest';

import { captureBackupSnapshot } from '../../src/backup/capture.js';

const fixture = () => {
  const rectangle = {
    id: 'r',
    type: 'RECTANGLE',
    name: 'Precise',
    x: 0.123456789,
    fills: [{ type: 'IMAGE', imageHash: 'image', filters: { exposure: 0.123456789 } }],
    parent: { id: 'p' },
  };
  const page = {
    id: 'p',
    type: 'PAGE',
    name: 'Page',
    children: [rectangle],
    loadAsync: vi.fn<() => Promise<void>>(async () => {}),
  };
  const ctx = {
    editorType: 'figma',
    root: { name: 'File', children: [page] },
    mixed: Symbol('mixed'),
    currentPage: { id: 'untouched' },
    skipInvisibleInstanceChildren: true,
    on: vi.fn<(event: string, callback: () => void) => void>(),
    off: vi.fn<(...args: unknown[]) => void>(),
    loadAllPagesAsync: vi.fn<() => Promise<void>>(async () => {}),
  };
  return { ctx, rectangle, page, api: ctx as unknown as typeof figma };
};

describe('raw backup capture', () => {
  it('captures stroke participation and child stacking instead of inheriting new-frame defaults', async () => {
    const { api, rectangle } = fixture();
    Object.assign(rectangle, { strokesIncludedInLayout: false, itemReverseZIndex: true });
    const result = await captureBackupSnapshot(api);
    expect(result.nodes[1]!.properties.strokesIncludedInLayout).toEqual({
      state: 'value',
      value: false,
    });
    expect(result.nodes[1]!.properties.itemReverseZIndex).toEqual({ state: 'value', value: true });
  });

  it('captures a 15911-node page above both former prototype limits without truncating', async () => {
    const { page, rectangle, api } = fixture();
    page.children = Array.from({ length: 15911 }, (_, index) => ({
      ...rectangle,
      id: `r-${index}`,
    }));
    const snapshot = await captureBackupSnapshot(api);
    expect(snapshot.nodes).toHaveLength(15912);
    expect(snapshot.nodes.at(-1)!.id).toBe('r-15910');
    expect(JSON.stringify(snapshot).length).toBeGreaterThan(6_000_000);
  });

  it('reports the configured node limit and restores runtime state when it is reached', async () => {
    const { ctx, api } = fixture();
    await expect(captureBackupSnapshot(api, { maxNodes: 1 })).rejects.toThrow(
      /node limit 1 reached after 1 nodes/u,
    );
    expect(ctx.skipInvisibleInstanceChildren).toBe(true);
    expect(ctx.off).toHaveBeenCalledOnce();
  });

  it('loads multiple pages and includes hidden instance descendants during capture', async () => {
    const { ctx, page, rectangle, api } = fixture();
    Object.defineProperty(page, 'children', {
      get: () => (ctx.skipInvisibleInstanceChildren ? [] : [rectangle]),
    });
    ctx.root.children.push({
      id: 'p2',
      type: 'PAGE',
      name: 'Second',
      children: [],
      loadAsync: vi.fn<() => Promise<void>>(async () => {}),
    });
    const snapshot = await captureBackupSnapshot(api);
    expect(snapshot.pageIds).toEqual(['p', 'p2']);
    expect(snapshot.nodes.map(node => node.id)).toEqual(['p', 'r', 'p2']);
    expect(ctx.skipInvisibleInstanceChildren).toBe(true);
  });

  it('preserves precision and raw image filters, loads every page without switching pages', async () => {
    const { ctx, rectangle, page, api } = fixture();
    const result = await captureBackupSnapshot(api);
    expect(result.nodes.map(node => node.id)).toEqual(['p', 'r']);
    expect(result.nodes[1]!.properties.x).toEqual({ state: 'value', value: 0.123456789 });
    expect(result.nodes[1]!.properties.fills).toEqual({ state: 'value', value: rectangle.fills });
    expect(result.issues.some(issue => issue.code === 'MEDIA_BYTES_NOT_CAPTURED')).toBe(true);
    expect(page.loadAsync).toHaveBeenCalledOnce();
    expect(ctx.currentPage.id).toBe('untouched');
    expect(ctx.skipInvisibleInstanceChildren).toBe(true);
    expect(ctx.off).toHaveBeenCalledWith('documentchange', ctx.on.mock.calls[0]![1]);
  });

  it('keeps mixed values distinct from actual strings, and reports throwing getters', async () => {
    const { rectangle, ctx, api } = fixture();
    Object.defineProperty(rectangle, 'cornerRadius', { value: ctx.mixed });
    Object.defineProperty(rectangle, 'opacity', {
      get: () => {
        throw new Error('Unavailable');
      },
    });
    const result = await captureBackupSnapshot(api);
    expect(result.nodes[1]!.properties.cornerRadius).toEqual({ state: 'mixed' });
    expect(result.nodes[1]!.properties.opacity).toEqual({
      state: 'unreadable',
      message: 'Unavailable',
    });
    expect(result.issues).toContainEqual({
      code: 'UNREADABLE_PROPERTY',
      severity: 'missing',
      objectId: 'r',
      property: 'opacity',
      message: 'Unavailable',
    });
  });

  it('captures text ranges independently of mixed node properties', async () => {
    const { page, ctx, api } = fixture();
    const runs = [
      { start: 0, end: 1, fontSize: 12 },
      { start: 1, end: 2, fontSize: 18 },
    ];
    page.children = [
      {
        id: 'text',
        type: 'TEXT',
        name: 'text',
        parent: { id: 'p' },
        fontSize: ctx.mixed,
        getStyledTextSegments: vi.fn<() => typeof runs>(() => runs),
      },
    ] as unknown as typeof page.children;
    const result = await captureBackupSnapshot(api);
    expect(result.nodes[1]!.properties.styledTextSegments).toEqual({ state: 'value', value: runs });
    expect(result.nodes[1]!.properties.fontSize).toEqual({ state: 'mixed' });
  });

  it('rejects lossy JSON coercion and leaves the failed field explicit', async () => {
    const { rectangle, api } = fixture();
    rectangle.x = NaN;
    const result = await captureBackupSnapshot(api);
    expect(result.nodes[1]!.properties.x?.state).toBe('unreadable');
  });

  it('aborts on a reported change and cleans up temporary runtime settings', async () => {
    const { ctx, page, api } = fixture();
    page.loadAsync.mockImplementation(async () => {
      ctx.on.mock.calls[0]![1]();
    });
    await expect(captureBackupSnapshot(api)).rejects.toThrow(/document changed/u);
    expect(ctx.skipInvisibleInstanceChildren).toBe(true);
    expect(ctx.off).toHaveBeenCalledOnce();
  });

  it('cleans up when page loading fails', async () => {
    const { ctx, page, api } = fixture();
    page.loadAsync.mockRejectedValue(new Error('Cannot load page'));
    await expect(captureBackupSnapshot(api)).rejects.toThrow('Cannot load page');
    expect(ctx.skipInvisibleInstanceChildren).toBe(true);
    expect(ctx.off).toHaveBeenCalledOnce();
  });

  it('refuses oversize snapshots instead of returning a partial tree', async () => {
    const { rectangle, api } = fixture();
    rectangle.name = 'x'.repeat(1001);
    await expect(captureBackupSnapshot(api, { maxChars: 1000 })).rejects.toThrow(
      /size limit 1000.*JSON characters after 2 nodes/u,
    );
  });

  it('rejects other editors before loading pages', async () => {
    const { ctx, page, api } = fixture();
    ctx.editorType = 'dev';
    await expect(captureBackupSnapshot(api)).rejects.toThrow(/Design editor/u);
    expect(page.loadAsync).not.toHaveBeenCalled();
  });
});
