import { vi } from 'vitest';

export const redis = {
  get: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
};
