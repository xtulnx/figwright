import {
  planBackupRestore,
  selectBackupDefinitions,
  BACKUP_NODE_FIELDS,
  RESTORABLE_NODE_TYPES,
  type RestorePayload,
  type RestoreIssue,
  type RestoreResultSchema,
} from '@figwright/shared';
import type { z } from 'zod';

import { TimeSlice } from '../cooperative.js';
import {
  createRestoredDefinitions,
  remapBackupAliases,
  restoreBackupDefinitions,
} from './definitions-restore.js';
import { RestoreExecution, RestoreInterrupted } from './execution.js';
import { mapBackupInstanceChildren } from './instances-restore.js';
import { sameBackupValue } from './raw-value.js';

// Derived, immutable and separately handled properties must never be blindly assigned.
const ALLOWED = new Set([...BACKUP_NODE_FIELDS, 'styledTextSegments', 'mainComponentId']);
const SPECIAL = new Set(
  `width height x y rotation relativeTransform characters fontName styledTextSegments vectorNetwork vectorPaths reactions name`.split(
    ' ',
  ),
);
const REFERENCES = new Set(
  `fillStyleId strokeStyleId effectStyleId gridStyleId textStyleId boundVariables explicitVariableModes componentPropertyDefinitions componentProperties componentPropertyReferences overrides variantProperties mainComponentId flowStartingPoints prototypeStartNodeID`.split(
    ' ',
  ),
);
const STYLE_SETTERS: Record<string, string> = {
  fillStyleId: 'setFillStyleIdAsync',
  strokeStyleId: 'setStrokeStyleIdAsync',
  effectStyleId: 'setEffectStyleIdAsync',
  gridStyleId: 'setGridStyleIdAsync',
  textStyleId: 'setTextStyleIdAsync',
};
const LATE = new Set(
  `layoutSizingHorizontal layoutSizingVertical primaryAxisSizingMode counterAxisSizingMode textAutoResize textTruncation maxLines`.split(
    ' ',
  ),
);
const RUN_SETTERS: Record<string, string> = {
  fontName: 'setRangeFontName',
  fontSize: 'setRangeFontSize',
  fills: 'setRangeFills',
  textDecoration: 'setRangeTextDecoration',
  textCase: 'setRangeTextCase',
  lineHeight: 'setRangeLineHeight',
  letterSpacing: 'setRangeLetterSpacing',
  hyperlink: 'setRangeHyperlink',
  listOptions: 'setRangeListOptions',
  indentation: 'setRangeIndentation',
  openTypeFeatures: 'setRangeOpenTypeFeatures',
  textWrapStyle: 'setRangeTextWrapStyle',
  textStyleId: 'setRangeTextStyleIdAsync',
  fillStyleId: 'setRangeFillStyleIdAsync',
};

