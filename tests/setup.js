import { vi } from 'vitest';

// Mock crypto.randomUUID with predictable values
let uuidCounter = 0;
if (!globalThis.crypto) {
  globalThis.crypto = {};
}
globalThis.crypto.randomUUID = () => {
  uuidCounter++;
  return `00000000-0000-0000-0000-${String(uuidCounter).padStart(12, '0')}`;
};

// Reset UUID counter before each test
import { beforeEach } from 'vitest';
beforeEach(() => {
  uuidCounter = 0;
});
