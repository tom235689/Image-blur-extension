/** Toolbar popup: master switch, blur strength, and what applies here. */
(function () {
  'use strict';

  var api = globalThis.ImageBlur;
  var i18n = globalThis.ImageBlurI18n;

  // Translates everything the markup declares; the strings this file swaps in
  // afterwards go through label() below.
  i18n.apply(document);

  var enabledInput = document.getElementById('enabled');
  var blurInput = document.getElementById('blur-amount');
  var blurValue = document.getElementById('blur-value');
  var stateLabel = document.getElementById('state-label');
  var optionsButton = document.getElementById('open-options');

  var siteRow = document.getElementById('site-row');
  var siteHost = document.getElementById('site-host');
  var siteInput = document.getElementById('site-enabled');
  var pauseRow = document.getElementById('pause-row');
  var pauseButton = document.getElementById('pause-tab');
  var unavailable = document.getElementById('unavailable');

  var writeTimer = 0;
  var settings = api.DEFAULT_SETTINGS;
  var tabId = null;
  var host = '';

  blurInput.min = String(api.BLUR_MIN);
  blurInput.max = String(api.BLUR_MAX);

  /** A translated string, falling back to the English wording when it is missing. */
  function label(key, fallback) {
    return i18n.message(key) || fallback;
  }

  function renderBlurValue(amount) {
    blurValue.textContent = i18n.pixels(amount);
  }

  function renderEnabled(enabled) {
    document.body.classList.toggle('is-off', !enabled);
    stateLabel.textContent = enabled
      ? (settings.siteListMode === 'only'
        ? label('popupStateListed', 'Blurring images on the listed sites')
        : label('popupStateOn', 'Blurring images on every site'))
      : label('popupStateOff', 'Blurring is turned off');
  }

  function renderSettings(next) {
    settings = next;
    enabledInput.checked = settings.enabled;
    blurInput.value = String(settings.blurAmount);
    renderBlurValue(settings.blurAmount);
    renderEnabled(settings.enabled);
    if (host) {
      siteInput.checked = api.isSiteBlurred(host, settings);
    }
  }

  function renderTab(state) {
    if (!state) {
      unavailable.hidden = false;
      return;
    }

    host = api.normalizeHost(state.host);
    if (host) {
      siteHost.textContent = host;
      siteInput.checked = api.isSiteBlurred(host, settings);
      siteRow.hidden = false;
    }

    pauseRow.hidden = false;
    renderPaused(state.paused);
  }

  function renderPaused(paused) {
    pauseButton.textContent = paused
      ? label('popupResume', 'Resume on this tab')
      : label('popupPause', 'Pause on this tab');
    pauseButton.classList.toggle('is-active', !!paused);
  }

  function save(patch) {
    api.writeSettings(patch);
  }

  enabledInput.addEventListener('change', function () {
    renderEnabled(enabledInput.checked);
    save({ enabled: enabledInput.checked });
  });

  // Dragging previews live, but chrome.storage.sync only allows 120 writes per
  // minute, so the preview is throttled and the final value is written on
  // release no matter what the throttled writes did.
  blurInput.addEventListener('input', function () {
    var amount = api.clampBlur(blurInput.value);
    renderBlurValue(amount);
    clearTimeout(writeTimer);
    writeTimer = setTimeout(function () {
      save({ blurAmount: amount });
    }, 400);
  });

  blurInput.addEventListener('change', function () {
    clearTimeout(writeTimer);
    save({ blurAmount: api.clampBlur(blurInput.value) });
  });

  siteInput.addEventListener('change', function () {
    var list = api.setSiteBlurred(settings.excludedSites, host, siteInput.checked, settings.siteListMode);
    settings.excludedSites = list;
    save({ excludedSites: list });
  });

  pauseButton.addEventListener('click', function () {
    if (tabId === null) {
      return;
    }
    chrome.runtime.sendMessage({ type: 'ibx-pause-toggle', tabId: tabId }, function (response) {
      void chrome.runtime.lastError;
      if (response) {
        renderPaused(response.paused);
      }
    });
  });

  optionsButton.addEventListener('click', function () {
    if (chrome.runtime.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    } else {
      window.open(chrome.runtime.getURL('src/options/options.html'));
    }
    window.close();
  });

  /**
   * The active tab's id comes from tabs.query, which needs no permission; the
   * host comes from the content script itself rather than from the tab's URL,
   * which would need the tabs permission. No content script, no answer - that
   * is exactly the case where the extension cannot do anything anyway.
   */
  function ask(done) {
    chrome.tabs.sendMessage(tabId, { type: 'ibx-query' }, function (response) {
      void chrome.runtime.lastError;
      done(response || null);
    });
  }

  function loadTab() {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      var tab = tabs && tabs[0];
      if (!tab || typeof tab.id !== 'number') {
        renderTab(null);
        return;
      }
      tabId = tab.id;
      ask(function (response) {
        if (response) {
          renderTab(response);
          return;
        }
        // A page part way through loading has no content script yet; only a
        // second silence means the extension really cannot run there.
        setTimeout(function () {
          ask(function (retried) {
            renderTab(retried || null);
          });
        }, 350);
      });
    });
  }

  api.readSettings().then(function (next) {
    renderSettings(next);
    loadTab();
  });
})();
