# Image Blur

A Chrome extension (Manifest V3) that blurs the images on every page you visit:
`<img>` elements, CSS background images, `<video>`, `<canvas>` and large inline
`<svg>` artwork. Blurring is on everywhere by default; hosts you add to the
exception list are left untouched.

## Install (unpacked)

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Choose **Load unpacked** and select this folder.

## Using it

- **Toolbar popup** - master on/off switch and the blur strength slider.
- **Options page** (link at the bottom of the popup) - reveal on hover, the
  excluded site list, and a reset button.
- **Reveal on hover** - on by default. While it is on, moving the pointer over a
  blurred element shows it sharply; turn it off and blurred media stays blurred.
- **Excluded sites** - a host also covers its sub domains, so `example.com`
  covers `images.example.com`.

Settings live in `chrome.storage.sync`, so they follow the signed-in profile and
apply to open tabs immediately.

## How it works

`src/content/blur.css` is injected at `document_start` in every frame and blurs
media by default, which means an image can never flash unblurred while the
stored settings are being read. The content script only switches modifier
classes on `<html>`:

| Class | Meaning |
| --- | --- |
| `ibx-off` | extension disabled, or this host is excluded |
| `ibx-hover` | reveal the element under the pointer |

CSS selectors cannot ask "does this element have a background image?", so
`src/content/content.js` walks the DOM in idle time chunks, reads the computed
style and tags what it finds:

| Class | Applied to |
| --- | --- |
| `ibx-bg-direct` | background image, no text inside - the element itself is blurred |
| `ibx-bg-overlay` | background image plus text - a blurred copy of the background is drawn behind the text |
| `ibx-bg-anchor` | overlay host that needed `position: relative` |
| `ibx-bg-canvas` | `<html>` or `<body>`, whose background is painted across the whole viewport |
| `ibx-vector` | inline `<svg>` of at least 48x48 px |

A document stylesheet does not reach inside a shadow tree, so every open shadow
root that turns up gets the same sheet adopted into it (the service worker hands
over the text) and is observed and scanned like the main document. Shadow tree
copies of the rules use `:host-context(html.ibx-off)` where the document uses
`html.ibx-off`, because a shadow tree cannot see `<html>`.

A `MutationObserver` keeps up with dynamically added content, the page is swept
again on `DOMContentLoaded` and shortly after `load` to catch late stylesheets
and lazily loaded sections, and the element under the pointer is re-checked on
`mouseover` so a background image that only exists in a `:hover` rule - which
changes no attribute and fires no mutation - is caught as well.

The scan itself is spread over idle callbacks with a per chunk time budget, and
each chunk reads style and layout first and writes its classes afterwards, so no
element forces a synchronous reflow. A page of 8000 elements finishes about 1.2
seconds after navigation starts.

## Flutter web apps

Flutter paints into `<flt-glass-pane>`, which carries an open shadow root, so
the extension reaches a Flutter app only through the shadow root support
described above. What actually gets blurred depends on the renderer the app was
built with:

| Renderer | What Flutter puts in the DOM | Result |
| --- | --- | --- |
| CanvasKit or skwasm (the default) | a single `<canvas>` the size of the view | the whole app is blurred, text included |
| HTML (`--web-renderer html`, gone since Flutter 3.29) | `<img>` inside `<flt-picture>`, text as `<flt-paragraph>` | only the images are blurred, the app stays readable |

Both were verified against a Flutter 3.22.2 build of the same app. With
CanvasKit nothing can tell image pixels from text pixels inside the canvas, so
blurring it is all or nothing. Two ways out: reveal on hover shows the app while
the pointer is over it, and the app's host can go on the exception list.

## Known limits

- Inline SVG smaller than 48x48 px is left sharp on purpose; blurring every icon
  makes most sites unusable.
- Background images declared on `::before` / `::after` cannot be detected, and an
  element that already uses `::before` has that pseudo element replaced by the
  blurred overlay.
- Closed shadow roots (`attachShadow({ mode: 'closed' })`) are invisible to
  extensions, so media inside them stays sharp. Open roots attached long after
  their host was scanned are picked up by sweeps at 1, 3, 8 and 20 seconds after
  load, so one attached later than that is missed.
- A blur radius is measured in the element's own coordinates, so an image scaled
  down by a CSS transform is blurred proportionally less than one sized by
  width and height.
- A background image on `<html>` or `<body>` is covered by a viewport sized copy
  that does not scroll with the page, so such a background looks fixed while it
  is blurred. Hovering never reveals it either, since the pointer is over
  `<body>` nearly all of the time.
- Media inside a cross origin frame is handled by that frame's own copy of the
  content script; frames the browser does not let extensions touch stay sharp.
- On an excluded site images may be blurred for a few milliseconds until the
  stored settings arrive. That direction is deliberate: erring towards blurred is
  safer than flashing an image that should have been hidden.

## Layout

```
manifest.json
src/common/defaults.js        shared settings, validation and host matching
src/content/blur.css          injected at document_start
src/content/content.js        activation and element tagging
src/popup/                    toolbar popup
src/options/                  options page
src/background/               service worker (defaults seeding, badge, stylesheet handover)
icons/
```
