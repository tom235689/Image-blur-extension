/**
 * Options page: every setting there is - strength and effect, which kinds of
 * media are blurred, the size limits, the reveal, the site list and the
 * settings file.
 */
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
  var revealKeyInput = document.getElementById('reveal-key');
  var revealKeyField = document.getElementById('reveal-key-field');
  var typesNone = document.getElementById('types-none');
  var addForm = document.getElementById('add-form');
  var siteInput = document.getElementById('site-input');
  var addError = document.getElementById('add-error');
  var siteList = document.getElementById('site-list');
  var emptyNote = document.getElementById('empty-note');
  var siteListModeInput = document.getElementById('site-list-mode');
  var sitesNote = document.getElementById('sites-note');
  var exportButton = document.getElementById('export-settings');
  var importButton = document.getElementById('import-settings');
  var importFile = document.getElementById('import-file');
  var backupError = document.getElementById('backup-error');
  var resetButton = document.getElementById('reset');
  var statusLabel = document.getElementById('status');

  var sites = [];
  var siteListMode = api.DEFAULT_SETTINGS.siteListMode;
  var writeTimer = 0;
  var statusTimer = 0;

  blurInput.min = String(api.BLUR_MIN);
  blurInput.max = String(api.BLUR_MAX);

  // One checkbox per kind, named after the kind itself so the two cannot drift.
  var typeInputs = api.MEDIA_KINDS.map(function (kind) {
    return { kind: kind, element: document.getElementById('type-' + kind) };
  });

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
      if (ok) {
        flashStatus(message || label('statusSaved', null, 'Saved'));
        return;
      }
      flashStatus(label('statusSaveFailed', null, 'Could not save'));
      // The page is showing a change that never reached storage - a site list
      // past the quota, or too many writes in one minute - so it has to stop
      // claiming otherwise and show what is really stored.
      api.readSettings().then(render);
    });
  }

  function renderSites() {
    siteList.textContent = '';
    emptyNote.hidden = sites.length > 0;

    sites.forEach(function (host) {
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
        sites = sites.filter(function (entry) {
          return entry !== host;
        });
        renderSites();
        save({ excludedSites: sites }, label('statusSiteRemoved', [host], 'Removed ' + host));
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
    revealKeyInput.value = settings.revealKey;
    renderHoverState(settings.revealOnHover);
    typeInputs.forEach(function (entry) {
      entry.element.checked = settings.blurTypes[entry.kind] !== false;
    });
    renderTypesState(settings);
    siteListMode = settings.siteListMode;
    siteListModeInput.value = settings.siteListMode;
    renderSiteListMode();
    sites = settings.excludedSites.slice();
    renderSites();
  }

  // The preview follows the handle, but the write waits for a pause in the
  // dragging: chrome.storage.sync allows 120 writes a minute, and a drag can
  // ask for more than that on its own. The released value is written in full
  // whatever the waiting write did.
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

  // A delay and a key both mean nothing while nothing is ever revealed.
  function renderHoverState(revealOnHover) {
    hoverDelayInput.disabled = !revealOnHover;
    hoverDelayField.classList.toggle('is-disabled', !revealOnHover);
    revealKeyInput.disabled = !revealOnHover;
    revealKeyField.classList.toggle('is-disabled', !revealOnHover);
  }

  hoverInput.addEventListener('change', function () {
    renderHoverState(hoverInput.checked);
    save({ revealOnHover: hoverInput.checked });
  });

  revealKeyInput.addEventListener('change', function () {
    save({ revealKey: revealKeyInput.value });
  });

  /** Switching every kind off is a way of blurring nothing; it has to say so. */
  function renderTypesState(settings) {
    typesNone.hidden = api.blursAnything(settings);
  }

  typeInputs.forEach(function (entry) {
    entry.element.addEventListener('change', function () {
      var blurTypes = {};
      typeInputs.forEach(function (other) {
        blurTypes[other.kind] = other.element.checked;
      });
      renderTypesState({ blurTypes: blurTypes });
      save({ blurTypes: blurTypes });
    });
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

    // Already covered, by itself or by a parent entry. Saying so beats storing
    // a second entry that changes nothing.
    if (api.isListed(host, sites)) {
      flashStatus(label('statusSiteDuplicate', [host], host + ' is already on the list'));
      return;
    }

    sites = api.normalizeSiteList(sites.concat(host));
    renderSites();
    save({ excludedSites: sites }, label('statusSiteAdded', [host], 'Added ' + host));
  });

  siteInput.addEventListener('input', function () {
    addError.hidden = true;
  });

  /** The same list reads as two opposite instructions, so the wording follows it. */
  function renderSiteListMode() {
    var isOnly = siteListMode === 'only';
    sitesNote.textContent = isOnly
      ? label('optionsSitesNoteOnly', null,
        'Only these hosts are blurred; every other site is left alone. A host also covers its sub domains, so example.com covers images.example.com.')
      : label('optionsSitesNote', null,
        'Nothing is blurred on these hosts. A host also covers its sub domains, so example.com covers images.example.com.');
    siteInput.setAttribute('aria-label', isOnly
      ? label('optionsSitesInputLabelOnly', null, 'Host to blur')
      : label('optionsSitesInputLabel', null, 'Host to leave unblurred'));
  }

  siteListModeInput.addEventListener('change', function () {
    siteListMode = siteListModeInput.value;
    renderSiteListMode();
    save({ siteListMode: siteListMode });
  });

  /**
   * Settings as a file. An extension page may hand the browser a blob to save,
   * so this needs no downloads permission and nothing leaves the profile.
   */
  exportButton.addEventListener('click', function () {
    api.readSettings().then(function (settings) {
      var payload = { format: 'image-blur-settings', version: 1, settings: settings };
      var url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
      var link = document.createElement('a');
      link.href = url;
      link.download = 'image-blur-settings.json';
      link.click();
      // Revoking straight away can cancel the save in progress.
      setTimeout(function () {
        URL.revokeObjectURL(url);
      }, 10000);
      flashStatus(label('statusExported', null, 'Settings exported'));
    });
  });

  importButton.addEventListener('click', function () {
    backupError.hidden = true;
    importFile.click();
  });

  importFile.addEventListener('change', function () {
    var file = importFile.files && importFile.files[0];
    if (!file) {
      return;
    }

    var reader = new FileReader();
    reader.onload = function () {
      var parsed = null;
      try {
        parsed = JSON.parse(String(reader.result));
      } catch (error) {
        parsed = null;
      }

      // Anything unrecognised in the file falls back to its default rather than
      // reaching storage, so a hand edited file cannot put the extension into a
      // state its own interface could not produce.
      var source = parsed && typeof parsed === 'object'
        ? (parsed.settings && typeof parsed.settings === 'object' ? parsed.settings : parsed)
        : null;
      if (!source) {
        backupError.hidden = false;
        return;
      }

      var settings = api.normalizeSettings(source);
      api.writeSettings(settings).then(function (ok) {
        render(settings);
        flashStatus(ok
          ? label('statusImported', null, 'Settings imported')
          : label('statusSaveFailed', null, 'Could not save'));
      });
    };
    reader.onerror = function () {
      backupError.hidden = false;
    };
    reader.readAsText(file);
    importFile.value = '';
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
