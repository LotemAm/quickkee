import { test, expect } from '../helpers';

test('extension loads and exposes a service worker id', async ({ extensionId }) => {
  expect(extensionId).toMatch(/^[a-p]{32}$/);
});
