# Image Blur

A Chrome extension (Manifest V3) that blurs the images on every page you visit:
`<img>` elements, CSS background images, `<video>`, `<canvas>` and large inline
`<svg>` artwork. Blurring is on everywhere by default; hosts you add to the
exception list are left untouched.

## Install (unpacked)

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Choose **Load unpacked** and select this folder.

Chrome 102 or newer. The options page opens once on a fresh install, because
blurring starts immediately and the exception list is worth knowing about before
the first page loads.

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
- **Site list** - either the hosts to leave alone, or the only hosts to blur,
  whichever the options page is set to. A host also covers its sub domains, so
  `example.com` covers `images.example.com`. Because of that, turning the site
  switch back on for `images.example.com` removes the `example.com` entry that
  was covering it: a list of hosts cannot say "this host, but not that sub
  domain of it".
- **Settings file** - export every setting to JSON and import it back, for a
  backup or for a second computer. An imported file is validated the same way
  every other path is, so nothing in it can produce a state the interface
  could not.
- **Left alone means left alone** - wherever nothing is blurred, whether the
  host is excluded, the extension is switched off, the tab is paused or the
  image is below the size limit, the page keeps whatever filter it applied to
  its own images. This extension never sets `filter: none` to stop blurring;
  its rules simply stop matching.

Settings live in `chrome.storage.sync`, so they follow the signed-in profile and
apply to open tabs immediately. Nothing else is stored and nothing is ever sent
anywhere - see [PRIVACY.md](PRIVACY.md).

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
| `ibx-media` | a picture no selector can reach: an untyped `<object>` or `<embed>`, a `content: url()`, a border drawn from an image |
| `ibx-small` | media below the raster size limit, excluded from the blur rule |

Every rule is written so that it does not match when there is nothing to blur,
rather than matching and switching the blur off again. A rule that said
`filter: none` would have to carry `!important` to survive a site that marks
its own image rules important, and it would then beat that site's own filter as
well - so an excluded host would have its images stripped of the styling the
page gave them. Hence `:root:not(.ibx-off) img:not(.ibx-small)` rather than a
counter-rule.

The gate is `:root` rather than `html` because a picture opened on its own is
still a document: navigating straight to an `.svg` file gives one whose root
element is `<svg>`, and the image to hide is that root element rather than
anything inside it.

A document stylesheet does not reach inside a shadow tree, so every open shadow
root that turns up gets the same sheet adopted into it (the service worker hands
over the text) and is observed and scanned like the main document. Shadow tree
copies of the rules use `:host-context(html:not(.ibx-off))` where the document
uses `:root:not(.ibx-off)`, because a shadow tree cannot see the root element.

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

`npm test` drives a real Chrome with the extension loaded and checks what pages
actually compute. See [tools/README.md](tools/README.md).

## Building a release

```
npm run check        validate the package without writing anything
npm run build        write dist/image-blur-<version>.zip
npm run screenshots  retake store/screenshots with the extension running
npm run images       redraw the pictures those screenshots are taken on
```

The build refuses to package while the manifest version disagrees with
`package.json`, the manifest points at a file that is not there, a page loads a
script that is not there, or the code asks for a message the catalogue does not
have - all of which the store finds only after an upload. Every entry is stored
with the same fixed timestamp, so the same source always produces a byte for
byte identical archive. Only `manifest.json`, `icons/`, `src/` and `_locales/`
go in; the tests and the documentation stay out.

There are no dependencies to install: the archive writer and the test harness
are both part of the repository.

## Translating

Every user visible string lives in `_locales/en/messages.json`. Markup names a
key with a `data-i18n` attribute and keeps the English as a fallback, so a
missing translation degrades to English rather than to a blank label:

```html
<h2 data-i18n="optionsSizeHeading">Size limits</h2>
```

To add a language, copy `_locales/en/messages.json` to
`_locales/<code>/messages.json` and translate the `message` field of each entry,
leaving the keys and the `$PLACEHOLDER$` tokens alone. The `description` field
is there to say what each string is for. Nothing else has to change - the
interface picks up the browser's language, and its writing direction, on its
own.

`npm run check` fails if the code asks for a key the catalogue does not have,
and the test suite additionally fails on a key nothing asks for.

## Known limits

- Size limits are decided on the painted box, so an element still loading or
  laid out at zero size counts as too big rather than too small and stays
  blurred. Media is measured again when its resource loads, when the window is
  resized and when the pointer enters it.
- Background images declared on `::before` / `::after` cannot be detected.
  Finding them would mean asking for the pseudo element style of every element
  on the page, roughly tripling the cost of a scan, and this extension builds
  its own overlay out of `::before`, so the two would collide on exactly the
  elements that need it. An element that already uses `::before` has that
  pseudo element replaced by the blurred overlay.
- An `<object>` or `<embed>` that names no `type` is recognised by the file
  extension at the end of its source URL, because the alternative - reading
  `contentDocument` - is `null` for a cross origin page just as it is for an
  image, and would eventually blur a document and the text in it. One whose URL
  ends in no extension is therefore missed.
- A `list-style-image` marker is drawn at font size and cannot be filtered on
  its own: `::marker` takes no filter, and blurring the list item would blur its
  text. A `mask-image` is not covered either, and does not need to be: a mask is
  used for its alpha channel, so what reaches the screen is the colour
  underneath in the shape of the image, not the image.
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
- A picture that only the content script can find - an untyped `<object>` or
  `<embed>`, a `content: url()`, a border drawn from an image - is sharp until
  the scan reaches it, because there is no selector for the stylesheet to blur
  it with beforehand. Everything a selector can reach is blurred before the
  first paint instead.
- On an excluded site images may be blurred for a few milliseconds until the
  stored settings arrive. That direction is deliberate: erring towards blurred is
  safer than flashing an image that should have been hidden.

## Layout

```
manifest.json
_locales/en/messages.json     every user visible string
src/common/defaults.js        shared settings, validation and host matching
src/common/i18n.js            fills data-i18n attributes, language and direction
src/content/blur.css          injected at document_start
src/content/content.js        activation and element tagging
src/popup/                    toolbar popup
src/options/                  options page
src/background/               service worker (defaults, badges, pause, shortcuts, stylesheet)
tools/build.js                validates the package and writes the store zip
tools/                        browser driven test harness, see tools/README.md
icons/
```

## Licence

MIT, see [LICENSE](LICENSE).
