'use strict';

const TARGETS = {
  imageButton: '#image-button',
  textField: '#text-field',
  imageObject: '#image-object',
  htmlObject: '#html-object'
};

/**
 * <input> and <object> share their tag with blurred media but only hold an
 * image some of the time, and blur.css says so in its selectors:
 * input[type="image"] and object[type^="image/"]. The content script has to
 * agree, or it tags a text box with a class that belongs to an image.
 */
module.exports = {
  name: 'inputs and objects that are not images',

  async run(t) {
    await t.open('replaced-media.html', 3000);

    const filters = await t.filters(TARGETS);
    t.expect('an image button and an image object are blurred',
      [filters.imageButton, filters.imageObject],
      ['blur(12px)', 'blur(12px)']);
    t.expect('a text box and an html object are left alone',
      [filters.textField, filters.htmlObject],
      ['none', 'none']);

    // A size limit is the only thing that tags replaced media, so it is what
    // shows whether the wrong elements are being measured.
    await t.setSettings({ minImageSize: 200 });

    const limited = await t.filters(TARGETS);
    t.expect('the image button is below the limit and goes sharp',
      [limited.imageButton, await t.classesOf('#image-button')],
      ['none', 'ibx-small']);

    t.expect('the text box is never tagged, whatever its size',
      await t.classesOf('#text-field'), '');
    t.expect('a non image object is never tagged either',
      await t.classesOf('#html-object'), '');
  }
};
