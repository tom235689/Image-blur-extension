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

    t.expect('an entry covers a sub domain of it', api.isListed('images.example.com', ['example.com']), true);
    t.expect('and the host itself', api.isListed('example.com', ['example.com']), true);
    t.expect('a suffix is not a match', api.isListed('notexample.com', ['example.com']), false);
    t.expect('a prefix is not a match', api.isListed('example.com.evil.com', ['example.com']), false);

    // Turning a site back on has to beat every entry that covers it, or the
    // switch in the popup reports a change it did not make.
    t.expect('leaving a site alone adds it', api.setSiteBlurred([], 'example.com', false), ['example.com']);
    t.expect('doing it twice changes nothing',
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
      revealKey: 'none',
      mode: 'blur',
      blurTypes: {
        images: true,
        videos: true,
        canvases: true,
        backgrounds: true,
        vectors: true
      },
      siteListMode: 'exceptions',
      minImageSize: 0,
      minVectorSize: 48,
      excludedSites: []
    });

    t.expect('an unknown reveal key falls back',
      api.normalizeSettings({ revealKey: 'meta' }).revealKey, 'none');

    // A settings file from an older version names no kind at all, and a hand
    // written one can name anything. Either way the answer has to be a whole
    // set of kinds, and a missing one has to end up blurred rather than not.
    t.expect('only an explicit false turns a kind off, and nothing else survives',
      api.normalizeSettings({ blurTypes: { videos: false, images: 'yes', nonsense: true } }).blurTypes,
      { images: true, videos: false, canvases: true, backgrounds: true, vectors: true });

    const shared = api.normalizeSettings(null).blurTypes;
    shared.images = false;
    t.expect('each answer is a fresh object rather than the defaults themselves',
      api.normalizeSettings(null).blurTypes.images, true);

    t.expect('with a kind left on, something is being blurred',
      api.blursAnything(api.normalizeSettings({ blurTypes: { images: false, videos: false } })), true);
    t.expect('with every kind off, nothing is',
      api.blursAnything(api.normalizeSettings({
        blurTypes: { images: false, videos: false, canvases: false, backgrounds: false, vectors: false }
      })), false);
    t.expect('settings that name no kinds blur everything',
      api.blursAnything({}), true);

    t.expect('an unknown site list mode falls back',
      api.normalizeSettings({ siteListMode: 'sideways' }).siteListMode, 'exceptions');

    // The same list, read the two opposite ways round.
    const listed = { excludedSites: ['example.com'] };
    t.expect('by default a listed host is the one left alone',
      [api.isSiteBlurred('images.example.com', listed), api.isSiteBlurred('other.com', listed)],
      [false, true]);

    const only = { siteListMode: 'only', excludedSites: ['example.com'] };
    t.expect('the other way round, a listed host is the only one blurred',
      [api.isSiteBlurred('images.example.com', only), api.isSiteBlurred('other.com', only)],
      [true, false]);

    t.expect('blurring a host in the default mode takes it off the list',
      api.setSiteBlurred(['example.com', 'other.com'], 'images.example.com', true, 'exceptions'),
      ['other.com']);
    t.expect('blurring a host in the other mode puts it on',
      api.setSiteBlurred(['example.com'], 'other.com', true, 'only'),
      ['example.com', 'other.com']);
    t.expect('and not blurring it takes it off again',
      api.setSiteBlurred(['example.com', 'other.com'], 'other.com', false, 'only'),
      ['example.com']);

    t.expect('site list deduped and sorted',
      api.normalizeSettings({ excludedSites: ['B.com', 'https://b.com/x', 'a.com', ''] }).excludedSites,
      ['a.com', 'b.com']);
    t.expect('explicit false survives', api.normalizeSettings({ enabled: false }).enabled, false);
    t.expect('an unknown mode falls back', api.normalizeSettings({ mode: 'nope' }).mode, 'blur');
    t.expect('hover delay clamped', [api.normalizeSettings({ hoverDelay: 9999 }).hoverDelay, api.normalizeSettings({ hoverDelay: -5 }).hoverDelay], [api.HOVER_DELAY_MAX, 0]);
  }
};
