import type { BrowserContext, Page } from '@playwright/test';
import {
  test, expect, openExtensionPage, installDb, getTabId, openPopupForTab,
  closedInlinePopupText, clickClosedInlineEntry,
} from '../helpers';

const initial = {
  'newsletter-email': 'newsletter-before',
  'hidden-user': 'hidden-user-before',
  'hidden-password': 'hidden-password-before',
  'first-user': 'first-user-before',
  'first-password': 'first-password-before',
  'second-unrelated': 'second-unrelated-before',
  'second-password': 'second-password-before',
  'second-new-password': 'second-new-password-before',
  'second-user': 'second-user-before',
};

async function setup(context: BrowserContext, extensionId: string, url: string) {
  const seed = await openExtensionPage(context, extensionId, 'src/pages/popup/index.html');
  await installDb(seed);
  await seed.reload();
  await seed.getByPlaceholder('Master password').fill('correct horse');
  await seed.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(seed.getByPlaceholder('Search…')).toBeVisible();
  const site = await context.newPage();
  await site.goto(url);
  await site.waitForLoadState('load');
  // Keep original nodes observable even when the page removes or replaces them.
  await site.evaluate(() => {
    (window as unknown as { originalInputs: HTMLInputElement[] }).originalInputs = Array.from(document.querySelectorAll('input'));
  });
  return { seed, site };
}

async function assertValues(site: Page, form?: 'first' | 'second') {
  const expected = { ...initial, ...(form ? { [`${form}-user`]: 'e2e-user', [`${form}-password`]: 'e2e-pass' } : {}) };
  await expect.poll(() => site.evaluate(() => Object.fromEntries(
    (window as unknown as { originalInputs: HTMLInputElement[] }).originalInputs.map(input => [input.id, input.value]),
  ))).toEqual(expected);
  // Also inspect replacement controls that were not in the original node collection.
  const replacements = site.locator('[data-replacement]');
  for (const replacement of await replacements.all()) await expect(replacement).toHaveValue('replacement-before');
}

async function toolbarFill(seed: Page, site: Page, extensionId: string) {
  const tabId = await getTabId(seed, site.url());
  const popup = await openPopupForTab(site.context(), extensionId, site.url(), tabId);
  await expect(popup.getByText('Localhost Login')).toBeVisible();
  const world = await isolatedWorld(site, extensionId);
  try {
    await world.evaluate(`(() => {
      globalThis.__qkToolbarDelivered = false;
      chrome.runtime.onMessage.addListener(message => {
        if (message.type === 'fill') setTimeout(() => { globalThis.__qkToolbarDelivered = true; }, 0);
      });
    })()`);
    await popup.getByRole('button', { name: 'Autofill', exact: true }).click();
    // Negative assertions must wait until the actual content destination processed delivery.
    await expect.poll(() => world.evaluate('globalThis.__qkToolbarDelivered')).toBe(true);
  } finally { await world.close(); }
}

