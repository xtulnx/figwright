/**
 * Reject values JSON would silently coerce (undefined, symbols, NaN, cycles) instead of losing
 * data. The only allowed symbol is the node-level mixed marker handled by the caller.
 */
export const copyBackupValue = (value: unknown): ReturnType<typeof JSON.parse> => {
  const json = JSON.stringify(value, (_key, item: unknown) => {
    if (
      item === undefined ||
      typeof item === 'symbol' ||
      typeof item === 'function' ||
      typeof item === 'bigint' ||
      (typeof item === 'number' && !Number.isFinite(item))
    ) {
      throw new TypeError('Value is not losslessly JSON-serializable');
    }
    return item;
  });
  if (json === undefined) throw new TypeError('Missing JSON value');
  return JSON.parse(json);
};

const keys = (value: object): string[] =>
  Object.keys(value).filter(key => {
    const item = (value as Record<string, unknown>)[key];
    return !(
      key === 'boundVariables' &&
      item &&
      typeof item === 'object' &&
      !Array.isArray(item) &&
      Object.keys(item).length === 0
    );
  });

/**
 * API getters may reorder object keys or materialize an empty binding map after a write. Neither
 * changes the value; arrays and every nonempty binding remain order/value sensitive.
 */
export const sameBackupValue = (a: unknown, b: unknown): boolean => {
  const pending: [unknown, unknown][] = [[a, b]];

  while (pending.length) {
    const [left, right] = pending.pop()!;
    if (left === right) continue;
    if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
    if (Array.isArray(left) !== Array.isArray(right)) return false;
    if (Array.isArray(left) && Array.isArray(right) && left.length !== right.length) return false;
    const leftKeys = keys(left);
    const rightKeys = keys(right);
    if (leftKeys.length !== rightKeys.length || leftKeys.some(key => !rightKeys.includes(key)))
      return false;
    for (const key of leftKeys)
      pending.push([
        (left as Record<string, unknown>)[key],
        (right as Record<string, unknown>)[key],
      ]);
  }
  return true;
};
