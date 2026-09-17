# Privacy policy

**Image Blur does not collect, transmit or sell any data.**

Last updated: 17 September 2026

## What the extension stores

Everything it stores is a setting you chose yourself, and all of it stays in
your own browser profile.

| Stored | Where | Why | How long |
| --- | --- | --- | --- |
| Blur strength, effect, size limits, reveal on hover and its delay, the master on/off switch | `chrome.storage.sync` | So the extension behaves the way you set it up | Until you change it or uninstall the extension |
| The list of excluded hosts you added | `chrome.storage.sync` | So those sites are left unblurred | Until you remove the entry or uninstall the extension |
| The id of a tab you paused | `chrome.storage.session` | So a pause survives until the tab is reloaded | Discarded when the browser closes |

`chrome.storage.sync` is Chrome's own synchronisation area. If you are signed
into Chrome and have extension sync turned on, Chrome copies those settings
between your own devices. That transfer is made by Chrome, to your own Google
account, under Google's privacy policy. The extension neither performs it nor
has any way to read the result on another machine.

## What the extension does not do

- It makes **no network requests of any kind**. There is no server behind it, no
  analytics, no telemetry, no crash reporting and no advertising.
- It does **not** read, store, transmit or keep a record of the pages you visit,
  their addresses, their content, or the images on them.
- It does **not** read form fields, passwords, cookies or browsing history.
- It loads **no remote code**. Every line it runs ships inside the extension.
- It contains **no third party libraries or services**.

## Why it asks for the permissions it asks for

- **`storage`** - to keep the settings listed above.
- **Access to every site** (`<all_urls>`, shown at install as "read and change
  all your data on all websites") - the extension has to run on a page in order
  to blur that page's images, and it cannot know in advance which pages you will
  open. What it does on a page is limited to adding its own stylesheet and
  marking which elements carry an image. Nothing about the page is sent
  anywhere, because nothing is sent anywhere at all.

The exception list is the one place a host name is written down, and only
because you typed it in to keep that site unblurred.

## Verifying this

The extension is open source. Everything described here can be checked in the
source, and the absence of network traffic can be confirmed in DevTools under
the Network tab while browsing with the extension enabled.

Source: <https://github.com/tom235689/Image-blur-extension>

## Changes

If a future version ever changes what is stored, this document and the store
listing will be updated before that version is published.

## Contact

Questions about this policy can be raised as an issue on the project page above.
