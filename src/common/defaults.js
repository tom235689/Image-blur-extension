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

  var DEFAULT_SETTINGS = {
    enabled: true,
    blurAmount: 12,
    revealOnHover: true,
    excludedSites: []
  };

  function clampBlur(value) {
    var amount = Number(value);
    if (!isFinite(amount)) {
      return DEFAULT_SETTINGS.blurAmount;
    }
    return Math.min(BLUR_MAX, Math.max(BLUR_MIN, Math.round(amount)));
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
      excludedSites: normalizeSiteList(source.excludedSites)
    };
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
      var entry = normalizeHost(excludedSites[i]);
      if (entry && (host === entry || host.slice(-(entry.length + 1)) === '.' + entry)) {
        return true;
      }
    }
    return false;
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
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    clampBlur: clampBlur,
    normalizeHost: normalizeHost,
    normalizeSiteList: normalizeSiteList,
    normalizeSettings: normalizeSettings,
    isExcluded: isExcluded,
    readSettings: readSettings,
    writeSettings: writeSettings
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
