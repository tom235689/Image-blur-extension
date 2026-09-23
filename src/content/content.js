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
  var CLASS_MEDIA = 'ibx-media';

  /**
   * One class per kind of media that can be left alone, carried on <html>
   * rather than on each element: the tagging pass runs long after the first
   * paint, so an element could not be spared in time.
   */
  var SKIP_CLASSES = {
    images: 'ibx-skip-image',
    videos: 'ibx-skip-video',
    canvases: 'ibx-skip-canvas',
    backgrounds: 'ibx-skip-background',
    vectors: 'ibx-skip-vector'
  };

  /** The modifier flag each reveal key choice reads off an event. */
  var REVEAL_KEY_FLAGS = { alt: 'altKey', ctrl: 'ctrlKey', shift: 'shiftKey' };

  /** How long one scanning chunk may block the main thread. */
  var FRAME_BUDGET_MS = 8;

  /** Tags worth measuring: every element blur.css can blur as replaced media. */
  var MEDIA_TAGS = { IMG: 1, VIDEO: 1, CANVAS: 1, OBJECT: 1, EMBED: 1, INPUT: 1 };

  var BACKGROUND_IMAGE_PATTERN = /url\(|image-set\(/i;

  /** Image file extensions as they appear at the end of a URL path. */
  var IMAGE_URL_PATTERN = /\.(?:apng|avif|bmp|gif|ico|jfif|jpe?g|png|svg|tiff?|webp)(?:[?#]|$)/i;

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
  /** Watches <html> for a page writing over the state kept there. */
  var rootGuard = null;
  /** Whether the key the reveal is waiting for is down at this moment. */
  var revealKeyHeld = false;
  var pending = new Set();
  var scheduled = false;
  var resizeTimer = 0;

  /**
   * How long to wait before each attempt at fetching the stylesheet text. The
   * service worker may still be starting up when the first shadow root turns
   * up, and a shadow tree without the sheet is a shadow tree whose images are
   * never blurred, so one refusal must not be the end of it.
   */
  var SHEET_RETRY_DELAYS = [0, 400, 1500, 5000, 15000];

  var shadowSheet = null;
  var sheetAttempt = 0;
  var sheetInFlight = false;
  var knownShadowRoots = new WeakSet();
  /** Roots to style as soon as the sheet arrives; a Set, so a root queues once. */
  var rootsAwaitingSheet = new Set();

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
   * The host the site list is about, which is the page the user is looking at
   * rather than wherever a frame's own source happens to come from. A site left
   * off the blur has to stay off across the videos, maps and adverts it embeds,
   * or half the page contradicts the switch the user just used; the popup names
   * that same host, so this is also what it promised. ancestorOrigins is
   * readable across origins, so a frame can always find out where it is.
   */
  function currentHost() {
    try {
      var origins = location.ancestorOrigins;
      if (origins && origins.length) {
        var embedder = new URL(origins[origins.length - 1]).hostname;
        if (embedder) {
          return embedder;
        }
      }
    } catch (error) {
      /* A sandboxed ancestor has an opaque origin; fall back to our own. */
    }
    return location.hostname || '';
  }

  /**
   * Queues a class change, and only a change. Reading classList forces no
   * layout, so the comparison belongs here in the read phase rather than in the
   * write phase: every element is offered half a dozen classes it does not
   * have, and on a large page that is tens of thousands of queued operations
   * per pass whose entire effect is to decide to do nothing.
   */
  function queueClass(ops, element, name, on) {
    try {
      if (element.classList.contains(name) === !!on) {
        return;
      }
    } catch (error) {
      /* No class list to read; nothing can be written either. */
      return;
    }
    ops.push({ element: element, name: name, on: on });
  }

  function applyOps(ops) {
    for (var i = 0; i < ops.length; i += 1) {
      var op = ops[i];
      try {
        if (op.on) {
          op.element.classList.add(op.name);
        } else {
          op.element.classList.remove(op.name);
        }
      } catch (error) {
        /* Detached or read only nodes are simply skipped. */
      }
    }
  }

  /** Whether it is still worth holding on to a root, or asking again. */
  function sheetStillComing() {
    return sheetInFlight || sheetAttempt < SHEET_RETRY_DELAYS.length;
  }

  /** Stops trying, and lets go of the roots that were waiting on the answer. */
  function giveUpOnSheet() {
    sheetInFlight = false;
    sheetAttempt = SHEET_RETRY_DELAYS.length;
    rootsAwaitingSheet.clear();
  }

  /**
   * Asks the service worker for the stylesheet text, which is the only way to
   * get at it: a content script cannot read its own resources unless they are
   * declared web accessible, and exposing them to every page just to style
   * shadow trees is not worth it.
   */
  function requestShadowSheet() {
    if (shadowSheet || sheetInFlight || sheetAttempt >= SHEET_RETRY_DELAYS.length) {
      return;
    }
    sheetInFlight = true;
    var delay = SHEET_RETRY_DELAYS[sheetAttempt];
    sheetAttempt += 1;
    setTimeout(sendSheetRequest, delay);
  }

  function sendSheetRequest() {
    try {
      chrome.runtime.sendMessage({ type: 'ibx-blur-css' }, function (response) {
        sheetInFlight = false;

        if (chrome.runtime.lastError || !response || !response.css) {
          // The worker was asleep, or busy starting; ask again shortly. Once
          // the attempts are spent there is nothing left to wait for, and the
          // roots that were waiting have to be let go of rather than held for
          // the life of the page.
          requestShadowSheet();
          if (!sheetStillComing()) {
            giveUpOnSheet();
          }
          return;
        }

        var sheet;
        try {
          sheet = new CSSStyleSheet();
          sheet.replaceSync(response.css);
        } catch (error) {
          // Constructable stylesheets are unavailable here, which asking again
          // cannot change.
          giveUpOnSheet();
          return;
        }
        shadowSheet = sheet;

        var waiting = rootsAwaitingSheet;
        rootsAwaitingSheet = new Set();
        waiting.forEach(adoptShadowSheet);
      });
    } catch (error) {
      /* The extension was reloaded; this frame cannot reach it any more. */
      giveUpOnSheet();
    }
  }

  function adoptShadowSheet(shadowRoot) {
    if (!shadowSheet) {
      if (sheetStillComing()) {
        rootsAwaitingSheet.add(shadowRoot);
      }
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
   * Whether blur.css has a selector for this element as replaced media, which
   * this mirrors: only an image button among inputs, and only image content
   * among objects and embeds. A tag alone is not enough - <input type="text">
   * and an <object> holding a PDF share their tag with blurred media but are
   * never blurred, and tagging them would put a class on a page element for no
   * reason. Whether the blur is switched on for that kind is a separate
   * question, and not one asked here: the class this decides says what an
   * element is, not what is currently being done to it.
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

  /**
   * An <object> or <embed> with no type attribute still shows an image when its
   * source points at one, and blur.css has nothing to match it with:
   * object[type^="image/"] needs the attribute the author left out.
   *
   * The source URL is the only clue that can be trusted here. contentDocument
   * is null for an image, but it is equally null for a cross origin page, so
   * reading it would eventually blur a document and the text inside it. An
   * extension at the end of the path is narrow enough never to do that.
   */
  function holdsUntypedImage(element, upper) {
    if (upper !== 'OBJECT' && upper !== 'EMBED') {
      return false;
    }
    if (element.getAttribute('type')) {
      return false;
    }
    var source = element.getAttribute(upper === 'OBJECT' ? 'data' : 'src');
    return !!source && IMAGE_URL_PATTERN.test(source);
  }

  /** A border-image drawn from a picture rather than from a gradient. */
  function hasBorderImage(style) {
    var source = style.borderImageSource;
    return !!source && source !== 'none' && BACKGROUND_IMAGE_PATTERN.test(source);
  }

  /**
   * Images that no CSS selector can reach: an untyped <object> or <embed>, any
   * element the content property replaces with a url(), and a border drawn from
   * a picture.
   *
   * Replaced media is blurred on sight and untagged once measured; these are
   * the other way round, because until this runs there is nothing to select.
   * That means the size limit is applied here rather than by taking a blur off
   * again, and it means such an image is sharp for the length of one scan.
   *
   * A border-image only counts when the element holds no text, because the only
   * way to hide it is to blur the element itself, and the overlay used for a
   * background cannot stand in: it copies the background, which a border image
   * is not part of.
   */
  function markUnselectableMedia(element, upper, style, ops) {
    var found = holdsUntypedImage(element, upper)
      || (!!style.content && style.content.indexOf('url(') === 0)
      || (hasBorderImage(style) && !hasText(element));
    var blur = found && !isHidden(style) && !isBelowSize(element, settings.minImageSize);
    queueClass(ops, element, CLASS_MEDIA, blur);
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
    markUnselectableMedia(element, upper, style, ops);
    markBackground(element, upper, style, ops);
  }

  /**
   * Every open shadow root under a node, the ones nested inside other shadow
   * trees included. querySelectorAll stops at each boundary, so finding those
   * means running it again inside every root it turns up: a component built out
   * of components hides its images one tree further down than a single pass
   * can see.
   *
   * Declared before its callers rather than beside the sweep, because both the
   * scan and the sweep ask it the same question.
   */
  function collectShadowRoots(node, found) {
    var elements;
    try {
      elements = node.querySelectorAll ? node.querySelectorAll('*') : null;
    } catch (error) {
      return found;
    }
    if (!elements) {
      return found;
    }

    for (var i = 0; i < elements.length; i += 1) {
      var shadowRoot = elements[i].shadowRoot;
      if (shadowRoot) {
        found.push(shadowRoot);
        collectShadowRoots(shadowRoot, found);
      }
    }
    return found;
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
   * Queues a tree together with every open shadow tree inside it, at any depth.
   * Used when a whole pass has to be redone, since querySelectorAll stops at a
   * shadow boundary. What counts as "every shadow tree" is answered in one
   * place, shared with the sweep: two walks that could disagree is how a tree
   * nested inside another came to be missed.
   */
  function enqueueDeep(node) {
    enqueueTree(node);

    var roots = collectShadowRoots(node, []);
    for (var i = 0; i < roots.length; i += 1) {
      enqueueTree(roots[i]);
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
    // A key can be held while the page has no focus at all, and then no key
    // event ever arrives; the pointer event carries the same flag.
    readRevealKey(event);
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

  /**
   * Whether hovering reveals anything at the moment. A reveal key makes the
   * reveal deliberate: a pointer crossing an image uncovers nothing on its
   * own, which is the difference between a blur that survives somebody else
   * looking at the screen and one that does not.
   */
  function revealAllowed() {
    if (!settings.revealOnHover) {
      return false;
    }
    return settings.revealKey === 'none' || revealKeyHeld;
  }

  /** Writes a class only when it is not already there, so nothing loops. */
  function setRootClass(element, name, on) {
    try {
      if (element.classList.contains(name) === !!on) {
        return;
      }
      if (on) {
        element.classList.add(name);
      } else {
        element.classList.remove(name);
      }
    } catch (error) {
      /* Nothing to write the class to. */
    }
  }

  /**
   * The same for the two numbers, which travel as custom properties. Written
   * important, because a page may declare the same property itself and a
   * radius of zero is a blur of nothing: an inline important declaration is the
   * one thing a page stylesheet cannot outrank.
   */
  function setRootVariable(element, name, value) {
    try {
      if (element.style.getPropertyValue(name) === value) {
        return;
      }
      element.style.setProperty(name, value, 'important');
    } catch (error) {
      /* Nothing to write the property to. */
    }
  }

  /**
   * Everything this extension keeps on <html>: what is switched off, what may
   * be revealed, which kinds of media are left alone, and the two numbers the
   * stylesheet reads. It lives in one function because all of it has to be
   * written again every time a page writes over it.
   */
  function applyRootState() {
    var element = root();
    if (!element) {
      return;
    }

    setRootVariable(element, '--ibx-blur-radius', settings.blurAmount + 'px');
    setRootVariable(element, '--ibx-hover-delay', settings.hoverDelay + 'ms');

    setRootClass(element, CLASS_OFF, !active);
    setRootClass(element, CLASS_HOVER, active && revealAllowed());
    setRootClass(element, CLASS_BLACKOUT, settings.mode === 'blackout');

    var types = settings.blurTypes || {};
    for (var i = 0; i < api.MEDIA_KINDS.length; i += 1) {
      var kind = api.MEDIA_KINDS[i];
      setRootClass(element, SKIP_CLASSES[kind], types[kind] === false);
    }
  }

  /**
   * A page is free to rewrite the class or the style attribute of <html> for
   * its own reasons, and a theme switcher assigning className does exactly
   * that. It takes ibx-off off a site the user excluded and starts blurring it,
   * or drops the radius back to whatever the stylesheet defaults to. The
   * scanning observer cannot do this job: it is disconnected whenever nothing
   * is being blurred, which is precisely the state a page must not be able to
   * undo.
   */
  function watchRoot() {
    var element = root();
    if (!element || typeof MutationObserver !== 'function') {
      return;
    }
    if (!rootGuard) {
      rootGuard = new MutationObserver(applyRootState);
    }
    try {
      // Observing an element it already watches only replaces the registration.
      rootGuard.observe(element, { attributes: true, attributeFilter: ['class', 'style'] });
    } catch (error) {
      /* Nothing to observe; the state is written once and left at that. */
    }
  }

  /**
   * Only the modifier flag that every event already carries is read here, and
   * never which key was pressed.
   */
  function readRevealKey(event) {
    var flag = REVEAL_KEY_FLAGS[settings.revealKey];
    if (!flag) {
      return;
    }
    setRevealKeyHeld(!!event[flag]);
  }

  function setRevealKeyHeld(held) {
    if (revealKeyHeld === held) {
      return;
    }
    revealKeyHeld = held;
    applyRootState();
  }

  /**
   * A key let go of while the page is not in front never reports itself, so
   * losing the window counts as letting go. The alternative is a page left
   * ready to reveal whatever the pointer lands on next.
   */
  function clearRevealKey() {
    setRevealKeyHeld(false);
  }

  function applySettings(next) {
    var previous = settings;
    settings = next;

    var element = root();
    if (!element) {
      return;
    }

    active = settings.enabled
      && !paused
      && api.blursAnything(settings)
      && api.isSiteBlurred(currentHost(), settings);

    applyRootState();
    watchRoot();

    // Only a change of activation needs the tree walked again: everything else
    // travels on the root element, which applyRootState has just written, so
    // dragging the slider must not restart a full scan on every write.
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

    var found = collectShadowRoots(document, []);
    for (var i = 0; i < found.length; i += 1) {
      if (!knownShadowRoots.has(found[i])) {
        registerShadowRoot(found[i]);
      }
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
    document.addEventListener('keydown', readRevealKey, { capture: true, passive: true });
    document.addEventListener('keyup', readRevealKey, { capture: true, passive: true });
    // Not in the capture phase: blur does not bubble, but a capturing listener
    // on the window sees every element in the page losing focus as well, and a
    // click from one box to another is not the window going away.
    window.addEventListener('blur', clearRevealKey);
    document.addEventListener('visibilitychange', clearRevealKey);

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
      // A document that replaced its own root element - document.write, an XSLT
      // result - left the guard watching an element that is no longer there,
      // and took the state written on it with it.
      applyRootState();
      watchRoot();
      rescan();
      setTimeout(rescan, 1200);
      scheduleShadowSweeps();
    }, true);
  }

  init();
})();
