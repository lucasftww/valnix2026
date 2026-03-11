(function(){
  try{
    var img=localStorage.getItem('valnix_lcp_img');
    if(img){
      var el=document.getElementById('lcp-card');
      if(el){
        var i=document.createElement('img');
        i.src=img;i.alt='';i.width=300;i.height=375;
        i.fetchPriority='high';i.decoding='sync';
        i.style.cssText='width:100%;height:100%;object-fit:cover';
        i.draggable=false;
        el.appendChild(i);
      }
    }
  }catch(e){}
})();
