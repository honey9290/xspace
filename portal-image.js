/*
 * portal-image.js — client-side photo compression for listing images.
 *
 * Why this exists: a photo straight off a phone is 2–4 MB. Supabase's free tier
 * gives 1 GB of file storage, so raw uploads would fill it after roughly a
 * couple of hundred photos. Resizing to 1600px and encoding as WebP typically
 * cuts a listing photo by 85–95%, which turns that same 1 GB into thousands of
 * photos — and makes the portal load far faster on a phone.
 *
 * Compression happens in the browser BEFORE upload, so the big file never
 * crosses the network at all.
 *
 * Load after portal-db.js:
 *   <script src="portal-image.js"></script>
 */
(function (global) {
  'use strict';

  var DEFAULTS = {
    maxDimension: 1600,  // longest edge, in px — plenty for a full-screen view
    quality: 0.82,       // visually indistinguishable from source for photos
    thumbDimension: 400, // used for the in-app gallery preview
    thumbQuality: 0.7
  };

  // Anything above this is refused before we try to decode it, so a stray
  // 80 MB RAW file can't hang the tab.
  var MAX_INPUT_BYTES = 25 * 1024 * 1024;

  var ACCEPTED = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp'];

  // ------------------------------------------------------------ capability --
  var _webp = null;
  function supportsWebP() {
    if (_webp !== null) return _webp;
    try {
      var c = document.createElement('canvas');
      c.width = c.height = 1;
      _webp = c.toDataURL('image/webp').indexOf('data:image/webp') === 0;
    } catch (e) {
      _webp = false;
    }
    return _webp;
  }

  function outputType() {
    // WebP where available (much smaller), JPEG everywhere else.
    return supportsWebP() ? 'image/webp' : 'image/jpeg';
  }

  // --------------------------------------------------------------- helpers --
  function formatBytes(n) {
    if (n === null || n === undefined) return '—';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
    return (n / (1024 * 1024)).toFixed(1) + ' MB';
  }

  // Decodes the file honouring EXIF orientation, so photos taken in portrait
  // don't come out sideways. createImageBitmap handles this natively where
  // supported; the <img> fallback is correct in every current browser.
  function loadImage(file) {
    if (typeof createImageBitmap === 'function') {
      try {
        return createImageBitmap(file, { imageOrientation: 'from-image' })
          .catch(function () { return loadViaElement(file); });
      } catch (e) {
        return loadViaElement(file);
      }
    }
    return loadViaElement(file);
  }

  function loadViaElement(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error('That file could not be read as an image.'));
      };
      img.src = url;
    });
  }

  function scaledSize(w, h, max) {
    if (w <= max && h <= max) return { w: w, h: h };          // never upscale
    var r = w > h ? max / w : max / h;
    return { w: Math.round(w * r), h: Math.round(h * r) };
  }

  function canvasToBlob(canvas, type, quality) {
    return new Promise(function (resolve, reject) {
      if (canvas.toBlob) {
        canvas.toBlob(function (blob) {
          blob ? resolve(blob) : reject(new Error('Could not encode the image.'));
        }, type, quality);
      } else {
        // Very old browsers: go through a data URL instead.
        try {
          var url = canvas.toDataURL(type, quality);
          var bin = atob(url.split(',')[1]);
          var arr = new Uint8Array(bin.length);
          for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
          resolve(new Blob([arr], { type: type }));
        } catch (e) {
          reject(new Error('Could not encode the image.'));
        }
      }
    });
  }

  function blobToDataURL(blob) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(fr.result); };
      fr.onerror = function () { reject(new Error('Could not read the compressed image.')); };
      fr.readAsDataURL(blob);
    });
  }

  function validate(file) {
    if (!file) throw new Error('No file selected.');
    if (file.type && ACCEPTED.indexOf(file.type) === -1 && file.type.indexOf('image/') !== 0) {
      throw new Error('“' + file.name + '” is not an image.');
    }
    if (file.size > MAX_INPUT_BYTES) {
      throw new Error('“' + file.name + '” is ' + formatBytes(file.size) +
                      '. Please use an image under ' + formatBytes(MAX_INPUT_BYTES) + '.');
    }
  }

  // ------------------------------------------------------------- the worker --
  function render(source, maxDim, quality, type) {
    var sw = source.width, sh = source.height;
    var size = scaledSize(sw, sh, maxDim);

    var canvas = document.createElement('canvas');
    canvas.width = size.w;
    canvas.height = size.h;

    var ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'high';

    // Flatten onto white — PNGs with transparency would otherwise go black
    // once encoded as JPEG.
    if (type === 'image/jpeg') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, size.w, size.h);
    }

    ctx.drawImage(source, 0, 0, size.w, size.h);
    return canvasToBlob(canvas, type, quality).then(function (blob) {
      return { blob: blob, width: size.w, height: size.h };
    });
  }

  /**
   * Compress one image file.
   * Resolves with { blob, dataUrl, thumbDataUrl, width, height,
   *                 originalSize, size, saved, ratio, type, name }
   */
  function compress(file, opts) {
    opts = opts || {};
    var maxDim  = opts.maxDimension  || DEFAULTS.maxDimension;
    var quality = opts.quality       || DEFAULTS.quality;
    var thumbD  = opts.thumbDimension|| DEFAULTS.thumbDimension;
    var thumbQ  = opts.thumbQuality  || DEFAULTS.thumbQuality;
    var type    = opts.type          || outputType();

    return Promise.resolve()
      .then(function () {
        validate(file);
        return loadImage(file);
      })
      .then(function (source) {
        return Promise.all([
          render(source, maxDim, quality, type),
          render(source, thumbD, thumbQ, type)
        ]).then(function (both) {
          if (source.close) source.close();  // release ImageBitmap memory
          return both;
        });
      })
      .then(function (both) {
        var full = both[0], thumb = both[1];
        return Promise.all([
          blobToDataURL(full.blob),
          blobToDataURL(thumb.blob)
        ]).then(function (urls) {
          var saved = file.size - full.blob.size;
          return {
            name: (file.name || 'photo').replace(/\.[^.]+$/, '') +
                  (type === 'image/webp' ? '.webp' : '.jpg'),
            type: type,
            blob: full.blob,            // <- this is what you upload
            dataUrl: urls[0],
            thumbDataUrl: urls[1],
            width: full.width,
            height: full.height,
            originalSize: file.size,
            size: full.blob.size,
            saved: saved > 0 ? saved : 0,
            ratio: file.size ? full.blob.size / file.size : 1
          };
        });
      });
  }

  /** Compress several files, reporting progress. Never rejects on one bad
   *  file — failures come back in `errors` so the good ones still upload. */
  function compressAll(files, opts, onProgress) {
    var list = Array.prototype.slice.call(files || []);
    var results = [], errors = [];

    return list.reduce(function (chain, file, i) {
      return chain.then(function () {
        if (onProgress) onProgress(i, list.length, file.name);
        return compress(file, opts)
          .then(function (r) { results.push(r); })
          .catch(function (e) { errors.push({ name: file.name, message: e.message }); });
      });
    }, Promise.resolve()).then(function () {
      if (onProgress) onProgress(list.length, list.length, null);
      return { results: results, errors: errors };
    });
  }

  /**
   * Upload a compressed result to Supabase Storage.
   *
   * Not wired up yet — it needs the Supabase JS client on the page and a
   * storage bucket. Kept here so the swap is a one-liner when the backend
   * lands: replace the localStorage thumbnail write with this call and store
   * the returned public URL on the listing instead of a data URL.
   *
   *   const { publicUrl } = await XImage.uploadToSupabase(supabase, 'listing-photos', result);
   */
  function uploadToSupabase(client, bucket, result, pathPrefix) {
    if (!client || !client.storage) {
      return Promise.reject(new Error('Pass an initialised Supabase client.'));
    }
    var path = (pathPrefix || 'listings') + '/' +
               Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '-' + result.name;

    return client.storage.from(bucket)
      .upload(path, result.blob, { contentType: result.type, upsert: false })
      .then(function (res) {
        if (res.error) throw res.error;
        var pub = client.storage.from(bucket).getPublicUrl(path);
        return { path: path, publicUrl: pub.data ? pub.data.publicUrl : null };
      });
  }

  global.XImage = {
    DEFAULTS: DEFAULTS,
    compress: compress,
    compressAll: compressAll,
    formatBytes: formatBytes,
    supportsWebP: supportsWebP,
    outputType: outputType,
    uploadToSupabase: uploadToSupabase
  };
})(window);
