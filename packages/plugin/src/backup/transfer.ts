import { BackupTransferRequestSchema, DEFAULT_BACKUP_CAPTURE_CHARS } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';
import { captureBackupSnapshot } from './capture.js';

export const createBackupTransferHandler = (figmaCtx: typeof figma): SandboxToolHandler => {
  let state: { id: string; text: string; expires: number } | null = null;
  let busy = false;
  let sequence = 0;
  return async raw => {
    const args = BackupTransferRequestSchema.parse(raw);
    if (state !== null && state.expires <= Date.now()) state = null;
    if (args.mode === 'start') {
      if (busy || state !== null)
        throw new Error('A backup capture is already active; retry after it finishes or expires');
      busy = true;
      try {
        const maxChars = args.maxChars ?? DEFAULT_BACKUP_CAPTURE_CHARS;
        const text = JSON.stringify(
          await captureBackupSnapshot(figmaCtx, {
            maxChars,
            ...(args.pageId === undefined ? {} : { pageId: args.pageId }),
          }),
        );
        if (text.length > maxChars)
          throw new Error(
            `Backup capture has ${text.length} characters, exceeding limit ${maxChars}`,
          );
        state = { id: `${Date.now()}-${++sequence}`, text, expires: Date.now() + 120_000 };
        return { transferVersion: 1, captureId: state.id, totalChars: text.length, maxChars };
      } finally {
        busy = false;
      }
    }
    if (state === null || args.captureId !== state.id)
      throw new Error('Backup capture expired or belongs to another session');
    if (args.mode === 'release') {
      state = null;
      return { released: true };
    }
    if (args.offset >= state.text.length) throw new Error('Backup offset is outside the capture');
    state.expires = Date.now() + 120_000;
    const code = state.text.charCodeAt(args.offset);
    if (code >= 0xdc00 && code <= 0xdfff)
      throw new Error('Backup offset splits a Unicode character');
    let end = Math.min(args.offset + 128_000, state.text.length);
    const last = state.text.charCodeAt(end - 1);
    // msgpack UTF-8 encodes each chunk separately: splitting a surrogate pair would replace both
    // halves with U+FFFD and silently corrupt emoji/non-BMP text before the archive is hashed.
    if (last >= 0xd800 && last <= 0xdbff) end--;
    const text = state.text.slice(args.offset, end);
    return {
      transferVersion: 1,
      captureId: state.id,
      offset: args.offset,
      nextOffset: args.offset + text.length,
      text,
      done: args.offset + text.length === state.text.length,
    };
  };
};
