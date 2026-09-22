'use strict';

const ADD = `(() => {
  document.getElementById('site-input').value = 'never-stored.example.com';
  document.getElementById('add-form').requestSubmit();
})()`;

const STATE = `(() => ({
  status: document.getElementById('status').textContent,
  listed: Array.from(document.querySelectorAll('#site-list .host')).map((el) => el.textContent)
}))()`;

/**
 * A write to chrome.storage.sync can fail: a site list past the 8 KB an item
 * is allowed, or more than a hundred writes in a minute. The page has drawn the
 * change before it can know, so a failure leaves a host on screen that storage
 * never took - the interface claiming a state the extension is not in, which is
 * worse than the failed write. The quota is not enforced in a signed out test
 * profile, so the failure is injected instead; what is being checked is what
 * the page does about it.
 */
module.exports = {
  name: 'a write that does not reach storage',

  async run(t) {
    const id = await t.worker.evaluate('chrome.runtime.id');
    await t.setSettings({ excludedSites: ['already-there.example.com'] });
    await t.page.send('Page.navigate', { url: 'chrome-extension://' + id + '/src/options/options.html' });
    await t.sleep(1500);

    t.expect('the stored list is on the page to begin with',
      (await t.evaluate(STATE)).listed, ['already-there.example.com']);

    await t.evaluate(`(() => {
      window.realSet = chrome.storage.sync.set;
      chrome.storage.sync.set = () => { throw new Error('nothing is being stored'); };
    })()`);

    await t.evaluate(ADD);
    await t.sleep(600);

    const failed = await t.evaluate(STATE);
    t.expect('a write that failed says so and leaves the list as storage has it',
      [failed.status, failed.listed],
      ['Could not save', ['already-there.example.com']]);

    // And the same action, once writing works again, does what it says.
    await t.evaluate('chrome.storage.sync.set = window.realSet');
    await t.evaluate(ADD);
    await t.sleep(600);

    const worked = await t.evaluate(STATE);
    t.expect('and one that reached storage is shown as added',
      [worked.status, worked.listed],
      ['Added never-stored.example.com', ['already-there.example.com', 'never-stored.example.com']]);

    const stored = await t.worker.evaluate(
      'new Promise((resolve) => chrome.storage.sync.get({ excludedSites: [] }, (items) => resolve(items.excludedSites)))',
      { awaitPromise: true }
    );
    t.expect('storage holds exactly what the page showed',
      stored, ['already-there.example.com', 'never-stored.example.com']);
  }
};
