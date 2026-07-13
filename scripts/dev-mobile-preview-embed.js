(function () {
  'use strict';

  if (new URLSearchParams(window.location.search).get('__mobile_preview') !== '1') return;

  var width = parseInt(new URLSearchParams(window.location.search).get('__preview_width') || '390', 10);
  if (!width || width < 320) width = 390;

  document.documentElement.classList.add('ikf-embed-preview');

  var meta = document.querySelector('meta[name="viewport"]');
  if (meta) {
    meta.setAttribute('content', 'width=' + width + ', initial-scale=1, maximum-scale=1');
  }
})();
