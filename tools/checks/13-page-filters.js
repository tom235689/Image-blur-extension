'use strict';

const TARGETS = {
  ownFilter: '#own-filter',
  ownFilterSmall: '#own-filter-small',
  noFilter: '#no-filter'
};

/**
 * Not blurring something has to mean leaving it alone. A site is entitled to
 * put its own filter on its own images, and the two states where this extension
 * blurs nothing - switched off, or a host on the exception list - have to hand
 * that image back exactly as the page styled it.
 */
module.exports = {
  name: 'filters the page applies itself',

  async run(t) {
    await t.open('page-filters.html', 3000);

    const blurring = await t.filters(TARGETS);
    t.expect('while blurring, the blur replaces the filter the page asked for',
      [blurring.ownFilter, blurring.noFilter],
      ['blur(12px)', 'blur(12px)']);

    // The exception list is the user saying "do nothing here".
    await t.setSettings({ excludedSites: ['127.0.0.1'] });

    const excluded = await t.filters(TARGETS);
    t.expect('on an excluded host the page keeps its own filter',
      excluded.ownFilter, 'grayscale(1)');
    t.expect('an image the page did not filter has no filter either',
      excluded.noFilter, 'none');

    await t.resetSettings();

    // A size limit is the other way of saying "not this one".
    await t.setSettings({ minImageSize: 48 });

    const spared = await t.filters(TARGETS);
    t.expect('media below the size limit keeps the filter the page asked for',
      spared.ownFilterSmall, 'grayscale(1)');
    t.expect('media above it is still blurred',
      spared.ownFilter, 'blur(12px)');

    await t.resetSettings();

    // Reveal on hover needs a transition to carry its delay. Declaring that in
    // the resting state would replace the transition the page declared there.
    const transitions = await t.evaluate(`(() => {
      const style = getComputedStyle(document.getElementById('own-transition'));
      return { property: style.transitionProperty, duration: style.transitionDuration };
    })()`);
    t.expect('while blurring, the page keeps its own transition on its images',
      [transitions.property, transitions.duration], ['opacity', '0.4s']);
  }
};
