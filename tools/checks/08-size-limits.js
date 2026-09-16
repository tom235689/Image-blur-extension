'use strict';

const TARGETS = {
  tiny: '#tiny',
  icon: '#icon',
  wide: '#wide',
  photo: '#photo',
  canvas: '#mini-canvas',
  svgIcon: '#svg-icon',
  svgArtwork: '#svg-artwork',
  tileSmall: '#tile-small',
  tileBig: '#tile-big'
};

function shape(filters) {
  const out = {};
  for (const key of Object.keys(filters)) {
    out[key] = filters[key] === 'none' ? 'sharp' : 'blurred';
  }
  return out;
}

/** The two configurable size limits, both measured on the painted box. */
module.exports = {
  name: 'size limits',

  async run(t) {
    await t.open('sizes.html', 3000);

    t.expect('by default every raster size blurs and only small svg is spared',
      shape(await t.filters(TARGETS)), {
        tiny: 'blurred', icon: 'blurred', wide: 'blurred', photo: 'blurred', canvas: 'blurred',
        svgIcon: 'sharp', svgArtwork: 'blurred', tileSmall: 'blurred', tileBig: 'blurred'
      });

    await t.setSettings({ minImageSize: 48 });
    t.expect('a raster limit spares only what is below it in both directions',
      shape(await t.filters(TARGETS)), {
        tiny: 'sharp', icon: 'sharp', wide: 'blurred', photo: 'blurred', canvas: 'sharp',
        svgIcon: 'sharp', svgArtwork: 'blurred', tileSmall: 'sharp', tileBig: 'blurred'
      });

    await t.setSettings({ minVectorSize: 0 });
    t.expect('a vector limit of zero blurs interface icons too',
      shape(await t.filters({ svgIcon: '#svg-icon' })), { svgIcon: 'blurred' });

    await t.setSettings({ minImageSize: 256 });
    t.expect('a limit above everything on the page spares it all',
      shape(await t.filters({ tiny: '#tiny', photo: '#photo', tileBig: '#tile-big' })),
      { tiny: 'sharp', photo: 'sharp', tileBig: 'sharp' });

    await t.setSettings({ minImageSize: 0, minVectorSize: 48 });
    t.expect('going back to the defaults needs no reload',
      shape(await t.filters(TARGETS)), {
        tiny: 'blurred', icon: 'blurred', wide: 'blurred', photo: 'blurred', canvas: 'blurred',
        svgIcon: 'sharp', svgArtwork: 'blurred', tileSmall: 'blurred', tileBig: 'blurred'
      });
  }
};
