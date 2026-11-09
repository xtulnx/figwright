import type { BackupSnapshot } from '@figwright/shared';
import { mount, flushPromises } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
// @vitest-environment happy-dom
import { effectScope, ref } from 'vue';

import { createPluginContextEvent } from '../../protocol/bridge.js';
import { decodePanelBackup } from '../../ui/backup/archive.js';
import { capturePanelBackup, restorePanelBackup } from '../../ui/backup/client.js';
import TabBackup from '../../ui/components/TabBackup.vue';
import { useBackup } from '../../ui/composables/useBackup.js';
import { languagePreference, setLanguage } from '../../ui/lib/i18n.js';

vi.mock('../../ui/backup/archive.js', () => ({
  decodePanelBackup: vi.fn<typeof import('../../ui/backup/archive.js').decodePanelBackup>(),
}));
vi.mock('../../ui/backup/client.js', async importOriginal => ({
  ...(await importOriginal<typeof import('../../ui/backup/client.js')>()),
  capturePanelBackup: vi.fn<typeof import('../../ui/backup/client.js').capturePanelBackup>(),
  restorePanelBackup: vi.fn<typeof import('../../ui/backup/client.js').restorePanelBackup>(),
}));
const snapshot = (): BackupSnapshot => ({
  captureVersion: 1,
  source: { name: 'Local', editorType: 'figma' },
  nodes: [
    {
      id: 'p',
      type: 'PAGE',
      parentId: null,
      children: [],
      properties: { name: { state: 'value', value: 'Page' } },
    },
  ],
  pageIds: ['p'],
  issues: [
    { code: 'EXPERIMENTAL_CAPTURE', severity: 'unknown', message: 'Coverage is experimental' },
  ],
});
const decoded = () => {
  const doc = snapshot();
  return {
    snapshot: doc,
    images: new Map<string, Uint8Array>(),
    manifest: {
      format: 'figwright-backup' as const,
      version: 1 as const,
      createdAt: '2026-11-09T00:00:00Z',
      producer: { serverVersion: 'standalone-plugin', pluginVersion: '0.7.0' },
      source: doc.source,
      entries: [
        { path: 'document.json', kind: 'document' as const, bytes: 1, sha256: '0'.repeat(64) },
      ],
      issues: doc.issues,
    },
  };
};
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  languagePreference.value = 'en';
  vi.clearAllMocks();
  vi.restoreAllMocks();
});
const setup = (editorType = 'figma') => {
  const scope = effectScope();
  const context = ref(
    createPluginContextEvent({
      fileName: 'Local',
      pageId: 'p',
      pageName: 'Page',
      selectionCount: 0,
      selection: [],
      editorType,
      mode: 'default',
      apiVersion: '1.0.0',
    }),
  );
  const dispatch = vi.fn<(method: string, args: unknown) => Promise<unknown>>(async () => {
    throw new Error('No relay is installed');
  });
  const controller = scope.run(() => useBackup(dispatch, context, '0.7.0'))!;
  const wrapper = mount(TabBackup, { props: { controller, context: context.value } });
  cleanups.push(() => {
    wrapper.unmount();
    scope.stop();
  });
  return { controller, wrapper, dispatch };
};
const button = (wrapper: ReturnType<typeof mount>, text: string) =>
  wrapper.findAll('button').find(b => b.text() === text)!;

