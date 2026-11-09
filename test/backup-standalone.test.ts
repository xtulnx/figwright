import { gzipSync } from 'node:zlib';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { encodeBackupArchive, decodeBackupArchive } from '../packages/mcp/src/backup/archive.js';
import type { PluginBridgeMessage } from '../packages/plugin/protocol/bridge.js';
import { dispatchSandboxMessage } from '../packages/plugin/src/dispatcher.js';
import { createSandboxHandlers } from '../packages/plugin/src/handlers/registry.js';
import { encodePanelBackup, decodePanelBackup } from '../packages/plugin/ui/backup/archive.js';
import {
  capturePanelBackup,
  restorePanelBackup,
  LocalBackupCancelled,
} from '../packages/plugin/ui/backup/client.js';
import { createToolBridge } from '../packages/plugin/ui/sandbox/tool-bridge.js';
import { type BackupSnapshot } from '../packages/shared/src/index.js';

const snapshot = (): BackupSnapshot => ({
  captureVersion: 1,
  source: { name: '中文 😀', editorType: 'figma' },
  nodes: [
    {
      id: 'p',
      type: 'PAGE',
      parentId: null,
      children: [],
      properties: { name: { state: 'value', value: 'Mixed 😀' } },
    },
  ],
  pageIds: ['p'],
  issues: [],
});
afterEach(() => vi.unstubAllGlobals());
describe('standalone browser archive interoperability', () => {
  it('uses the exact Node format and integrity checks without WebCrypto', async () => {
    vi.stubGlobal('crypto', undefined);
    const original = snapshot();
    const images = new Map([['original-hash', Uint8Array.from([0, 128, 255])]]);
    const native = encodeBackupArchive(original, 'server', images);
    const panel = await decodePanelBackup(native);
    expect(panel.images.get('original-hash')).toEqual(images.get('original-hash'));
    const exported = await encodePanelBackup(panel.snapshot, panel.images, 'plugin');
    const checked = decodeBackupArchive(exported);
    expect(checked.snapshot).toEqual(panel.snapshot);
    expect(checked.manifest.producer).toEqual({
      serverVersion: 'standalone-plugin',
      pluginVersion: 'plugin',
    });
    expect(checked.manifest.entries.map(e => e.sha256)).toEqual(
      panel.manifest.entries.map(e => e.sha256),
    );
  });
  it('bounds streamed decompression before container decoding and rejects damaged gzip', async () => {
    await expect(decodePanelBackup(gzipSync(Buffer.alloc(100_000)), 1024)).rejects.toThrow(
      '256 MiB',
    );
    await expect(decodePanelBackup(Uint8Array.from([0, 1, 2]))).rejects.toThrow(Error);
    await expect(decodePanelBackup(new Uint8Array(), 0)).rejects.toThrow('byte limit');
  });
});

