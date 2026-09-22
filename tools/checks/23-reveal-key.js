'use strict';

/** The protocol's modifier bitmask: 1 Alt, 2 Ctrl, 4 Meta, 8 Shift. */
const ALT = 1;

const PHOTO = { photo: '#photo' };

/**
 * A pointer crossing an image uncovers it, and on a screen somebody else can
 * see that is the one thing this extension is there to prevent. Holding a key
 * first makes the reveal deliberate instead of accidental.
 */
module.exports = {
  name: 'a key held before anything is revealed',

  async run(t) {
    await t.open('media.html', 2500);
    await t.setSettings({ hoverDelay: 0, revealKey: 'alt' });

    await t.hoverElement('#photo');
    t.expect('the pointer on its own now uncovers nothing',
      (await t.filters(PHOTO)).photo, 'blur(12px)');

    await t.hover(4, 4);
    await t.hoverElement('#photo', ALT);
    t.expect('with the key held it is revealed',
      (await t.filters(PHOTO)).photo, 'none');

    // Let go of while the pointer stays where it is. Nothing but the modifier
    // flag is ever read, so a real key event is what has to arrive.
    await t.page.send('Input.dispatchKeyEvent', {
      type: 'keyUp', modifiers: 0, key: 'Alt', code: 'AltLeft', windowsVirtualKeyCode: 18
    });
    await t.sleep(400);
    t.expect('letting go covers it again without the pointer moving',
      (await t.filters(PHOTO)).photo, 'blur(12px)');

    // Moving on with the key held down reveals the next one straight away.
    await t.hover(4, 4);
    await t.hoverElement('#artwork', ALT);
    t.expect('and the next one after that',
      (await t.filters({ photo: '#artwork' })).photo, 'none');

    // A key to hold means nothing while nothing is ever revealed.
    await t.setSettings({ revealOnHover: false });
    await t.hover(4, 4);
    await t.hoverElement('#photo', ALT);
    t.expect('with the reveal itself off the key reveals nothing',
      (await t.filters(PHOTO)).photo, 'blur(12px)');

    await t.setSettings({ revealOnHover: true, revealKey: 'none' });
    await t.hover(4, 4);
    await t.hoverElement('#photo');
    t.expect('and with no key chosen the pointer alone is enough again',
      (await t.filters(PHOTO)).photo, 'none');
  }
};
