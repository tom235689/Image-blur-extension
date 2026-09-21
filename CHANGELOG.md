# Changelog

All notable changes to this project are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[semantic versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- The site list can now mean either of the two things a site list can mean:
  the hosts to leave alone, as before, or the only hosts to blur. The second
  is for someone who wants the blur on a handful of sites rather than on all
  of them.
- Settings can be exported to a JSON file and imported back, for a backup or
  for carrying a long site list to another computer. An imported file goes
  through the same validation as every other path, so nothing in it can put
  the extension into a state its own interface could not produce.
- `npm run screenshots` takes the store screenshots with the extension really
  running, and `npm run images` draws the pictures the page they are taken on
  uses, so the listing never borrows an image and never drifts out of date.

### Fixed

- Reveal on hover declared its transition on the resting state, which replaced
  whatever transition a page had put on its own images. It now belongs to the
  hovered state alone, where the delay is all it was ever needed for.
- The blur radius and the hover delay are put back if a page rewrites the style
  attribute on the root element, instead of every blur on that page silently
  falling back to the stylesheet default.
- The popup asks the tab a second time before concluding the extension cannot
  run there, which a page still loading would otherwise trigger.
- Adding a host the exception list already covers through a parent domain says
  so, rather than storing an entry that changes nothing.
- The hover delay is greyed out while reveal on hover is off, since it has
  nothing to delay.

### Added

- The test harness fails a run on anything the extension throws or logs as an
  error, so an unhandled rejection cannot hide behind passing assertions.
- .gitattributes, so line endings are settled in the repository rather than
  renegotiated on every checkout.

## [1.0.0] - 2026-09-19

First release intended for the Chrome Web Store.

### Added

- Every user visible string now comes from `_locales/en/messages.json`, so the
  extension can be translated without touching any markup or code. The
  interface follows the browser's language and writing direction.
- The options page opens once, on a fresh install, so the exception list and
  the keyboard shortcuts are discoverable before the first blurred page appears.
- `npm run build` produces a zip ready to upload to the store, and refuses to
  build if the manifest points at a file that is not there, or names a message
  that does not exist.
- Continuous integration runs the whole browser driven suite on every push.
- A privacy policy and an MIT licence.
- The suite now opens the popup and the options page themselves, which nothing
  had ever loaded, and fails on a control with no accessible name or a message
  key the catalogue never filled in.
- A check that walks every construct able to put a picture on a screen, and
  pins the three that are deliberately not covered alongside the ones that are,
  so a gap stays a decision on the record rather than a surprise.
- store/listing.md holds the single purpose statement, the permission
  justifications and the privacy certifications the store refuses a review
  without, next to the code they describe.

### Fixed

- Three ways of putting a picture on a screen were not covered at all, so the
  image simply showed: an `<object>` or `<embed>` that names no `type`, and any
  element the `content` property replaces with a `url()`. A border drawn from a
  picture was uncovered too. All four are now found while the page is scanned.
- The stylesheet that reaches inside shadow roots was asked for exactly once per
  page, and the request can fail - the service worker may still be starting up.
  One failure was permanent for the life of that page, and a shadow tree without
  the sheet is a shadow tree whose images are never blurred, which on a site
  built from web components means most of them. It is retried now, on a widening
  interval, and the roots waiting for it are no longer kept in a list that only
  grew.
- A picture opened as its own document stopped being blurred: navigating
  straight to an `.svg` file gives a document whose root element is `<svg>`, and
  the rules had been anchored to `html` and to descendants of the root, so the
  one case where the image fills the whole window matched nothing.
- Switching the extension off, excluding a host, pausing a tab or sparing an
  image with a size limit all used to force `filter: none` on that image. The
  rule needs `!important` to survive a site that marks its own image rules
  important, so it also beat the filter the page itself had asked for: a site
  that greyscales its own thumbnails had that greyscale stripped on exactly the
  pages where this extension was supposed to be doing nothing. Every rule is now
  written not to match instead of matching and undoing itself.
- Turning the site switch back on for a sub domain did nothing at all when a
  parent host was on the exception list, while the switch showed itself as on.
  The covering entry is now removed with it.
- The two switches in the popup had no accessible name, so a screen reader
  announced each of them as an unlabelled checkbox, and the host box on the
  options page had only a placeholder.
- The raster size limit had no effect on `<input type="image">`,
  `<object type="image/*">` and `<embed type="image/*">`: their selectors
  outrank a single class, so the rule that takes the blur off small media lost
  the cascade and an image button stayed blurred at any limit.
- `<input>` elements that hold no image - every text box, checkbox and button on
  the web - were measured and tagged as though they did. Nothing was blurred
  that should not have been, but a class was written onto page elements that
  have nothing to do with images.

### Changed

- A class change is now queued only when it is a change. Every element used to
  be offered half a dozen classes it did not have, which on a large page is tens
  of thousands of queued operations per pass whose whole effect is to decide to
  do nothing.
- `minimum_chrome_version` is declared as 102, the first version with
  `chrome.storage.session`, so the extension cannot install where it would
  silently lose per tab pauses.

## [0.1.0] - 2026-09-16

Initial working extension, developed and verified but never published.

### Added

- Blurs `<img>`, `<video>`, `<canvas>`, CSS background images, large inline
  `<svg>`, image buttons and image objects, at `document_start`, in every frame
  including `about:blank` and `srcdoc`.
- Leaves text, buttons and layout sharp: an element holding text gets a blurred
  copy of its background rather than a blur of itself.
- Reaches into open shadow roots by adopting the same stylesheet into them.
- Blur strength, blackout effect, per media size limits, reveal on hover with a
  delay, a per site exception list and a per tab pause.
- Keyboard shortcuts for the master switch and the per tab pause.
- A browser driven test suite that asserts what pages actually compute.

