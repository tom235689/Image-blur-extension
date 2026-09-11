/** Toolbar popup: master switch and blur strength. */
(function () {
  'use strict';

  var api = globalThis.ImageBlur;
  var enabledInput = document.getElementById('enabled');
  var blurInput = document.getElementById('blur-amount');
  var blurValue = document.getElementById('blur-value');
  var stateLabel = document.getElementById('state-label');
  var optionsButton = document.getElementById('open-options');
  var writeTimer = 0;

  blurInput.min = String(api.BLUR_MIN);
  blurInput.max = String(api.BLUR_MAX);

  function renderBlurValue(amount) {
    blurValue.textContent = amount + ' px';
  }

  function renderEnabled(enabled) {
    document.body.classList.toggle('is-off', !enabled);
    stateLabel.textContent = enabled ? 'Blurring images on every site' : 'Blurring is turned off';
  }

  function render(settings) {
    enabledInput.checked = settings.enabled;
    blurInput.value = String(settings.blurAmount);
    renderBlurValue(settings.blurAmount);
    renderEnabled(settings.enabled);
  }

  function save(patch) {
    api.writeSettings(patch);
  }

  enabledInput.addEventListener('change', function () {
    renderEnabled(enabledInput.checked);
    save({ enabled: enabledInput.checked });
  });

  blurInput.addEventListener('input', function () {
    var amount = api.clampBlur(blurInput.value);
    renderBlurValue(amount);
    clearTimeout(writeTimer);
    writeTimer = setTimeout(function () {
      save({ blurAmount: amount });
    }, 120);
  });

  optionsButton.addEventListener('click', function () {
    if (chrome.runtime.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    } else {
      window.open(chrome.runtime.getURL('src/options/options.html'));
    }
    window.close();
  });

  api.readSettings().then(render);
})();
