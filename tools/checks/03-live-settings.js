'use strict';

const TARGETS = { photo: '#photo', tile: '#tile' };

/** Stored settings must reach open tabs without a reload. */
module.exports = {
  name: 'settings reach open tabs',

  async run(t) {
    await t.open('media.html', 3000);

    const root = () => t.evaluate(
      '(() => ({ cls: document.documentElement.getAttribute("class") || "",' +
      ' radius: document.documentElement.style.getPropertyValue("--ibx-blur-radius") }))()'
    );

    t.expect('defaults applied', [(await root()).cls, (await root()).radius, (await t.filters(TARGETS)).photo],
      ['ibx-hover', '12px', 'blur(12px)']);

    await t.setSettings({ blurAmount: 30 });
    t.expect('radius follows the slider', await t.filters(TARGETS), { photo: 'blur(30px)', tile: 'blur(30px)' });

    await t.setSettings({ revealOnHover: false });
    t.expect('hover mode off, blur kept', [(await root()).cls, (await t.filters(TARGETS)).photo], ['', 'blur(30px)']);

    await t.setSettings({ enabled: false });
    t.expect('master switch off', [(await root()).cls, await t.filters(TARGETS)],
      ['ibx-off', { photo: 'none', tile: 'none' }]);

    await t.setSettings({ enabled: true, revealOnHover: true, blurAmount: 12 });
    t.expect('back on', [(await root()).cls, (await t.filters(TARGETS)).photo], ['ibx-hover', 'blur(12px)']);

    await t.setSettings({ excludedSites: ['127.0.0.1'] });
    t.expect('excluded host suspends blurring', [(await root()).cls, (await t.filters(TARGETS)).photo],
      ['ibx-off', 'none']);

    await t.setSettings({ excludedSites: ['example.com'] });
    t.expect('unrelated exclusion resumes it', [(await root()).cls, (await t.filters(TARGETS)).photo],
      ['ibx-hover', 'blur(12px)']);
  }
};
