'use strict';

const FRAME = `(() => ({
  host: location.hostname,
  image: getComputedStyle(document.getElementById('frame-image')).filter,
  tile: getComputedStyle(document.getElementById('frame-tile')).filter
}))()`;

/**
 * Half of a page now arrives from somewhere else: the video, the map, the
 * advert, each in a frame of its own with its own host name. The site list
 * names the site the user is on - it is the host the popup shows next to the
 * switch - so an exception for it has to cover what that site embeds. A frame
 * judging itself by its own source would leave half a page blurred just after
 * the user said not to blur it.
 */
module.exports = {
  name: 'frames embedded from another host',

  async run(t) {
    await t.open('generated/embedded.html', 3000);

    const blurring = await t.inFrame('localhost', FRAME);
    t.expect('a frame from another host is blurred with the page around it',
      [blurring.host, blurring.image, blurring.tile],
      ['localhost', 'blur(12px)', 'blur(12px)']);

    // What the switch in the popup writes: the host of the page, never the
    // host of anything it embeds.
    await t.setSettings({ excludedSites: ['127.0.0.1'] });

    t.expect('leaving the page alone leaves what it embeds alone too',
      (await t.inFrame('localhost', FRAME)).image, 'none');
    t.expect('and the page itself, of course',
      (await t.filters({ own: '#own-image' })).own, 'none');

    // The mirror image: naming the embedded host alone means nothing, because
    // that is not the site the user is on.
    await t.setSettings({ excludedSites: ['localhost'] });

    t.expect('naming the embedded host alone changes nothing',
      (await t.inFrame('localhost', FRAME)).image, 'blur(12px)');

    await t.setSettings({ siteListMode: 'only', excludedSites: ['127.0.0.1'] });

    t.expect('blurring only this page blurs what it embeds as well',
      (await t.inFrame('localhost', FRAME)).image, 'blur(12px)');
  }
};
