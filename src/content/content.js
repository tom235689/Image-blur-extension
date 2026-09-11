/**
 * Content script: decides whether this frame should be blurred and tags the
 * elements that plain CSS selectors cannot reach (CSS background images and
 * inline SVG artwork).
 *
 * blur.css already blurs img/video/canvas from the very first paint, so this
 * script never has to add blur in a hurry - it only switches it off again when
 * the settings say so. Shadow trees are the exception: a document stylesheet
 * does not reach inside them, so the same sheet is adopted into every open
 * shadow root that turns up.
 */
(function () {
  'use strict';

  var api = globalThis.ImageBlur;
  if (!api) {
    return;
  }

  var CLASS_OFF = 'ibx-off';
  var CLASS_HOVER = 'ibx-hover';
  var CLASS_BG_DIRECT = 'ibx-bg-direct';
  var CLASS_BG_OVERLAY = 'ibx-bg-overlay';
  var CLASS_BG_ANCHOR = 'ibx-bg-anchor';
  var CLASS_BG_CANVAS = 'ibx-bg-canvas';
  var CLASS_VECTOR = 'ibx-vector';

  /** Inline SVG below this size is treated as UI chrome (icons, arrows, logos). */
  var VECTOR_MIN_SIZE = 48;
  /** How long one scanning chunk may block the main thread. */
  var FRAME_BUDGET_MS = 8;

  var BACKGROUND_IMAGE_PATTERN = /url\(|image-set\(/i;

  var OBSERVE_OPTIONS = {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['class', 'style']
  };

  var SKIP_TAGS = {
    AREA: 1, BASE: 1, BR: 1, COL: 1, COLGROUP: 1, FRAME: 1, HEAD: 1, HR: 1,
    IFRAME: 1, LINK: 1, MAP: 1, META: 1, NOSCRIPT: 1, OPTION: 1, PARAM: 1,
    SCRIPT: 1, SOURCE: 1, STYLE: 1, TEMPLATE: 1, TITLE: 1, TRACK: 1
  };

  var settings = api.DEFAULT_SETTINGS;
  var active = false;
  var scanning = false;
  var observer = null;
  var pending = new Set();
  var scheduled = false;

  var shadowSheet = null;
  var shadowSheetRequested = false;
  var knownShadowRoots = new WeakSet();
  var rootsAwaitingSheet = [];

  function root() {
    return document.documentElement;
  }

  function now() {
    return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
  }

  function requestIdle(callback) {
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(callback, { timeout: 250 });
    } else {
      setTimeout(callback, 16);
    }
  }

  /**
   * The frame's own host, falling back to the top level document for
   * about:blank and srcdoc frames, which have no host of their own.
   */
  function currentHost() {
    if (location.hostname) {
      return location.hostname;
    }
    try {
      var origins = location.ancestorOrigins;
      if (origins && origins.length) {
        return new URL(origins[origins.length - 1]).hostname;
      }
    } catch (error) {
      /* Cross origin ancestors are not readable; treat the frame as unknown. */
    }
    return '';
  }

  function queueClass(ops, element, name, on) {
    ops.push({ element: element, name: name, on: on });
  }

  function applyOps(ops) {
    for (var i = 0; i < ops.length; i += 1) {
      var op = ops[i];
      try {
        var list = op.element.classList;
        if (op.on) {
          if (!list.contains(op.name)) {
            list.add(op.name);
          }
        } else if (list.contains(op.name)) {
          list.remove(op.name);
        }
      } catch (error) {
        /* Detached or read only nodes are simply skipped. */
      }
    }
  }

  /**
   * The service worker hands over the stylesheet text; a content script cannot
   * read its own resources unless they are web accessible, and exposing them
   * to every page just to style shadow trees is not worth it.
   */
  function requestShadowSheet() {
    if (shadowSheetRequested) {
      return;
    }
    shadowSheetRequested = true;

    try {
      chrome.runtime.sendMessage({ type: 'ibx-blur-css' }, function (response) {
        if (chrome.runtime.lastError || !response || !response.css) {
          return;
        }
        try {
          shadowSheet = new CSSStyleSheet();
          shadowSheet.replaceSync(response.css);
        } catch (error) {
          shadowSheet = null;
          return;
        }
        var waiting = rootsAwaitingSheet;
        rootsAwaitingSheet = [];
        for (var i = 0; i < waiting.length; i += 1) {
          adoptShadowSheet(waiting[i]);
        }
      });
    } catch (error) {
      /* The extension was reloaded; shadow trees stay unstyled in this frame. */
    }
  }

  function adoptShadowSheet(shadowRoot) {
    if (!shadowSheet) {
      rootsAwaitingSheet.push(shadowRoot);
      return;
    }
    try {
      var sheets = shadowRoot.adoptedStyleSheets;
      // Re-adopting also repairs the case where the page replaced the array.
      if (sheets.indexOf(shadowSheet) === -1) {
        shadowRoot.adoptedStyleSheets = sheets.concat(shadowSheet);
      }
    } catch (error) {
      /* Some roots reject adopted sheets; nothing else to try. */
    }
  }

  function registerShadowRoot(shadowRoot) {
    var known = knownShadowRoots.has(shadowRoot);
    if (!known) {
      knownShadowRoots.add(shadowRoot);
      requestShadowSheet();
    }

    adoptShadowSheet(shadowRoot);

    if (observer) {
      try {
        // Observing the same root twice replaces the earlier registration, so
        // this also restores observation after the extension is switched off
        // and on again.
        observer.observe(shadowRoot, OBSERVE_OPTIONS);
      } catch (error) {
        /* Ignore roots that cannot be observed. */
      }
    }

    if (!known) {
      enqueueTree(shadowRoot);
    }
  }

  function hasText(element) {
    var text = element.textContent;
    return !!text && /\S/.test(text);
  }

  function markVector(element, style, ops) {
    if (style.display === 'none' || style.visibility === 'hidden') {
      queueClass(ops, element, CLASS_VECTOR, false);
      return;
    }
    var rect;
    try {
      rect = element.getBoundingClientRect();
    } catch (error) {
      return;
    }
    queueClass(ops, element, CLASS_VECTOR, rect.width >= VECTOR_MIN_SIZE && rect.height >= VECTOR_MIN_SIZE);
  }

  function markBackground(element, upper, style, ops) {
    var image = style.backgroundImage;
    var hasImage = !!image && image !== 'none' && BACKGROUND_IMAGE_PATTERN.test(image);

    if (!hasImage) {
      queueClass(ops, element, CLASS_BG_DIRECT, false);
      queueClass(ops, element, CLASS_BG_OVERLAY, false);
      queueClass(ops, element, CLASS_BG_ANCHOR, false);
      queueClass(ops, element, CLASS_BG_CANVAS, false);
      return;
    }

    // A background on <html> or <body> is painted across the whole viewport,
    // and blurring either of them would blur the entire page, so they always
    // take the overlay route with a viewport sized copy.
    var canvasHost = upper === 'HTML' || upper === 'BODY';

    // Blurring an element blurs its children too, so an element that holds text
    // gets a blurred copy of its background instead of a blur of itself.
    var overlay = canvasHost || hasText(element);

    var anchor = false;
    if (overlay && !canvasHost) {
      anchor = element.classList.contains(CLASS_BG_OVERLAY)
        // The anchor class itself forces position: relative, so re-reading the
        // computed position would flip the answer on every pass. Once decided,
        // the choice stays until the element stops needing an overlay.
        ? element.classList.contains(CLASS_BG_ANCHOR)
        : style.position === 'static';
    }

    queueClass(ops, element, CLASS_BG_DIRECT, !overlay);
    queueClass(ops, element, CLASS_BG_OVERLAY, overlay);
    queueClass(ops, element, CLASS_BG_ANCHOR, anchor);
    queueClass(ops, element, CLASS_BG_CANVAS, canvasHost);
  }

  function evaluate(element, ops, roots) {
    if (!element || element.nodeType !== 1) {
      return;
    }

    var tag = element.tagName;
    if (typeof tag !== 'string') {
      return;
    }
    var upper = tag.toUpperCase();
    if (SKIP_TAGS[upper] === 1) {
      return;
    }

    // Nodes inside an <svg> carry no CSS background image and are already
    // covered by the blur applied to their root <svg>.
    if (element.ownerSVGElement) {
      return;
    }

    if (element.shadowRoot) {
      roots.push(element.shadowRoot);
    }

    var style;
    try {
      style = getComputedStyle(element);
    } catch (error) {
      return;
    }
    if (!style) {
      return;
    }

    if (upper === 'SVG') {
      markVector(element, style, ops);
    }
    markBackground(element, upper, style, ops);
  }

  /**
   * Queues a node and everything under it. Only queueing happens here; the
   * work itself is spread over idle callbacks, so even a very large tree is
   * safe to enqueue in one go.
   */
  function enqueueTree(node) {
    if (!node) {
      return;
    }
    if (node.nodeType === 1) {
      pending.add(node);
    } else if (node.nodeType !== 9 && node.nodeType !== 11) {
      return;
    }

    var descendants = null;
    try {
      descendants = node.querySelectorAll ? node.querySelectorAll('*') : null;
    } catch (error) {
      descendants = null;
    }
    if (!descendants) {
      return;
    }

    for (var i = 0; i < descendants.length; i += 1) {
      pending.add(descendants[i]);
    }
  }

  function schedule() {
    if (scheduled || !active || !pending.size) {
      return;
    }
    scheduled = true;
    requestIdle(drain);
  }

  /**
   * Reads first and writes afterwards: class changes and newly found shadow
   * roots are collected while the chunk only reads style and layout, then
   * flushed in one go, so the scan never forces a synchronous reflow per
   * element.
   */
  function drain() {
    scheduled = false;
    if (!active) {
      pending.clear();
      return;
    }

    var ops = [];
    var roots = [];
    var deadline = now() + FRAME_BUDGET_MS;
    var processed = 0;
    var iterator = pending.values();
    var step = iterator.next();

    while (!step.done) {
      var element = step.value;
      pending.delete(element);
      evaluate(element, ops, roots);
      processed += 1;
      if ((processed & 31) === 0 && now() > deadline) {
        break;
      }
      step = iterator.next();
    }

    applyOps(ops);
    for (var i = 0; i < roots.length; i += 1) {
      registerShadowRoot(roots[i]);
    }

    schedule();
  }

  function onMutations(records) {
    if (!active) {
      return;
    }
    for (var i = 0; i < records.length; i += 1) {
      var record = records[i];
      if (record.type === 'attributes') {
        pending.add(record.target);
        continue;
      }
      var added = record.addedNodes;
      for (var j = 0; j < added.length; j += 1) {
        enqueueTree(added[j]);
      }
    }
    schedule();
  }

  /**
   * A rule such as ".card:hover { background-image: url(...) }" changes no
   * attribute and fires no mutation, so the element under the pointer is
   * re-checked as it is entered.
   */
  function onPointerEnter(event) {
    if (!active || !event.target || event.target.nodeType !== 1) {
      return;
    }
    pending.add(event.target);
    schedule();
  }

  function startScanning() {
    if (!observer) {
      observer = new MutationObserver(onMutations);
    }
    try {
      observer.observe(document, OBSERVE_OPTIONS);
    } catch (error) {
      /* Nothing to observe yet; the readyState listeners will retry. */
    }
    enqueueTree(root());
    schedule();
  }

  function stopScanning() {
    if (observer) {
      observer.disconnect();
    }
    pending.clear();
  }

  function applySettings(next) {
    settings = next;
    var element = root();
    if (!element) {
      return;
    }

    active = settings.enabled && !api.isExcluded(currentHost(), settings.excludedSites);

    element.style.setProperty('--ibx-blur-radius', settings.blurAmount + 'px');
    element.classList.toggle(CLASS_OFF, !active);
    element.classList.toggle(CLASS_HOVER, active && settings.revealOnHover);

    // Only a change of activation needs the tree walked again: the radius and
    // the hover mode are carried by the custom property and the classes above,
    // so dragging the slider must not restart a full scan on every write.
    if (active && !scanning) {
      scanning = true;
      startScanning();
    } else if (!active && scanning) {
      scanning = false;
      stopScanning();
    }
  }

  function rescan() {
    if (!active) {
      return;
    }
    enqueueTree(root());
    schedule();
  }

  function watchSettings() {
    try {
      chrome.storage.onChanged.addListener(function (changes, area) {
        if (area !== 'sync') {
          return;
        }
        api.readSettings().then(applySettings);
      });
    } catch (error) {
      /* The extension was reloaded; this frame keeps its current state. */
    }
  }

  function init() {
    if (!root()) {
      document.addEventListener('readystatechange', init, { once: true });
      return;
    }

    api.readSettings().then(applySettings);
    watchSettings();

    document.addEventListener('DOMContentLoaded', rescan, true);
    document.addEventListener('mouseover', onPointerEnter, { capture: true, passive: true });
    // Late stylesheets and lazily loaded sections can introduce background
    // images without touching an observed attribute, so sweep again once the
    // page has settled.
    window.addEventListener('load', function () {
      rescan();
      setTimeout(rescan, 1200);
    }, true);
  }

  init();
})();
