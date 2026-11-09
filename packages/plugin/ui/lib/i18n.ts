import { computed, ref } from 'vue';

// English messages are stable fallback keys. Unknown diagnostics remain verbatim.
const zh = {
  Activity: '活动',
  Context: '上下文',
  Backup: '备份',
  Debug: '调试',
  'Local backup · Figwright': '本地备份 · Figwright',
  Language: '语言',
  Automatic: '跟随系统',
  Idle: '空闲',
  Connecting: '连接中',
  Connected: '已连接',
  Reconnecting: '重新连接中',
  Disconnected: '未连接',
  'up {time}': '已连接 {time}',
  '{count} calls': '{count} 次调用',
  '{count} failed': '{count} 次失败',
  'Run in background': '后台运行',
  'Run in background — hides the panel; the relay stays connected. Reopen by running the plugin again.':
    '后台运行：隐藏面板并保持自动化连接，重新运行插件可打开面板。',
  'Drag to resize': '拖动以调整大小',
  File: '文件',
  Page: '页面',
  Editor: '编辑器',
  'Selection ({count})': '已选节点（{count}）',
  '…and {count} more': '…另有 {count} 项',
  'Nothing selected': '尚未选择节点',
  'Waiting for plugin context…': '等待插件上下文…',
  Copied: '已复制',
  Copy: '复制',
  'Connected and idle': '已连接，等待调用',
  'Waiting for the MCP client': '等待 MCP 客户端',
  'Tool calls from your agent will show up here.': 'AI 的工具调用将显示在这里。',
  'Start your agent — this panel connects automatically.': '启动 AI 客户端后，面板会自动连接。',
  'Reveal the nodes {method} touched': '定位 {method} 操作过的节点',
  'Select and zoom to the nodes this call touched': '选择并缩放到本次调用操作过的节点',
  'Started {time}': '开始于 {time}',
  Error: '错误',
  Request: '请求',
  'Payload → LLM': '发送给 AI 的数据',
  Connection: '连接',
  Session: '会话',
  ' (resumed)': '（已恢复）',
  Reconnects: '重连次数',
  Plugin: '插件',
  Server: '服务端',
  Calls: '调用',
  Total: '总计',
  Failed: '失败',
  'Avg (recent)': '近期平均耗时',
  'Recent errors': '最近错误',
  'No errors.': '暂无错误。',
  Diagnostics: '诊断',
  'Copy diagnostic bundle': '复制诊断信息',
  'For bug reports · includes your design content.': '用于问题反馈，包含你的设计内容。',
  'Showing the first part only — the full result was larger.': '仅显示开头部分，完整结果更大。',
  'Local page backup': '本地页面备份',
  'Save and restore editable designs directly in this plugin. No AI or server required.':
    '直接在插件内备份和恢复可编辑设计稿，无需 AI 或本地服务。',
  'Open a Figma Design file to back up or restore pages.':
    '请在 Figma Design 文件中备份或恢复页面。',
  'Save a page': '备份页面',
  'Waiting for file context…': '等待文件信息…',
  'Back up current page': '备份当前页面',
  'Download .figwright-backup': '下载 .figwright-backup 文件',
  'Experimental snapshot · {count} coverage issue(s). Keep another backup.':
    '实验性快照 · 有 {count} 条覆盖限制，请保留其他备份。',
  'Restore a backup': '恢复备份',
  'Choose a .figwright-backup file': '选择 .figwright-backup 文件',
  'Page from backup': '备份中的页面',
  'All captured pages': '全部已备份页面',
  'New page name (optional)': '新页面名称（可选）',
  'Original name (restored)': '原名称（已恢复）',
  '{nodes} nodes · {pages} new page(s)': '{nodes} 个节点 · 新建 {pages} 个页面',
  'Existing pages are preserved. Fonts and writable properties are checked during restore.':
    '保留现有页面，恢复时检查字体可用性及属性是否可写。',
  '{count} unsupported node(s). Partial restore may replace complex components with frames and lose their links.':
    '有 {count} 个不支持的节点。部分恢复可能将复杂组件替换为 Frame 并丢失组件关联。',
  'Review {count} coverage issue(s)': '查看 {count} 条覆盖限制',
  'Showing the first 50. Copy the report for more.': '仅显示前 50 条，复制报告可查看完整列表。',
  'I reviewed the issues and allow a partial restore. Unsupported content may lose properties or component links.':
    '我已阅读问题并允许部分恢复。不支持的内容可能丢失属性或组件关联。',
  'Restore to new page(s)': '恢复到新页面',
  'Progress and report': '进度与报告',
  'Backup task progress': '备份任务进度',
  'Keep this plugin open until the task finishes.': '请保持插件打开，直到任务完成。',
  'Cancel task': '取消任务',
  'Check restore task': '检查恢复任务',
  'Cancel restore task': '取消恢复任务',
  '{count} restore issue(s)': '{count} 条恢复问题',
  'Copy report': '复制报告',
  'Restore status is uncertain. Check the existing task before retrying to avoid duplicate pages.':
    '恢复状态尚不确定。请先检查原任务，避免重复创建页面。',
  'Reading the page…': '读取页面中…',
  'Collecting original images…': '收集原始图片中…',
  'Compressing and checking the backup…': '压缩并校验备份中…',
  'Preparing the restore…': '准备恢复中…',
  'Sending the backup to the canvas…': '向画布传输备份中…',
  'Loading fonts…': '加载字体中…',
  'Waiting for other edits…': '等待其他编辑操作完成…',
  'Rebuilding components and overrides…': '重建组件与覆盖中…',
  'Restoring interactions…': '恢复交互中…',
  'Restoring layers and design resources…': '恢复图层与设计资源中…',
  'Cancelling and cleaning up…': '取消并清理中…',
  'Cancelling…': '取消中…',
  Cancelled: '已取消',
  'Cancelled; newly created items were cleaned up': '已取消，本次新建内容已清理',
  'Checking the backup…': '校验备份中…',
  'Ready to download · {nodes} nodes · {images} images':
    '可下载 · {nodes} 个节点 · {images} 张图片',
  'Download requested. Check your downloads.': '已请求下载，请确认文件已保存到下载目录。',
  'Archive integrity verified. Review coverage before restoring.':
    '归档完整性校验通过，恢复前请阅读覆盖限制。',
  'Created {pages} new page(s) · {nodes} nodes. {outcome}':
    '已新建 {pages} 个页面 · {nodes} 个节点。{outcome}',
  'Partial restore — review the report.': '部分恢复，请查看报告。',
  'Restore finished.': '恢复完成。',
  'Restore finished. Review the report.': '恢复完成，请查看报告。',
  'Restore failed': '恢复失败',
  'Cancellation requested. Check the task until cleanup finishes.':
    '已请求取消，请检查任务直到清理完成。',
  'Restore is still running. Keep the plugin open and check again.':
    '恢复仍在进行，请保持插件打开并再次检查。',
  'Backup exceeds the 256 MiB file limit': '备份文件超过 256 MiB 上限',
  'Backup has no pages to restore': '备份中没有可恢复的页面',
  'Review the listed issues and explicitly allow a partial restore to proceed':
    '请阅读列出的问题，并明确允许部分恢复后继续',
  'Plugin did not honor the capture limit': '插件未遵守捕获大小限制',
  'Inconsistent backup transfer': '备份传输数据不一致',
  'Plugin did not capture the selected page': '插件未捕获所选页面',
  'Restore exceeds the transfer limit': '恢复数据超过传输上限',
  'Inconsistent restore upload acknowledgment': '恢复上传确认不一致',
  'This Figma browser does not support local gzip. Update Figma and try again.':
    '当前 Figma 内置浏览器不支持本地 gzip，请更新 Figma 后重试。',
  'Backup exceeds the 256 MiB limit': '备份超过 256 MiB 上限',
  'Expanded backup exceeds the 256 MiB limit': '解压后的备份超过 256 MiB 上限',
  'Capture coverage has not been verified by cross-file restore; this is an incomplete experimental snapshot.':
    '尚未通过跨文件恢复验证全部捕获范围，这是不完整的实验性快照。',
  'Animation definitions and external-library publishing identities are not included.':
    '不包含动画定义与外部组件库的发布身份信息。',
  'Figma does not provide an atomic read transaction; edit-free consistency is not guaranteed.':
    'Figma 不提供原子读取事务，无法保证捕获期间的数据完全一致。',
  'Dev Mode blocks every write — nodes, pages, variables and styles alike. Reads, exports (screenshots, PDF) and plugin data still work. Switch the file to Design mode to make changes.':
    'Dev Mode 禁止写入节点、页面、变量和样式；仍支持读取、截图/PDF 导出与插件数据。请切换到 Design 模式以编辑。',
  'FigJam has no components, variables or styles, so the tools that read or edit them fail there — frames, sections, shapes and text all work. Open a Figma Design file for the rest.':
    'FigJam 不支持组件、变量和样式的读取或编辑；支持 Frame、分区、形状和文本。其他能力请使用 Figma Design 文件。',
  now: '刚刚',
  '{count}s': '{count}秒',
  '{count}m': '{count}分',
  '{count}h': '{count}时',
} as const;
export type MessageKey = keyof typeof zh;
export type TextValues = Record<string, string | number>;
export type UiText = string | { key: MessageKey; values?: TextValues };
export type LanguagePreference = 'auto' | 'en' | 'zh-CN';
const storageKey = 'figwright.language';
export const detectLanguage = (languages: readonly string[]): 'en' | 'zh-CN' =>
  languages[0]?.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
