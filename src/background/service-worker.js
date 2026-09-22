/**
 * Service worker: seeds the stored defaults on install, keeps the toolbar badge
 * in sync per tab, owns the temporary per tab pause, handles the keyboard
 * shortcuts, and hands the content script the stylesheet it adopts into shadow
 * roots.
 */
importScripts('/src/common/defaults.js', '/src/common/i18n.js');

var api = self.ImageBlur;
var i18n = self.ImageBlurI18n;

var PAUSED_TABS = 'pausedTabs';

/** A translated string, falling back to the English wording when it is missing. */
function label(key, fallback) {
  return i18n.message(key) || fallback;
}

function badgeOff() {
  return label('badgeOff', 'OFF');
}

function globalBadge(settings) {
  // Every kind of media switched off is a second way of blurring nothing, and
  // the badge has to show it as plainly as the switch itself.
  var nothing = !api.blursAnything(settings);
  chrome.action.setBadgeText({ text: !settings.enabled || nothing ? badgeOff() : '' });
  chrome.action.setBadgeBackgroundColor({ color: '#6b7280' });
  chrome.action.setTitle({
    title: !settings.enabled
      ? label('tooltipTurnedOff', 'Image Blur - turned off')
      : (nothing
        ? label('tooltipNothingToBlur', 'Image Blur - no kind of media is set to be blurred')
        : label('tooltipBlurring', 'Image Blur - blurring images'))
  });
}

/**
 * Naming a tab that has gone makes chrome.action reject rather than throw, and
 * a tab can be closed between reporting its state and this running. A badge
 * for a tab nobody can see is not worth an unhandled rejection in the log.
 */
function ignoreClosedTab(result) {
  if (result && typeof result.catch === 'function') {
    result.catch(function () {});
  }
}

/**
 * A tab that reports its own state gets its own badge, which wins over the
 * global one. Tabs the content script cannot run in keep the global badge.
 */
function tabBadge(tabId, state) {
  ignoreClosedTab(chrome.action.setBadgeText({ tabId: tabId, text: state.active ? '' : badgeOff() }));
  ignoreClosedTab(chrome.action.setTitle({
    tabId: tabId,
    title: state.active
      ? label('tooltipBlurring', 'Image Blur - blurring images')
      : (state.paused
        ? label('tooltipPausedTab', 'Image Blur - paused on this tab')
        : label('tooltipTabOff', 'Image Blur - not blurring this tab'))
  }));
}

function refreshGlobalBadge() {
  api.readSettings().then(globalBadge);
}

function readPausedTabs() {
  return new Promise(function (resolve) {
    try {
      chrome.storage.session.get({ pausedTabs: [] }, function (items) {
        resolve(Array.isArray(items.pausedTabs) ? items.pausedTabs : []);
      });
    } catch (error) {
      resolve([]);
    }
  });
}

function writePausedTabs(list) {
  return new Promise(function (resolve) {
    var patch = {};
    patch[PAUSED_TABS] = list;
    try {
      chrome.storage.session.set(patch, function () {
        resolve();
      });
    } catch (error) {
      resolve();
    }
  });
}

function tellTab(tabId, paused) {
  try {
    chrome.tabs.sendMessage(tabId, { type: 'ibx-pause', paused: paused }, function () {
      void chrome.runtime.lastError;
    });
  } catch (error) {
    /* The tab has no content script; nothing to pause. */
  }
}

/** Flips the pause for one tab and returns the state it ended up in. */
function togglePause(tabId) {
  return readPausedTabs().then(function (list) {
    var paused = list.indexOf(tabId) === -1;
    var next = paused ? list.concat(tabId) : list.filter(function (id) { return id !== tabId; });
    return writePausedTabs(next).then(function () {
      tellTab(tabId, paused);
      return paused;
    });
  });
}

function clearPause(tabId) {
  return readPausedTabs().then(function (list) {
    if (list.indexOf(tabId) === -1) {
      return null;
    }
    return writePausedTabs(list.filter(function (id) { return id !== tabId; }));
  });
}

chrome.runtime.onInstalled.addListener(function (details) {
  // readSettings fills in every missing key, so writing the result back turns
  // the defaults into real stored values on a fresh install.
  api.readSettings().then(function (settings) {
    chrome.storage.sync.set(settings, function () {
      globalBadge(settings);
    });
  });

  // Blurring starts the moment this is installed, which is startling without a
  // word of explanation, and the exception list and the shortcuts are not
  // discoverable from the toolbar icon alone. Shown once, on a real install.
  if (details && details.reason === 'install') {
    try {
      chrome.runtime.openOptionsPage();
    } catch (error) {
      /* Nothing worth failing an install over. */
    }
  }
});

chrome.runtime.onStartup.addListener(refreshGlobalBadge);

chrome.storage.onChanged.addListener(function (changes, area) {
  if (area === 'sync') {
    refreshGlobalBadge();
  }
});

chrome.tabs.onRemoved.addListener(function (tabId) {
  clearPause(tabId);
});

chrome.commands.onCommand.addListener(function (command, tab) {
  if (command === 'toggle-blur') {
    api.readSettings().then(function (settings) {
      chrome.storage.sync.set({ enabled: !settings.enabled });
    });
    return;
  }
  if (command === 'pause-tab' && tab && typeof tab.id === 'number') {
    togglePause(tab.id);
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
  if (!message) {
    return false;
  }

  if (message.type === 'ibx-blur-css') {
    readBlurCss().then(function (css) {
      sendResponse({ css: css });
    });
    // Keeps the message channel open until the stylesheet has been read.
    return true;
  }

  if (message.type === 'ibx-state') {
    var tabId = sender.tab && sender.tab.id;
    if (typeof tabId === 'number') {
      // The first report after a load means the tab reloaded, which is exactly
      // how long a pause is meant to last.
      if (message.fresh) {
        clearPause(tabId);
      }
      tabBadge(tabId, message);
    }
    return false;
  }

  if (message.type === 'ibx-pause-toggle' && typeof message.tabId === 'number') {
    togglePause(message.tabId).then(function (paused) {
      sendResponse({ paused: paused });
    });
    return true;
  }

  return false;
});

refreshGlobalBadge();
