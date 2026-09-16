'use strict';

/** Frames run their own copy of the content script; video is plain CSS. */
module.exports = {
  name: 'frames, video and stability',

  async run(t) {
    await t.open('frames.html', 3000);

    const frames = await t.evaluate(`(() => {
      const inner = document.getElementById('same-origin').contentWindow;
      const srcdoc = document.getElementById('srcdoc').contentWindow;
      return {
        image: inner.getComputedStyle(inner.document.getElementById('frame-image')).filter,
        tile: inner.getComputedStyle(inner.document.getElementById('frame-tile')).filter,
        tileClass: inner.document.getElementById('frame-tile').getAttribute('class'),
        srcdocImage: srcdoc.getComputedStyle(srcdoc.document.getElementById('inner-image')).filter,
        video: getComputedStyle(document.getElementById('clip')).filter
      };
    })()`);

    t.expect('same origin frame content blurred',
      [frames.image, frames.tile, frames.tileClass],
      ['blur(12px)', 'blur(12px)', 'tile ibx-bg-direct']);
    t.expect('srcdoc frame content blurred', frames.srcdocImage, 'blur(12px)');
    t.expect('video blurred', frames.video, 'blur(12px)');

    // Tagging an element changes its class, which the observer sees. If that
    // fed back into itself the class list would never settle.
    const stability = await t.evaluate(`(() => new Promise((resolve) => {
      const el = document.getElementById('stable');
      const seen = [];
      let ticks = 0;
      const tick = () => {
        const value = el.getAttribute('class') || '';
        if (seen[seen.length - 1] !== value) { seen.push(value); }
        ticks += 1;
        if (ticks >= 20) { resolve({ transitions: seen.length, last: seen[seen.length - 1] }); }
        else { setTimeout(tick, 200); }
      };
      tick();
    }))()`, { awaitPromise: true });

    t.expect('class list settles instead of oscillating',
      [stability.transitions <= 2, stability.last], [true, 'ibx-bg-overlay ibx-bg-anchor']);
  }
};
