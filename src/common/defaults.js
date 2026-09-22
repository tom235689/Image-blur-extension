/**
 * Settings contract shared by every extension surface.
 *
 * Loaded as a classic script so that the content script, the popup, the
 * options page and the service worker can all reuse the exact same defaults,
 * validation and host matching rules.
 */
(function (global) {
  'use strict';

  var BLUR_MIN = 2;
  var BLUR_MAX = 60;
  var SIZE_MIN = 0;
  var SIZE_MAX = 256;
  var HOVER_DELAY_MAX = 2000;
  var MODES = ['blur', 'blackout'];

  /**
   * What the site list means. 'exceptions' leaves the listed hosts alone and
   * blurs everywhere else; 'only' is the mirror image, for someone who wants
   * the blur on a handful of sites rather than on all of them.
   */
  var SITE_LIST_MODES = ['exceptions', 'only'];

  /**
   * Which key has to be held down before hovering reveals anything. A pointer
   * crossing an image uncovers it by accident, and on a shared screen that is
   * the one thing this extension is there to prevent.
   */
  var REVEAL_KEYS = ['none', 'alt', 'ctrl', 'shift'];

  /**
   * The kinds of media that can be turned off one at a time. A page drawn on a
   * canvas is unusable once it is blurred and a video is unwatchable, so
   * "blur the images" has to be able to mean only that.
   */
  var MEDIA_KINDS = ['images', 'videos', 'canvases', 'backgrounds', 'vectors'];

  var DEFAULT_SETTINGS = {
    enabled: true,
    blurAmount: 12,
    revealOnHover: true,
    /** How long the pointer must rest on something before it is revealed. */
    hoverDelay: 300,
    /** A key that must be held down as well, or 'none' for hovering alone. */
    revealKey: 'none',
    /** blur softens the image; blackout replaces it with a dark block. */
    mode: 'blur',
    /** Which kinds of media are blurred at all. */
    blurTypes: {
      images: true,
      videos: true,
      canvases: true,
      backgrounds: true,
      vectors: true
    },
    /** Whether the site list names what to leave alone, or what to blur. */
    siteListMode: 'exceptions',
    /** Raster media smaller than this in both directions is left sharp. 0 blurs everything. */
    minImageSize: 0,
    /** Inline SVG smaller than this in both directions is left sharp: interface icons. */
    minVectorSize: 48,
    excludedSites: []
  };

  function clampBlur(value) {
    var amount = Number(value);
    if (!isFinite(amount)) {
      return DEFAULT_SETTINGS.blurAmount;
    }
    return Math.min(BLUR_MAX, Math.max(BLUR_MIN, Math.round(amount)));
  }

  function clampNumber(value, fallback) {
    var number = Number(value);
    return isFinite(number) ? Math.round(number) : fallback;
  }

  function clampSize(value, fallback) {
    var size = Number(value);
    if (!isFinite(size)) {
      return fallback;
    }
    return Math.min(SIZE_MAX, Math.max(SIZE_MIN, Math.round(size)));
  }

  /**
   * Turns whatever the user typed ("https://www.Example.com/photos?a=1",
   * "Example.com:8080") into a bare, lower case host name.
   * Returns an empty string when nothing usable is left.
   */
  function normalizeHost(input) {
    var text = String(input == null ? '' : input).trim().toLowerCase();
    if (!text) {
      return '';
    }
    text = text.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
    text = text.replace(/^[^/@]*@/, '');
    text = text.split('/')[0].split('?')[0].split('#')[0];
    text = text.replace(/:\d+$/, '');
    text = text.replace(/^www\./, '');
    text = text.replace(/\.+$/, '');
    if (!text || !/^[a-z0-9.\-[\]:]+$/.test(text)) {
      return '';
    }
    return text;
  }

  /**
   * Always a fresh object carrying every kind, so that no caller can reach the
   * defaults through a stored value and no surface has to cope with a missing
   * key. Only an explicit false turns a kind off: a settings file written by an
   * older version, or by hand, blurs more rather than less.
   */
  function normalizeBlurTypes(value) {
    var source = value && typeof value === 'object' ? value : {};
    var result = {};
    for (var i = 0; i < MEDIA_KINDS.length; i += 1) {
      result[MEDIA_KINDS[i]] = source[MEDIA_KINDS[i]] !== false;
    }
    return result;
  }

  function normalizeSiteList(value) {
    var list = Array.isArray(value) ? value : [];
    var seen = Object.create(null);
    var result = [];
    for (var i = 0; i < list.length; i += 1) {
      var host = normalizeHost(list[i]);
      if (host && !seen[host]) {
        seen[host] = true;
        result.push(host);
      }
    }
    result.sort();
    return result;
  }

  function normalizeSettings(raw) {
    var source = raw && typeof raw === 'object' ? raw : {};
    return {
      enabled: source.enabled !== false,
      blurAmount: clampBlur(source.blurAmount),
      revealOnHover: source.revealOnHover !== false,
      hoverDelay: Math.min(HOVER_DELAY_MAX, Math.max(0, clampNumber(source.hoverDelay, DEFAULT_SETTINGS.hoverDelay))),
      revealKey: REVEAL_KEYS.indexOf(source.revealKey) === -1 ? DEFAULT_SETTINGS.revealKey : source.revealKey,
      mode: MODES.indexOf(source.mode) === -1 ? DEFAULT_SETTINGS.mode : source.mode,
      blurTypes: normalizeBlurTypes(source.blurTypes),
      siteListMode: SITE_LIST_MODES.indexOf(source.siteListMode) === -1
        ? DEFAULT_SETTINGS.siteListMode
        : source.siteListMode,
      minImageSize: clampSize(source.minImageSize, DEFAULT_SETTINGS.minImageSize),
      minVectorSize: clampSize(source.minVectorSize, DEFAULT_SETTINGS.minVectorSize),
      excludedSites: normalizeSiteList(source.excludedSites)
    };
  }

  /** Whether one stored entry covers a host: the host itself, or a parent of it. */
  function covers(entry, host) {
    return !!entry && (host === entry || host.slice(-(entry.length + 1)) === '.' + entry);
  }

  /**
   * A stored host also covers its sub domains, so "example.com" excludes
   * "images.example.com" as well.
   */
  function isExcluded(hostname, excludedSites) {
    var host = normalizeHost(hostname);
    if (!host || !Array.isArray(excludedSites)) {
      return false;
    }
    for (var i = 0; i < excludedSites.length; i += 1) {
      if (covers(normalizeHost(excludedSites[i]), host)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Whether any kind of media is left to blur at all. Switching every kind off
   * is a way of blurring nothing, and every surface has to read it as one.
   */
  function blursAnything(settings) {
    var source = settings && typeof settings === 'object' && settings.blurTypes
      && typeof settings.blurTypes === 'object' ? settings.blurTypes : {};
    for (var i = 0; i < MEDIA_KINDS.length; i += 1) {
      if (source[MEDIA_KINDS[i]] !== false) {
        return true;
      }
    }
    return false;
  }

  /** Whether the list names this host, whatever the list happens to mean. */
  function isListed(hostname, sites) {
    return isExcluded(hostname, sites);
  }

  /**
   * Whether this host gets blurred at all, which is the question every surface
   * actually asks. In the default mode the list names the hosts to leave alone;
   * in the other it names the only hosts to blur, and everywhere else is left
   * as it is.
   */
  function isSiteBlurred(hostname, settings) {
    var source = settings && typeof settings === 'object' ? settings : {};
    var listed = isListed(hostname, source.excludedSites);
    return source.siteListMode === 'only' ? listed : !listed;
  }

  /**
   * The site list after turning blurring on or off for one host.
   *
   * In the default mode the list holds what to skip, so blurring a host means
   * taking it off; in the other mode the list holds what to blur, so blurring a
   * host means putting it on. Either way, removing has to drop every entry that
   * covers the host rather than only one equal to it: a stored "example.com"
   * also covers "images.example.com", so removing nothing would leave the
   * switch saying one thing and the page doing another. The parent goes with
   * it, because a list of hosts cannot say "this host, but not that sub domain".
   */
  function setSiteBlurred(sites, hostname, blurred, siteListMode) {
    var host = normalizeHost(hostname);
    var list = normalizeSiteList(sites);
    if (!host) {
      return list;
    }

    var wantsListed = siteListMode === 'only' ? blurred : !blurred;
    if (wantsListed) {
      return isListed(host, list) ? list : normalizeSiteList(list.concat(host));
    }
    return list.filter(function (entry) {
      return !covers(entry, host);
    });
  }

  function storage() {
    try {
      return global.chrome && chrome.storage ? chrome.storage.sync : null;
    } catch (error) {
      return null;
    }
  }

  function readSettings() {
    return new Promise(function (resolve) {
      var area = storage();
      if (!area) {
        resolve(normalizeSettings(null));
        return;
      }
      try {
        area.get(DEFAULT_SETTINGS, function (items) {
          var failed = chrome.runtime && chrome.runtime.lastError;
          resolve(normalizeSettings(failed ? null : items));
        });
      } catch (error) {
        resolve(normalizeSettings(null));
      }
    });
  }

  function writeSettings(patch) {
    return new Promise(function (resolve) {
      var area = storage();
      if (!area || !patch) {
        resolve(false);
        return;
      }
      try {
        area.set(patch, function () {
          resolve(!(chrome.runtime && chrome.runtime.lastError));
        });
      } catch (error) {
        resolve(false);
      }
    });
  }

  global.ImageBlur = {
    BLUR_MIN: BLUR_MIN,
    BLUR_MAX: BLUR_MAX,
    SIZE_MIN: SIZE_MIN,
    SIZE_MAX: SIZE_MAX,
    HOVER_DELAY_MAX: HOVER_DELAY_MAX,
    MODES: MODES,
    SITE_LIST_MODES: SITE_LIST_MODES,
    REVEAL_KEYS: REVEAL_KEYS,
    MEDIA_KINDS: MEDIA_KINDS,
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    clampBlur: clampBlur,
    clampSize: clampSize,
    normalizeHost: normalizeHost,
    normalizeSiteList: normalizeSiteList,
    normalizeBlurTypes: normalizeBlurTypes,
    normalizeSettings: normalizeSettings,
    isExcluded: isExcluded,
    isListed: isListed,
    blursAnything: blursAnything,
    isSiteBlurred: isSiteBlurred,
    setSiteBlurred: setSiteBlurred,
    readSettings: readSettings,
    writeSettings: writeSettings
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
