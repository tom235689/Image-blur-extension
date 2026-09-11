/**
 * Service worker: seeds the stored defaults on install and keeps the toolbar
 * badge in sync so the off state is visible without opening the popup.
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

refreshBadge();