export const restoreBackupSnapshot = async (
  ctx: typeof figma,
  payload: RestorePayload,
  execution = new RestoreExecution(),
): Promise<z.infer<typeof RestoreResultSchema>> => {
  if (ctx.editorType !== 'figma') throw new Error('restore_backup requires Figma Design');
  const plan = planBackupRestore(payload.snapshot, payload.pageId);
  const capturedDefinitions = selectBackupDefinitions(
    payload.snapshot.definitions,
    plan.nodes.map(node => node.properties),
  );
  if (!payload.allowPartial && plan.issues.length)
    throw new Error(
      'Restore preflight found incomplete capture or unsupported nodes; inspect the backup and explicitly allowPartial to proceed',
    );
  const issues: RestoreIssue[] = [...plan.issues];
  const reported = new Set<string>();
  const add = (objectId: string, property: string, error: unknown): void => {
    const message = error instanceof Error ? error.message : String(error);
    const key = JSON.stringify([objectId, property, message]);
    if (reported.has(key)) return;
    reported.add(key);
    issues.push({ objectId, property, message });
  };
  const fonts = new Map<string, FontName>();
  const collectFonts = (value: unknown): void => {
    if (value === null || typeof value !== 'object') return;
    const record = value as Record<string, unknown>;
    if (typeof record.family === 'string' && typeof record.style === 'string') {
      fonts.set(JSON.stringify(record), record as unknown as FontName);
    }
    for (const child of Object.values(record)) collectFonts(child);
  };
  for (const node of plan.nodes) if (node.type === 'TEXT') collectFonts(node.properties);
  collectFonts(capturedDefinitions?.styles);
  const loadedFonts = new Set<string>();
  const loadFont = async (font: FontName, phase: string): Promise<void> => {
    const key = JSON.stringify(font);
    if (loadedFonts.has(key)) return;
    await execution.wait(ctx.loadFontAsync(font), phase);
    loadedFonts.add(key);
  };
  // Missing fonts are fatal before creating any page; silently substituting changes layout.
  for (const font of fonts.values()) {
    // eslint-disable-next-line no-await-in-loop
    await loadFont(font, `font ${font.family}/${font.style}`);
  }
  const byId = new Map(plan.nodes.map(node => [node.id, node]));
  const nativeFields = new Map<string, Set<string>>();
  const explicitOverrides = new Map<string, Set<string>>();
  for (const [id, info] of plan.instances.native) {
    const pending = [id];
    while (pending.length) {
      const source = byId.get(pending.pop()!)!;
      const fields = new Set(info.overrides.get(source.id) ?? []);
      explicitOverrides.set(source.id, new Set(fields));
      nativeFields.set(source.id, fields);
      pending.push(...source.children);
    }
    for (const field of [
      'relativeTransform',
      'x',
      'y',
      'rotation',
      'layoutAlign',
      'layoutGrow',
      'layoutPositioning',
      'layoutSizingHorizontal',
      'layoutSizingVertical',
      'constraints',
      'explicitVariableModes',
    ])
      nativeFields.get(id)!.add(field);
  }
  const propertiesFor = (source: (typeof plan.nodes)[number]): typeof source.properties => {
    const fields = nativeFields.get(source.id);
    if (!fields) return source.properties;
    const props = Object.fromEntries(
      Object.entries(source.properties).filter(([field]) => fields.has(field)),
    );
    const runs = source.properties.styledTextSegments;
    if (
      runs?.state === 'value' &&
      Array.isArray(runs.value) &&
      [...fields].some(field => RUN_SETTERS[field])
    )
      props.styledTextSegments = {
        state: 'value',
        value: runs.value.map(item =>
          Object.fromEntries(
            Object.entries(item as object).filter(
              ([field]) => ['start', 'end'].includes(field) || fields.has(field),
            ),
          ),
        ),
      };
    const bindings = source.properties.boundVariables;
    if (bindings?.state === 'value' && bindings.value && typeof bindings.value === 'object') {
      const selected = Object.fromEntries(
        Object.entries(bindings.value).filter(([field]) => fields.has(field)),
      );
      if (Object.keys(selected).length) props.boundVariables = { state: 'value', value: selected };
    }
    return props;
  };
  const definitions = createRestoredDefinitions();
  const pages: PageNode[] = [];
  const created: BaseNode[] = [];
  const map = new Map<string, PageNode | SceneNode>();
  const imageHashes = new Map<string, string>();
  const slice = new TimeSlice();
  const skipping = ctx.skipInvisibleInstanceChildren;
  try {
    ctx.skipInvisibleInstanceChildren = false;
    for (const [hash, encoded] of Object.entries(payload.images))
      imageHashes.set(hash, ctx.createImage(ctx.base64Decode(encoded)).hash);
    const styleId = (id: string): string => {
      const style = definitions.styles.get(id);
      if (!style) throw new Error(`Style definition unavailable: ${id}`);
      return style.id;
    };
    const remap = (value: unknown, objectId: string, property: string): unknown => {
      if (Array.isArray(value)) return value.map(child => remap(child, objectId, property));
      if (value === null || typeof value !== 'object') return value;
      if ((value as Record<string, unknown>).type === 'VARIABLE_ALIAS')
        return remapBackupAliases(value, definitions);
      const result: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(value)) {
        if (['__proto__', 'constructor', 'prototype'].includes(key))
          throw new Error('Unsafe property in backup value');
        if (key === 'videoHash' && child) throw new Error('Video resource bytes are not captured');
        if (key === 'boundVariables') {
          if (child && Object.keys(child as object).length) {
            const bindings: Record<string, unknown> = {};
            for (const [field, alias] of Object.entries(child)) {
              try {
                bindings[field] = remapBackupAliases(alias, definitions);
              } catch {
                add(
                  objectId,
                  property,
                  'Variable binding omitted; captured resolved value retained because definitions are unavailable',
                );
              }
            }
            if (Object.keys(bindings).length) result[key] = bindings;
          }
          continue;
        }
        if (key === 'variableId' && typeof child === 'string') {
          const variable = definitions.variables.get(child);
          if (!variable) throw new Error(`Prototype variable unavailable: ${child}`);
          result[key] = variable.id;
          continue;
        }
        if (key === 'variableCollectionId' && typeof child === 'string') {
          const collection = definitions.collections.get(child);
          if (!collection) throw new Error(`Prototype variable collection unavailable: ${child}`);
          result[key] = collection.id;
          continue;
        }
        if (key === 'variableModeId' && typeof child === 'string') {
          const collectionId = (value as Record<string, unknown>).variableCollectionId;
          const mode =
            typeof collectionId === 'string'
              ? definitions.modes.get(collectionId)?.get(child)
              : undefined;
          if (!mode) throw new Error(`Prototype variable mode unavailable: ${child}`);
          result[key] = mode;
          continue;
        }
        if (key === 'imageHash' && typeof child === 'string') {
          const hash = imageHashes.get(child);
          if (!hash) throw new Error(`Original image bytes unavailable: ${child}`);
          result[key] = hash;
        } else if (['destinationId', 'sourceNodeId'].includes(key) && typeof child === 'string') {
          const target = map.get(child);
          if (!target) throw new Error(`Unresolved prototype destination: ${child}`);
          result[key] = target.id;
        } else if (
          key === 'value' &&
          (value as Record<string, unknown>).type === 'NODE' &&
          typeof child === 'string'
        ) {
          const target = map.get(child);
          if (!target) throw new Error(`Unresolved node hyperlink: ${child}`);
          result[key] = target.id;
        } else result[key] = remap(child, objectId, property);
      }
      return result;
    };
    await restoreBackupDefinitions(
      ctx,
      capturedDefinitions,
      definitions,
      issues,
      remap,
      execution,
      loadedFonts,
    );
    // Create the complete hierarchy first, so every node reference can be resolved on apply.
    for (const source of plan.nodes) {
      if (nativeFields.has(source.id)) continue;
      execution.check();
      execution.phase = `create ${source.id}`;
      let node: PageNode | SceneNode;
      const parent = source.parentId === null ? undefined : map.get(source.parentId);
      if (source.type !== 'PAGE' && (!parent || !('appendChild' in parent)))
        throw new Error(`Invalid non-container parent for ${source.id}`);
      switch (source.type) {
        case 'PAGE':
          node = ctx.createPage();
          pages.push(node);
          break;
        case 'RECTANGLE':
          node = ctx.createRectangle();
          break;
        case 'ELLIPSE':
          node = ctx.createEllipse();
          break;
        case 'LINE':
          node = ctx.createLine();
          break;
        case 'POLYGON':
          node = ctx.createPolygon();
          break;
        case 'STAR':
          node = ctx.createStar();
          break;
        case 'VECTOR':
          node = ctx.createVector();
          break;
        case 'TEXT':
          node = ctx.createText();
          break;
        case 'COMPONENT':
          node = ctx.createComponent();
          break;
        case 'SECTION':
          node = ctx.createSection();
          break;
        case 'GROUP': {
          if (!parent || !('appendChild' in parent)) throw new Error('Invalid group parent');
          const placeholder = ctx.createRectangle();
          created.push(placeholder);
          node = ctx.group([placeholder], parent);
          // Keep the group alive until its real children have been appended.
          break;
        }
        default:
          node = ctx.createFrame();
          node.fills = [];
          node.clipsContent = false;
      }
      created.push(node);
      map.set(source.id, node);
      if (source.type !== 'PAGE' && parent && 'appendChild' in parent)
        parent.appendChild(node as SceneNode);
      const name = source.properties.name;
      node.name =
        source.type === 'PAGE'
          ? (payload.pageName ??
            `${name?.state === 'value' ? String(name.value) : 'Page'} (restored)`)
          : name?.state === 'value'
            ? String(name.value)
            : source.type;
      if (node.type === 'TEXT') {
        // eslint-disable-next-line no-await-in-loop
        await loadFont(node.fontName as FontName, `node font ${source.id}`);
      }
      // eslint-disable-next-line no-await-in-loop
      if (slice.due()) await slice.yield();
    }
    for (const source of plan.nodes) {
      const node = map.get(source.id)!;
      if (source.type === 'GROUP' && node?.type === 'GROUP') node.children[0]!.remove();
    }
    const parallelNodes = async (
      nodes: typeof plan.nodes,
      work: (source: (typeof plan.nodes)[number]) => Promise<void>,
    ): Promise<void> => {
      for (let offset = 0; offset < nodes.length; offset += 64) {
        // eslint-disable-next-line no-await-in-loop
        const results = await Promise.allSettled(
          nodes.slice(offset, offset + 64).map(async source => {
            execution.check();
            await work(source);
          }),
        );
        const failed = results.find(result => result.status === 'rejected');
        if (failed?.status === 'rejected') throw failed.reason;
        // eslint-disable-next-line no-await-in-loop
        if (slice.due()) await slice.yield();
      }
    };
    const applyStyleLinks = async (source: (typeof plan.nodes)[number]): Promise<void> => {
      const node = map.get(source.id)!;
      const target = node as unknown as Record<string, unknown>;
      const props = propertiesFor(source);
      for (const [field, setter] of Object.entries(STYLE_SETTERS)) {
        const ref = props[field];
        if (ref?.state !== 'value' || typeof ref.value !== 'string' || !ref.value) continue;
        try {
          const id = styleId(ref.value);
          if (target[field] === id && !explicitOverrides.get(source.id)?.has(field)) continue;
          const fn = target[setter];
          if (typeof fn !== 'function') throw new Error(`Style setter unavailable: ${setter}`);
          // eslint-disable-next-line no-await-in-loop
          await execution.wait(Promise.resolve(fn.call(node, id)), `${source.id}.${field}`);
        } catch (error) {
          if (error instanceof RestoreInterrupted) throw error;
          add(source.id, field, error);
        }
      }
    };
    const applyReactions = async (source: (typeof plan.nodes)[number]): Promise<void> => {
      const node = map.get(source.id)!;
      const prop = propertiesFor(source).reactions;
      if (!('setReactionsAsync' in node) || prop?.state !== 'value') return;
      try {
        const reactions = remap(prop.value, source.id, 'reactions') as Reaction[];
        if (
          !sameBackupValue(node.reactions, reactions) ||
          explicitOverrides.get(source.id)?.has('reactions')
        )
          await execution.wait(node.setReactionsAsync(reactions), `${source.id}.reactions`);
      } catch (error) {
        if (error instanceof RestoreInterrupted) throw error;
        add(source.id, 'reactions', error);
      }
    };
    const apply = async (source: (typeof plan.nodes)[number], late: boolean): Promise<void> => {
      execution.check();
      execution.phase = `apply ${source.id}`;
      const node = map.get(source.id)!;
      const target = node as unknown as Record<string, unknown>;
      const props = propertiesFor(source);
      const values = Object.fromEntries(
        Object.entries(props)
          .filter(([, v]) => v.state === 'value')
          .map(([key, v]) => [key, v.state === 'value' ? v.value : null]),
      );
      const attempt = async (
        property: string,
        write: () => void | Promise<void>,
      ): Promise<void> => {
        try {
          execution.check();
          const result = write();
          if (result !== undefined) {
            if (property === 'characters') await result;
            else await execution.wait(Promise.resolve(result), `${source.id}.${property}`);
          }
        } catch (error) {
          if (error instanceof RestoreInterrupted) throw error;
          add(source.id, property, error);
        }
      };
      if (!late && nativeFields.has(source.id) && props.name?.state === 'value')
        node.name = String(props.name.value);
      if (!late) await applyStyleLinks(source);
      if (!late)
        for (const [property, wrapped] of Object.entries(props)) {
          if (!ALLOWED.has(property))
            add(source.id, property, 'Unknown backup property; refused arbitrary assignment');
          if (
            wrapped.state === 'mixed' &&
            !(
              node.type === 'TEXT' &&
              (RUN_SETTERS[property] ||
                ['textStyleId', 'fillStyleId', 'boundVariables'].includes(property)) &&
              values.styledTextSegments
            )
          )
            add(source.id, property, 'Mixed property cannot be restored without per-range data');
        }
      for (const [property, value] of Object.entries(values)) {
        if (!ALLOWED.has(property)) continue;
        if (property.startsWith('grid') && !['gridStyleId'].includes(property)) {
          const childField = /AnchorIndex$|Span$|^gridChild/u.test(property);
          const layout = childField
            ? (node.parent as FrameNode | null)?.layoutMode
            : (node as FrameNode).layoutMode;
          if (layout !== 'GRID') continue;
        }
        if (SPECIAL.has(property) || LATE.has(property) !== late) continue;
        if (
          [
            'boundVariables',
            'explicitVariableModes',
            'flowStartingPoints',
            ...Object.keys(STYLE_SETTERS),
          ].includes(property)
        )
          continue;
        if (REFERENCES.has(property)) {
          if (
            !late &&
            value !== '' &&
            value !== null &&
            (typeof value !== 'object' || Object.keys(value).length > 0)
          )
            add(source.id, property, 'Definition/reference restoration is not implemented');
          continue;
        }
        // eslint-disable-next-line no-await-in-loop
        await attempt(property, () => {
          if (!(property in target))
            throw new Error(`Property is unavailable on restored ${node.type}`);
          const restoredValue = remap(value, source.id, property);
          if (explicitOverrides.get(source.id)?.has(property)) target[property] = restoredValue;
          else if (!sameBackupValue(target[property], restoredValue))
            target[property] = restoredValue;
        });
      }
      if (late) return;
      if (node.type === 'TEXT' && ('characters' in values || 'styledTextSegments' in values)) {
        await attempt('characters', async () => {
          await loadFont(node.fontName as FontName, `node font ${source.id}`);
          const runs = Array.isArray(values.styledTextSegments)
            ? (values.styledTextSegments as Record<string, unknown>[])
            : [];
          const firstFont = values.fontName ?? runs.find(run => run.fontName)?.fontName;
          if (
            firstFont &&
            (!sameBackupValue(node.fontName, firstFont) ||
              explicitOverrides.get(source.id)?.has('fontName'))
          )
            node.fontName = firstFont as FontName;
          if (
            typeof values.characters === 'string' &&
            (node.characters !== values.characters || nativeFields.has(source.id))
          )
            node.characters = values.characters;
          for (const run of runs) {
            for (const [key, value] of Object.entries(run).toSorted(
              ([a], [b]) => Number(!a.endsWith('StyleId')) - Number(!b.endsWith('StyleId')),
            )) {
              if (
                key.endsWith('StyleId') &&
                value === '' &&
                props[key]?.state === 'value' &&
                props[key].value === ''
              )
                continue;
              if (['start', 'end', 'characters', 'boundVariables'].includes(key)) continue;
              const setter = RUN_SETTERS[key];
              if (!setter) {
                if (
                  value !== '' &&
                  value !== null &&
                  (typeof value !== 'object' || Object.keys(value as object).length)
                )
                  add(
                    source.id,
                    `styledTextSegments.${key}`,
                    'Text run property is not restorable yet',
                  );
                continue;
              }
              const fn = target[setter];
              if (typeof fn !== 'function') {
                if (
                  key === 'openTypeFeatures' &&
                  JSON.stringify(
                    node.getRangeOpenTypeFeatures(run.start as number, run.end as number),
                  ) === JSON.stringify(value)
                )
                  continue;
                add(source.id, key, `${setter} is unavailable`);
                continue;
              }
              try {
                const restoredValue =
                  key.endsWith('StyleId') && typeof value === 'string' && value
                    ? styleId(value)
                    : remap(value, source.id, `styledTextSegments.${key}`);
                const getter = target[setter.replace(/^set/u, 'get').replace(/Async$/u, '')];
                if (
                  !explicitOverrides.get(source.id)?.has(key) &&
                  typeof getter === 'function' &&
                  sameBackupValue(getter.call(node, run.start, run.end), restoredValue)
                )
                  continue;
                // eslint-disable-next-line no-await-in-loop
                await execution.wait(
                  Promise.resolve(fn.call(node, run.start, run.end, restoredValue)),
                  `text range ${source.id}.${key}`,
                );
              } catch (error) {
                if (error instanceof RestoreInterrupted) throw error;
                add(source.id, key, error);
              }
            }
          }
        });
      }
      if (node.type === 'VECTOR' && values.vectorNetwork) {
        await attempt('vectorNetwork', async () => {
          const network = remap(values.vectorNetwork, source.id, 'vectorNetwork') as VectorNetwork;
          if (!sameBackupValue(node.vectorNetwork, network))
            await node.setVectorNetworkAsync(network);
        });
      } else if ('vectorPaths' in node && values.vectorPaths)
        await attempt('vectorPaths', () => {
          const paths = remap(values.vectorPaths, source.id, 'vectorPaths') as VectorPaths;
          if (!sameBackupValue((node as VectorNode).vectorPaths, paths))
            (node as VectorNode).vectorPaths = paths;
        });
      if (!RESTORABLE_NODE_TYPES.has(source.type) && 'clipsContent' in node)
        node.clipsContent = false;
    };
    const applyReferences = async (source: (typeof plan.nodes)[number]): Promise<void> => {
      execution.check();
      execution.phase = `apply ${source.id}`;
      const node = map.get(source.id)!;
      const target = node as unknown as Record<string, unknown>;
      const props = propertiesFor(source);
      const attempt = async (
        property: string,
        write: () => void | Promise<void>,
      ): Promise<void> => {
        try {
          execution.check();
          const result = write();
          if (result !== undefined) {
            if (property === 'characters') await result;
            else await execution.wait(Promise.resolve(result), `${source.id}.${property}`);
          }
        } catch (error) {
          if (error instanceof RestoreInterrupted) throw error;
          add(source.id, property, error);
        }
      };
      const modes = props.explicitVariableModes;
      if (modes?.state === 'value' && modes.value && typeof modes.value === 'object')
        for (const [collectionId, modeId] of Object.entries(modes.value)) {
          // eslint-disable-next-line no-await-in-loop
          await attempt('explicitVariableModes', () => {
            const collection = definitions.collections.get(collectionId);
            const mode =
              typeof modeId === 'string'
                ? definitions.modes.get(collectionId)?.get(modeId)
                : undefined;
            if (!collection || !mode || !('setExplicitVariableModeForCollection' in node))
              throw new Error(`Variable mode unavailable: ${collectionId}/${String(modeId)}`);
            node.setExplicitVariableModeForCollection(collection, mode);
          });
        }
      const bindings = props.boundVariables;
      if (bindings?.state === 'value' && bindings.value && typeof bindings.value === 'object')
        for (const [field, alias] of Object.entries(bindings.value)) {
          // Array fields are summaries; their precise bindings live in paints/effects/text runs.
          if (Array.isArray(alias)) continue;
          // eslint-disable-next-line no-await-in-loop
          await attempt('boundVariables.' + field, () => {
            const variable =
              alias && typeof alias === 'object' && 'id' in alias
                ? definitions.variables.get(String(alias.id))
                : undefined;
            if (!variable || typeof target.setBoundVariable !== 'function')
              throw new Error(`Node variable unavailable: ${field}`);
            (target.setBoundVariable as (field: string, variable: Variable) => void).call(
              node,
              field,
              variable,
            );
          });
        }
      const runs = props.styledTextSegments;
      if (node.type === 'TEXT' && runs?.state === 'value' && Array.isArray(runs.value))
        for (const item of runs.value) {
          const run = item as Record<string, unknown>;
          if (!run.boundVariables || typeof run.boundVariables !== 'object') continue;
          for (const [field, alias] of Object.entries(run.boundVariables)) {
            if (Array.isArray(alias)) continue;
            // eslint-disable-next-line no-await-in-loop
            await attempt(`styledTextSegments.boundVariables.${field}`, () => {
              const variable =
                alias && typeof alias === 'object' && 'id' in alias
                  ? definitions.variables.get(String(alias.id))
                  : undefined;
              if (!variable) throw new Error(`Text range variable unavailable: ${field}`);
              node.setRangeBoundVariable(
                run.start as number,
                run.end as number,
                field as VariableBindableTextField,
                variable,
              );
            });
          }
        }
    };
    const applyGeometry = (source: (typeof plan.nodes)[number]): void => {
      execution.check();
      execution.phase = `apply ${source.id}`;
      const node = map.get(source.id)!;
      const target = node as unknown as Record<string, unknown>;
      const props = propertiesFor(source);
      const values = Object.fromEntries(
        Object.entries(props)
          .filter(([, v]) => v.state === 'value')
          .map(([key, v]) => [key, v.state === 'value' ? v.value : null]),
      );
      const attempt = (property: string, write: () => void): void => {
        try {
          write();
        } catch (error) {
          if (error instanceof RestoreInterrupted) throw error;
          add(source.id, property, error);
        }
      };
      if (
        'resize' in node &&
        source.type !== 'GROUP' &&
        typeof values.width === 'number' &&
        typeof values.height === 'number'
      ) {
        attempt('size', () => node.resize(values.width as number, values.height as number));
      }
      if ('relativeTransform' in node && values.relativeTransform)
        attempt('relativeTransform', () => {
          node.relativeTransform = values.relativeTransform as Transform;
        });
      else
        for (const property of ['x', 'y', 'rotation'])
          if (property in values && property in target) {
            attempt(property, () => {
              target[property] = values[property];
            });
          }
    };
    // Fully prepare main components before creating native instances, so copied descendants
    // inherit their restored styles, bindings and geometry rather than Figma creation defaults.
    const base = plan.nodes.filter(source => !nativeFields.has(source.id));
    await parallelNodes(base, applyStyleLinks);
    if (plan.instances.native.size) {
      for (const source of base) {
        // eslint-disable-next-line no-await-in-loop
        await apply(source, false);
      }
      for (const source of base.toReversed()) {
        applyGeometry(source);
        // eslint-disable-next-line no-await-in-loop
        await apply(source, true);
      }
      for (const source of base) {
        // eslint-disable-next-line no-await-in-loop
        await applyReferences(source);
      }
    }
    for (const [id, info] of plan.instances.native) {
      execution.check();
      execution.phase = `instance ${id}`;
      const source = byId.get(id)!;
      const main = map.get(info.mainId);
      const parent = source.parentId === null ? undefined : map.get(source.parentId);
      if (main?.type !== 'COMPONENT' || !parent || !('appendChild' in parent))
        throw new Error(`Native instance dependencies unavailable: ${id}`);
      const instance = main.createInstance();
      created.push(instance);
      parent.appendChild(instance);
      const mapped = mapBackupInstanceChildren(source, instance, byId, map);
      for (const [oldId, restoredNode] of mapped) map.set(oldId, restoredNode);
      // eslint-disable-next-line no-await-in-loop
      if (slice.due()) await slice.yield();
    }
    // Deferred instance insertion must not change sibling stacking or auto-layout order.
    for (const source of plan.nodes) {
      const parent = map.get(source.id)!;
      if ('insertChild' in parent && !nativeFields.has(source.id))
        for (const [index, childId] of source.children.entries())
          parent.insertChild(index, map.get(childId) as SceneNode);
    }
    for (const source of plan.nodes) {
      // eslint-disable-next-line no-await-in-loop
      await apply(source, false);
      // eslint-disable-next-line no-await-in-loop
      if (slice.due()) await slice.yield();
    }
    for (const source of plan.nodes.toReversed()) applyGeometry(source);
    for (const source of plan.nodes.toReversed()) {
      // eslint-disable-next-line no-await-in-loop
      await apply(source, true);
    }
    for (const source of plan.nodes) {
      // eslint-disable-next-line no-await-in-loop
      await applyReferences(source);
    }
    await parallelNodes(plan.nodes, applyReactions);
    for (const source of plan.nodes.filter(node => node.type === 'PAGE')) {
      const prop = source.properties.flowStartingPoints;
      if (prop?.state !== 'value' || !Array.isArray(prop.value)) continue;
      try {
        execution.check();
        const node = map.get(source.id) as PageNode;
        const flows = prop.value.map(item => {
          const flow = item as { nodeId: string; name: string };
          const target = map.get(flow.nodeId);
          if (!target) throw new Error(`Flow destination unavailable: ${flow.nodeId}`);
          return { nodeId: target.id, name: flow.name };
        });
        if (!sameBackupValue(node.flowStartingPoints, flows)) node.flowStartingPoints = flows;
        if (!sameBackupValue(node.flowStartingPoints, flows))
          throw new Error('Figma did not preserve all prototype flow starting points');
      } catch (error) {
        if (error instanceof RestoreInterrupted) throw error;
        add(source.id, 'flowStartingPoints', error);
      }
    }

    // Equal-valued overrides are still semantically different from inheritance. Figma ignores a
    // write equal to a master's current value. Perturb ONLY our new master, apply the archived
    // override, then restore that master; this preserves intent when the master later changes.
    const repairs = new Map<
      string,
      { template: (typeof plan.nodes)[number]; kind: string; targets: Set<string> }
    >();
    for (const [id, info] of plan.instances.native) {
      const instance = map.get(id) as InstanceNode;
      const actual = new Map(
        instance.overrides.map(item => [item.id, new Set<string>(item.overriddenFields)]),
      );
      for (const [nodeId, fields] of info.overrides)
        for (const field of fields) {
          if (actual.get(map.get(nodeId)!.id)?.has(field)) continue;
          const kind = field === 'width' || field === 'height' ? 'size' : field;
          if (!['size', 'fontSize', 'fills'].includes(kind)) continue;
          const templateId = nodeId === id ? info.mainId : nodeId.split(';').at(-1)!;
          const template = byId.get(templateId)!;
          const key = templateId + '/' + kind;
          const repair = repairs.get(key) ?? { template, kind, targets: new Set<string>() };
          repair.targets.add(nodeId);
          repairs.set(key, repair);
        }
    }
    for (const repair of repairs.values()) {
      execution.check();
      execution.phase = `override intent ${repair.template.id}.${repair.kind}`;
      const template = map.get(repair.template.id)!;
      try {
        if (repair.kind === 'size' && 'resize' in template)
          template.resize(template.width + 1, template.height + 1);
        else if (repair.kind === 'fontSize' && template.type === 'TEXT')
          template.fontSize =
            typeof template.fontSize === 'number' ? template.fontSize + 1 : 17.125;
        else if (repair.kind === 'fills' && 'fills' in template)
          template.fills =
            template.fills === ctx.mixed || template.fills.length
              ? []
              : [{ type: 'SOLID', color: { r: 1, g: 0, b: 1 } }];
        else throw new Error('Cannot reconstruct this equal-valued override');
        for (const id of repair.targets) {
          const source = byId.get(id)!;
          // eslint-disable-next-line no-await-in-loop
          await apply(source, false);
          applyGeometry(source);
          // eslint-disable-next-line no-await-in-loop
          await apply(source, true);
          // eslint-disable-next-line no-await-in-loop
          await applyReferences(source);
        }
      } catch (error) {
        if (error instanceof RestoreInterrupted) throw error;
        add(repair.template.id, 'overrides', error);
      } finally {
        // Restore complete authored values, styles and bindings on the new template, including
        // fields that a temporary geometry/paint write may have unbound.
        // eslint-disable-next-line no-await-in-loop
        await apply(repair.template, false);
        applyGeometry(repair.template);
        // eslint-disable-next-line no-await-in-loop
        await apply(repair.template, true);
        // eslint-disable-next-line no-await-in-loop
        await applyReferences(repair.template);
      }
    }
    for (const [id, info] of plan.instances.native) {
      const actual = new Map(
        (map.get(id) as InstanceNode).overrides.map(item => [
          item.id,
          new Set<string>(item.overriddenFields),
        ]),
      );
      const expected = new Map(
        [...info.overrides].map(([oldId, fields]) => [map.get(oldId)!.id, fields]),
      );
      for (const nodeId of new Set([...actual.keys(), ...expected.keys()])) {
        const left = actual.get(nodeId) ?? new Set();
        const right = expected.get(nodeId) ?? new Set();
        if (left.size !== right.size || [...right].some(field => !left.has(field)))
          add(id, 'overrides', `Override intent differs on restored descendant ${nodeId}`);
      }
    }
    if (!payload.allowPartial && issues.length)
      throw new Error(`Restore encountered ${issues.length} issue(s): ${issues[0]!.message}`);
    return {
      status: issues.length ? 'partial' : 'restored',
      nativeInstances: plan.instances.native.size,
      resources: {
        collections: [...definitions.collections.values()].map(item => item.id),
        variables: [...definitions.variables.values()].map(item => item.id),
        styles: [...definitions.styles.values()].map(item => item.id),
      },
      pages: plan.roots.map(id => ({
        sourceId: id,
        nodeId: map.get(id)!.id,
        name: map.get(id)!.name,
      })),
      nodes: map.size,
      issueCount: issues.length,
      issues: issues.slice(0, 100),
    };
  } catch (error) {
    const cleanup: string[] = [];
    for (const page of pages) {
      try {
        page.remove();
      } catch (failure) {
        cleanup.push(String(failure));
      }
    }
    for (const node of created.toReversed()) {
      try {
        if (!node.removed) node.remove();
      } catch (failure) {
        cleanup.push(String(failure));
      }
    }
    for (const resource of definitions.resources.toReversed()) {
      try {
        resource.remove();
      } catch (failure) {
        cleanup.push(String(failure));
      }
    }
    if (cleanup.length)
      throw new Error(`${String(error)}; restore cleanup failed: ${cleanup.join('; ')}`, {
        cause: error,
      });
    throw error;
  } finally {
    ctx.skipInvisibleInstanceChildren = skipping;
  }
};
