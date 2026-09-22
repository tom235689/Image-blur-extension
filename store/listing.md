# Chrome Web Store submission

Everything the dashboard asks for that is not in the package itself. The
wording here is meant to be pasted as it stands; it is kept in the repository
so that what was declared to the store can be diffed against what the code
does.

A review is refused outright when a permission has no justification, when the
privacy practices are left uncertified, or when the single purpose is not
stated, so none of these fields is optional.

## Single purpose

> Image Blur blurs the pictures on the pages you visit - images, CSS
> background images, videos and canvases - while leaving text, buttons and
> layout sharp, so that a screen can be read in public without its pictures
> being readable over your shoulder.

That is the only thing it does. There is no second feature to declare.

## Permission justifications

**`storage`**

> Stores the user's own settings: blur strength, the effect, the size limits,
> which kinds of media are blurred, whether hovering reveals an image and what
> key it waits for, and the list of sites the user asked to leave alone.
> Nothing else is stored, and none of it leaves the browser profile.

**Host permission `<all_urls>`** (shown to the user as "read and change all
your data on all websites")

> The extension has to run on a page in order to blur that page's pictures, and
> it cannot know in advance which pages the user will open: a blur that only
> worked on a list of sites agreed in advance would not do the job. On a page
> it adds its own stylesheet and marks which elements carry a picture. It reads
> no page content, sends nothing anywhere, and makes no network request of any
> kind. Where the user has chosen a key to hold before a picture is revealed,
> it also watches for that key: it reads only the Alt, Ctrl and Shift flags
> that every event already carries, never which key was pressed.

There is no `tabs` permission: the popup gets the tab id from `tabs.query`,
which needs none, and the host name from the content script rather than from
the tab URL, for exactly this reason.

## Privacy practices

- **What user data is collected:** none. Every checkbox in the data disclosure
  is left unticked.
- **Privacy policy URL:**
  <https://github.com/tom235689/Image-blur-extension/blob/main/PRIVACY.md>
- **Certifications:** the extension does not sell or transfer user data, does
  not use or transfer data for any purpose unrelated to its single purpose, and
  does not use or transfer data to determine creditworthiness or for lending.

All three are true because the extension transmits nothing. Verifiable in the
source: the only `fetch` reads a file out of the extension package itself.

## Remote code

> No remote code. Every line the extension runs is in the uploaded package.
> There is no eval, no remotely hosted script and no third party library.

## Listing text

**Name:** Image Blur

**Short description** (132 characters maximum, and this is what
`_locales/en/messages.json` holds as `appDescription`, so change both together)

> Blurs images, CSS background images and videos on every page you visit.

**Category:** Privacy & Security

## Before uploading

1. `npm test` - the whole suite against a real browser.
1. `npm run screenshots` - if anything on screen has changed since the last
   release.
2. `npm run build` - writes `dist/image-blur-<version>.zip` and refuses if the
   package does not hold together.
3. Upload that zip. It contains `manifest.json`, `icons/`, `src/` and
   `_locales/` and nothing else.

Screenshots are in `store/screenshots`, at the 1280x800 the dashboard wants.
`npm run screenshots` retakes them with the extension really running, so they
cannot drift away from what it does; every picture in them is drawn by
`npm run images` rather than borrowed from anywhere.

There are five: a blurred page, one picture revealed under the pointer, the
popup, and the options page in two halves. The options page is twice as tall
as the store's canvas, and squeezed onto it whole nothing on it can be read,
so it is cut between two cards and shown at a size that can be.
