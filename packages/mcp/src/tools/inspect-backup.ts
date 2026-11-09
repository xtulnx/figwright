import { z } from 'zod';

import { readBackupArchive } from '../backup/archive.js';
import type { ToolSpec } from './spec.js';

export const INSPECT_BACKUP_TOOL_NAME = 'inspect_backup';
const inputSchema = z.object({
  path: z.string().min(1).describe('Local .figwright-backup file to inspect'),
});
export const inspectBackupTool: ToolSpec = {
  name: INSPECT_BACKUP_TOOL_NAME,
  description:
    'Validate a local experimental .figwright-backup container, manifest, SHA-256 hashes, lengths and page/tree references. ' +
    'Returns integrity: valid only after checks pass; recoverability remains unknown. Byte integrity does not prove complete capture or restore support. ' +
    'Returns issueCount and up to 50 missing-coverage issues; never writes to Figma. Invalid or damaged files fail with an error.',
  inputSchema,
  kind: 'local',
  serverOnlyArgs: null,
};
export const handleInspectBackup = async (rawArgs: unknown) => {
  const { path } = inputSchema.parse(rawArgs);
  const { manifest, snapshot, images } = await readBackupArchive(path);
  return {
    integrity: 'valid' as const,
    recoverability: 'unknown' as const,
    source: manifest.source,
    createdAt: manifest.createdAt,
    pages: snapshot.pageIds.length,
    nodes: snapshot.nodes.length,
    imageAssets: images.size,
    definitionsCaptured: snapshot.definitions !== undefined,
    variableDefinitions: snapshot.definitions?.variables.length ?? 0,
    styleDefinitions: snapshot.definitions?.styles.length ?? 0,
    issueCount: manifest.issues.length,
    issues: manifest.issues.slice(0, 50),
  };
};
