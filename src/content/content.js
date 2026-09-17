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
  var CLASS_BLACKOUT = 'ibx-blackout';
  var CLASS_BG_DIRECT = 'ibx-bg-direct';
  var CLASS_BG_OVERLAY = 'ibx-bg-overlay';
  var CLASS_BG_ANCHOR = 'ibx-bg-anchor';
  var CLASS_BG_CANVAS = 'ibx-bg-canvas';
  var CLASS_VECTOR = 'ibx-vector';
  var CLASS_SMALL = 'ibx-small';

  /** How long one scanning chunk may block the main thread. */
  var FRAME_BUDGET_MS = 8;

  /** Tags worth measuring: every element blur.css can blur as replaced media. */
  var MEDIA_TAGS = { IMG: 1, VIDEO: 1, CANVAS: 1, OBJECT: 1, EMBED: 1, INPUT: 1 };

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
  /** Set by the toolbar or the keyboard shortcut; gone as soon as the tab reloads. */
  var paused = false;
  var reportedOnce = false;
  var observer = null;
  var pending = new Set();
  var scheduled = false;
  var resizeTimer = 0;

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

  function isHidden(style) {
    return style.display === 'none' || style.visibility === 'hidden';
  }

  /**
   * Whether the element is small enough to count as an interface icon rather
   * than content: smaller than the limit in both directions. An element that
   * has no box yet - an image still loading, a lazy section - is never called
   * small, so it stays blurred until it has a real size.
   */
  function isBelowSize(element, limit) {
    if (limit <= 0) {
      return false;
    }
    var rect;
    try {
      rect = element.getBoundingClientRect();
    } catch (error) {
      return false;
    }
    return rect.width > 0 && rect.height > 0 && rect.width < limit && rect.height < limit;
  }

  function markVector(element, style, ops) {
    if (isHidden(style)) {
      queueClass(ops, element, CLASS_VECTOR, false);
      return;
    }
    queueClass(ops, element, CLASS_VECTOR, !isBelowSize(element, settings.minVectorSize));
  }

  /**
   * Whether blur.css actually blurs this element, which mirrors its selectors:
   * only an image button among inputs, and only image content among objects and
   * embeds. A tag alone is not enough - <input type="text"> and an <object>
   * holding a PDF share their tag with blurred media but are never blurred, and
   * tagging them would put a class on a page element for no reason.
   */
  function isBlurredMedia(element, upper) {
    if (upper === 'IMG' || upper === 'VIDEO' || upper === 'CANVAS') {
      return true;
    }
    if (upper === 'INPUT') {
      // The IDL attribute is already lower case and defaults to "text".
      return element.type === 'image';
    }
    // CSS matches the type attribute case insensitively here, so this does too.
    var type = element.getAttribute && element.getAttribute('type');
    return !!type && type.toLowerCase().indexOf('image/') === 0;
  }

  /**
   * blur.css blurs replaced media on sight, so the size limit works the other
   * way round here: anything below it is tagged and has its blur taken off.
   * Anything the stylesheet never blurs is never tagged, and the same check
   * clears a stale class from an element that has stopped being an image.
   */
  function markSmallMedia(element, upper, style, ops) {
    var exempt = isBlurredMedia(element, upper)
      && !isHidden(style)
      && isBelowSize(element, settings.minImageSize);
    queueClass(ops, element, CLASS_SMALL, exempt);
  }

  function markBackground(element, upper, style, ops) {
    var image = style.backgroundImage;
    var hasImage = !!image && image !== 'none' && BACKGROUND_IMAGE_PATTERN.test(image);

    // Icon sized boxes - sprite sheets, bullets, flags - fall under the same
    // size limit as replaced media, except for the page background, which is
    // measured against the viewport rather than a box of its own.
    if (hasImage && upper !== 'HTML' && upper !== 'BODY' && isBelowSize(element, settings.minImageSize)) {
      hasImage = false;
    }

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
    } else if (MEDIA_TAGS[upper] === 1) {
      markSmallMedia(element, upper, style, ops);
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

  /**
   * Queues a tree together with every open shadow tree inside it. Used when a
   * whole pass has to be redone, since querySelectorAll stops at a shadow
   * boundary.
   */
  function enqueueDeep(node) {
    enqueueTree(node);

    var elements;
    try {
      elements = node.querySelectorAll ? node.querySelectorAll('*') : null;
    } catch (error) {
      return;
    }
    if (!elements) {
      return;
    }

    for (var i = 0; i < elements.length; i += 1) {
      if (elements[i].shadowRoot) {
        enqueueDeep(elements[i].shadowRoot);
      }
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

  /**
   * An image has no size until it has loaded, and the size limits are decided
   * on the painted box, so every media element is measured again once its
   * resource arrives. Load events do not bubble; the capture phase sees them.
   */
  function onResourceLoad(event) {
    var target = event.target;
    if (!active || !target || target.nodeType !== 1 || MEDIA_TAGS[target.tagName.toUpperCase()] !== 1) {
      return;
    }
    pending.add(target);
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
    enqueueDeep(root());
    schedule();
  }

  function stopScanning() {
    if (observer) {
      observer.disconnect();
    }
    pending.clear();
  }

  function applySettings(next) {
    var previous = settings;
    settings = next;

    var element = root();
    if (!element) {
      return;
    }

    active = settings.enabled && !paused && !api.isExcluded(currentHost(), settings.excludedSites);

    element.style.setProperty('--ibx-blur-radius', settings.blurAmount + 'px');
    element.style.setProperty('--ibx-hover-delay', settings.hoverDelay + 'ms');
    element.classList.toggle(CLASS_OFF, !active);
    element.classList.toggle(CLASS_HOVER, active && settings.revealOnHover);
    element.classList.toggle(CLASS_BLACKOUT, settings.mode === 'blackout');

    // Only a change of activation needs the tree walked again: the radius and
    // the hover mode are carried by the custom property and the classes above,
    // so dragging the slider must not restart a full scan on every write.
    if (active && !scanning) {
      scanning = true;
      startScanning();
    } else if (!active && scanning) {
      scanning = false;
      stopScanning();
    } else if (active && sizeLimitsChanged(previous, settings)) {
      // The limits are decided per element while scanning, so changing one is
      // the one setting that does need everything measured again.
      rescan();
    }

    reportState();
  }

  /**
   * Tells the service worker what this tab looks like now, so the toolbar can
   * show a badge for it. The first report after a load also says so, which is
   * how a pause is dropped when the tab reloads.
   */
  function reportState() {
    if (window.top !== window) {
      return;
    }
    try {
      chrome.runtime.sendMessage({
        type: 'ibx-state',
        host: currentHost(),
        active: active,
        paused: paused,
        fresh: !reportedOnce
      }, function () {
        void chrome.runtime.lastError;
      });
      reportedOnce = true;
    } catch (error) {
      /* The extension was reloaded; the badge just stays as it was. */
    }
  }

  function onExtensionMessage(message, sender, sendResponse) {
    if (!message) {
      return false;
    }

    // A pause covers the whole tab, so every frame gets told.
    if (message.type === 'ibx-pause') {
      paused = !!message.paused;
      applySettings(settings);
      return false;
    }

    if (message.type === 'ibx-query' && window.top === window) {
      sendResponse({ host: currentHost(), active: active, paused: paused });
    }
    return false;
  }

  function sizeLimitsChanged(previous, next) {
    return previous.minImageSize !== next.minImageSize || previous.minVectorSize !== next.minVectorSize;
  }

  function rescan() {
    if (!active) {
      return;
    }
    enqueueDeep(root());
    schedule();
  }

  /**
   * A shadow root can be attached long after its host was scanned, and that
   * attachment fires no mutation record anywhere. Hunting for unknown hosts is
   * cheap - no style or layout is read - so it is repeated a few times on a
   * widening interval instead of scanning the whole tree again.
   */
  function sweepShadowHosts() {
    if (!active) {
      return;
    }

    var elements;
    try {
      elements = document.querySelectorAll('*');
    } catch (error) {
      return;
    }

    var found = [];
    for (var i = 0; i < elements.length; i += 1) {
      var shadowRoot = elements[i].shadowRoot;
      if (shadowRoot && !knownShadowRoots.has(shadowRoot)) {
        found.push(shadowRoot);
      }
    }
    for (var j = 0; j < found.length; j += 1) {
      registerShadowRoot(found[j]);
    }
  }

  function scheduleShadowSweeps() {
    var delays = [1000, 3000, 8000, 20000];
    for (var i = 0; i < delays.length; i += 1) {
      setTimeout(sweepShadowHosts, delays[i]);
    }
  }

  function watchSettings() {
    try {
      chrome.storage.onChanged.addListener(function (changes, area) {
        if (area !== 'sync') {
          return;
        }
        api.readSettings().then(applySettings);
      });
      chrome.runtime.onMessage.addListener(onExtensionMessage);
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
    document.addEventListener('load', onResourceLoad, { capture: true, passive: true });

    // A responsive layout can push an element across a size limit, but only if
    // there is a limit to cross.
    window.addEventListener('resize', function () {
      if (!settings.minImageSize && !settings.minVectorSize) {
        return;
      }
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(rescan, 400);
    }, { passive: true });
    // Late stylesheets and lazily loaded sections can introduce background
    // images without touching an observed attribute, so sweep again once the
    // page has settled.
    window.addEventListener('load', function () {
      rescan();
      setTimeout(rescan, 1200);
      scheduleShadowSweeps();
    }, true);
  }

  init();
})();
