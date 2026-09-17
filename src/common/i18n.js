/**
 * Localisation helper shared by the popup, the options page and the service
 * worker.
 *
 * Every user visible string lives in _locales/<lang>/messages.json. Markup
 * refers to a key with a data-i18n attribute rather than carrying the English
 * text, so a translation never needs the HTML touched:
 *
 *   <h2 data-i18n="optionsSizeHeading">Size limits</h2>
 *
 * The English text stays in the markup as a fallback. If a key is missing -
 * a half translated catalogue, or the file failing to load - the element keeps
 * what it already had instead of going blank.
 */
(function (global) {
  'use strict';

  /** data-i18n attribute -> what it fills in. */
  var TARGETS = [
    { attribute: 'data-i18n', apply: setText },
    { attribute: 'data-i18n-title', apply: setAttribute('title') },
    { attribute: 'data-i18n-label', apply: setAttribute('aria-label') },
    { attribute: 'data-i18n-placeholder', apply: setAttribute('placeholder') }
  ];

  function bridge() {
    try {
      return global.chrome && chrome.i18n ? chrome.i18n : null;
    } catch (error) {
      return null;
    }
  }

  /**
   * The message for a key, or an empty string when it is missing. Callers
   * decide what an empty answer means, which is what keeps the markup fallback
   * above working.
   */
  function message(name, substitutions) {
    var i18n = bridge();
    if (!i18n || !name) {
      return '';
    }
    try {
      return i18n.getMessage(name, substitutions) || '';
    } catch (error) {
      return '';
    }
  }

  /** A length written the way the current locale writes it, such as "12 px". */
  function pixels(amount) {
    return message('unitPixels', [String(amount)]) || amount + ' px';
  }

  function setText(element, text) {
    element.textContent = text;
  }

  function setAttribute(name) {
    return function (element, text) {
      element.setAttribute(name, text);
    };
  }

  function fill(root, target) {
    var elements = root.querySelectorAll('[' + target.attribute + ']');
    for (var i = 0; i < elements.length; i += 1) {
      var element = elements[i];
      var text = message(element.getAttribute(target.attribute));
      if (text) {
        target.apply(element, text);
      }
    }
  }

  /**
   * Translates a document in place and marks it with the language and writing
   * direction of the interface, so a right to left translation lays itself out
   * correctly without any further work.
   */
  function apply(root) {
    var scope = root || global.document;
    if (!scope || !scope.querySelectorAll) {
      return;
    }

    for (var i = 0; i < TARGETS.length; i += 1) {
      fill(scope, TARGETS[i]);
    }

    var documentElement = scope.documentElement || (scope.ownerDocument && scope.ownerDocument.documentElement);
    if (!documentElement) {
      return;
    }

    var i18n = bridge();
    if (!i18n) {
      return;
    }
    try {
      var language = i18n.getUILanguage && i18n.getUILanguage();
      if (language) {
        documentElement.lang = language;
      }
    } catch (error) {
      /* Keep the language declared in the markup. */
    }
    var direction = message('@@bidi_dir');
    if (direction) {
      documentElement.dir = direction;
    }
  }

  global.ImageBlurI18n = {
    message: message,
    pixels: pixels,
    apply: apply
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
