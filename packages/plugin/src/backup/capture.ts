import {
  type BackupSnapshot,
  BACKUP_NODE_FIELDS,
  MAX_BACKUP_CAPTURE_CHARS,
  DEFAULT_BACKUP_CAPTURE_CHARS,
  MAX_BACKUP_NODE_COUNT,
} from '@figwright/shared';

import { TimeSlice } from '../cooperative.js';
import { captureBackupDefinitions } from './definitions-capture.js';
import { copyBackupValue } from './raw-value.js';

// Explicitly versioned capture surface, independent of codegen's selective serializer. This is
// experimental: fields outside this list and design-system definitions are not captured yet.

const RUN_FIELDS = [
  'fontName',
  'fontSize',
  'fills',
  'textDecoration',
  'textCase',
  'lineHeight',
  'letterSpacing',
  'hyperlink',
  'listOptions',
  'indentation',
  'textStyleId',
  'fillStyleId',
  'boundVariables',
  'openTypeFeatures',
  'textWrapStyle',
] as const;

export const captureBackupSnapshot = async (
  figmaCtx: typeof figma,
  limits: { maxChars?: number; maxNodes?: number; pageId?: string } = {},
): Promise<BackupSnapshot> => {
  const maxChars = limits.maxChars ?? DEFAULT_BACKUP_CAPTURE_CHARS;
  const maxNodes = limits.maxNodes ?? MAX_BACKUP_NODE_COUNT;
  if (
    !Number.isSafeInteger(maxChars) ||
    maxChars <= 0 ||
    maxChars > MAX_BACKUP_CAPTURE_CHARS ||
    !Number.isSafeInteger(maxNodes) ||
    maxNodes <= 0 ||
    maxNodes > MAX_BACKUP_NODE_COUNT
  ) {
    throw new RangeError('Invalid backup capture limits');
  }
  if (figmaCtx.editorType !== 'figma')
    throw new Error('backup_design requires the Figma Design editor');
  const snapshot: BackupSnapshot = {
    captureVersion: 1,
    source: { name: figmaCtx.root.name, editorType: 'figma' },
    nodes: [],
    pageIds: [],
    issues: [
      {
        code: 'EXPERIMENTAL_CAPTURE',
        severity: 'unknown',
        message:
          'Capture coverage has not been verified by cross-file restore; this is an incomplete experimental snapshot.',
      },
      {
        code: 'ANIMATION_DEFINITIONS_NOT_CAPTURED',
        severity: 'missing',
        message:
          'Animation definitions and external-library publishing identities are not included.',
      },
      {
        code: 'CONSISTENCY_UNVERIFIED',
        severity: 'unknown',
        message:
          'Figma does not provide an atomic read transaction; edit-free consistency is not guaranteed.',
      },
    ],
  };
  const slice = new TimeSlice();
  let changed = false;
  const onChange = (): void => {
    changed = true;
  };
  // dynamic-page plugins must load the document before subscribing to documentchange.
  await figmaCtx.loadAllPagesAsync();
  const skipping = figmaCtx.skipInvisibleInstanceChildren;
  figmaCtx.on('documentchange', onChange);
  let chars = 0;
  try {
    figmaCtx.skipInvisibleInstanceChildren = false;
    const originalPageIds = figmaCtx.root.children.map(page => page.id).join(',');
    const pages = figmaCtx.root.children.filter(
      page => limits.pageId === undefined || page.id === limits.pageId,
    );
    if (pages.length === 0) throw new Error(`backup_design: page not found: ${limits.pageId}`);
    snapshot.pageIds = pages.map(page => page.id);
    for (const page of pages) {
      // Loading a page reads its nodes without changing the current page.
      // eslint-disable-next-line no-await-in-loop
      await page.loadAsync();
      const pending: (PageNode | SceneNode)[] = [page];
      while (pending.length > 0) {
        const node = pending.pop()!;
        if (snapshot.nodes.length >= maxNodes)
          throw new Error(
            `backup_design: node limit ${maxNodes} reached after ${snapshot.nodes.length} nodes (${chars} JSON characters); no backup was written`,
          );
        const children = 'children' in node ? [...node.children] : [];
        const captured: BackupSnapshot['nodes'][number] = {
          id: node.id,
          type: node.type,
          parentId: node.type === 'PAGE' ? null : node.parent!.id,
          children: children.map(child => child.id),
          properties: {},
        };
        const read = (field: string, getter: () => unknown): void => {
          try {
            const value = getter();
            captured.properties[field] =
              value === figmaCtx.mixed
                ? { state: 'mixed' }
                : { state: 'value', value: copyBackupValue(value) };
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            captured.properties[field] = { state: 'unreadable', message };
            snapshot.issues.push({
              code: 'UNREADABLE_PROPERTY',
              severity: 'missing',
              objectId: node.id,
              property: field,
              message,
            });
          }
        };
        for (const field of BACKUP_NODE_FIELDS) {
          if (field in node) read(field, () => (node as unknown as Record<string, unknown>)[field]);
        }
        if (node.type === 'TEXT' || node.type === 'TEXT_PATH') {
          read('styledTextSegments', () => node.getStyledTextSegments([...RUN_FIELDS]));
        }
        if (node.type === 'INSTANCE') {
          try {
            // eslint-disable-next-line no-await-in-loop
            const main = await node.getMainComponentAsync();
            read('mainComponentId', () => main?.id ?? null);
          } catch (error) {
            read('mainComponentId', () => {
              throw error;
            });
          }
        }
        // Image hashes and filters survive, but source assets are not in this milestone.
        if (
          JSON.stringify(captured.properties).includes('imageHash') ||
          JSON.stringify(captured.properties).includes('videoHash')
        ) {
          snapshot.issues.push({
            code: 'MEDIA_BYTES_NOT_CAPTURED',
            severity: 'missing',
            objectId: node.id,
            message: 'Media metadata captured; original image/video bytes are not included yet.',
          });
        }
        chars += JSON.stringify(captured).length;
        if (chars > maxChars)
          throw new Error(
            `backup_design: capture size limit ${maxChars} exceeded at ${chars} JSON characters after ${snapshot.nodes.length + 1} nodes; no backup was written`,
          );
        snapshot.nodes.push(captured);
        for (let i = children.length - 1; i >= 0; i--) pending.push(children[i]!);
        // eslint-disable-next-line no-await-in-loop
        if (slice.due()) await slice.yield();
        if (changed)
          throw new Error('backup_design: document changed during capture; retry without editing');
      }
    }
    if (
      figmaCtx.root.name !== snapshot.source.name ||
      figmaCtx.root.children.map(page => page.id).join(',') !== originalPageIds
    ) {
      throw new Error('backup_design: document changed during capture');
    }
    snapshot.definitions = await captureBackupDefinitions(figmaCtx, snapshot);
    if (changed) throw new Error('backup_design: document changed during definition capture');
    const totalChars = JSON.stringify(snapshot).length;
    if (totalChars > maxChars) {
      throw new Error(
        `backup_design: capture size limit ${maxChars} exceeded at ${totalChars} JSON characters after ${snapshot.nodes.length} nodes; no backup was written`,
      );
    }
    return snapshot;
  } finally {
    try {
      figmaCtx.skipInvisibleInstanceChildren = skipping;
    } finally {
      figmaCtx.off('documentchange', onChange);
    }
  }
};
