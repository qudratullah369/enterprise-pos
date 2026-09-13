import { describe, expect, it } from 'vitest';

import { AppError } from '../../errors/AppError.js';
import {
  assertBranchAccess,
  resolveAuthorizedBranch,
  type BranchScopedUser,
} from '../branch.js';

/**
 * Helper: assert that a synchronous fn throws AppError with statusCode 403.
 */
function expect403(fn: () => void): void {
  let thrown: unknown;
  try {
    fn();
  } catch (e) {
    thrown = e;
  }
  expect(thrown).toBeInstanceOf(AppError);
  const err = thrown as AppError;
  expect(err.statusCode).toBe(403);
}

const manager: BranchScopedUser = { role: 'MANAGER', branchId: 'branch-A' };
const managerNoBranch: BranchScopedUser = { role: 'MANAGER', branchId: null };

describe('MANAGER branch scope — behaves like CASHIER, not ADMIN', () => {
  describe('resolveAuthorizedBranch', () => {
    it('T1-B-1: MANAGER -> own branch = allowed', () => {
      expect(resolveAuthorizedBranch(manager, 'branch-A')).toBe('branch-A');
    });

    it('T1-B-2: MANAGER -> other branch = client input ignored (own branch returned)', () => {
      expect(resolveAuthorizedBranch(manager, 'branch-B')).toBe('branch-A');
    });

    it('T1-B-3: MANAGER -> no requested branch = own branch', () => {
      expect(resolveAuthorizedBranch(manager)).toBe('branch-A');
      expect(resolveAuthorizedBranch(manager, null)).toBe('branch-A');
    });

    it('T1-B-4: MANAGER -> no assigned branch = 403', () => {
      expect403(() => resolveAuthorizedBranch(managerNoBranch));
      expect403(() => resolveAuthorizedBranch(managerNoBranch, 'branch-X'));
    });

    it('T1-B-5: MANAGER -> allowAllBranches option does NOT grant cross-branch (non-admin)', () => {
      // Even with allowAllBranches, MANAGER must stay scoped.
      // (Currently unused by MANAGER, but documents the invariant.)
      expect(
        resolveAuthorizedBranch(manager, null, { allowAllBranches: true }),
      ).toBe('branch-A');
    });
  });

  describe('assertBranchAccess', () => {
    it('T1-B-6: MANAGER -> own branch = allowed (no throw)', () => {
      expect(() => assertBranchAccess(manager, 'branch-A')).not.toThrow();
    });

    it('T1-B-7: MANAGER -> other branch = 403', () => {
      expect403(() => assertBranchAccess(manager, 'branch-B'));
    });

    it('T1-B-8: MANAGER -> no requested branch = allowed', () => {
      expect(() => assertBranchAccess(manager)).not.toThrow();
      expect(() => assertBranchAccess(manager, null)).not.toThrow();
    });

    it('T1-B-9: MANAGER -> no assigned branch = 403 (even for own-branch request)', () => {
      expect403(() => assertBranchAccess(managerNoBranch));
      expect403(() => assertBranchAccess(managerNoBranch, 'branch-A'));
    });
  });
});