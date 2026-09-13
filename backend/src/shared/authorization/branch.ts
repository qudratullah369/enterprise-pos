import { AppError } from '../errors/AppError.js';

/**
 * Minimal authenticated-user shape required for branch authorization.
 *
 * branchId = null is meaningful for ADMIN users only.
 */
export interface BranchScopedUser {
  role: string;
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

  if (
    requestedBranchId &&
    requestedBranchId !== user.branchId
  ) {
    throw new AppError(
      'Access to requested branch is forbidden',
      403,
    );
  }
}