const storedPreference = (): LanguagePreference => {
  if (typeof window === 'undefined') return 'auto';
  try {
    const value = localStorage.getItem(storageKey);
    return value === 'en' || value === 'zh-CN' ? value : 'auto';
  } catch {
    return 'auto'; // Figma null-origin frames can deny storage.
  }
};
const systemLanguage = ref(
  detectLanguage(typeof navigator === 'undefined' ? [] : navigator.languages),
);
export const languagePreference = ref<LanguagePreference>(storedPreference());
export const locale = computed(() =>
  languagePreference.value === 'auto' ? systemLanguage.value : languagePreference.value,
);
export const refreshSystemLanguage = (): void => {
  systemLanguage.value = detectLanguage(navigator.languages);
};
export const setLanguage = (value: LanguagePreference): void => {
  languagePreference.value = value;
  try {
    localStorage.setItem(storageKey, value);
  } catch {
    /* Session language still works. */
  }
};
export const t = (key: string, values: TextValues = {}): string => {
  const template = locale.value === 'zh-CN' && Object.hasOwn(zh, key) ? zh[key as MessageKey] : key;
  // Only interpolate application-owned messages; diagnostic payloads may contain braces.
  return Object.hasOwn(zh, key)
    ? template.replace(/\{(\w+)\}/gu, (match, name: string) => String(values[name] ?? match))
    : template;
};
export const text = (value: UiText): string =>
  typeof value === 'string' ? t(value) : t(value.key, value.values);
export const issueText = (issue: { message: string }): string => {
  // Restore preflight prefixes capture diagnostics without changing their archived English text.
  const capture = /^Capture [A-Z_]+: (.+)$/u.exec(issue.message);
  const message = capture?.[1] ?? issue.message;
  const translated = t(message);
  return translated === message ? issue.message : translated;
};
