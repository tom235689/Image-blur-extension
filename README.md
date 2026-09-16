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

- **Toolbar popup** - master on/off switch, blur strength, a switch for the site
  in front of you, and a pause button for the current tab.
- **Keyboard shortcuts** - Alt+Shift+B turns blurring on or off, Alt+Shift+P
  pauses it on the current tab. Both can be rebound at chrome://extensions/shortcuts.
- **Pause on this tab** - a temporary reveal that lasts until the tab reloads,
  for when the exception list would be too permanent.
- **Effect** - blur softens the image; blackout blurs it and then drops it to
  black, so there is nothing left to read at any strength.
- **Options page** (link at the bottom of the popup) - size limits, reveal on
  hover, the excluded site list, and a reset button.
- **Size limits** - anything smaller than its limit in *both* directions is left
  sharp. Raster media (images, videos, canvases, background images) starts at 0,
  so every size is blurred; inline SVG starts at 48 px, because that is how most
  sites draw their interface icons. Either limit can be set anywhere from 0 to
  256 px.
- **Reveal on hover** - on by default, after a 300 ms wait so a pointer merely
  passing through uncovers nothing. The cover comes back the moment the pointer
  leaves. Turn it off and blurred media stays blurred.
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
| `ibx-off` | extension disabled, this host is excluded, or this tab is paused |
| `ibx-hover` | reveal the element under the pointer |
| `ibx-blackout` | swap the blur for a blur plus brightness(0) |

CSS selectors cannot ask "does this element have a background image?", so
`src/content/content.js` walks the DOM in idle time chunks, reads the computed
style and tags what it finds:

| Class | Applied to |
| --- | --- |
| `ibx-bg-direct` | background image, no text inside - the element itself is blurred |
| `ibx-bg-overlay` | background image plus text - a blurred copy of the background is drawn behind the text |
| `ibx-bg-anchor` | overlay host that needed `position: relative` |
| `ibx-bg-canvas` | `<html>` or `<body>`, whose background is painted across the whole viewport |
| `ibx-vector` | inline `<svg>` at or above the vector size limit |
| `ibx-small` | media below the raster size limit, whose blur is taken off again |

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

## Tests

`node tools/run-tests.js` drives a real Chrome with the extension loaded and
checks what pages actually compute. See [tools/README.md](tools/README.md).

## Known limits

- Size limits are decided on the painted box, so an element still loading or
  laid out at zero size counts as too big rather than too small and stays
  blurred. Media is measured again when its resource loads, when the window is
  resized and when the pointer enters it.
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
src/background/               service worker (defaults, badges, pause, shortcuts, stylesheet)
tools/                        browser driven test harness, see tools/README.md
icons/
```
