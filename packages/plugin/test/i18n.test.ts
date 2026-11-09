// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  detectLanguage,
  issueText,
  languagePreference,
  locale,
  refreshSystemLanguage,
  setLanguage,
  t,
} from '../ui/lib/i18n.js';

afterEach(() => {
  languagePreference.value = 'en';
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('panel language preference', () => {
  it('follows browser language by default and falls back to English for other languages', () => {
    expect(detectLanguage(['zh-Hans-CN'])).toBe('zh-CN');
    expect(detectLanguage(['zh-TW'])).toBe('zh-CN');
    expect(detectLanguage(['en-GB'])).toBe('en');
    expect(detectLanguage(['fr'])).toBe('en');
    expect(detectLanguage([])).toBe('en');
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['zh-CN']);
    refreshSystemLanguage();
    languagePreference.value = 'auto';
    expect(locale.value).toBe('zh-CN');
    expect(t('Backup')).toBe('备份');
    setLanguage('en');
    expect(t('Backup')).toBe('Backup');
    expect(localStorage.getItem('figwright.language')).toBe('en');
  });
  it('keeps language switching usable if Figma denies localStorage', () => {
    vi.stubGlobal('localStorage', {
      setItem: () => {
        throw new Error('denied');
      },
    });
    expect(() => setLanguage('zh-CN')).not.toThrow();
    expect(t('Review {count} coverage issue(s)', { count: 3 })).toBe('查看 3 条覆盖限制');
  });
  it('translates known coverage diagnostics while preserving unfamiliar technical data', () => {
    setLanguage('zh-CN');
    expect(
      issueText({
        message:
          'Capture CONSISTENCY_UNVERIFIED: Figma does not provide an atomic read transaction; edit-free consistency is not guaranteed.',
      }),
    ).toContain('不提供原子读取事务');
    expect(t('node={nodeId}, error={reason}', { nodeId: 3, reason: 'unchanged' })).toBe(
      'node={nodeId}, error={reason}',
    );
    expect(issueText({ message: 'Unexpected API error: {nodeId}' })).toBe(
      'Unexpected API error: {nodeId}',
    );
  });
  it('restores a saved preference and handles unavailable storage on initialization', async () => {
    localStorage.setItem('figwright.language', 'zh-CN');
    vi.resetModules();
    const saved = await import('../ui/lib/i18n.js');
    expect(saved.languagePreference.value).toBe('zh-CN');
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied');
      },
    });
    vi.resetModules();
    const denied = await import('../ui/lib/i18n.js');
    expect(denied.languagePreference.value).toBe('auto');
  });
});
