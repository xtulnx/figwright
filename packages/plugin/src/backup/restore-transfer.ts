import {
  RestorePayloadSchema,
  RestoreTransferRequestSchema,
  type RestoreJobStatusSchema,
} from '@figwright/shared';
import type { z } from 'zod';

import type { SandboxToolHandler } from '../dispatcher.js';
import { RestoreExecution } from './execution.js';
import { restoreBackupSnapshot } from './restore.js';

export const createRestoreTransferHandler = (
  ctx: typeof figma,
  execute: (work: () => Promise<void>) => Promise<unknown> = work => work(),
): SandboxToolHandler => {
  let state: {
    id: string;
    total: number;
    chunks: string[];
    received: number;
    expires: number;
    lastOffset: number;
    lastText: string;
  } | null = null;
  let job: {
    status: z.infer<typeof RestoreJobStatusSchema>;
    execution: RestoreExecution;
    expires: number;
  } | null = null;
  let sequence = 0;
  return async raw => {
    const args = RestoreTransferRequestSchema.parse(raw);
    if (state && state.expires <= Date.now()) state = null;
    if (job && job.status.state !== 'running' && job.expires <= Date.now()) job = null;
    if (args.mode === 'status' || args.mode === 'cancel') {
      if (!job || (args.restoreId !== undefined && job.status.restoreId !== args.restoreId))
        throw new Error('Restore job expired or belongs to another session');
      if (args.mode === 'cancel' && job.status.state === 'running') job.execution.cancel();
      return { ...job.status, phase: job.execution.phase };
    }
    if (args.mode === 'release' && job?.status.restoreId === args.restoreId)
      return { released: true };
    if (args.mode === 'commit' && job?.status.restoreId === args.restoreId)
      return { ...job.status, phase: job.execution.phase };
    if (job?.status.state === 'running') throw new Error('A restore commit is already running');
    if (args.mode === 'start') {
      if (state) throw new Error('A restore upload is already active');
      state = {
        id: `${Date.now()}-${++sequence}`,
        total: args.totalChars,
        chunks: [],
        received: 0,
        expires: Date.now() + 120_000,
        lastOffset: -1,
        lastText: '',
      };
      return { restoreId: state.id, received: 0 };
    }
    if (!state || state.id !== args.restoreId)
      throw new Error('Restore upload expired or belongs to another session');
    if (args.mode === 'release') {
      state = null;
      return { released: true };
    }
    state.expires = Date.now() + 120_000;
    if (args.mode === 'append') {
      if (args.offset === state.lastOffset && args.text === state.lastText)
        return { received: state.received };
      if (args.offset !== state.received || state.received + args.text.length > state.total)
        throw new Error('Invalid restore chunk offset or size');
      state.lastOffset = args.offset;
      state.lastText = args.text;
      state.chunks.push(args.text);
      state.received += args.text.length;
      return { received: state.received };
    }
    if (state.received !== state.total) throw new Error('Restore upload is incomplete');
    const payload = RestorePayloadSchema.parse(JSON.parse(state.chunks.join('')));
    const current = {
      status: { restoreId: state.id, state: 'running', phase: 'queued' } as z.infer<
        typeof RestoreJobStatusSchema
      >,
      execution: new RestoreExecution(),
      expires: Date.now() + 600_000,
    };
    job = current;
    state = null;
    const fail = (error: unknown): void => {
      current.status.state = 'failed';
      current.status.error = error instanceof Error ? error.message : String(error);
      current.expires = Date.now() + 600_000;
    };
    // execute tracks the undo step until job/cleanup completes without blocking other writes.
    void execute(async () => {
      try {
        current.status.result = await restoreBackupSnapshot(ctx, payload, current.execution);
        current.status.state = 'completed';
        current.execution.phase = 'completed';
        current.expires = Date.now() + 600_000;
      } catch (error) {
        fail(error);
      }
    }).catch(fail);
    return { ...current.status, phase: current.execution.phase };
  };
};
