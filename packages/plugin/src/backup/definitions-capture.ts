import {
  BACKUP_STYLE_FIELDS,
  backupDefinitionReferences,
  type BackupDefinitions,
  type BackupSnapshot,
} from '@figwright/shared';

import { TimeSlice } from '../cooperative.js';
import { copyBackupValue } from './raw-value.js';

/** Capture only reachable dependencies; aliases and bindings in styles expand the closure. */
export const captureBackupDefinitions = async (
  ctx: typeof figma,
  snapshot: BackupSnapshot,
): Promise<BackupDefinitions> => {
  const result: BackupDefinitions = { collections: [], variables: [], styles: [] };
  const variables = new Set<string>();
  const styles = new Set<string>();
  const collections = new Set<string>();
  const seenVariables = new Set<string>();
  const seenStyles = new Set<string>();
  const seenCollections = new Set<string>();
  const scan = (value: unknown): void => {
    const refs = backupDefinitionReferences(value);
    for (const id of refs.variables) variables.add(id);
    for (const id of refs.styles) styles.add(id);
    for (const id of refs.collections) collections.add(id);
  };
  const fail = (id: string, error: unknown): void => {
    snapshot.issues.push({
      code: 'DEFINITION_UNAVAILABLE',
      severity: 'missing',
      objectId: id,
      message: error instanceof Error ? error.message : String(error),
    });
  };
  scan(snapshot.nodes.map(node => node.properties));
  const slice = new TimeSlice();
  while (styles.size || variables.size || collections.size) {
    for (const id of styles) {
      styles.delete(id);
      if (seenStyles.has(id)) continue;
      seenStyles.add(id);
      try {
        // eslint-disable-next-line no-await-in-loop
        const style = await ctx.getStyleByIdAsync(id);
        if (!style || !BACKUP_STYLE_FIELDS[style.type]) throw new Error(`Style unavailable: ${id}`);
        const properties: Record<string, ReturnType<typeof copyBackupValue>> = {};
        for (const field of BACKUP_STYLE_FIELDS[style.type]!) {
          if (!(field in style)) continue;
          try {
            const value = (style as unknown as Record<string, unknown>)[field];
            if (value !== undefined) properties[field] = copyBackupValue(value);
          } catch (error) {
            fail(id, error);
          }
        }
        result.styles.push({
          id,
          type: style.type as BackupDefinitions['styles'][number]['type'],
          properties,
        });
        scan(properties);
      } catch (error) {
        fail(id, error);
      }
    }
    for (const id of variables) {
      variables.delete(id);
      if (seenVariables.has(id)) continue;
      seenVariables.add(id);
      try {
        // eslint-disable-next-line no-await-in-loop
        const variable = await ctx.variables.getVariableByIdAsync(id);
        if (!variable) throw new Error(`Variable unavailable: ${id}`);
        // Fetch collection first: an inaccessible or extended collection cannot be represented.
        // eslint-disable-next-line no-await-in-loop
        const collection = await ctx.variables.getVariableCollectionByIdAsync(
          variable.variableCollectionId,
        );
        if (!collection || collection.isExtension)
          throw new Error(
            `Unavailable or extended variable collection: ${variable.variableCollectionId}`,
          );
        collections.add(collection.id);
        const captured = {
          id,
          name: variable.name,
          collectionId: collection.id,
          resolvedType: variable.resolvedType,
          valuesByMode: copyBackupValue(variable.valuesByMode),
          description: variable.description,
          scopes: [...variable.scopes],
          codeSyntax: copyBackupValue(variable.codeSyntax),
          hiddenFromPublishing: variable.hiddenFromPublishing,
        };
        result.variables.push(captured);
        scan(captured.valuesByMode);
      } catch (error) {
        fail(id, error);
      }
    }
    for (const id of collections) {
      collections.delete(id);
      if (seenCollections.has(id)) continue;
      seenCollections.add(id);
      try {
        // eslint-disable-next-line no-await-in-loop
        const collection = await ctx.variables.getVariableCollectionByIdAsync(id);
        if (!collection || collection.isExtension)
          throw new Error(`Unavailable or extended variable collection: ${id}`);
        result.collections.push({
          id,
          name: collection.name,
          defaultModeId: collection.defaultModeId,
          modes: collection.modes.map(mode => ({ modeId: mode.modeId, name: mode.name })),
          hiddenFromPublishing: collection.hiddenFromPublishing,
        });
      } catch (error) {
        fail(id, error);
      }
    }
    // eslint-disable-next-line no-await-in-loop
    if (slice.due()) await slice.yield();
  }
  // If a collection became unavailable between reads, retain a missing issue rather than emit an invalid graph.
  result.variables = result.variables.filter(variable =>
    result.collections.some(collection => collection.id === variable.collectionId),
  );
  return result;
};
