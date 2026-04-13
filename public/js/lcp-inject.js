(function () {
  try {
    var raw = localStorage.getItem("valnix_featured_imgs");
    if (raw && typeof window.__valnixInjectShell === "function") {
      window.__valnixInjectShell(JSON.parse(raw));
    } else if (typeof window.__valnixInjectShell === "function") {
      var single = localStorage.getItem("valnix_lcp_img");
      if (single) window.__valnixInjectShell([single]);
    }
  } catch (e) {}
})();
