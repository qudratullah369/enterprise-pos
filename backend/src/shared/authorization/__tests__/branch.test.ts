import { describe, expect, it } from 'vitest';

import { AppError } from '../../errors/AppError.js';
import {
  assertBranchAccess,
  resolveAuthorizedBranch,
  type BranchScopedUser,
} from '../branch.js';

function expect403(fn: () => void): void {
  let thrown: unknown;
  try {
    fn();
  } catch (e) {
    thrown = e;
  }

  expect(thrown).toBeInstanceOf(AppError);

  const err = thrown as AppError & {
    statusCode?: number;
    status?: number;
  };
  const status = err.statusCode ?? err.status;
  expect(status).toBe(403);
}

const cashier: BranchScopedUser = { role: 'CASHIER', branchId: 'branch-A' };
const cashierNoBranch: BranchScopedUser = { role: 'CASHIER', branchId: null };
const admin: BranchScopedUser = { role: 'ADMIN', branchId: 'branch-A' };
const adminNoBranch: BranchScopedUser = { role: 'ADMIN', branchId: null };

describe('resolveAuthorizedBranch', () => {
  it('1. CASHIER -> own branch = allowed', () => {
    expect(resolveAuthorizedBranch(cashier, 'branch-A')).toBe('branch-A');
  });

  it('2. CASHIER -> other branch = client input ignored, own branch returned', () => {
    expect(resolveAuthorizedBranch(cashier, 'branch-B')).toBe('branch-A');
  });

  it('3. CASHIER -> no requested branch = own branch', () => {
    expect(resolveAuthorizedBranch(cashier)).toBe('branch-A');
    expect(resolveAuthorizedBranch(cashier, null)).toBe('branch-A');
  });

  it('4. CASHIER -> no assigned branch = 403', () => {
    expect403(() => resolveAuthorizedBranch(cashierNoBranch));
    expect403(() => resolveAuthorizedBranch(cashierNoBranch, 'branch-X'));
  });

  it('5. ADMIN -> any specific branch = allowed', () => {
    expect(resolveAuthorizedBranch(admin, 'branch-Z')).toBe('branch-Z');
  });

  it('6. ADMIN -> all branches only when allowAllBranches = true -> null', () => {
    expect(
      resolveAuthorizedBranch(adminNoBranch, null, { allowAllBranches: true }),
    ).toBeNull();

    expect(
      resolveAuthorizedBranch(admin, null, { allowAllBranches: true }),
    ).toBeNull();
  });

  it('7. ADMIN without branch and without allowAllBranches = 403', () => {
    expect403(() => resolveAuthorizedBranch(adminNoBranch));
    expect403(() => resolveAuthorizedBranch(adminNoBranch, null));
  });
});

describe('assertBranchAccess', () => {
  it('1. CASHIER -> own branch = allowed (no throw)', () => {
    expect(() => assertBranchAccess(cashier, 'branch-A')).not.toThrow();
  });

  it('2. CASHIER -> other branch = 403', () => {
    expect403(() => assertBranchAccess(cashier, 'branch-B'));
  });

  it('3. CASHIER -> no requested branch = allowed (scoped to own later)', () => {
    expect(() => assertBranchAccess(cashier)).not.toThrow();
    expect(() => assertBranchAccess(cashier, null)).not.toThrow();
  });

  it('4. CASHIER -> no assigned branch = 403', () => {
    expect403(() => assertBranchAccess(cashierNoBranch));
    expect403(() => assertBranchAccess(cashierNoBranch, 'branch-A'));
  });

  it('5. ADMIN -> any branch = allowed (including no branch)', () => {
    expect(() => assertBranchAccess(admin, 'branch-Z')).not.toThrow();
    expect(() => assertBranchAccess(adminNoBranch, 'branch-Z')).not.toThrow();
    expect(() => assertBranchAccess(admin)).not.toThrow();
  });
});
