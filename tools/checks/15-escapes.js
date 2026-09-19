'use strict';

/**
 * Reports what happened to each construct: blurred in its own right, hidden
 * behind the overlay, or still sharp.
 */
const PROBE = `(() => {
  const ids = ${JSON.stringify([
    'plain', 'srcset', 'picture', 'object-typed', 'svg-image',
    'object-untyped', 'embed-untyped', 'css-content', 'border-image', 'shorthand',
    'table-background',
    'list-image', 'pseudo', 'mask-image'
  ])};
  const out = {};
  for (const id of ids) {
    const el = document.getElementById(id);
    if (!el) { out[id] = 'MISSING'; continue; }
    const own = getComputedStyle(el).filter;
    const overlay = getComputedStyle(el, '::before').filter;
    out[id] = own !== 'none' ? 'blurred' : (overlay !== 'none' ? 'overlay' : 'sharp');
  }
  return out;
})()`;

/**
 * Every way a picture can reach the screen, in one place.
 *
 * An image this extension fails to hide is the worst thing it can do, so the
 * list is deliberately exhaustive rather than realistic, and the three cases
 * that are not covered are pinned here with the rest. That is the point: a gap
 * stays a decision somebody wrote down, and the day one of them becomes
 * coverable this check is what says so.
 */
module.exports = {
  name: 'ways an image can reach the screen',

  async run(t) {
    await t.open('escapes.html', 3500);

    t.expect('every construct ends up where it is meant to', await t.evaluate(PROBE), {
      // Selected by blur.css directly, so blurred before the first paint.
      plain: 'blurred',
      srcset: 'blurred',
      picture: 'blurred',
      'object-typed': 'blurred',
      'svg-image': 'blurred',

      // Found by the content script, so blurred one scan later.
      'object-untyped': 'blurred',
      'embed-untyped': 'blurred',
      'css-content': 'blurred',
      'border-image': 'blurred',
      shorthand: 'blurred',

      // Holds text, so a blurred copy of the background goes behind it instead.
      'table-background': 'overlay',

      // A marker is drawn at font size and cannot be filtered on its own:
      // ::marker takes no filter, and blurring the list item would blur the
      // text. Small enough to be an icon either way.
      'list-image': 'sharp',

      // A background on the page's own ::before cannot be found without asking
      // for the pseudo element style of every element on the page, which would
      // roughly triple the cost of a scan. This extension also builds its own
      // overlay out of ::before, so the two would collide on the elements that
      // need it most.
      pseudo: 'sharp',

      // A mask is used for its alpha channel, not drawn: what reaches the
      // screen is the colour underneath in the shape of the image, not the
      // image. There is nothing here to hide.
      'mask-image': 'sharp'
    });
  }
};
