# Changelog

All notable changes to this project are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[semantic versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Each kind of media can now be left alone on its own: images, videos, canvas
  drawings, CSS background images and inline SVG. Blurring all of them at once
  is right for a photograph and wrong for everything a page draws itself - a
  chart, a map or an entire application lives on a canvas, and a blurred video
  is an unwatchable one. Turning every kind off is read as blurring nothing, and
  the badge and the popup say so.
- A key can be required before hovering reveals anything. A pointer crossing an
  image uncovers it, which on a screen somebody else can see is the one thing
  this extension is there to prevent; with Alt, Ctrl or Shift chosen the reveal
  becomes deliberate. Only the modifier flag that every event already carries is
  read, never which key was pressed.
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

- A shadow root attached inside another shadow root was never found, so every
  image in it stayed sharp for good - on a page that looked as though the
  extension was working, because the tree around it was covered. The sweep that
  hunts for late roots walked the document, and `querySelectorAll` stops at
  every shadow boundary; it now goes through each tree it finds as well as into
  it. A component built out of components is the ordinary case for anything
  written with web components.
- Roots waiting for the stylesheet were held for the life of the page once the
  last attempt at fetching it had failed, rather than let go of along with the
  attempts.
- A frame loaded from another host judged itself by its own host name rather
  than by the page it was embedded in, so turning the blur off for a site left
  every video, map and advert on it blurred, and turning it on for a site left
  all of them sharp. The site list now means the site in the address bar, which
  is the host the popup names next to the switch.
- A page assigning `className` on its root element - which is how most theme
  switchers are written - wiped the classes this extension keeps there and
  started blurring a site the user had excluded. Nothing was watching either:
  the observer is disconnected whenever nothing is being blurred, which is
  precisely that case. The root element is now watched whatever the state.
- Three lines of CSS in a page could switch the blur off altogether, by
  declaring the custom property the radius travels in as `0px !important`. That
  declaration is written important now, which a page stylesheet cannot outrank.
- Hovering media that a size limit had spared set `filter: none` on it, taking
  away the filter the page itself had asked for. The reveal spares whatever the
  blur spared.
- The options page went on showing a change that never reached storage when a
  write failed - a site list past the quota, or too many writes in one minute.
  It now says so and puts back what is really stored.
- Reveal on hover declared its transition on the resting state, which replaced
  whatever transition a page had put on its own images. It now belongs to the
  hovered state alone, where the delay is all it was ever needed for.
- The blur radius and the hover delay are put back if a page rewrites the style
  attribute on the root element, instead of every blur on that page silently
  falling back to the stylesheet default.
- The popup asks the tab a second time before concluding the extension cannot
  run there, which a page still loading would otherwise trigger.
- Adding a host the site list already covers through a parent domain says so,
  rather than storing an entry that changes nothing. It no longer says the host
  is "already excluded", which is the wrong word by half when the list has been
  set to mean the only hosts to blur.
- The hover delay is greyed out while reveal on hover is off, since it has
  nothing to delay.

### Changed

- The popup says so when blurring is switched on but every kind of media has
  been switched off, instead of claiming to blur images on every site.
- The one matcher behind the site list is called isListed rather than
  isExcluded, and the options page calls its copy of the list sites, now that
  the list can mean either thing. The stored key keeps its old name on purpose:
  renaming it would lose the list of everyone who already has one.
- Comments that had stopped being true were corrected. The stylesheet no longer
  says the blur and the hover reveal are settled by the order they are written
  in - the reveal outranks the blur by itself now that both carry a kind gate,
  which was checked by writing them the wrong way round and watching the reveal
  still win - and the two sliders no longer call waiting for a pause in the
  dragging a throttle.
- The fixture server answers on both loopback addresses, so the cross origin
  check cannot fail on a machine where localhost means ::1 before 127.0.0.1.
- The build refuses an icon that is not the size it is declared as, which the
  store finds only after an upload.
- The archive itself is checked: the bytes are read back the way a reader reads
  them, the checksums are compared against ones computed elsewhere, and the
  same files are confirmed to produce the same archive twice. Nothing had ever
  opened what the release writes.
- The link at the foot of the popup is aligned to the start of the line rather
  than to the left, so it follows a right to left translation.
- The options page is photographed in two halves for the store. It is twice as
  tall as the store's canvas, and squeezed onto it whole nothing on it could be
  read.
- The test harness fails a run on anything the extension throws or logs as an
  error, so an unhandled rejection cannot hide behind passing assertions. It can
  also reach into a cross origin frame and hold a modifier key down, neither of
  which anything could ask it to do before.
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

