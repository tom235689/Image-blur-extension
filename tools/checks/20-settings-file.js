'use strict';

/**
 * Settings as a file: a backup, and the only way to carry a long site list to
 * another computer. Exporting hands the browser a blob, which cannot be
 * intercepted from here, so the check drives the import side and the shape of
 * what export writes.
 */
module.exports = {
  name: 'exporting and importing settings',

  async run(t) {
    const id = await t.worker.evaluate('chrome.runtime.id');
    await t.page.send('Page.navigate', { url: 'chrome-extension://' + id + '/src/options/options.html' });
    await t.sleep(1500);

    const stored = () => t.worker.evaluate(
      'new Promise((resolve) => chrome.storage.sync.get(null, resolve))',
      { awaitPromise: true }
    );

    // What export writes: the blob is built from the stored settings, so the
    // file content is checked where it is assembled.
    await t.setSettings({ blurAmount: 33, mode: 'blackout', excludedSites: ['example.com'] });
    await t.page.send('Page.reload');
    await t.sleep(1500);

    // The anchor is stubbed out as well as the URL: letting a made up blob
    // address be clicked would have the page log a load failure of its own.
    const exported = await t.evaluate(`(() => new Promise((resolve) => {
      const createObjectURL = URL.createObjectURL;
      const click = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () {};
      URL.createObjectURL = (blob) => {
        blob.text().then((text) => {
          URL.createObjectURL = createObjectURL;
          HTMLAnchorElement.prototype.click = click;
          resolve(text);
        });
        return 'blob:captured';
      };
      document.getElementById('export-settings').click();
    }))()`, { awaitPromise: true });

    const payload = JSON.parse(exported);
    t.expect('the file says what it is', [payload.format, payload.version], ['image-blur-settings', 1]);
    t.expect('and holds the settings as they stand',
      [payload.settings.blurAmount, payload.settings.mode, payload.settings.excludedSites],
      [33, 'blackout', ['example.com']]);

    // Importing goes through the same normalising every other path uses, so a
    // hand edited file cannot put the extension into a state it could not
    // otherwise reach.
    const load = (text) => t.evaluate(`(() => {
      const input = document.getElementById('import-file');
      const file = new File([${JSON.stringify(text)}], 'settings.json', { type: 'application/json' });
      const transfer = new DataTransfer();
      transfer.items.add(file);
      input.files = transfer.files;
      input.dispatchEvent(new Event('change'));
    })()`);

    await load(JSON.stringify({
      format: 'image-blur-settings',
      version: 1,
      settings: { blurAmount: 7, mode: 'blur', hoverDelay: 120, excludedSites: ['IMPORTED.com'] }
    }));
    await t.sleep(900);

    let now = await stored();
    t.expect('an imported file replaces the settings',
      [now.blurAmount, now.mode, now.hoverDelay, now.excludedSites],
      [7, 'blur', 120, ['imported.com']]);

    await load(JSON.stringify({ settings: { blurAmount: 9999, mode: 'nonsense', excludedSites: 'not a list' } }));
    await t.sleep(900);

    now = await stored();
    t.expect('nonsense in the file lands as the defaults, clamped',
      [now.blurAmount, now.mode, now.excludedSites], [60, 'blur', []]);

    await load('this is not json at all');
    await t.sleep(700);

    t.expect('a file that is not settings says so and changes nothing',
      [await t.evaluate("document.getElementById('backup-error').hidden"), (await stored()).blurAmount],
      [false, 60]);
  }
};