describe('standalone Backup panel', () => {
  it('allows offline backup and offers a deliberate download without a connected server', async () => {
    vi.mocked(capturePanelBackup).mockResolvedValue({
      bytes: Uint8Array.from([1, 2]),
      snapshot: snapshot(),
      images: 0,
    });
    const { wrapper, controller, dispatch } = setup();
    const objectUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:backup');
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    expect(wrapper.text()).toContain('No AI or server required');
    expect(button(wrapper, 'Back up current page').attributes('disabled')).toBeUndefined();
    await button(wrapper, 'Back up current page').trigger('click');
    await flushPromises();
    expect(controller.state.downloadReady).toBe(true);
    expect(button(wrapper, 'Download .figwright-backup').exists()).toBe(true);
    expect(dispatch).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
    await button(wrapper, 'Download .figwright-backup').trigger('click');
    expect(objectUrl).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
    expect(controller.state.downloadFileName).toMatch(/\.figwright-backup$/u);
    expect(controller.state.message).toBe('Download requested. Check your downloads.');
  });
  it('switches already prepared backup text to Chinese without altering the archive or report', async () => {
    const original = snapshot();
    vi.mocked(capturePanelBackup).mockResolvedValue({
      bytes: Uint8Array.from([1, 2]),
      snapshot: original,
      images: 9,
    });
    const { wrapper, controller } = setup();
    await controller.exportPage();
    await flushPromises();
    const filename = controller.state.downloadFileName;
    setLanguage('zh-CN');
    await flushPromises();
    expect(wrapper.text()).toContain('备份当前页面');
    expect(wrapper.text()).toContain('可下载 · 1 个节点 · 9 张图片');
    expect(wrapper.text()).toContain('查看 1 条覆盖限制');
    expect(controller.state.downloadFileName).toBe(filename);
    expect(JSON.parse(controller.report()).exportIssues[0].message).toBe(
      original.issues[0]!.message,
    );
    setLanguage('en');
    await flushPromises();
    expect(wrapper.text()).toContain('Ready to download · 1 nodes · 9 images');
    expect(capturePanelBackup).toHaveBeenCalledOnce();
  });
  it('requires inspection and explicit partial consent before canvas writes', async () => {
    vi.mocked(decodePanelBackup).mockResolvedValue(decoded());
    vi.mocked(restorePanelBackup).mockResolvedValue({
      status: 'partial',
      pages: [{ sourceId: 'p', nodeId: 'new', name: 'Page restored' }],
      nodes: 1,
      issueCount: 1,
      issues: [{ message: 'Coverage is experimental' }],
    });
    const { wrapper, controller } = setup();
    await controller.load(new File(['x'], 'backup.figwright-backup'));
    await flushPromises();
    const restore = button(wrapper, 'Restore to new page(s)');
    expect(restore.attributes('disabled')).toBeDefined();
    expect(restorePanelBackup).not.toHaveBeenCalled();
    await wrapper.find('input[type="checkbox"]').setValue(true);
    expect(restore.attributes('disabled')).toBeUndefined();
    await restore.trigger('click');
    await flushPromises();
    expect(restorePanelBackup).toHaveBeenCalledOnce();
    expect(vi.mocked(restorePanelBackup).mock.calls[0]![2]).toMatchObject({
      allowPartial: true,
      pageId: 'p',
    });
    expect(wrapper.text()).toContain('Partial restore');
  });
  it('rejects corrupt input without enabling restore and blocks writes in Dev Mode', async () => {
    vi.mocked(decodePanelBackup).mockRejectedValue(new Error('Backup integrity failed'));
    const { wrapper, controller } = setup('dev');
    expect(button(wrapper, 'Back up current page').attributes('disabled')).toBeDefined();
    await controller.load(new File(['bad'], 'bad.figwright-backup'));
    await flushPromises();
    expect(wrapper.text()).toContain('Backup integrity failed');
    expect(wrapper.findAll('button').some(b => b.text() === 'Restore to new page(s)')).toBe(false);
    expect(restorePanelBackup).not.toHaveBeenCalled();
  });
  it('keeps unsafe retries blocked until an uncertain task is checked', async () => {
    const { controller, dispatch } = setup();
    controller.state.jobId = 'job';
    controller.state.uncertainJob = true;
    dispatch.mockResolvedValue({ restoreId: 'job', state: 'running', phase: 'font Noto Sans SC' });
    await controller.checkJob();
    expect(controller.state.uncertainJob).toBe(true);
    dispatch.mockResolvedValue({
      restoreId: 'job',
      state: 'failed',
      phase: 'font Noto Sans SC',
      error: 'Restore cancelled',
    });
    await controller.checkJob();
    expect(controller.state.uncertainJob).toBe(false);
  });
});
