(function(){
  var path=location.pathname;
  var isHome=path==='/'||path==='/index.html';
  var base='https://tiupdhnjdcmgbqifwkrd.supabase.co/functions/v1/site-data';
  var key='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRpdXBkaG5qZGNtZ2JxaWZ3a3JkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA0MjEwODYsImV4cCI6MjA4NTk5NzA4Nn0.xgPpT3hWbTTo6DcFuf0pjD1jcPpyWIpLQGrdNHX4IkI';
  var h={'Content-Type':'application/json','apikey':key};
  var preloaded={};
  function preloadImg(src,priority){
    if(!src||preloaded[src])return;
    preloaded[src]=true;
    var l=document.createElement('link');
    l.rel='preload';l.as='image';l.href=src;
    if(priority)l.fetchPriority='high';
    document.head.appendChild(l);
  }
  if(isHome){
    try{
      var cached=localStorage.getItem('valnix_lcp_img');
      if(cached)preloadImg(cached,true);
    }catch(e){}
  }
  var pf=fetch(base+'?type=featured',{headers:h}).then(function(r){return r.json()}).then(function(d){
    if(d&&d.products&&isHome){
      var sorted=d.products.slice().sort(function(a,b){return(a.display_order||0)-(b.display_order||0)});
      // Preload first row (up to 4) so carousel does not show grey placeholders beside LCP image.
      for(var i=0;i<Math.min(4,sorted.length);i++){
        var img=sorted[i].image_url;
        if(img){
          if(i===0){try{localStorage.setItem('valnix_lcp_img',img)}catch(e){}}
          preloadImg(img,i<2);
        }
      }
    }
    return d;
  }).catch(function(){return null});
  window.__API_PREFETCH_FEATURED=pf;
  window.__API_PREFETCH_CATEGORIES=fetch(base+'?type=categories',{headers:h}).then(function(r){return r.json()}).catch(function(){return null});
})();
