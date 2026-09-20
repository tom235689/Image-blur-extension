/** Options page: blur strength, hover behaviour and the excluded site list. */
(function () {
  'use strict';

  var api = globalThis.ImageBlur;
  var i18n = globalThis.ImageBlurI18n;

  // Translates everything the markup declares; the strings built below - the
  // ones that name a host - go through label() instead.
  i18n.apply(document);

  /** A translated string, falling back to the English wording when it is missing. */
  function label(key, substitutions, fallback) {
    return i18n.message(key, substitutions) || fallback;
  }

  var blurInput = document.getElementById('blur-amount');
  var blurValue = document.getElementById('blur-value');
  var hoverInput = document.getElementById('reveal-on-hover');
  var minImageInput = document.getElementById('min-image-size');
  var minVectorInput = document.getElementById('min-vector-size');
  var modeInput = document.getElementById('mode');
  var hoverDelayInput = document.getElementById('hover-delay');
  var hoverDelayField = document.getElementById('hover-delay-field');
  var addForm = document.getElementById('add-form');
  var siteInput = document.getElementById('site-input');
  var addError = document.getElementById('add-error');
  var siteList = document.getElementById('site-list');
  var emptyNote = document.getElementById('empty-note');
  var resetButton = document.getElementById('reset');
  var statusLabel = document.getElementById('status');

  var excluded = [];
  var writeTimer = 0;
  var statusTimer = 0;

  blurInput.min = String(api.BLUR_MIN);
  blurInput.max = String(api.BLUR_MAX);

  var sizeInputs = [
    { element: minImageInput, key: 'minImageSize' },
    { element: minVectorInput, key: 'minVectorSize' }
  ];

  sizeInputs.forEach(function (entry) {
    entry.element.min = String(api.SIZE_MIN);
    entry.element.max = String(api.SIZE_MAX);
  });

  hoverDelayInput.max = String(api.HOVER_DELAY_MAX);

  function flashStatus(message) {
    statusLabel.textContent = message;
    clearTimeout(statusTimer);
    statusTimer = setTimeout(function () {
      statusLabel.textContent = '';
    }, 1600);
  }

  function save(patch, message) {
    api.writeSettings(patch).then(function (ok) {
      flashStatus(ok
        ? (message || label('statusSaved', null, 'Saved'))
        : label('statusSaveFailed', null, 'Could not save'));
    });
  }

  function renderSites() {
    siteList.textContent = '';
    emptyNote.hidden = excluded.length > 0;

    excluded.forEach(function (host) {
      var item = document.createElement('li');

      var name = document.createElement('span');
      name.className = 'host';
      name.textContent = host;

      var remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'remove';
      remove.textContent = label('optionsSitesRemove', null, 'Remove');
      remove.setAttribute('aria-label', label('optionsSitesRemoveLabel', [host], 'Remove ' + host));
      remove.addEventListener('click', function () {
        excluded = excluded.filter(function (entry) {
          return entry !== host;
        });
        renderSites();
        save({ excludedSites: excluded }, label('statusSiteRemoved', [host], 'Removed ' + host));
      });

      item.appendChild(name);
      item.appendChild(remove);
      siteList.appendChild(item);
    });
  }

  function render(settings) {
    blurInput.value = String(settings.blurAmount);
    blurValue.textContent = i18n.pixels(settings.blurAmount);
    hoverInput.checked = settings.revealOnHover;
    minImageInput.value = String(settings.minImageSize);
    minVectorInput.value = String(settings.minVectorSize);
    modeInput.value = settings.mode;
    hoverDelayInput.value = String(settings.hoverDelay);
    renderHoverDelayState(settings.revealOnHover);
    excluded = settings.excludedSites.slice();
    renderSites();
  }

  // Throttled while dragging to stay inside the storage write quota, with the
  // released value always written in full.
  blurInput.addEventListener('input', function () {
    var amount = api.clampBlur(blurInput.value);
    blurValue.textContent = i18n.pixels(amount);
    clearTimeout(writeTimer);
    writeTimer = setTimeout(function () {
      save({ blurAmount: amount });
    }, 400);
  });

  blurInput.addEventListener('change', function () {
    clearTimeout(writeTimer);
    save({ blurAmount: api.clampBlur(blurInput.value) });
  });

  // A delay means nothing while nothing is ever revealed.
  function renderHoverDelayState(revealOnHover) {
    hoverDelayInput.disabled = !revealOnHover;
    hoverDelayField.classList.toggle('is-disabled', !revealOnHover);
  }

  hoverInput.addEventListener('change', function () {
    renderHoverDelayState(hoverInput.checked);
    save({ revealOnHover: hoverInput.checked });
  });

  modeInput.addEventListener('change', function () {
    save({ mode: modeInput.value });
  });

  hoverDelayInput.addEventListener('change', function () {
    var delay = api.normalizeSettings({ hoverDelay: hoverDelayInput.value }).hoverDelay;
    hoverDelayInput.value = String(delay);
    save({ hoverDelay: delay });
  });

  // Written on commit rather than on every keystroke: each change makes every
  // open tab measure its elements again.
  sizeInputs.forEach(function (entry) {
    entry.element.addEventListener('change', function () {
      var size = api.clampSize(entry.element.value, api.DEFAULT_SETTINGS[entry.key]);
      entry.element.value = String(size);
      var patch = {};
      patch[entry.key] = size;
      save(patch);
    });
  });

  addForm.addEventListener('submit', function (event) {
    event.preventDefault();
    var host = api.normalizeHost(siteInput.value);
    if (!host) {
      addError.hidden = false;
      siteInput.focus();
      return;
    }

    addError.hidden = true;
    siteInput.value = '';

    if (api.isExcluded(host, excluded)) {
      flashStatus(label('statusSiteDuplicate', [host], host + ' is already excluded'));
      return;
    }

    excluded = api.normalizeSiteList(excluded.concat(host));
    renderSites();
    save({ excludedSites: excluded }, label('statusSiteAdded', [host], 'Added ' + host));
  });

  siteInput.addEventListener('input', function () {
    addError.hidden = true;
  });

  resetButton.addEventListener('click', function () {
    if (!window.confirm(label('optionsResetConfirm', null, 'Reset every Image Blur setting to its default?'))) {
      return;
    }
    var defaults = api.normalizeSettings(null);
    api.writeSettings(defaults).then(function (ok) {
      render(defaults);
      flashStatus(ok
        ? label('statusReset', null, 'Settings reset')
        : label('statusSaveFailed', null, 'Could not save'));
    });
  });

  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area === 'sync' && !document.hasFocus()) {
      api.readSettings().then(render);
    }
  });

  api.readSettings().then(render);
})();
