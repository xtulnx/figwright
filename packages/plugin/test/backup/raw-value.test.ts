import { describe, expect, it } from 'vitest';

import { sameBackupValue } from '../../src/backup/raw-value.js';

describe('backup apply comparisons', () => {
  it('ignores object key order and materialized empty bindings without hiding live bindings', () => {
    expect(
      sameBackupValue(
        { color: { r: 0.1, g: 0.2, b: 0.3 } },
        { boundVariables: {}, color: { b: 0.3, g: 0.2, r: 0.1 } },
      ),
    ).toBe(true);
    expect(
      sameBackupValue(
        { color: 1 },
        { color: 1, boundVariables: { color: { type: 'VARIABLE_ALIAS', id: 'v' } } },
      ),
    ).toBe(false);
    expect(sameBackupValue([1, 2], [2, 1])).toBe(false);
    expect(sameBackupValue(false, 0)).toBe(false);
    expect(sameBackupValue(0.123456789, 0.123456788)).toBe(false);
  });
});
