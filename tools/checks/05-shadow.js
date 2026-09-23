'use strict';

const SHADOW_STATE = `(() => {
  const root = document.getElementById('card').shadowRoot;
  return {
    adopted: root.adoptedStyleSheets.length,
    image: getComputedStyle(root.getElementById('shadow-image')).filter,
    tile: getComputedStyle(root.getElementById('shadow-tile')).filter,
    tileClass: root.getElementById('shadow-tile').getAttribute('class')
  };
})()`;

const LATE_STATE = `(() => {
  const host = document.getElementById('host');
  const late = host.shadowRoot && host.shadowRoot.getElementById('late-image');
  return {
    attached: !!host.shadowRoot,
    adopted: host.shadowRoot ? host.shadowRoot.adoptedStyleSheets.length : -1,
    late: late ? getComputedStyle(late).filter : 'MISSING',
    imageInput: getComputedStyle(document.getElementById('image-input')).filter
  };
})()`;

const NESTED_STATE = `(() => {
  const outer = document.getElementById('outer').shadowRoot;
  const inner = outer.getElementById('inner-host').shadowRoot;
  return {
    outerImage: getComputedStyle(outer.getElementById('outer-image')).filter,
    attached: !!inner,
    adopted: inner ? inner.adoptedStyleSheets.length : -1,
    innerImage: inner ? getComputedStyle(inner.getElementById('inner-image')).filter : 'MISSING'
  };
})()`;

/** A document stylesheet stops at a shadow boundary; the sheet is adopted instead. */
module.exports = {
  name: 'shadow trees',

  async run(t) {
    await t.open('shadow.html', 2500);
    let state = await t.evaluate(SHADOW_STATE);
    t.expect('sheet adopted, media inside blurred',
      [state.adopted, state.image, state.tile, state.tileClass],
      [1, 'blur(12px)', 'blur(12px)', 'tile ibx-bg-direct']);

    await t.setSettings({ enabled: false });
    state = await t.evaluate(SHADOW_STATE);
    t.expect('switching off reaches inside the shadow tree', [state.image, state.tile], ['none', 'none']);
    await t.setSettings({ enabled: true });

    // Every gate in the stylesheet is written twice, the shadow copy with
    // :host-context. One added to the document flavour and forgotten in the
    // other is invisible until somebody looks inside a component.
    await t.setSettings({ mode: 'blackout' });
    state = await t.evaluate(SHADOW_STATE);
    t.expect('blackout reaches inside as well',
      [state.image, state.tile], ['blur(12px) brightness(0)', 'blur(12px) brightness(0)']);

    await t.setSettings({ mode: 'blur', blurTypes: { images: false } });
    state = await t.evaluate(SHADOW_STATE);
    t.expect('and so does one kind of media switched off',
      [state.image, state.tile], ['none', 'blur(12px)']);
    await t.resetSettings();

    // The host is scanned long before the root is attached at 4 s, and
    // attachShadow fires no mutation, so a sweep has to find it.
    await t.open('late-shadow.html', 2500);
    state = await t.evaluate(LATE_STATE);
    t.expect('image input blurred, shadow root not attached yet',
      [state.imageInput, state.attached], ['blur(12px)', false]);

    await t.sleep(7000);
    state = await t.evaluate(LATE_STATE);
    t.expect('late shadow root found, styled and blurred',
      [state.attached, state.adopted, state.late], [true, 1, 'blur(12px)']);

    // The same again one tree further down: a component built out of
    // components. querySelectorAll on the document cannot see into the outer
    // tree at all, so a sweep that only walks the document leaves the inner
    // image sharp for good - on a page that looks like it is working, since
    // the outer one is covered.
    await t.open('nested-shadow.html', 2500);
    state = await t.evaluate(NESTED_STATE);
    t.expect('the outer tree is covered, the inner one is not there yet',
      [state.outerImage, state.attached], ['blur(12px)', false]);

    await t.sleep(7000);
    state = await t.evaluate(NESTED_STATE);
    t.expect('a root nested inside another is found by the sweep too',
      [state.attached, state.adopted, state.innerImage], [true, 1, 'blur(12px)']);

    // Nothing may be skipped on a page with more elements than one chunk holds.
    await t.open('generated/large-dom.html', 6000);
    const large = await t.evaluate(`(() => ({
      elements: document.querySelectorAll('*').length,
      first: document.getElementById('first-tile').getAttribute('class'),
      last: document.getElementById('last-tile').getAttribute('class'),
      lastImage: getComputedStyle(document.getElementById('last-image')).filter
    }))()`);
    t.expect('the far end of a large page is scanned too',
      [large.elements > 8000, large.first, large.last, large.lastImage],
      [true, 'tile ibx-bg-direct', 'tile ibx-bg-direct', 'blur(12px)']);
  }
};
