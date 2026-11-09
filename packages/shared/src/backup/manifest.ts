import { z } from 'zod';

// Archive paths are portable identifiers, never host paths. Disallow Windows aliases as well as
// traversal so a package accepted on macOS cannot overwrite a different entry on Windows.
const pathSchema = z
  .string()
  .min(1)
  .refine(path => {
    if (/[\\:*?"<>|]/u.test(path)) return false;
    if ([...path].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) return false;
    return path
      .split('/')
      .every(
        part =>
          part !== '' &&
          part !== '.' &&
          part !== '..' &&
          !/[. ]$/u.test(part) &&
          !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part),
      );
  }, 'Expected a portable relative archive path');

/**
 * Metadata only: payloads have separate, versioned codecs. Passing this schema proves neither
 * payload semantics nor recoverability. In particular, completeness is never trusted from disk.
 */
export const BackupManifestSchema = z
  .strictObject({
    format: z.literal('figwright-backup'),
    version: z.literal(1),
    createdAt: z.iso.datetime(),
    producer: z.strictObject({
      serverVersion: z.string().min(1),
      pluginVersion: z.string().min(1),
    }),
    source: z.strictObject({ name: z.string(), editorType: z.literal('figma') }),
    entries: z
      .array(
        z.strictObject({
          path: pathSchema,
          kind: z.enum(['document', 'page', 'objects', 'asset', 'preview']),
          bytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
          sha256: z.string().regex(/^[a-f0-9]{64}$/u),
        }),
      )
      .min(1),
    issues: z.array(
      z.strictObject({
        code: z.string().min(1),
        severity: z.enum(['unsupported', 'missing', 'unknown']),
        message: z.string().min(1),
        objectId: z.string().optional(),
        property: z.string().optional(),
      }),
    ),
  })
  .superRefine((manifest, ctx) => {
    const paths = new Set<string>();
    let documents = 0;
    manifest.entries.forEach((entry, index) => {
      // NFC + case folding prevents aliases across common host filesystems.
      const key = entry.path.normalize('NFC').toLowerCase();
      if (key === 'manifest.json' || key.startsWith('manifest.json/') || paths.has(key)) {
        ctx.addIssue({
          code: 'custom',
          path: ['entries', index, 'path'],
          message: 'Duplicate or reserved path',
        });
      }
      paths.add(key);
      if (entry.kind === 'document') documents++;
    });
    if (documents !== 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['entries'],
        message: 'Expected exactly one document entry',
      });
    }
    for (const path of paths) {
      const parts = path.split('/');
      for (let i = 1; i < parts.length; i++) {
        if (paths.has(parts.slice(0, i).join('/'))) {
          ctx.addIssue({
            code: 'custom',
            path: ['entries'],
            message: 'Entry collides with a parent file',
          });
        }
      }
    }
  });

export type BackupManifest = z.infer<typeof BackupManifestSchema>;
