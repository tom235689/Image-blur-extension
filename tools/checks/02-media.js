'use strict';

const TARGETS = {
  heading: 'h1',
  photo: '#photo',
  banner: '#banner',
  tile: '#tile',
  gradient: '#gradient',
  artwork: '#artwork',
  icon: '#icon',
  painting: '#painting'
};

/** Which element types get blurred, and which are deliberately left alone. */
module.exports = {
  name: 'media types',

  async run(t) {
    await t.open('media.html', 3000);

    const filters = await t.filters(TARGETS);
    t.expect('text, gradients and small svg stay sharp',
      [filters.heading, filters.gradient, filters.icon],
      ['none', 'none', 'none']);
    t.expect('image, canvas and large svg are blurred',
      [filters.photo, filters.painting, filters.artwork],
      ['blur(12px)', 'blur(12px)', 'blur(12px)']);

    t.expect('plain background element blurred directly',
      [await t.classesOf('#tile'), filters.tile],
      ['bg-plain ibx-bg-direct', 'blur(12px)']);

    const banner = await t.evaluate(`(() => {
      const el = document.querySelector('#banner');
      const before = getComputedStyle(el, '::before');
      return { cls: el.getAttribute('class'), self: getComputedStyle(el).filter,
               overlay: before.filter, position: before.position };
    })()`);
    t.expect('background behind text uses a clipped overlay, leaving the text sharp',
      [banner.cls, banner.self, banner.overlay, banner.position],
      ['bg-text ibx-bg-overlay ibx-bg-anchor', 'none', 'blur(12px)', 'absolute']);
  }
};
