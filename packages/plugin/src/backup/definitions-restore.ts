import { BACKUP_STYLE_FIELDS, type BackupDefinitions, type RestoreIssue } from '@figwright/shared';

import { RestoreExecution, RestoreInterrupted } from './execution.js';

export interface RestoredDefinitions {
  variables: Map<string, Variable>;
  collections: Map<string, VariableCollection>;
  modes: Map<string, Map<string, string>>;
  styles: Map<string, BaseStyle>;
  resources: { remove(): void }[];
}

export const createRestoredDefinitions = (): RestoredDefinitions => ({
  variables: new Map(),
  collections: new Map(),
  modes: new Map(),
  styles: new Map(),
  resources: [],
});

/** Translate aliases recursively, including composed colors and gradient stops. */
export const remapBackupAliases = (value: unknown, restored: RestoredDefinitions): unknown => {
  if (Array.isArray(value)) return value.map(child => remapBackupAliases(child, restored));
  if (!value || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  if (record.type === 'VARIABLE_ALIAS') {
    const variable = typeof record.id === 'string' ? restored.variables.get(record.id) : undefined;
    if (!variable) throw new Error(`Variable definition unavailable: ${String(record.id)}`);
    return { type: 'VARIABLE_ALIAS', id: variable.id };
  }
  return Object.fromEntries(
    Object.entries(record).map(([key, child]) => [key, remapBackupAliases(child, restored)]),
  );
};

export const restoreBackupDefinitions = async (
  ctx: typeof figma,
  defs: BackupDefinitions | undefined,
  restored: RestoredDefinitions,
  issues: RestoreIssue[],
  remap: (value: unknown, objectId: string, property: string) => unknown,
  execution = new RestoreExecution(),
  loadedFonts: ReadonlySet<string> = new Set(),
): Promise<void> => {
  if (!defs) return;
  const attempt = async (
    id: string,
    property: string,
    write: () => void | Promise<void>,
  ): Promise<void> => {
    try {
      execution.check();
      const result = write();
      if (result !== undefined) await execution.wait(Promise.resolve(result), `${id}.${property}`);
    } catch (error) {
      if (error instanceof RestoreInterrupted) throw error;
      issues.push({
        objectId: id,
        property,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };
  for (const source of defs.collections) {
    // eslint-disable-next-line no-await-in-loop
    await attempt(source.id, 'collection', () => {
      const collection = ctx.variables.createVariableCollection(source.name);
      restored.resources.push(collection);
      restored.collections.set(source.id, collection);
      collection.hiddenFromPublishing = source.hiddenFromPublishing;
      const modes = new Map([[source.defaultModeId, collection.defaultModeId]]);
      restored.modes.set(source.id, modes);
      collection.renameMode(
        collection.defaultModeId,
        source.modes.find(mode => mode.modeId === source.defaultModeId)!.name,
      );
      for (const mode of source.modes)
        if (mode.modeId !== source.defaultModeId)
          modes.set(mode.modeId, collection.addMode(mode.name));
      if (source.modes[0]!.modeId !== source.defaultModeId)
        throw new Error('Mode order cannot be preserved with a non-first default mode');
    });
  }
  for (const source of defs.variables) {
    // eslint-disable-next-line no-await-in-loop
    await attempt(source.id, 'variable', () => {
      const collection = restored.collections.get(source.collectionId);
      if (!collection) throw new Error(`Collection unavailable: ${source.collectionId}`);
      const variable = ctx.variables.createVariable(source.name, collection, source.resolvedType);
      restored.resources.push(variable);
      restored.variables.set(source.id, variable);
      variable.description = source.description;
      variable.hiddenFromPublishing = source.hiddenFromPublishing;
      // EASING/TIMING expose no scopes and reject setting even an empty scope list.
      if (source.resolvedType !== 'EASING' && source.resolvedType !== 'TIMING')
        variable.scopes = source.scopes as VariableScope[];
      for (const [platform, syntax] of Object.entries(source.codeSyntax)) {
        if (!['WEB', 'ANDROID', 'iOS'].includes(platform))
          throw new Error(`Unknown code syntax platform: ${platform}`);
        variable.setVariableCodeSyntax(platform as CodeSyntaxPlatform, syntax);
      }
    });
  }
  // All identities exist before applying aliases; no source file or library lookup is used.
  for (const source of defs.variables) {
    for (const [modeId, value] of Object.entries(source.valuesByMode)) {
      // eslint-disable-next-line no-await-in-loop
      await attempt(source.id, `valuesByMode.${modeId}`, () => {
        const variable = restored.variables.get(source.id);
        const mode = restored.modes.get(source.collectionId)?.get(modeId);
        if (!variable || !mode)
          throw new Error(`Variable or mode unavailable: ${source.id}/${modeId}`);
        variable.setValueForMode(mode, remapBackupAliases(value, restored) as VariableValue);
      });
    }
  }
  for (const source of defs.styles) {
    // eslint-disable-next-line no-await-in-loop
    await attempt(source.id, 'style', async () => {
      if (source.type === 'TEXT') {
        const font = source.properties.fontName as unknown as FontName | undefined;
        if (font && !loadedFonts.has(JSON.stringify(font)))
          await execution.wait(ctx.loadFontAsync(font), `style font ${font.family}/${font.style}`);
      }
      let style: BaseStyle;
      switch (source.type) {
        case 'PAINT':
          style = ctx.createPaintStyle();
          break;
        case 'TEXT':
          style = ctx.createTextStyle();
          break;
        case 'EFFECT':
          style = ctx.createEffectStyle();
          break;
        case 'GRID':
          style = ctx.createGridStyle();
          break;
      }
      restored.resources.push(style);
      restored.styles.set(source.id, style);
      const target = style as unknown as Record<string, unknown>;
      for (const [property, value] of Object.entries(source.properties)) {
        if (!BACKUP_STYLE_FIELDS[source.type]!.includes(property))
          throw new Error(`Unknown ${source.type} style property: ${property}`);
        if (property === 'boundVariables') continue;
        target[property] = remap(value, source.id, property);
      }
      if (source.type === 'TEXT' && source.properties.boundVariables) {
        for (const [field, alias] of Object.entries(source.properties.boundVariables)) {
          const variable = restored.variables.get((alias as { id: string }).id);
          if (!variable) throw new Error(`Text style variable unavailable: ${field}`);
          (style as TextStyle).setBoundVariable(field as VariableBindableTextField, variable);
        }
      }
    });
  }
};
