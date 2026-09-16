'use strict';

const STATE = `(() => ({
  html: document.documentElement.getAttribute('class') || '',
  photo: getComputedStyle(document.getElementById('photo')).filter
}))()`;

/**
 * The per tab pause and the per tab badge, both driven through the service
 * worker so the toolbar and the keyboard shortcut behave the same way.
 */
module.exports = {
  name: 'per tab pause and badge',

  async run(t) {
    await t.open('modes.html', 2500);
    t.expect('blurred to start with', (await t.evaluate(STATE)).photo, 'blur(12px)');

    // The content script answers the popup with what applies on this tab.
    const answered = await t.worker.evaluate(`(async () => {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      return new Promise((resolve) => {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'ibx-query' }, (response) => {
          void chrome.runtime.lastError;
          resolve(response || null);
        });
      });
    })()`, { awaitPromise: true });
    t.expect('the tab reports its host and state',
      [answered && answered.host, answered && answered.active, answered && answered.paused],
      ['127.0.0.1', true, false]);

    // A service worker does not receive its own runtime.sendMessage, so this
    // calls the function the popup message and the keyboard shortcut both reach.
    const pause = async () => t.worker.evaluate(`(async () => {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      return { paused: await togglePause(tabs[0].id) };
    })()`, { awaitPromise: true });

    const paused = await pause();
    await t.sleep(600);
    let state = await t.evaluate(STATE);
    t.expect('pausing the tab takes the blur off without touching the settings',
      [paused && paused.paused, state.html, state.photo], [true, 'ibx-off', 'none']);

    const badge = await t.worker.evaluate(`(async () => {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      return chrome.action.getBadgeText({ tabId: tabs[0].id });
    })()`, { awaitPromise: true });
    t.expect('the tab badge says it is off', badge, 'OFF');

    const resumed = await pause();
    await t.sleep(600);
    state = await t.evaluate(STATE);
    t.expect('pausing again resumes it', [resumed && resumed.paused, state.photo], [false, 'blur(12px)']);

    // A pause is only meant to last until the tab reloads.
    await pause();
    await t.sleep(600);
    t.expect('paused again', (await t.evaluate(STATE)).photo, 'none');

    await t.open('modes.html', 2500);
    t.expect('a reload drops the pause', (await t.evaluate(STATE)).photo, 'blur(12px)');

    // The shortcut and the popup share the same path through storage.
    await t.worker.evaluate(`chrome.storage.sync.set({ enabled: false })`, { awaitPromise: true });
    await t.sleep(700);
    t.expect('turning the extension off from the worker reaches the tab',
      (await t.evaluate(STATE)).html, 'ibx-off');
  }
};
