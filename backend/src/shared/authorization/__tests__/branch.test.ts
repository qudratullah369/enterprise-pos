import { describe, expect, it } from 'vitest';

import { AppError } from '../../errors/AppError.js';
import {
  assertBranchAccess,
  assertProductReadable,
  assertProductWritable,
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

const managerSame: BranchScopedUser = {
  id: 'manager-1',
  role: 'MANAGER',
  branchId: 'branch-A',
};

const staffSame: BranchScopedUser = {
  id: 'staff-1',
  role: 'STAFF',
  branchId: 'branch-A',
};

const staffOther: BranchScopedUser = {
  id: 'staff-2',
  role: 'STAFF',
  branchId: 'branch-B',
};

const staffNoBranch: BranchScopedUser = {
  id: 'staff-3',
  role: 'STAFF',
  branchId: null,
};

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

describe('assertProductReadable', () => {
  describe('global product', () => {
    const product = { id: 'p-global', branchId: null };

    it('is readable by every role', () => {
      for (const user of [
        admin,
        managerSame,
        staffSame,
        staffOther,
        staffNoBranch,
      ]) {
        expect(() => assertProductReadable(product, user)).not.toThrow();
      }
    });
  });

  describe('missing branchId treated as global', () => {
    const product = { id: 'p-global-2' };

    it('is readable by other-branch staff', () => {
      expect(() => assertProductReadable(product, staffOther)).not.toThrow();
    });
  });

  describe('branch-scoped product', () => {
    const product = { id: 'p-a', branchId: 'branch-A' };

    it('same branch non-admin can read', () => {
      expect(() => assertProductReadable(product, managerSame)).not.toThrow();
      expect(() => assertProductReadable(product, staffSame)).not.toThrow();
    });

    it('other branch non-admin gets 403', () => {
      expect403(() => assertProductReadable(product, staffOther));
    });

    it('ADMIN can read any branch', () => {
      expect(() => assertProductReadable(product, admin)).not.toThrow();
    });

    it('non-admin without branchId gets 403', () => {
      expect403(() => assertProductReadable(product, staffNoBranch));
    });
  });
});

describe('assertProductWritable', () => {
  describe('global product', () => {
    const product = { id: 'p-global', branchId: null };

    it('ADMIN can write', () => {
      expect(() => assertProductWritable(product, admin)).not.toThrow();
    });

    it('every non-admin role gets 403', () => {
      for (const user of [
        managerSame,
        staffSame,
        staffOther,
        staffNoBranch,
      ]) {
        expect403(() => assertProductWritable(product, user));
      }
    });
  });

  describe('missing branchId treated as global', () => {
    const product = { id: 'p-global-2' };

    it('non-admin gets 403', () => {
      expect403(() => assertProductWritable(product, staffOther));
    });
  });

  describe('branch-scoped product', () => {
    const product = { id: 'p-a', branchId: 'branch-A' };

    it('same branch non-admin can write', () => {
      expect(() => assertProductWritable(product, managerSame)).not.toThrow();
      expect(() => assertProductWritable(product, staffSame)).not.toThrow();
    });

    it('other branch non-admin gets 403', () => {
      expect403(() => assertProductWritable(product, staffOther));
    });

    it('ADMIN can write any branch', () => {
      expect(() => assertProductWritable(product, admin)).not.toThrow();
    });

    it('non-admin without branchId gets 403', () => {
      expect403(() => assertProductWritable(product, staffNoBranch));
    });
  });
});
