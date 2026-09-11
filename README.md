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
| `ibx-vector` | inline `<svg>` of at least 48x48 px |

A `MutationObserver` keeps up with dynamically added content, and the page is
swept again on `DOMContentLoaded` and shortly after `load` to catch late
stylesheets and lazily loaded sections.

## Known limits

- Inline SVG smaller than 48x48 px is left sharp on purpose; blurring every icon
  makes most sites unusable.
- Background images declared on `::before` / `::after` cannot be detected, and an
  element that already uses `::before` has that pseudo element replaced by the
  blurred overlay.
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
src/background/               service worker (defaults seeding, toolbar badge)
icons/
```
