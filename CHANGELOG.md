# Changelog

All notable changes to this project are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[semantic versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-09-17

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

### Fixed

- The raster size limit had no effect on `<input type="image">`,
  `<object type="image/*">` and `<embed type="image/*">`: their selectors
  outrank a single class, so the rule that takes the blur off small media lost
  the cascade and an image button stayed blurred at any limit.
- `<input>` elements that hold no image - every text box, checkbox and button on
  the web - were measured and tagged as though they did. Nothing was blurred
  that should not have been, but a class was written onto page elements that
  have nothing to do with images.

### Changed

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