const localPlugin = () => {
  let sequence = 0;
  const make = (type: string) => ({
    id: `new:${++sequence}`,
    type,
    name: '',
    removed: false,
    parent: null as unknown as { children: unknown[] } | null,
    children: [] as unknown[],
    width: 20,
    height: 30,
    x: 0,
    y: 0,
    fills: [] as unknown[],
    appendChild(child: { parent: { children: unknown[] } | null }) {
      if (child.parent) child.parent.children.splice(child.parent.children.indexOf(child), 1);
      this.children.push(child);
      child.parent = this;
    },
    remove() {
      this.removed = true;
      if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1);
      for (const child of this.children as { remove(): void }[]) child.remove();
    },
    resize(width: number, height: number) {
      this.width = width;
      this.height = height;
    },
    async loadAsync() {},
  });
  const root = make('DOCUMENT');
  root.name = 'File';
  const page = make('PAGE');
  page.id = 'p';
  page.name = '😀'.repeat(70_000);
  root.appendChild(page);
  const rect = make('RECTANGLE');
  rect.id = 'r';
  rect.name = 'Original photo';
  rect.fills = [{ type: 'IMAGE', imageHash: 'old', scaleMode: 'FILL' }];
  page.appendChild(rect);
  const image = Uint8Array.from([137, 80, 78, 71, 0, 128, 255]);
  const ctx = {
    root,
    currentPage: page,
    editorType: 'figma',
    mixed: Symbol('mixed'),
    skipInvisibleInstanceChildren: false,
    loadAllPagesAsync: async () => {},
    on: () => {},
    off: () => {},
    commitUndo: vi.fn<() => void>(),
    getNodeByIdAsync: async (id: string) => (id === 'p' ? page : id === 'r' ? rect : null),
    getImageByHash: () => ({
      getBytesAsync: async () => image,
      getSizeAsync: async () => ({ width: 1, height: 1 }),
    }),
    createPage: () => {
      const p = make('PAGE');
      root.appendChild(p);
      return p;
    },
    createRectangle: () => {
      const n = make('RECTANGLE');
      page.appendChild(n);
      return n;
    },
    createImage: () => ({ hash: 'restored-image' }),
    base64Decode: (text: string) => Uint8Array.from(Buffer.from(text, 'base64')),
  };
  const handlers = createSandboxHandlers(ctx as unknown as typeof figma);
  let listener: ((raw: unknown) => void) | undefined;
  const calls: { method: string; args: unknown }[] = [];
  const bridge = createToolBridge({
    subscribe: cb => {
      listener = cb;
      return () => {
        listener = undefined;
      };
    },
    postMessage: (raw: PluginBridgeMessage) => {
      if (raw.kind === 'tool-call') calls.push({ method: raw.method, args: raw.params });
      void dispatchSandboxMessage({ raw, handlers, editorType: 'figma' }).then(outcome => {
        if (outcome.kind === 'reply') listener?.(outcome.reply);
        return undefined;
      });
    },
  });
  return { ctx, page, rect, bridge, calls };
};
describe('standalone panel ↔ sandbox without a relay', () => {
  it('backs up Unicode and original image bytes, then restores to a new page through postMessage', async () => {
    const plugin = localPlugin();
    const network = vi.fn<() => Promise<never>>(async () => {
      throw new Error('A standalone backup must not use the network');
    });
    vi.stubGlobal('fetch', network);
    try {
      const saved = await capturePanelBackup(
        plugin.bridge.handler,
        'p',
        'plugin',
        () => {},
        () => false,
      );
      const archive = await decodePanelBackup(saved.bytes);
      expect(archive.snapshot.nodes[0]!.properties.name).toEqual({
        state: 'value',
        value: plugin.page.name,
      });
      expect(archive.images.size).toBe(1);
      await expect(
        restorePanelBackup(
          plugin.bridge.handler,
          archive,
          { allowPartial: false },
          () => {},
          () => false,
          () => {},
        ),
      ).rejects.toThrow('partial');
      let job = '';
      const restored = await restorePanelBackup(
        plugin.bridge.handler,
        archive,
        { allowPartial: true, pageId: 'p', pageName: 'Restored' },
        () => {},
        () => false,
        id => {
          job = id;
        },
      );
      expect(restored).toMatchObject({
        status: 'partial',
        nodes: 2,
        pages: [{ name: 'Restored' }],
      });
      expect(job).not.toBe('');
      expect(plugin.ctx.root.children).toHaveLength(2);
      expect(plugin.page.children).toEqual([plugin.rect]);
      const restoredPage = plugin.ctx.root.children[1] as typeof plugin.page;
      expect((restoredPage.children[0] as typeof plugin.rect).fills).toEqual([
        { type: 'IMAGE', imageHash: 'restored-image', scaleMode: 'FILL' },
      ]);
      expect(plugin.calls.some(c => c.method === 'save_image_fills')).toBe(true);
      expect(
        plugin.calls.filter(
          c => c.method === 'restore_backup' && (c.args as { mode: string }).mode === 'commit',
        ),
      ).toHaveLength(1);
      expect(network).not.toHaveBeenCalled();
      expect(plugin.ctx.commitUndo).toHaveBeenCalledOnce();
    } finally {
      plugin.bridge.dispose();
    }
  });
});

describe('standalone restore recovery', () => {
  const archive = async () =>
    decodePanelBackup(await encodePanelBackup(snapshot(), new Map(), 'plugin'));
  const result = {
    status: 'restored',
    pages: [{ sourceId: 'p', nodeId: 'new', name: 'Restored' }],
    nodes: 1,
    issueCount: 0,
    issues: [],
  };
  it('checks the same job after losing a commit reply instead of committing twice', async () => {
    const plugin = localPlugin();
    try {
      let committed = 0;
      const dispatch = async (method: string, args: unknown): Promise<unknown> => {
        const reply = await plugin.bridge.handler(method, args);
        if ((args as { mode: string }).mode === 'commit') {
          committed++;
          throw new Error('Reply lost after commit');
        }
        return reply;
      };
      const restored = await restorePanelBackup(
        dispatch,
        await archive(),
        { allowPartial: false },
        () => {},
        () => false,
        () => {},
      );
      expect(restored.nodes).toBe(1);
      expect(committed).toBe(1);
      expect(plugin.ctx.root.children).toHaveLength(2);
      expect(plugin.calls.some(call => (call.args as { mode: string }).mode === 'status')).toBe(
        true,
      );
    } finally {
      plugin.bridge.dispose();
    }
  });
  it('waits for a terminal cleanup result after cancellation', async () => {
    let cancelRequested = false;
    let cancelSent = false;
    const modes: string[] = [];
    const dispatch = async (_method: string, raw: unknown): Promise<unknown> => {
      const args = raw as { mode: string; offset: number; text: string };
      modes.push(args.mode);
      if (args.mode === 'start') return { restoreId: 'job', received: 0 };
      if (args.mode === 'append') return { received: args.offset + args.text.length };
      if (args.mode === 'commit') {
        cancelRequested = true;
        return { restoreId: 'job', state: 'running', phase: 'font waiting' };
      }
      if (args.mode === 'cancel') {
        cancelSent = true;
        return { restoreId: 'job', state: 'running', phase: 'cleaning' };
      }
      if (args.mode === 'status')
        return cancelSent
          ? { restoreId: 'job', state: 'failed', phase: 'cancelled', error: 'Restore cancelled' }
          : { restoreId: 'job', state: 'completed', phase: 'complete', result };
      return {};
    };
    await expect(
      restorePanelBackup(
        dispatch,
        await archive(),
        { allowPartial: false },
        () => {},
        () => cancelRequested,
        () => {},
      ),
    ).rejects.toBeInstanceOf(LocalBackupCancelled);
    expect(modes.slice(-3)).toEqual(['cancel', 'status', 'release']);
  });
});
