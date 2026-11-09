import { z } from 'zod';

/** Raw dependency definitions; IDs are archive identities, never reused on restore. */
export const BackupDefinitionsSchema = z
  .strictObject({
    collections: z.array(
      z.strictObject({
        id: z.string().min(1),
        name: z.string(),
        defaultModeId: z.string().min(1),
        modes: z.array(z.strictObject({ modeId: z.string().min(1), name: z.string() })).min(1),
        hiddenFromPublishing: z.boolean(),
      }),
    ),
    variables: z.array(
      z.strictObject({
        id: z.string().min(1),
        name: z.string(),
        collectionId: z.string().min(1),
        resolvedType: z.enum(['BOOLEAN', 'FLOAT', 'STRING', 'COLOR', 'EASING', 'TIMING']),
        valuesByMode: z.record(z.string().min(1), z.json()),
        description: z.string(),
        scopes: z.array(z.string()),
        codeSyntax: z.record(z.string(), z.string()),
        hiddenFromPublishing: z.boolean(),
      }),
    ),
    styles: z.array(
      z.strictObject({
        id: z.string().min(1),
        type: z.enum(['PAINT', 'TEXT', 'EFFECT', 'GRID']),
        properties: z.record(z.string(), z.json()),
      }),
    ),
  })
  .superRefine((defs, ctx) => {
    const bad = (message: string): void => ctx.addIssue({ code: 'custom', message });
    const collections = new Map(defs.collections.map(c => [c.id, c]));
    if (collections.size !== defs.collections.length) bad('Duplicate collection ID');
    if (new Set(defs.variables.map(v => v.id)).size !== defs.variables.length)
      bad('Duplicate variable ID');
    if (new Set(defs.styles.map(s => s.id)).size !== defs.styles.length) bad('Duplicate style ID');
    for (const c of defs.collections) {
      if (new Set(c.modes.map(m => m.modeId)).size !== c.modes.length)
        bad(`Duplicate mode in ${c.id}`);
      if (!c.modes.some(m => m.modeId === c.defaultModeId)) bad(`Missing default mode in ${c.id}`);
    }
    for (const v of defs.variables) {
      const collection = collections.get(v.collectionId);
      if (!collection) {
        bad(`Missing collection for ${v.id}`);
        continue;
      }
      if (Object.keys(v.valuesByMode).some(id => !collection.modes.some(m => m.modeId === id)))
        bad(`Unknown mode in ${v.id}`);
      if (!Object.hasOwn(v.valuesByMode, collection.defaultModeId))
        bad(`Missing default value in ${v.id}`);
    }
  });
export type BackupDefinitions = z.infer<typeof BackupDefinitionsSchema>;

export const BACKUP_STYLE_FIELDS: Readonly<Record<string, readonly string[]>> = {
  PAINT: ['name', 'description', 'paints'],
  EFFECT: ['name', 'description', 'effects'],
  GRID: ['name', 'description', 'layoutGrids'],
  TEXT: `name description fontName fontSize textDecoration letterSpacing lineHeight leadingTrim paragraphIndent paragraphSpacing textWrapStyle listSpacing hangingPunctuation hangingList textCase boundVariables`.split(
    ' ',
  ),
};

/** Raw aliases and style IDs, including wrappers, text ranges and nested paints. */
export const backupDefinitionReferences = (value: unknown) => {
  const variables = new Set<string>();
  const styles = new Set<string>();
  const collections = new Set<string>();
  const pending = [value];
  while (pending.length) {
    const item = pending.pop();
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    if (record.type === 'VARIABLE_ALIAS' && typeof record.id === 'string') variables.add(record.id);
    if (record.type === 'SET_VARIABLE' && typeof record.variableId === 'string')
      variables.add(record.variableId);
    if (record.type === 'SET_VARIABLE_MODE' && typeof record.variableCollectionId === 'string')
      collections.add(record.variableCollectionId);
    for (const [key, child] of Object.entries(record)) {
      if (
        ['fillStyleId', 'strokeStyleId', 'textStyleId', 'effectStyleId', 'gridStyleId'].includes(
          key,
        )
      ) {
        const id = child && typeof child === 'object' && 'value' in child ? child.value : child;
        if (typeof id === 'string' && id) styles.add(id);
      }
      if (key === 'explicitVariableModes' && child && typeof child === 'object') {
        const modes = 'value' in child ? child.value : child;
        if (modes && typeof modes === 'object')
          for (const id of Object.keys(modes)) collections.add(id);
      }
      pending.push(child);
    }
  }
  return { variables, styles, collections };
};

export const selectBackupDefinitions = (
  defs: BackupDefinitions | undefined,
  properties: unknown,
): BackupDefinitions | undefined => {
  if (!defs) return undefined;
  const refs = backupDefinitionReferences(properties);
  const variables = new Map(defs.variables.map(item => [item.id, item]));
  const styles = new Map(defs.styles.map(item => [item.id, item]));
  for (const id of refs.styles) {
    const style = styles.get(id);
    if (style)
      for (const variable of backupDefinitionReferences(style.properties).variables)
        refs.variables.add(variable);
  }
  for (const id of refs.variables) {
    const variable = variables.get(id);
    if (!variable) continue;
    refs.collections.add(variable.collectionId);
    for (const alias of backupDefinitionReferences(variable.valuesByMode).variables)
      refs.variables.add(alias);
  }
  return {
    collections: defs.collections.filter(item => refs.collections.has(item.id)),
    variables: defs.variables.filter(item => refs.variables.has(item.id)),
    styles: defs.styles.filter(item => refs.styles.has(item.id)),
  };
};
