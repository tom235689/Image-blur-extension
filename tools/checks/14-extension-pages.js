'use strict';

/**
 * Every control has to carry a name a screen reader can announce. A switch
 * built from a label wrapping a bare checkbox and two empty spans looks
 * labelled and is not: the label has no text, so the control is announced as
 * "checkbox" and nothing else.
 */
const UNNAMED_CONTROLS = `(() => {
  const controls = document.querySelectorAll('input, select, textarea, button');
  const unnamed = [];
  for (const control of controls) {
    const aria = (control.getAttribute('aria-label') || '').trim();
    const referenced = (control.getAttribute('aria-labelledby') || '')
      .split(' ')
      .filter(Boolean)
      .map((id) => {
        const target = document.getElementById(id);
        return target ? target.textContent : '';
      })
      .join(' ')
      .trim();
    const labels = Array.prototype.map
      .call(control.labels || [], (label) => label.textContent || '')
      .join(' ')
      .trim();
    const own = control.tagName === 'BUTTON' ? (control.textContent || '').trim() : '';
    if (!aria && !referenced && !labels && !own) {
      unnamed.push(control.id || control.tagName.toLowerCase());
    }
  }
  return unnamed;
})()`;

/** Anything the catalogue failed to fill in shows up as the raw key. */
const LEFTOVER_KEYS = `(() => {
  const found = document.documentElement.innerHTML.match(/__MSG_[A-Za-z0-9_]+__/g);
  return found ? Array.from(new Set(found)) : [];
})()`;

const PAGE_STATE = `(() => ({
  title: document.title,
  lang: document.documentElement.lang,
  heading: (document.querySelector('h1') || {}).textContent || ''
}))()`;

/**
 * The popup and the options page are the only parts of this extension a user
 * ever clicks, and nothing else in the suite opens them. Loading both catches
 * a page that throws on startup, a key the catalogue is missing, and a control
 * with no accessible name.
 */
module.exports = {
  name: 'popup and options pages',

  async run(t) {
    const id = await t.worker.evaluate('chrome.runtime.id');

    for (const page of ['src/popup/popup.html', 'src/options/options.html']) {
      await t.page.send('Page.navigate', { url: 'chrome-extension://' + id + '/' + page });
      await t.sleep(1200);

      const state = await t.evaluate(PAGE_STATE);
      t.expect(page + ' has a title and a language', [!!state.title, !!state.lang], [true, true]);
      t.expect(page + ' filled its heading in', state.heading, 'Image Blur');
      t.expect(page + ' has no untranslated keys left', await t.evaluate(LEFTOVER_KEYS), []);
      t.expect(page + ' names every control', await t.evaluate(UNNAMED_CONTROLS), []);
    }
  }
};
