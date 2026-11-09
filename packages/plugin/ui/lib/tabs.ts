export type Tab = 'activity' | 'context' | 'backup' | 'debug';

/** Tab order drives both the button row and the sliding indicator's offset. */
export const TABS = [
  ['activity', 'Activity'],
  ['context', 'Context'],
  ['backup', 'Backup'],
  ['debug', 'Debug'],
] as const satisfies ReadonlyArray<readonly [Tab, string]>;
