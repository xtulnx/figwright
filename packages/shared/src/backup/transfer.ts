import { z } from 'zod';

import { MAX_BACKUP_CAPTURE_CHARS } from './limits.js';

/** Internal protocol only. A capture is frozen once; reading chunks never re-reads Figma. */
export const BackupTransferRequestSchema = z.discriminatedUnion('mode', [
  z.strictObject({
    mode: z.literal('start'),
    pageId: z.string().min(1).optional(),
    maxChars: z.number().int().positive().max(MAX_BACKUP_CAPTURE_CHARS).optional(),
  }),
  z.strictObject({
    mode: z.literal('read'),
    captureId: z.string().min(1),
    offset: z.number().int().nonnegative(),
  }),
  z.strictObject({ mode: z.literal('release'), captureId: z.string().min(1) }),
]);
export const BackupTransferStartSchema = z.strictObject({
  transferVersion: z.literal(1),
  captureId: z.string().min(1),
  totalChars: z.number().int().positive().max(MAX_BACKUP_CAPTURE_CHARS),
  maxChars: z.number().int().positive().max(MAX_BACKUP_CAPTURE_CHARS),
});
export const BackupTransferChunkSchema = z.strictObject({
  transferVersion: z.literal(1),
  captureId: z.string().min(1),
  offset: z.number().int().nonnegative(),
  nextOffset: z.number().int().positive(),
  text: z.string().min(1).max(128_000),
  done: z.boolean(),
});
