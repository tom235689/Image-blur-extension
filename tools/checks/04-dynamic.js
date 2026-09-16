'use strict';

/** Content added after the first scan, and the hover escape hatch. */
module.exports = {
  name: 'dynamic content and hover',

  async run(t) {
    await t.open('dynamic.html', 2500);

    await t.evaluate('window.addInserted()');
    await t.sleep(1200);
    t.expect('inserted image and background are blurred',
      [(await t.filters({ image: '#inserted-image', tile: '#inserted-tile' })), await t.classesOf('#inserted-tile')],
      [{ image: 'blur(12px)', tile: 'blur(12px)' }, 'ibx-bg-direct']);

    await t.hoverElement('#inserted-image');
    t.expect('hover reveals only the element under the pointer',
      await t.filters({ hovered: '#inserted-image', other: '#painting' }),
      { hovered: 'none', other: 'blur(12px)' });

    await t.hover(700, 860);
    t.expect('blur returns when the pointer leaves',
      (await t.filters({ image: '#inserted-image' })).image, 'blur(12px)');

    // A background that only exists in a :hover rule changes no attribute and
    // fires no mutation, so it can only be caught by re-checking on mouseover.
    await t.setSettings({ revealOnHover: false });
    await t.open('hover-background.html', 2500);
    t.expect('nothing to blur before the pointer arrives',
      [await t.classesOf('#hovercard'), (await t.filters({ card: '#hovercard' })).card], ['', 'none']);

    await t.hoverElement('#hovercard');
    await t.sleep(700);
    t.expect('hover only background is found and blurred',
      [await t.classesOf('#hovercard'), (await t.filters({ card: '#hovercard' })).card],
      ['ibx-bg-direct', 'blur(12px)']);
  }
};
