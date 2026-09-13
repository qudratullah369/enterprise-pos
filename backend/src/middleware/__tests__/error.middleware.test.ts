import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { ZodError, z } from 'zod';

import { errorHandler } from '../error.middleware.js';
import { AppError } from '../../shared/errors/AppError.js';

function makeRes() {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
  return res;
}

const req = {} as Request;
const next = vi.fn() as unknown as NextFunction;

describe('errorHandler', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('T1-A-1: AppError(403) -> HTTP 403 (not 500)', () => {
    const err = new AppError('Access to requested branch is forbidden', 403);
    const res = makeRes();

    errorHandler(err, req, res, next);

    expect(res.status).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: 'Access to requested branch is forbidden',
      details: undefined,
    });
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it('T1-A-2: AppError(401) -> HTTP 401 (auth errors preserved)', () => {
    const err = new AppError('Authentication required', 401);
    const res = makeRes();

    errorHandler(err, req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        message: 'Authentication required',
      }),
    );
  });

  it('T1-A-3: AppError with details -> details preserved in body', () => {
    const err = new AppError('Bad input', 400, { field: 'branchId' });
    const res = makeRes();

    errorHandler(err, req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: 'Bad input',
      details: { field: 'branchId' },
    });
  });

  it('T1-A-4: ZodError -> HTTP 400 with fieldErrors', () => {
    const schema = z.object({ name: z.string() });
    let zodErr: ZodError | undefined;
    try {
      schema.parse({ name: 123 });
    } catch (e) {
      zodErr = e as ZodError;
    }
    expect(zodErr).toBeInstanceOf(ZodError);

    const res = makeRes();
    errorHandler(zodErr!, req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    const body = (res.json as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(body.success).toBe(false);
    expect(body.message).toBe('Validation error');
    expect(body.details).toHaveProperty('name');
  });

  it('T1-A-5: Unknown Error -> HTTP 500 and logged', () => {
    const err = new Error('boom');
    const res = makeRes();

    errorHandler(err, req, res, next);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: 'Internal server error',
    });
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith('Unhandled error:', err);
  });
});