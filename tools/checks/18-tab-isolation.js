'use strict';

/**
 * A pause belongs to one tab. The service worker keeps the list, tells the
 * frames of that tab alone, and drops the entry when the tab goes away - none
 * of which anything else in the suite opens a second tab to check.
 */
module.exports = {
  name: 'one paused tab does not pause the others',

  async run(t) {
    await t.open('media.html', 2500);

    // A second tab on the same page, so the only difference is which tab it is.
    const second = await t.worker.evaluate(`(async () => {
      const tab = await chrome.tabs.create({ url: ${JSON.stringify(t.site + '/media.html')}, active: false });
      return tab.id;
    })()`, { awaitPromise: true });
    await t.sleep(2500);

    const state = () => t.worker.evaluate(`(async () => {
      const tabs = await chrome.tabs.query({});
      const badges = {};
      for (const tab of tabs) {
        badges[tab.id] = await chrome.action.getBadgeText({ tabId: tab.id });
      }
      const session = await chrome.storage.session.get({ pausedTabs: [] });
      return { badges, paused: session.pausedTabs };
    })()`, { awaitPromise: true });

    const first = await t.worker.evaluate(`(async () => {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      return tabs[0].id;
    })()`, { awaitPromise: true });

    let now = await state();
    t.expect('both tabs start blurring', [now.badges[first], now.badges[second]], ['', '']);

    await t.worker.evaluate('togglePause(' + first + ')', { awaitPromise: true });
    await t.sleep(900);

    now = await state();
    t.expect('pausing one tab marks that tab only',
      [now.badges[first], now.badges[second], now.paused], ['OFF', '', [first]]);
    t.expect('the other tab is still blurring',
      (await t.filters({ photo: '#photo' })).photo === 'none', true);

    await t.worker.evaluate('togglePause(' + first + ')', { awaitPromise: true });
    await t.sleep(900);
    now = await state();
    t.expect('resuming clears it again', [now.badges[first], now.paused], ['', []]);

    // A tab that closes while paused would otherwise leave its id behind for
    // the next tab that happens to be given the same number.
    await t.worker.evaluate('togglePause(' + second + ')', { awaitPromise: true });
    await t.sleep(600);
    t.expect('the second tab is the paused one now', (await state()).paused, [second]);

    await t.worker.evaluate('chrome.tabs.remove(' + second + ')', { awaitPromise: true });
    await t.sleep(900);
    t.expect('closing a paused tab forgets it', (await state()).paused, []);
  }
};