// Test-only instrumentation in Chromium's extension isolated world. The real message
// still reaches the real worker; only delivery of one successful response is held.
// No production test seam or page-world synthetic picker selection is involved.
async function isolatedWorld(site: Page, extensionId: string) {
  const client = await site.context().newCDPSession(site);
  const contexts: number[] = [];
  client.on('Runtime.executionContextCreated', ({ context }) => contexts.push(context.id));
  await client.send('Runtime.enable');
  let contextId: number | undefined;
  await expect.poll(async () => {
    for (const id of contexts) {
      const result = await client.send('Runtime.evaluate', {
        contextId: id, expression: 'globalThis.chrome?.runtime?.id', returnByValue: true,
      });
      if (result.result.value === extensionId) { contextId = id; return true; }
    }
    return false;
  }).toBe(true);
  const evaluate = async (expression: string) => {
    const result = await client.send('Runtime.evaluate', { contextId, expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  };
  return { evaluate, close: () => client.detach() };
}

async function holdReply(site: Page, extensionId: string, type: 'getEntry' | 'getEntrySummariesForUrl') {
  const { evaluate, close } = await isolatedWorld(site, extensionId);
  await evaluate(`(() => {
    const original = chrome.runtime.sendMessage;
    const state = globalThis.__qkHeldLoginReply = { ready: false, ok: false, release: null };
    chrome.runtime.sendMessage = function(request) {
      const response = original.call(chrome.runtime, request);
      if (request.type !== ${JSON.stringify(type)}) return response;
      chrome.runtime.sendMessage = original;
      return response.then(payload => new Promise(resolve => {
        state.ok = payload.ok && (${JSON.stringify(type)} === 'getEntry' ? !!payload.entry : payload.summaries.length > 0);
        state.release = () => resolve(payload);
        state.ready = true;
      }));
    };
  })()`);
  return {
    wait: async () => {
      await expect.poll(() => evaluate('globalThis.__qkHeldLoginReply.ready')).toBe(true);
      expect(await evaluate('globalThis.__qkHeldLoginReply.ok')).toBe(true);
    },
    release: async () => {
      await evaluate('new Promise(resolve => { globalThis.__qkHeldLoginReply.release(); setTimeout(resolve, 0); })');
    },
    close,
  };
}

for (const anchor of ['second-password', 'second-user']) {
  test(`trusted inline selection targets second form from ${anchor}`, async ({ context, extensionId, http }) => {
    const { site } = await setup(context, extensionId, http.loginFormScopeUrl);
    await site.locator(`#${anchor}`).click();
    await expect.poll(() => closedInlinePopupText(site)).toContain('Localhost Login');
    await clickClosedInlineEntry(site, 'Localhost Login');
    await assertValues(site, 'second');
  });
}

for (const blur of [false, true]) {
  test(`toolbar fills second form with ${blur ? 'last' : 'active'} login anchor`, async ({ context, extensionId, http }) => {
    const { seed, site } = await setup(context, extensionId, http.loginFormScopeUrl);
    await site.locator('#second-password').click();
    await expect.poll(() => closedInlinePopupText(site)).toContain('Localhost Login');
    if (blur) await site.locator('h1').click();
    await toolbarFill(seed, site, extensionId);
    await assertValues(site, 'second');
  });
}

test('toolbar with no preferred form declines competing visible login forms', async ({ context, extensionId, http }) => {
  const { seed, site } = await setup(context, extensionId, http.loginFormScopeUrl);
  await toolbarFill(seed, site, extensionId);
  await assertValues(site);
});

test('toolbar rejects its changed pair instead of selecting a new destination', async ({ context, extensionId, http }) => {
  const { seed, site } = await setup(context, extensionId, http.loginFormScopeUrl);
  await site.locator('#second-password').click();
  await expect.poll(() => closedInlinePopupText(site)).toContain('Localhost Login');
  await changeContext(site, 'pair-replaced');
  await toolbarFill(seed, site, extensionId);
  await assertValues(site);
});

const changes = ['unchanged', 'focus-switch', 'detached', 'moved', 'owner-changed', 'readonly', 'disabled-pair', 'hidden', 'pair-replaced'] as const;
type Change = typeof changes[number];

async function changeContext(site: Page, change: Change) {
  if (change === 'focus-switch') {
    await site.locator('#first-password').click();
    await expect.poll(() => closedInlinePopupText(site)).toContain('Localhost Login');
    return;
  }
  await site.evaluate(change => {
    const anchor = document.getElementById('second-password') as HTMLInputElement;
    const username = document.getElementById('second-user') as HTMLInputElement;
    if (change === 'detached') anchor.remove();
    if (change === 'moved') {
      anchor.setAttribute('form', 'second-login');
      document.getElementById('move-target')!.appendChild(anchor);
    }
    if (change === 'owner-changed') anchor.setAttribute('form', 'first-login');
    if (change === 'readonly') anchor.readOnly = true;
    if (change === 'disabled-pair') username.disabled = true;
    if (change === 'hidden') document.getElementById('second-login')!.hidden = true;
    if (change === 'pair-replaced') {
      const replacement = username.cloneNode(true) as HTMLInputElement;
      replacement.value = 'replacement-before';
      replacement.dataset.replacement = 'true';
      username.replaceWith(replacement);
    }
  }, change);
}

for (const type of ['getEntrySummariesForUrl', 'getEntry'] as const) {
  for (const change of changes) {
    test(`delayed ${type} with ${change} destination`, async ({ context, extensionId, http }) => {
      const { site } = await setup(context, extensionId, http.loginFormScopeUrl);
      const reply = await holdReply(site, extensionId, type);
      try {
        await site.locator('#second-password').click();
        if (type === 'getEntry') {
          await expect.poll(() => closedInlinePopupText(site)).toContain('Localhost Login');
          await clickClosedInlineEntry(site, 'Localhost Login');
        }
        await reply.wait();
        await changeContext(site, change);
        await reply.release();
        if (change === 'unchanged') {
          if (type === 'getEntrySummariesForUrl') {
            await expect.poll(() => closedInlinePopupText(site)).toContain('Localhost Login');
            await clickClosedInlineEntry(site, 'Localhost Login');
          }
          await assertValues(site, 'second');
        } else {
          await assertValues(site);
          if (change === 'focus-switch') {
            // The old summaries must not overwrite the new form's picker callback.
            await clickClosedInlineEntry(site, 'Localhost Login');
            await assertValues(site, 'first');
          } else await expect(site.locator('[data-quickkee-popup]')).toBeHidden();
        }
      } finally { await reply.close(); }
    });
  }
}

test('focus during a visible credential prompt invalidates a delayed login selection', async ({ context, extensionId, http }) => {
  const { site } = await setup(context, extensionId, http.loginFormScopeUrl);
  const reply = await holdReply(site, extensionId, 'getEntry');
  try {
    await site.locator('#second-password').click();
    await expect.poll(() => closedInlinePopupText(site)).toContain('Localhost Login');
    await clickClosedInlineEntry(site, 'Localhost Login');
    await reply.wait();
    // A genuine submit produces the existing prompt without changing this document.
    await site.getByRole('button', { name: 'Submit first login' }).click();
    await expect(site.locator('[data-quickkee-credential-prompt]')).toBeVisible();
    await site.locator('#first-password').click();
    await reply.release();
    await assertValues(site);
    await expect(site.locator('[data-quickkee-credential-prompt]')).toBeVisible();
    await expect(site.locator('[data-quickkee-popup]')).toBeHidden();
  } finally { await reply.close(); }
});
