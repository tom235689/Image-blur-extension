'use strict';

const SVG_STATE = `(() => {
  const root = document.documentElement;
  return {
    root: root.tagName,
    classes: (root.getAttribute('class') || '').split(' ').sort().join(' '),
    filter: getComputedStyle(root).filter
  };
})()`;

const RASTER_STATE = `(() => {
  const image = document.querySelector('img');
  return {
    root: document.documentElement.tagName,
    filter: image ? getComputedStyle(image).filter : 'MISSING'
  };
})()`;

/**
 * A picture opened on its own is still a picture. Navigating straight to a file
 * gives a document whose whole content is that image, and for SVG the document
 * element is <svg> rather than <html> - so a rule anchored to html, or to a
 * descendant of the root, quietly stops covering the one case where the image
 * fills the entire window.
 */
module.exports = {
  name: 'a file opened as its own document',

  async run(t) {
    await t.open('standalone.svg', 2500);
    let state = await t.evaluate(SVG_STATE);
    t.expect('an svg file opened on its own is the root element, and blurred',
      [state.root, state.classes, state.filter],
      ['svg', 'ibx-hover ibx-vector', 'blur(12px)']);

    await t.setSettings({ enabled: false });
    state = await t.evaluate(SVG_STATE);
    t.expect('switching off reaches the root element too', state.filter, 'none');
    await t.resetSettings();

    await t.open('checker.png', 2500);
    const raster = await t.evaluate(RASTER_STATE);
    t.expect('a png file opened on its own is wrapped in a document and blurred',
      [raster.root, raster.filter], ['HTML', 'blur(12px)']);
  }
};
