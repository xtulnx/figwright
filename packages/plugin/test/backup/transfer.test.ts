import { afterEach, describe, expect, it, vi } from 'vitest';

import { createBackupTransferHandler } from '../../src/backup/transfer.js';

const fixture = (name = 'Design') => {
  const page = {
    id: 'p',
    type: 'PAGE',
    name,
    children: [],
    loadAsync: vi.fn<() => Promise<void>>(async () => {}),
  };
  const ctx = {
    editorType: 'figma',
    root: { name: 'File', children: [page] },
    mixed: Symbol('mixed'),
    skipInvisibleInstanceChildren: false,
    on: vi.fn<(...args: unknown[]) => void>(),
    off: vi.fn<(...args: unknown[]) => void>(),
    loadAllPagesAsync: vi.fn<() => Promise<void>>(async () => {}),
  };
  return { page, ctx, handler: createBackupTransferHandler(ctx as unknown as typeof figma) };
};
afterEach(() => {
  vi.restoreAllMocks();
});

describe('frozen snapshot chunk transfer', () => {
  it('honors per-capture budgets and lets a failed capture retry with a larger budget', async () => {
    const { handler } = fixture('x'.repeat(2000));
    await expect(handler({ mode: 'start', maxChars: 1000 })).rejects.toThrow(/size limit 1000/u);
    const start = (await handler({ mode: 'start', maxChars: 10_000 })) as {
      maxChars: number;
      totalChars: number;
    };
    expect(start.maxChars).toBe(10_000);
    expect(start.totalChars).toBeGreaterThan(1000);
  });
  it.each(['', 'x'])(
    'keeps UTF-8 round trips lossless across emoji chunk boundaries (%j)',
    async prefix => {
      const name = prefix + '😀'.repeat(90_000);
      const { handler } = fixture(name);
      const start = (await handler({ mode: 'start' })) as { captureId: string; totalChars: number };
      let text = '';
      while (text.length < start.totalChars) {
        // eslint-disable-next-line no-await-in-loop
        const chunk = (await handler({
          mode: 'read',
          captureId: start.captureId,
          offset: text.length,
        })) as { text: string };
        // UTF-8 encode/decode reproduces what msgpack does to isolated surrogate halves.
        text += Buffer.from(chunk.text).toString('utf8');
      }
      expect(JSON.parse(text).nodes[0].properties.name.value).toBe(name);
    },
  );
  it('transfers over the former 2-million-character limit in bounded, repeatable chunks', async () => {
    const { handler, page } = fixture('x'.repeat(2_100_000));
    const start = (await handler({ mode: 'start' })) as { captureId: string; totalChars: number };
    expect(start.totalChars).toBeGreaterThan(2_000_000);
    page.name = 'Edited after capture';
    const pieces: string[] = [];
    let offset = 0;
    while (offset < start.totalChars) {
      // eslint-disable-next-line no-await-in-loop
      const chunk = (await handler({ mode: 'read', captureId: start.captureId, offset })) as {
        text: string;
        nextOffset: number;
        done: boolean;
      };
      expect(chunk.text.length).toBeLessThanOrEqual(128_000);
      pieces.push(chunk.text);
      offset = chunk.nextOffset;
      expect(chunk.done).toBe(offset === start.totalChars);
    }
    expect(JSON.parse(pieces.join('')).nodes[0].properties.name.value.length).toBe(2_100_000);
    const retry = (await handler({ mode: 'read', captureId: start.captureId, offset: 0 })) as {
      text: string;
    };
    expect(retry.text).toBe(pieces[0]);
    expect(await handler({ mode: 'release', captureId: start.captureId })).toEqual({
      released: true,
    });
    await expect(handler({ mode: 'read', captureId: start.captureId, offset: 0 })).rejects.toThrow(
      /expired/u,
    );
  });

  it('rejects competing capture starts and invalid offsets', async () => {
    const { handler } = fixture();
    const start = (await handler({ mode: 'start' })) as { captureId: string; totalChars: number };
    await expect(handler({ mode: 'start' })).rejects.toThrow(/already active/u);
    await expect(
      handler({ mode: 'read', captureId: start.captureId, offset: start.totalChars }),
    ).rejects.toThrow(/outside/u);
    await expect(handler({ mode: 'read', captureId: start.captureId, offset: -1 })).rejects.toThrow(
      /offset/u,
    );
    await expect(handler({ mode: 'release', captureId: 'wrong' })).rejects.toThrow(
      /another session/u,
    );
  });

  it('expires abandoned leases and allows a new capture', async () => {
    const { handler } = fixture();
    vi.spyOn(Date, 'now').mockReturnValue(1_000);
    const start = (await handler({ mode: 'start' })) as { captureId: string };
    vi.spyOn(Date, 'now').mockReturnValue(122_000);
    await expect(handler({ mode: 'read', captureId: start.captureId, offset: 0 })).rejects.toThrow(
      /expired/u,
    );
    const next = (await handler({ mode: 'start' })) as { captureId: string };
    expect(next.captureId).not.toBe(start.captureId);
  });
});

describe('page-scoped capture', () => {
  it('captures only the requested page and rejects unknown page IDs', async () => {
    const { ctx, page } = fixture('First');
    ctx.root.children.push({ ...page, id: 'other', name: 'Second' });
    const handler = createBackupTransferHandler(ctx as unknown as typeof figma);
    await expect(handler({ mode: 'start', pageId: 'missing' })).rejects.toThrow('page not found');
    const start = (await handler({ mode: 'start', pageId: 'other' })) as { captureId: string };
    const chunk = (await handler({ mode: 'read', captureId: start.captureId, offset: 0 })) as {
      text: string;
    };
    expect(JSON.parse(chunk.text).pageIds).toEqual(['other']);
    expect(JSON.parse(chunk.text).nodes.map((node: { id: string }) => node.id)).toEqual(['other']);
  });
});
