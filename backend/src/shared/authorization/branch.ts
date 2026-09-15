import { AppError } from '../errors/AppError.js';

/**
 * Minimal authenticated-user shape required for branch authorization.
 *
 * branchId = null is meaningful for ADMIN users only.
 */
export interface BranchScopedUser {
  id?: string;
  role: string;
  branchId?: string | null;
}

/**
 * Minimal product shape required for branch-scoped product authorization.
 *
 * branchId = null / undefined means the product is global.
 */
export interface BranchScopedProduct {
  id?: string;
  branchId?: string | null;
}

/**
 * Options that control branch-scope resolution.
 */
export interface BranchScopeOptions {
  /**
   * Allows ADMIN users to operate across all branches
   * when no specific branch is requested.
   *
   * Default: false
   */
  allowAllBranches?: boolean;
}

/**
 * Resolves the effective authorized branch for the current request.
 *
 * Security rules:
 * - ADMIN may access any explicitly requested branch.
 * - ADMIN may access all branches only when allowAllBranches is true.
 * - Non-admin users can only operate on their assigned branch.
 * - Client-provided branchId is never authoritative for non-admin users.
 *
 * Returns:
 * - branch ID for branch-scoped operations
 * - null for ADMIN all-branch operations
 *
 * Throws:
 * - AppError(403) when the user's branch scope cannot be safely resolved.
 */
export function resolveAuthorizedBranch(
  user: BranchScopedUser,
  requestedBranchId?: string | null,
  options: BranchScopeOptions = {},
): string | null {
  const { allowAllBranches = false } = options;

  if (user.role === 'ADMIN') {
    if (requestedBranchId) {
      return requestedBranchId;
    }

    if (allowAllBranches) {
      return null;
    }

    if (user.branchId) {
      return user.branchId;
    }

    throw new AppError(
      'Admin must specify a branchId for this operation',
      403,
    );
  }

  if (!user.branchId) {
    throw new AppError('User has no assigned branch', 403);
  }

  return user.branchId;
}

/**
 * Asserts that the authenticated user can access
 * the requested branch.
 *
 * Throws AppError(403) when access is denied.
 */
export function assertBranchAccess(
  user: BranchScopedUser,
  requestedBranchId?: string | null,
): void {
  if (user.role === 'ADMIN') {
    return;
  }

  if (!user.branchId) {
    throw new AppError('User has no assigned branch', 403);
  }

  if (requestedBranchId && requestedBranchId !== user.branchId) {
    throw new AppError(
      'Access to requested branch is forbidden',
      403,
    );
  }
}

function isAdmin(user: BranchScopedUser): boolean {
  return user.role === 'ADMIN';
}

function isGlobalProduct(product: BranchScopedProduct): boolean {
  return product.branchId == null;
}

function isSameBranch(
  product: BranchScopedProduct,
  user: BranchScopedUser,
): boolean {
  return (
    product.branchId != null &&
    user.branchId != null &&
    product.branchId === user.branchId
  );
}

/**
 * Global product: readable by all roles.
 * Branch product: readable by the same branch; ADMIN can read any branch.
 * Missing branchId is treated as a global product.
 *
 * Throws AppError(403) when access is denied.
 */
export function assertProductReadable(
  product: BranchScopedProduct,
  user: BranchScopedUser,
): void {
  if (isGlobalProduct(product)) return;

  if (isAdmin(user)) return;

  if (isSameBranch(product, user)) return;

  throw new AppError(
    'Product is not readable for this user/branch',
    403,
  );
}

/**
 * Global product: writable only by ADMIN.
 * Branch product: writable by the same branch; ADMIN can write any branch.
 * Missing branchId is treated as a global product.
 *
 * Throws AppError(403) when access is denied.
 */
export function assertProductWritable(
  product: BranchScopedProduct,
  user: BranchScopedUser,
): void {
  if (isGlobalProduct(product)) {
    if (isAdmin(user)) return;

    throw new AppError(
      'Global product is writable only by ADMIN',
      403,
    );
  }

  if (isAdmin(user)) return;

  if (isSameBranch(product, user)) return;

  throw new AppError(
    'Product is not writable for this user/branch',
    403,
  );
}
