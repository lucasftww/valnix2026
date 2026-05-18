(function () {
  /** Paint product images into static #root shell (runs when fetch returns or from lcp-inject). */
  window.__valnixInjectShell = function (urls) {
    if (!Array.isArray(urls)) return;
    for (var i = 0; i < Math.min(4, urls.length); i++) {
      var src = urls[i];
      if (!src) continue;
      var el = document.getElementById("lcp-shell-" + i);
      if (!el || el.querySelector("img")) continue;
      var img = document.createElement("img");
      img.src = src;
      img.alt = "";
      img.width = 300;
      img.height = 375;
      img.decoding = i === 0 ? "sync" : "async";
      if (i === 0) img.fetchPriority = "high";
      img.style.cssText =
        "position:absolute;inset:0;width:100%;height:100%;max-width:none;object-fit:cover;display:block";
      img.draggable = false;
      el.appendChild(img);
      el.classList.remove("vn-shell-pulse");
    }
  };

  var path = location.pathname;
  var isHome = path === "/" || path === "/index.html";
  // Same-origin /api/site-data — uses our Vercel function which proxies to
  // the current Supabase project. Same-origin avoids the DNS + CORS round
  // trips of the legacy cross-origin Supabase Edge Function call.
  var base = "/api/site-data";
  var preloaded = {};
  function preloadImg(src, priority) {
    if (!src || preloaded[src]) return;
    preloaded[src] = true;
    var l = document.createElement("link");
    l.rel = "preload";
    l.as = "image";
    l.href = src;
    if (priority) l.fetchPriority = "high";
    document.head.appendChild(l);
  }
  if (isHome) {
    try {
      var cached = localStorage.getItem("valnix_lcp_img");
      if (cached) preloadImg(cached, true);
    } catch (e) {}
  }
  var pf = fetch(base + "?type=featured")
    .then(function (r) {
      return r.json();
    })
    .then(function (d) {
      if (d && d.products && isHome) {
        var sorted = d.products.slice().sort(function (a, b) {
          return (a.display_order || 0) - (b.display_order || 0);
        });
        var urls = [];
        for (var i = 0; i < Math.min(4, sorted.length); i++) {
          var img = sorted[i].image_url;
          if (img) {
            urls.push(img);
            if (i === 0) {
              try {
                localStorage.setItem("valnix_lcp_img", img);
              } catch (e) {}
            }
            preloadImg(img, i < 2);
          }
        }
        try {
          if (urls.length) localStorage.setItem("valnix_featured_imgs", JSON.stringify(urls));
        } catch (e) {}
        function tryInject() {
          if (typeof window.__valnixInjectShell === "function") {
            window.__valnixInjectShell(urls);
          }
        }
        tryInject();
        setTimeout(tryInject, 0);
        requestAnimationFrame(tryInject);
      }
      return d;
    })
    .catch(function () {
      return null;
    });
  window.__API_PREFETCH_FEATURED = pf;
  window.__API_PREFETCH_CATEGORIES = fetch(base + "?type=categories")
    .then(function (r) {
      return r.json();
    })
    .catch(function () {
      return null;
    });
})();
