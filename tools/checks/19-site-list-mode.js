'use strict';

/**
 * The site list reads as one of two opposite instructions. In the default mode
 * it names the hosts to leave alone; in the other it names the only hosts to
 * blur, which is what someone wants who needs the blur on a handful of sites
 * rather than on all of them.
 */
module.exports = {
  name: 'what the site list means',

  async run(t) {
    await t.open('media.html', 2500);

    const photo = async () => (await t.filters({ photo: '#photo' })).photo;

    t.expect('by default an unlisted host is blurred', await photo(), 'blur(12px)');

    // The pages are served from 127.0.0.1, so that is this page's host.
    await t.setSettings({ excludedSites: ['127.0.0.1'] });
    t.expect('a listed host is skipped', await photo(), 'none');

    await t.setSettings({ siteListMode: 'only' });
    t.expect('the same entry now means blur here', await photo(), 'blur(12px)');

    await t.setSettings({ excludedSites: ['example.com'] });
    t.expect('and an unlisted host is left alone', await photo(), 'none');

    await t.setSettings({ excludedSites: ['127.0.0.1'], siteListMode: 'exceptions' });
    t.expect('switching back reads the list the other way again', await photo(), 'none');
  }
};
