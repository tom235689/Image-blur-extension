'use strict';

/** Pure checks on the shared settings contract; no browser needed. */
module.exports = {
  name: 'settings contract',
  browser: false,

  run(t) {
    const api = t.settingsModule.load();

    t.expect('scheme, www and path stripped', api.normalizeHost('https://www.Example.com/photos?a=1'), 'example.com');
    t.expect('port stripped', api.normalizeHost('Example.com:8080'), 'example.com');
    t.expect('user info stripped', api.normalizeHost('user@example.com'), 'example.com');
    t.expect('blank rejected', api.normalizeHost('   '), '');
    t.expect('nonsense rejected', api.normalizeHost('not a host'), '');

    t.expect('sub domain excluded', api.isExcluded('images.example.com', ['example.com']), true);
    t.expect('exact host excluded', api.isExcluded('example.com', ['example.com']), true);
    t.expect('suffix is not a match', api.isExcluded('notexample.com', ['example.com']), false);
    t.expect('prefix is not a match', api.isExcluded('example.com.evil.com', ['example.com']), false);

    // Turning a site back on has to beat every entry that covers it, or the
    // switch in the popup reports a change it did not make.
    t.expect('excluding a site adds it', api.setSiteBlurred([], 'example.com', false), ['example.com']);
    t.expect('excluding it twice changes nothing',
      api.setSiteBlurred(['example.com'], 'example.com', false), ['example.com']);
    t.expect('a sub domain already covered is not added again',
      api.setSiteBlurred(['example.com'], 'images.example.com', false), ['example.com']);
    t.expect('blurring a site removes its own entry',
      api.setSiteBlurred(['a.com', 'example.com'], 'example.com', true), ['a.com']);
    t.expect('blurring a sub domain removes the parent that covered it',
      api.setSiteBlurred(['a.com', 'example.com'], 'images.example.com', true), ['a.com']);
    t.expect('a host that only looks like a parent is left alone',
      api.setSiteBlurred(['notexample.com'], 'example.com', true), ['notexample.com']);
    t.expect('blurring a site that was never excluded changes nothing',
      api.setSiteBlurred(['a.com'], 'b.com', true), ['a.com']);
    t.expect('an unusable host leaves the list as it was',
      api.setSiteBlurred(['a.com'], 'not a host', false), ['a.com']);

    t.expect('blur clamped high', api.clampBlur(1000), api.BLUR_MAX);
    t.expect('blur clamped low', api.clampBlur(0), api.BLUR_MIN);
    t.expect('blur falls back on text', api.clampBlur('abc'), api.DEFAULT_SETTINGS.blurAmount);

    t.expect('size clamped low', api.clampSize(-5, 48), api.SIZE_MIN);
    t.expect('size clamped high', api.clampSize(1000, 48), api.SIZE_MAX);
    t.expect('size falls back on text', api.clampSize('abc', 48), 48);
    t.expect('size rounds', api.clampSize(33.7, 0), 34);

    t.expect('defaults', api.normalizeSettings(null), {
      enabled: true,
      blurAmount: 12,
      revealOnHover: true,
      hoverDelay: 300,
      mode: 'blur',
      minImageSize: 0,
      minVectorSize: 48,
      excludedSites: []
    });

    t.expect('site list deduped and sorted',
      api.normalizeSettings({ excludedSites: ['B.com', 'https://b.com/x', 'a.com', ''] }).excludedSites,
      ['a.com', 'b.com']);
    t.expect('explicit false survives', api.normalizeSettings({ enabled: false }).enabled, false);
    t.expect('an unknown mode falls back', api.normalizeSettings({ mode: 'nope' }).mode, 'blur');
    t.expect('hover delay clamped', [api.normalizeSettings({ hoverDelay: 9999 }).hoverDelay, api.normalizeSettings({ hoverDelay: -5 }).hoverDelay], [api.HOVER_DELAY_MAX, 0]);
  }
};
