# Test harness

Drives a real Chrome with the extension loaded and checks what the page
actually computes, because most of this extension's behaviour lives in CSS
specificity, paint order and shadow tree boundaries - none of which a unit test
can see.

```
node tools/run-tests.js            every check
node tools/run-tests.js shadow     only the checks whose file name matches
```

Needs Chrome and Node 22 or newer (for the built in `WebSocket`). Set
`CHROME_PATH` if Chrome is not in one of the usual places.

Stable channel Chrome ignores `--load-extension`, so the harness loads the
extension over the DevTools protocol with `Extensions.loadUnpacked`, which is
what `--enable-unsafe-extension-debugging` is for. Every run gets a throwaway
profile, so stored settings never leak between runs.

## Layout

```
run-tests.js        launches everything, runs the checks, reports
lib/cdp.js          minimal DevTools protocol client
lib/server.js       serves tools/pages, and generates the large DOM page
lib/harness.js      finds Chrome, starts it, loads the extension
lib/settings-module.js  runs src/common/defaults.js outside the browser
checks/             one file per area, run in file name order
pages/              fixtures
```

## Writing a check

```js
module.exports = {
  name: 'what this covers',
  async run(t) {
    await t.open('media.html');
    t.expect('image blurred', (await t.filters({ photo: '#photo' })).photo, 'blur(12px)');
  }
};
```

`t` gives you `open`, `evaluate`, `filters`, `classesOf`, `hover`,
`hoverElement`, `setSettings`, `resetSettings`, `sleep` and `expect`. Settings
are reset to the defaults before each check. Add `browser: false` for a check
that needs no page at all.
