'use strict';

const BODY_STATE = `(() => {
  const before = getComputedStyle(document.body, '::before');
  return {
    cls: document.body.getAttribute('class') || '',
    self: getComputedStyle(document.body).filter,
    overlay: before.filter,
    position: before.position,
    opacity: before.opacity,
    hovered: document.body.matches(':hover'),
    bodyHeight: Math.round(document.body.getBoundingClientRect().height),
    viewportHeight: window.innerHeight
  };
})()`;

const HTML_STATE = `(() => {
  const before = getComputedStyle(document.documentElement, '::before');
  return {
    cls: (document.documentElement.getAttribute('class') || '').split(' ').sort().join(' '),
    overlay: before.filter,
    position: before.position,
    display: before.display,
    content: before.content
  };
})()`;

/**
 * A background on html or body is painted across the whole viewport rather
 * than over the element's own box, so the copy that hides it has to be fixed.
 */
module.exports = {
  name: 'page wide backgrounds',

  async run(t) {
    await t.open('body-background.html', 2500);
    let state = await t.evaluate(BODY_STATE);
    t.expect('body background covered by a fixed overlay',
      [state.cls, state.self, state.overlay, state.position],
      ['ibx-bg-overlay ibx-bg-canvas', 'none', 'blur(12px)', 'fixed']);
    t.expect('the body box is far smaller than the area that background covers',
      state.bodyHeight < state.viewportHeight, true);

    // The pointer is over body almost always, so hovering must not strip it.
    await t.hoverElement('body');
    state = await t.evaluate(BODY_STATE);
    t.expect('hovering the body keeps the page background blurred',
      [state.hovered, state.opacity, state.overlay], [true, '1', 'blur(12px)']);

    await t.open('html-background.html', 2500);
    state = await t.evaluate(HTML_STATE);
    t.expect('html is tagged as a page wide background host',
      [state.cls, state.overlay, state.position],
      ['ibx-bg-canvas ibx-bg-overlay ibx-hover', 'blur(12px)', 'fixed']);

    await t.setSettings({ enabled: false });
    state = await t.evaluate(HTML_STATE);
    // Not merely hidden: with the rule gated on html:not(.ibx-off) the pseudo
    // element is never generated, so nothing of it is left on the page.
    t.expect('switching off leaves no overlay on html at all',
      [state.content, state.overlay], ['none', 'none']);
  }
};
