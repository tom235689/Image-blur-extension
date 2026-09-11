/**
 * Service worker: seeds the stored defaults on install, keeps the toolbar badge
 * in sync so the off state is visible without opening the popup, and hands the
 * content script the stylesheet it adopts into shadow roots.
 */
importScripts('/src/common/defaults.js');

var api = self.ImageBlur;

function updateBadge(settings) {
  var off = !settings.enabled;
  chrome.action.setBadgeText({ text: off ? 'OFF' : '' });
  chrome.action.setBadgeBackgroundColor({ color: '#6b7280' });
  chrome.action.setTitle({
    title: off ? 'Image Blur - turned off' : 'Image Blur - blurring images'
  });
}

function refreshBadge() {
  api.readSettings().then(updateBadge);
}

chrome.runtime.onInstalled.addListener(function () {
  // readSettings fills in every missing key, so writing the result back turns
  // the defaults into real stored values on a fresh install.
  api.readSettings().then(function (settings) {
    chrome.storage.sync.set(settings, function () {
      updateBadge(settings);
    });
  });
});

chrome.runtime.onStartup.addListener(refreshBadge);

chrome.storage.onChanged.addListener(function (changes, area) {
  if (area === 'sync') {
    refreshBadge();
  }
});

var blurCssPromise = null;

/**
 * A content script cannot read its own extension resources unless they are
 * declared web accessible, which would expose them to every page. Reading the
 * file here and passing the text back keeps the stylesheet private.
 */
function readBlurCss() {
  if (!blurCssPromise) {
    blurCssPromise = fetch(chrome.runtime.getURL('src/content/blur.css'))
      .then(function (response) {
        return response.text();
      })
      .catch(function () {
        blurCssPromise = null;
        return '';
      });
  }
  return blurCssPromise;
}

chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  if (!message || message.type !== 'ibx-blur-css') {
    return false;
  }
  readBlurCss().then(function (css) {
    sendResponse({ css: css });
  });
  // Keeps the message channel open until the stylesheet has been read.
  return true;
});

refreshBadge();
