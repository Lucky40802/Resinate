(function(){
  "use strict";
  var CFG = window.RESINATE_CONFIG || {};
  var CONTACT = CFG.contact || {};

  // ---- prices (cents). Editors override these from the dashboard (resinate_settings 'prices'). ----
  // Keep the defaults and rules in step with private.resinate_quote() in supabase/setup.sql.
  // ml: rough amount of resin in each size
  var SIZES = [{k:"S",name:"Small",h:30,ml:100},{k:"M",name:"Medium",h:46,ml:150},{k:"L",name:"Large",h:62,ml:250},{k:"XL",name:"XL",h:78,ml:400}];
  function volText(k){ for(var i=0;i<SIZES.length;i++) if(SIZES[i].k===k) return "about "+SIZES[i].ml+" ml"; return ""; }
  var DEFAULT_PRICES = {
    base:{S:599,M:999,L:1399,XL:1999},
    print:{S:199,M:199,L:299,XL:299},
    theme:{S:99,M:99,L:199,XL:199},
    dye:99, sparkleLo:100, sparkleHi:149, sparkleXL:null,
    led:{L:449,XL:399}, customMin:200, bundleOff:0
  };
  var P = JSON.parse(JSON.stringify(DEFAULT_PRICES));
  var STATUSES = ["New","Confirmed","Making","Ready","Collected","Cancelled"];
  var METHODS = ["PayID","Cash","Card"];

  function $(id){return document.getElementById(id)}
  function money(c){ var neg=c<0; c=Math.abs(c); return (neg?"−":"")+"$"+(c/100).toFixed(2); }
  function range(lo,hi){return lo===hi?money(lo):money(lo)+"–"+money(hi).slice(1)}
  function short(c){ return c%100===0 ? "$"+(c/100) : money(c); }
  function esc(s){return String(s==null?"":s).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]})}
  function sizeName(k){ var s=SIZES.filter(function(x){return x.k===k})[0]; return s?s.name:k; }
  function cents(str){ var t=String(str==null?"":str).replace(/[^0-9.]/g,""); if(!t) return NaN; var n=parseFloat(t); return isFinite(n)?Math.round(n*100):NaN; }
  function toast(text){ var t=$("toast"); t.textContent=text; t.hidden=false; clearTimeout(toast.h); toast.h=setTimeout(function(){ t.hidden=true; },2600); }
  function errText(e){ return (e && (e.message || e.error_description || e.code)) || "unknown error"; }
  function sparkleRange(k){ return k==="XL" ? (P.sparkleXL ? [P.sparkleXL,P.sparkleXL] : null) : [P.sparkleLo,P.sparkleHi]; }
  function ledPrice(k){ return (k==="L"||k==="XL") ? (P.led[k]||null) : null; }
  function mergePrices(d){
    var out = JSON.parse(JSON.stringify(DEFAULT_PRICES));
    if(!d) return out;
    ["base","print","theme","led"].forEach(function(g){ if(d[g]) for(var k in out[g]) if(typeof d[g][k]==="number") out[g][k]=d[g][k]; });
    ["dye","sparkleLo","sparkleHi","customMin","bundleOff"].forEach(function(k){ if(typeof d[k]==="number") out[k]=d[k]; });
    out.sparkleXL = typeof d.sparkleXL==="number" ? d.sparkleXL : null;
    return out;
  }

  // ---- builder state (kept in this browser so a half-built order survives a reload) ----
  var MAX_COLOURS = 2; // most colours in one piece (same limit in setup.sql)
  var COLOURS = [["Clear","#e8f2f1"],["Ocean teal","#0d8a8c"],["Deep blue","#24509e"],["Sky blue","#7cc3e6"],["Emerald","#2f9a5c"],["Purple","#7d4fb0"],
    ["Rose pink","#e48aa8"],["Red","#c0392b"],["Amber","#cf7a1c"],["Gold","#d9a63a"],["Pearl white","#f4f1ea"],["Black","#1d1d1f"]];
  function colourHex(name){ for(var i=0;i<COLOURS.length;i++) if(COLOURS[i][0]===name) return COLOURS[i][1]; return "#9cc"; }
  // themed designs: included in the base price. Makers change them on the dashboard (resinate_settings 'designs').
  var DEFAULT_DESIGNS = [
    {name:"Ocean wave", blurb:"Teal and sky blue breaking like a wave on the sand.", palette:["Ocean teal","Sky blue"]},
    {name:"Forest", blurb:"Deep greens with a touch of gold, like light through the leaves.", palette:["Emerald","Gold"]},
    {name:"Galaxy", blurb:"Night-sky blue and purple, best with sparkle for the stars.", palette:["Deep blue","Purple"]},
    {name:"Sunset", blurb:"Warm amber fading into rose pink.", palette:["Amber","Rose pink"]},
    {name:"Blossom", blurb:"Soft pink and pearl white, light and pretty.", palette:["Rose pink","Pearl white"]},
    {name:"Geode", blurb:"Purple ringed with gold, like a cut stone.", palette:["Purple","Gold"]}
  ];
  var designs = DEFAULT_DESIGNS;
  function cleanDesigns(list){
    if(!Array.isArray(list)) return DEFAULT_DESIGNS;
    return list.filter(function(d){ return d && typeof d.name==="string" && d.name.trim(); }).slice(0,8).map(function(d){
      return {name:d.name.trim().slice(0,30), blurb:String(d.blurb||"").slice(0,160),
        photo:(typeof d.photo==="string" && /^designs\/themes\/[A-Za-z0-9_.-]{1,80}$/.test(d.photo)) ? d.photo : "",
        palette:(Array.isArray(d.palette)?d.palette:[]).filter(function(c){ return COLOURS.some(function(x){ return x[0]===c; }); }).slice(0,MAX_COLOURS)};
    });
  }
  function findDesign(name){ for(var i=0;i<designs.length;i++) if(designs[i].name===name) return designs[i]; return null; }
  function designBg(pal){
    var cols = (pal&&pal.length?pal:["Clear"]).map(colourHex);
    if(cols.length===1) cols.push(cols[0]);
    return "linear-gradient(160deg,"+cols.join(",")+")";
  }
  var state = {size:"M", print:false, theme:"", art:"", artText:"", artNote:"", colours:1, palette:["Clear"], sparkle:false, led:false, custom:false, customNote:"", qty:1};
  var cart = [];
  try{
    var d = JSON.parse(localStorage.getItem("resinate-draft")||"null");
    if(d && d.state && P.base[d.state.size]!=null) Object.assign(state, d.state);
    if(!Array.isArray(state.palette) || !state.palette.length) state.palette = ["Clear"];
    state.palette = state.palette.filter(function(c){ return COLOURS.some(function(x){ return x[0]===c; }); }).slice(0,MAX_COLOURS);
    if(!state.palette.length) state.palette = ["Clear"];
    state.colours = state.palette.length;
    if(d && Array.isArray(d.cart)) cart = d.cart.filter(function(it){ return it && P.base[it.size]!=null; });
  }catch(e){}
  function saveDraft(){ try{ localStorage.setItem("resinate-draft", JSON.stringify({state:state, cart:cart})); }catch(e){} }

  // ---- shop price displays ----
  function renderPriceDisplays(){
    $("fromPrice").textContent = $("fromPrice2").textContent = money(Math.min(P.base.S,P.base.M,P.base.L,P.base.XL));
    $("sizes").innerHTML = SIZES.map(function(s){
      var w = 26 + s.h*0.9;
      return '<div class="size"><div class="top"><span class="code">'+s.k+'</span><i class="blob" style="width:'+w+'px;height:'+s.h+'px"></i></div>'+
        '<h3>'+s.name+'</h3><div class="price num">'+money(P.base[s.k])+'</div>'+
        '<p class="incl"><b class="vol">'+volText(s.k).replace(/^a/,"A")+' of resin</b><br>'+(ledPrice(s.k)?"LED light available":"Clear or one colour")+'</p></div>';
    }).join("");
    $("sizeSeg").innerHTML = SIZES.map(function(s){
      return '<label><input type="radio" name="size" id="size'+s.k+'" value="'+s.k+'"'+(s.k===state.size?" checked":"")+'><span><b>'+s.name+'</b><small>'+money(P.base[s.k])+'</small><small class="ml">~'+s.ml+' ml</small></span></label>';
    }).join("");
    function cells(fn){ return SIZES.map(function(s){ return fn(s.k).replace('<td class="p', '<td data-l="'+s.name+'" class="p'); }).join(""); }
    $("addonRows").innerHTML =
      '<tr><td><b>Themed design</b><span class="sub">One of our designs, with its colours included.</span></td>'+cells(function(k){return '<td class="p">'+money(P.theme[k])+'</td>'})+'</tr>'+
      '<tr><td><b>Your own design</b><span class="sub">Your own picture, words or a custom 3D design set into the resin.</span></td>'+cells(function(k){return '<td class="p">'+money(P.print[k])+'</td>'})+'</tr>'+
      '<tr><td><b>Colour dye</b><span class="sub">Charged when you pick 2 or more colours. One colour is included.</span></td>'+cells(function(){return '<td class="p">'+money(P.dye)+'</td>'})+'</tr>'+
      '<tr><td><b>Sparkle</b><span class="sub">Glitter, mica or flakes. Price depends on how much you want.</span></td>'+cells(function(k){var r=sparkleRange(k); return r?'<td class="p">'+range(r[0],r[1])+'</td>':'<td class="p ask">Ask us</td>'})+'</tr>'+
      '<tr><td><b>LED light</b><span class="sub">Light-up base for larger pieces</span></td>'+cells(function(k){var l=ledPrice(k); return l?'<td class="p">'+money(l)+'</td>':'<td class="p na">Not available</td>'})+'</tr>'+
      '<tr><td><b>Custom inclusions</b><span class="sub">Crystals, scenery, or a theme like sand for a wave or leaves for a nature piece. We quote each one.</span></td>'+cells(function(){return '<td class="p">from '+short(P.customMin)+'</td>'})+'</tr>';
    $("bundleBox").innerHTML = P.bundleOff>0
      ? '<span class="pill ok">Bundle deal</span><div style="min-width:0;flex:1 1 260px"><strong>Save '+money(P.bundleOff)+' on the full modification bundle</strong><p>Add your own design, 2 or more colours and sparkle to one piece and the discount comes off automatically.</p></div>'
      : '<span class="pill warn">Coming soon</span><div style="min-width:0;flex:1 1 260px"><strong>Full modification bundle</strong><p>Your own design, colour dye and sparkle together will cost less than adding each one. Bundle prices are on the way; ask us at the stall.</p></div>';
    $("cCustom").textContent = "from "+short(P.customMin);
  }

  // ---- quoting ----
  function quoteItem(it){
    var lines = [{label:sizeName(it.size)+" piece ("+volText(it.size)+")", lo:P.base[it.size], hi:P.base[it.size]}];
    var open = [];
    var free = themeColoursFree(it);
    if(it.theme && !it.print && findDesign(it.theme)) lines.push({label:it.theme+" design"+(free && it.colours>=2?", with its colours":""), lo:P.theme[it.size], hi:P.theme[it.size]});
    if(it.print) lines.push({label:"Your own design", lo:P.print[it.size], hi:P.print[it.size]});
    if(it.colours>=2 && !free) lines.push({label:"Colour dye ("+it.colours+" colours)", lo:P.dye, hi:P.dye});
    if(it.sparkle){
      var sp = sparkleRange(it.size);
      if(sp) lines.push({label:"Sparkle", lo:sp[0], hi:sp[1]});
      else { lines.push({label:"Sparkle (XL)", text:"quoted"}); open.push("XL sparkle"); }
    }
    var l = ledPrice(it.size);
    if(it.led && l) lines.push({label:"LED light", lo:l, hi:l});
    if(it.custom){ lines.push({label:"Custom inclusion", lo:P.customMin, hi:P.customMin, text:"from "+short(P.customMin)}); open.push("custom inclusion"); }
    if(P.bundleOff>0 && it.print && it.colours>=2 && it.sparkle) lines.push({label:"Bundle discount", lo:-P.bundleOff, hi:-P.bundleOff});
    var lo=0, hi=0;
    lines.forEach(function(x){ if(x.lo!=null){ lo+=x.lo; hi+=x.hi; } });
    return {lines:lines, lo:lo, hi:hi, open:open};
  }
  function quoteCart(items){
    var lo=0, hi=0, open=[];
    items.forEach(function(it){ var q=quoteItem(it), n=it.qty||1; lo+=q.lo*n; hi+=q.hi*n; q.open.forEach(function(o){ if(open.indexOf(o)<0) open.push(o); }); });
    return {lo:lo, hi:hi, open:open};
  }
  function est(q){ return (q.open.length?"from ":"")+range(q.lo,q.hi); }
  function itemSpec(it){
    var bits = [sizeName(it.size)];
    if(it.theme) bits.push(it.theme+" design");
    if(it.print) bits.push("own design"+(it.artText?' "'+it.artText+'"':"")+(it.art?" (picture attached)":"")+(it.artNote?": "+it.artNote:""));
    if(Array.isArray(it.palette) && it.palette.length) bits.push(it.palette.join(", "));
    else if(it.colours>=2) bits.push(it.colours+" colours");
    if(it.sparkle) bits.push("sparkle");
    if(it.led) bits.push("LED");
    if(it.custom) bits.push("custom"+(it.customNote?": "+it.customNote:""));
    return bits.join(" · ");
  }

  // a themed design's own colours are included; adding other colours brings back the dye charge (same rule in setup.sql)
  function themeColoursFree(it){
    var d = !it.print && it.theme ? findDesign(it.theme) : null;
    return !!d && (it.palette||[]).every(function(c){ return d.palette.indexOf(c)>=0; });
  }
  function designKey(st){ return st.print ? "own" : (st.theme && findDesign(st.theme) ? st.theme : ""); }
  function renderDesignList(){
    var tmin = Math.min(P.theme.S,P.theme.M,P.theme.L,P.theme.XL), tmax = Math.max(P.theme.S,P.theme.M,P.theme.L,P.theme.XL);
    $("designList").innerHTML = designs.map(function(d){
      var thumb = d.photo ? '<img class="thumb" src="'+esc(photoUrl(d.photo))+'" alt="'+esc(d.name)+' design" loading="lazy">' : '<div class="thumb" style="background:'+designBg(d.palette)+'"></div>';
      return '<article class="design">'+thumb+'<h3>'+esc(d.name)+'</h3>'+(d.blurb?'<p>'+esc(d.blurb)+'</p>':'')+
        '<div class="foot"><span class="incl">+'+esc(tmin===tmax?money(tmin):range(tmin,tmax))+' by size</span><button type="button" class="btn small ghost" data-use="'+esc(d.name)+'">Use this design</button></div></article>';
    }).join("")+
      '<article class="design own"><div class="thumb own"><svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="m3 16 5-5 4 4 3-3 6 6"/><circle cx="16" cy="9" r="1.6"/></svg></div><h3>Your own design</h3><p>Upload your photo, logo or artwork and add words, and see it on your piece before you order. Or ask us for a custom 3D design.</p>'+
      '<div class="foot"><span class="incl">+'+esc(range(Math.min(P.print.S,P.print.M,P.print.L,P.print.XL),Math.max(P.print.S,P.print.M,P.print.L,P.print.XL)))+' by size</span><button type="button" class="btn small ghost" data-use="own">Use your own</button></div></article>';
  }
  function renderDesignPick(){
    var st = state, key = designKey(st);
    var opts = [{k:"", n:"Plain pour", sub:"Included", bg:"", cls:"plain"}].concat(
      designs.map(function(d){ return {k:d.name, n:d.name, sub:"+"+money(P.theme[st.size]), bg:d.photo?'center/cover url("'+photoUrl(d.photo)+'")':designBg(d.palette)}; }),
      [{k:"own", n:"Your own design", sub:"+"+money(P.print[st.size]), cls:"own"}]);
    $("designPick").innerHTML = opts.map(function(o){
      return '<label><input type="radio" name="design" value="'+esc(o.k)+'"'+(o.k===key?" checked":"")+'><span><i class="thumb '+(o.cls||"")+'"'+(o.bg?' style="background:'+o.bg+'"':'')+'></i>'+esc(o.n)+'<small>'+esc(o.sub)+'</small></span></label>';
    }).join("");
    var d = findDesign(key);
    $("designHint").textContent = key==="own" ? "Upload your picture and add words below. You'll see it on the preview."
      : d ? (d.blurb ? d.blurb+" " : "")+"Its colours are included; adding others adds the dye charge."
      : "One clear or single-colour pour, with any add-ons you choose.";
  }
  function useDesign(key){
    state.print = key==="own";
    state.theme = (key && key!=="own") ? key : "";
    var d = findDesign(state.theme);
    if(d && d.palette.length){ state.palette = d.palette.slice(); state.colours = state.palette.length; }
    renderBuilder(); saveDraft();
  }

  // ---- the designer: a customer's own picture and words, shown on the preview ----
  var ART_RE = /^designs\/[0-9a-f-]{36}\/[A-Za-z0-9_.-]{1,80}$/;
  function renderOwnBox(){
    var own = !!state.print;
    $("ownBox").hidden = !own;
    if(!own) return;
    var signedIn = !!(sb && session);
    var hasArt = !!(state.art && ART_RE.test(state.art));
    $("artThumb").hidden = !hasArt;
    if(hasArt) $("artThumb").src = photoUrl(state.art);
    $("artPick").hidden = !signedIn;
    $("artPick").textContent = hasArt ? "Change picture" : "Upload a picture";
    $("artRm").hidden = !hasArt;
    if(!signedIn) $("artMsg").innerHTML = 'To upload a picture, <a href="#signin">sign in</a> first (it\'s free). Or describe your design below and send us the picture after you order.';
    else if(!$("artMsg").dataset.busy) $("artMsg").textContent = hasArt ? "Your picture is saved with this piece." : "JPG or PNG. We shrink it on your device before it's sent.";
    if($("artText").value !== (state.artText||"")) $("artText").value = state.artText||"";
    if($("artNote").value !== (state.artNote||"")) $("artNote").value = state.artNote||"";
  }
  function fitJpeg(file, max){
    return new Promise(function(resolve, reject){
      var img = new Image(), url = URL.createObjectURL(file);
      img.onload = function(){
        var k = Math.min(1, max/Math.max(img.naturalWidth, img.naturalHeight)), c = document.createElement("canvas");
        c.width = Math.round(img.naturalWidth*k); c.height = Math.round(img.naturalHeight*k);
        var g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0,0,c.width,c.height); g.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        c.toBlob(function(b){ b ? resolve(b) : reject(new Error("Couldn't read that image")); }, "image/jpeg", 0.86);
      };
      img.onerror = function(){ URL.revokeObjectURL(url); reject(new Error("That file isn't an image this browser can open")); };
      img.src = url;
    });
  }
  function randName(){ var a = new Uint8Array(8); crypto.getRandomValues(a); return Array.prototype.map.call(a, function(x){ return ("0"+x.toString(16)).slice(-2); }).join(""); }
  $("artFile").addEventListener("change", function(){
    var f = this.files[0]; if(!f || !session) return;
    var path = "designs/"+session.user.id+"/"+randName()+".jpg";
    $("artMsg").dataset.busy = "1"; $("artMsg").textContent = "Uploading your picture…";
    fitJpeg(f, 1400).then(function(blob){
      return sb.storage.from("resinate").upload(path, blob, {contentType:"image/jpeg", upsert:false});
    }).then(function(r){
      if(r.error) throw r.error;
      state.art = path; saveDraft(); delete $("artMsg").dataset.busy; renderBuilder();
    }).catch(function(err){ delete $("artMsg").dataset.busy; $("artMsg").textContent = "Your picture didn't upload ("+errText(err)+"). Try a smaller image."; });
    this.value = "";
  });
  $("artRm").addEventListener("click", function(){ state.art = ""; saveDraft(); renderBuilder(); });
  $("artText").addEventListener("input", function(){ state.artText = this.value.slice(0,40); saveDraft(); drawPreview(state); });
  $("artNote").addEventListener("input", function(){ state.artNote = this.value.slice(0,300); saveDraft(); });

  function renderBuilder(){
    var st = state;
    renderDesignPick(); renderOwnBox();
    var full = st.palette.length>=MAX_COLOURS;
    $("swatches").querySelectorAll("input").forEach(function(i){ i.checked = st.palette.indexOf(i.value)>=0; i.disabled = full && !i.checked; });
    $("picked").textContent = st.palette.join(", ")+(full?" (2 is the most; untick one to swap)":"");
    $("cDye").textContent = st.colours>=2 ? money(P.dye) : "Included";
    var sp = sparkleRange(st.size);
    $("cSparkle").textContent = sp ? range(sp[0],sp[1]) : "Ask us";
    $("dSparkle").textContent = sp ? "Glitter, mica or flakes" : "Glitter, mica or flakes. XL sparkle is quoted by us.";
    var l = ledPrice(st.size);
    $("led").disabled = !l;
    if(!l){ $("led").checked = false; st.led = false; }
    $("optLed").classList.toggle("off", !l);
    $("cLed").textContent = l ? money(l) : "—";
    $("dLed").textContent = l ? "Light-up base" : "Available on Large and XL";
    $("customBox").hidden = !st.custom;
    $("qty").textContent = st.qty;
    $("qtyMinus").disabled = st.qty<=1;
    $("qtyPlus").disabled = st.qty>=20;

    var q = quoteItem(st);
    $("lines").innerHTML = q.lines.map(function(x){
      var v = x.lo==null ? x.text : (x.text || range(x.lo,x.hi));
      return '<div class="line"><span>'+esc(x.label)+'</span><span>'+esc(v)+'</span></div>';
    }).join("");
    $("each").textContent = est(q);
    $("total").textContent = $("bbTotal").textContent = est({lo:q.lo*st.qty, hi:q.hi*st.qty, open:q.open});
    var note = [];
    if(q.lo!==q.hi) note.push("Sparkle price depends on how much you add.");
    if(q.open.length) note.push("We'll confirm the price of your "+q.open.join(" and ")+" before you pay.");
    if(!(P.bundleOff>0) && st.print && st.colours>=2 && st.sparkle) note.push("This qualifies for the full modification bundle, which will cost less once it launches.");
    $("totalNote").textContent = note.join(" ");
    $("addBtn").textContent = st.qty>1 ? "Add "+st.qty+" to order" : "Add to order";
    drawPreview(st);
  }

  // ---- live preview of the piece being built ----
  function drawPreview(st){
    var sc = {S:.62, M:.76, L:.9, XL:1}[st.size]||.8;
    var w = 150*sc, h = 120*sc, x = 120-w/2, base = st.led ? 160 : 176, y = base-h;
    var cols = st.palette.map(colourHex), n = cols.length;
    // one band per colour, top to bottom, softly blended where they meet
    var stops = "";
    cols.forEach(function(c,i){
      var op = st.palette[i]==="Clear" ? .3 : .9, a = Math.max(0,i/n*100+(i?3:0)), z = Math.min(100,(i+1)/n*100-(i<n-1?3:0));
      stops += '<stop offset="'+a+'%" stop-color="'+c+'" stop-opacity="'+op+'"/><stop offset="'+z+'%" stop-color="'+c+'" stop-opacity="'+(n===1?op*.75:op)+'"/>';
    });
    var r = Math.min(w,h)*.42;
    var shape = 'M'+x+' '+base+' L'+x+' '+(y+r)+' Q'+x+' '+y+' '+(x+r)+' '+y+' L'+(x+w-r)+' '+y+' Q'+(x+w)+' '+y+' '+(x+w)+' '+(y+r)+' L'+(x+w)+' '+base+' Z';
    var g = '<defs><linearGradient id="pvg" gradientUnits="userSpaceOnUse" x1="0" y1="'+y+'" x2="0" y2="'+base+'">'+stops+'</linearGradient>'+
      '<linearGradient id="pvs" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/></linearGradient>'+
      '<radialGradient id="pvl" cx=".5" cy="1" r=".9"><stop offset="0" stop-color="#ffe9a8" stop-opacity=".95"/><stop offset="1" stop-color="#ffe9a8" stop-opacity="0"/></radialGradient>'+
      '<clipPath id="pvc"><path d="'+shape+'"/></clipPath></defs>';
    var out = g;
    out += '<ellipse cx="120" cy="'+(st.led?186:184)+'" rx="'+(w*.62)+'" ry="7" fill="#000" opacity=".28"/>';
    if(st.led) out += '<ellipse cx="120" cy="'+(base-4)+'" rx="'+(w*.9)+'" ry="'+(h*.9)+'" fill="url(#pvl)"/>';
    out += '<g clip-path="url(#pvc)"><rect x="0" y="0" width="240" height="200" fill="url(#pvg)"/>';
    // swirls between colours
    for(var i=1;i<n;i++){
      var yy = y + h*i/n;
      out += '<path d="M'+(x-10)+' '+(yy+8)+' C'+(x+w*.3)+' '+(yy-14)+' '+(x+w*.6)+' '+(yy+16)+' '+(x+w+10)+' '+(yy-6)+'" stroke="#fff" stroke-opacity=".55" stroke-width="2.2" fill="none"/>';
    }
    if(st.custom){
      out += '<path d="M'+(x-5)+' '+(base-h*.16)+' C'+(x+w*.3)+' '+(base-h*.26)+' '+(x+w*.65)+' '+(base-h*.08)+' '+(x+w+5)+' '+(base-h*.2)+' L'+(x+w+5)+' '+(base+5)+' L'+(x-5)+' '+(base+5)+' Z" fill="#d9b77e"/>';
      out += '<path d="M'+(x+w*.22)+' '+(base-h*.18)+' l7 -16 l7 16 z" fill="#c9e7ff" opacity=".9"/><path d="M'+(x+w*.7)+' '+(base-h*.15)+' q10 -18 18 -4 q-8 10 -18 4z" fill="#3f8f4e" opacity=".9"/>';
    }
    var artOk = st.print && st.art && ART_RE.test(st.art);
    if(artOk){
      var aw = w*.62, ah = h*.52, ax = 120-aw/2, ay = y+h*.16;
      out += '<clipPath id="pva"><rect x="'+ax+'" y="'+ay+'" width="'+aw+'" height="'+ah+'" rx="6"/></clipPath>'+
        '<image href="'+esc(photoUrl(st.art))+'" x="'+ax+'" y="'+ay+'" width="'+aw+'" height="'+ah+'" preserveAspectRatio="xMidYMid slice" clip-path="url(#pva)" opacity=".95"/>';
    } else if(st.print){
      var pw = w*.34, px = 120-pw/2, py = y+h*.3;
      out += '<rect x="'+px+'" y="'+py+'" width="'+pw+'" height="'+pw*.8+'" rx="4" fill="#fff" opacity=".85"/>'+
        '<path d="M'+(px+pw*.12)+' '+(py+pw*.68)+' l'+(pw*.25)+' '+(-pw*.3)+' l'+(pw*.18)+' '+(pw*.18)+' l'+(pw*.12)+' '+(-pw*.1)+' l'+(pw*.21)+' '+(pw*.22)+'z" fill="#0d6d70" opacity=".8"/>'+
        '<circle cx="'+(px+pw*.72)+'" cy="'+(py+pw*.24)+'" r="'+(pw*.08)+'" fill="#b86a07"/>';
    }
    if(st.sparkle){
      var seed = 7;
      for(var k=0;k<38;k++){
        seed = (seed*9301+49297)%233280; var rx = seed/233280;
        seed = (seed*9301+49297)%233280; var ry = seed/233280;
        out += '<circle cx="'+(x+rx*w).toFixed(1)+'" cy="'+(y+ry*h).toFixed(1)+'" r="'+(k%5===0?1.8:1)+'" fill="'+(k%3===0?"#ffe39a":"#fff")+'" opacity=".9"/>';
      }
    }
    if(st.print && st.artText){
      out += '<text x="120" y="'+(base-h*.1)+'" text-anchor="middle" font-family="Instrument Serif, Georgia, serif" font-size="'+Math.max(9, Math.min(18, w*1.5/Math.max(6, st.artText.length)))+'" fill="#fff" stroke="#000" stroke-opacity=".35" stroke-width=".6" paint-order="stroke">'+esc(st.artText)+'</text>';
    }
    out += '<rect x="0" y="0" width="240" height="200" fill="url(#pvs)"/></g>';
    out += '<path d="'+shape+'" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="1.2"/>';
    if(st.led) out += '<rect x="'+(x-8)+'" y="'+(base)+'" width="'+(w+16)+'" height="14" rx="4" fill="#2b2f33"/><rect x="'+(x-2)+'" y="'+(base)+'" width="'+(w+4)+'" height="3" fill="#ffe9a8" opacity=".9"/>';
    $("pv").innerHTML = out;
    $("pv").setAttribute("aria-label", "Preview: "+itemSpec(st));
  }

  function renderCart(){
    var n = cart.reduce(function(a,it){return a+(it.qty||1)},0);
    $("cartBadge").hidden = !n; $("cartBadge").textContent = n;
    $("cbCount").textContent = n+(n===1?" piece":" pieces");
    $("cbTotal").textContent = n ? est(quoteCart(cart)) : "";
    syncCartBar();
    if(!cart.length){
      $("cart").innerHTML = '<div class="empty" style="padding:18px">No pieces yet. <a href="#build">Build a piece</a> and press Add to order.</div>';
      return;
    }
    $("cart").innerHTML = cart.map(function(it,i){
      var iq = quoteItem(it), n2 = it.qty||1;
      return '<div class="citem"><span class="spec">'+(n2>1?'<b>'+n2+' ×</b> ':'')+esc(itemSpec(it))+'</span><span class="amt">'+esc(est({lo:iq.lo*n2,hi:iq.hi*n2,open:iq.open}))+'</span><button type="button" data-rm="'+i+'" aria-label="Remove '+esc(itemSpec(it))+'">Remove</button></div>';
    }).join("")+'<div class="ctotal"><span>Estimated total</span><span>'+esc(est(quoteCart(cart)))+'</span></div>';
  }
  function cartText(){
    return cart.map(function(it){ var iq=quoteItem(it), n=it.qty||1; return "• "+(n>1?n+" × ":"")+itemSpec(it)+" — "+est({lo:iq.lo*n,hi:iq.hi*n,open:iq.open}); }).join("\n")+"\nEstimate: "+est(quoteCart(cart));
  }

  function renderAll(){ renderPriceDisplays(); renderDesignList(); renderBuilder(); renderCart(); $("factDesigns").textContent = designs.length; }

  // the phone checkout bar shows while there's something in the order and the checkout isn't on screen
  var checkoutSeen = false, builderSeen = false, receiptSeen = false;
  function syncCartBar(){
    var shop = (document.body.dataset.view||"shop")==="shop";
    // phones: while choosing options, a bar keeps this piece's price and Add in reach; otherwise the order bar shows
    var build = shop && builderSeen && !receiptSeen;
    $("buildbar").classList.toggle("show", build);
    $("buildbar").setAttribute("aria-hidden", build?"false":"true");
    $("bbAdd").tabIndex = build ? 0 : -1;
    var show = !build && cart.length>0 && !checkoutSeen && shop;
    $("cartbar").classList.toggle("show", show);
    $("cartbar").setAttribute("aria-hidden", show?"false":"true");
    $("cartbar").querySelector("a").tabIndex = show ? 0 : -1;
  }
  if("IntersectionObserver" in window){
    new IntersectionObserver(function(es){ checkoutSeen = es[0].isIntersecting; syncCartBar(); }, {threshold:0.05}).observe($("checkout"));
    new IntersectionObserver(function(es){ builderSeen = es[0].isIntersecting; syncCartBar(); }, {threshold:0.02}).observe($("builder"));
    new IntersectionObserver(function(es){ receiptSeen = es[0].isIntersecting; syncCartBar(); }, {threshold:0.35}).observe(document.querySelector(".receipt"));
    // highlight the menu link for the section being read
    var spy = {};
    document.querySelectorAll('header nav a[href^="#"]').forEach(function(a){ spy[a.getAttribute("href").slice(1)] = a; });
    var spyIO = new IntersectionObserver(function(es){
      es.forEach(function(e){ if(e.isIntersecting){ for(var k in spy) spy[k].classList.toggle("on", k===e.target.id); } });
    }, {rootMargin:"-45% 0px -50% 0px"});
    ["about","pricing","designs-sec","build","checkout","track","contact"].forEach(function(id){ if($(id)) spyIO.observe($(id)); });
  }

  $("builder").addEventListener("submit", function(e){ e.preventDefault(); });
  $("sizeSeg").addEventListener("change", function(e){ state.size = e.target.value; renderBuilder(); saveDraft(); });
  ["sparkle","led","custom"].forEach(function(k){
    $(k).addEventListener("change", function(){ state[k] = this.checked; renderBuilder(); saveDraft(); });
  });
  $("designPick").addEventListener("change", function(e){ if(e.target.name==="design") useDesign(e.target.value); });
  $("designList").addEventListener("click", function(e){
    var b = e.target.closest("[data-use]"); if(!b) return;
    useDesign(b.getAttribute("data-use"));
    $("build").scrollIntoView({behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"});
  });
  $("swatches").innerHTML = COLOURS.map(function(c){
    return '<label class="sw'+(c[0]==="Clear"?" clear":"")+'" title="'+c[0]+'"><input type="checkbox" value="'+c[0]+'" aria-label="'+c[0]+'"><span style="--c:'+c[1]+'"></span></label>';
  }).join("");
  $("swatches").addEventListener("change", function(e){
    var v = e.target.value, i = state.palette.indexOf(v);
    if(e.target.checked){ if(i<0 && state.palette.length<MAX_COLOURS) state.palette.push(v); }
    else if(i>=0) state.palette.splice(i,1);
    if(!state.palette.length) state.palette = [v]; // always at least one colour
    state.colours = state.palette.length;
    renderBuilder(); saveDraft();
  });
  $("qtyMinus").addEventListener("click", function(){ state.qty = Math.max(1,state.qty-1); renderBuilder(); saveDraft(); });
  $("qtyPlus").addEventListener("click", function(){ state.qty = Math.min(20,state.qty+1); renderBuilder(); saveDraft(); });
  $("customNote").addEventListener("input", function(){ state.customNote = this.value; saveDraft(); });
  $("addBtn").addEventListener("click", function(){
    cart.push({size:state.size, print:state.print, theme:state.print?"":(findDesign(state.theme)?state.theme:""),
      art:state.print && ART_RE.test(state.art||"") ? state.art : "", artText:state.print?(state.artText||"").trim():"", artNote:state.print?(state.artNote||"").trim():"", colours:state.palette.length, palette:state.palette.slice(), sparkle:state.sparkle, led:state.led, custom:state.custom, customNote:state.custom?state.customNote.trim():"", qty:state.qty});
    state.qty = 1; saveDraft(); renderBuilder(); renderCart();
    var n = cart.reduce(function(a,x){return a+(x.qty||1)},0);
    $("added").hidden = false;
    $("added").innerHTML = 'Added. '+n+(n===1?' piece':' pieces')+' in your order. <a href="#checkout">Go to checkout</a> or build another.';
    toast("Added to your order ("+n+(n===1?" piece":" pieces")+")");
  });
  $("bbAdd").addEventListener("click", function(){ $("addBtn").click(); });
  $("cart").addEventListener("click", function(e){
    var b = e.target.closest("[data-rm]"); if(!b) return;
    cart.splice(+b.getAttribute("data-rm"),1); saveDraft(); renderCart();
  });

  ["sparkle","led","custom"].forEach(function(k){ $(k).checked = !!state[k]; });
  $("customNote").value = state.customNote||"";
  renderAll();

  // ---- contact links (from config.js) ----
  function contactLinks(){
    var out = [];
    if(CONTACT.instagram) out.push('<a href="https://instagram.com/'+encodeURIComponent(CONTACT.instagram.replace(/^@/,""))+'" target="_blank" rel="noopener">Instagram @'+esc(CONTACT.instagram.replace(/^@/,""))+'</a>');
    if(CONTACT.email) out.push('<a href="mailto:'+esc(CONTACT.email)+'">'+esc(CONTACT.email)+'</a>');
    if(CONTACT.phone) out.push('<a href="tel:'+esc(CONTACT.phone.replace(/[^0-9+]/g,""))+'">'+esc(CONTACT.phone)+'</a>');
    return out;
  }
  (function(){ var c = contactLinks(); if(c.length){
    $("contactLine").innerHTML = "Contact us: "+c.join(" · "); $("contactLine").hidden = false;
    $("contactDirect").innerHTML = "Or reach us directly: "+c.join(" · "); $("contactDirect").hidden = false;
  } })();

  // ---- copy helpers ----
  function copyText(text, btn, fallbackEl){
    var done = function(){ if(!btn) return; var o=btn.textContent; btn.textContent="Copied"; setTimeout(function(){ btn.textContent=o; },1600); };
    var fail = function(){ if(fallbackEl){ var r=document.createRange(); r.selectNodeContents(fallbackEl); var s=getSelection(); s.removeAllRanges(); s.addRange(r); toast("Selected. Copy it with your keyboard or long-press."); } else toast("Couldn't copy here."); };
    try{ navigator.clipboard.writeText(text).then(done, fail); }catch(e){ fail(); }
  }
  document.addEventListener("click", function(e){
    var b = e.target.closest && e.target.closest("[data-copy]");
    if(b){ var target = $(b.getAttribute("data-copy")); copyText(target.textContent, b, target); }
  });

  // ---- payment details ----
  var pay = {};
  function payRows(ref){
    var rows = [];
    if(pay.payid) rows.push(["PayID", pay.payid, "Payid"]);
    if(pay.name) rows.push(["Account name", pay.name, "Name"]);
    if(pay.bsb) rows.push(["BSB", pay.bsb, "Bsb"]);
    if(pay.acct) rows.push(["Account", pay.acct, "Acct"]);
    if(ref) rows.push(["Reference", ref, "Ref"]);
    return rows;
  }
  function kvHtml(rows, prefix){
    return '<dl class="kv">'+rows.map(function(r){
      var id = prefix+r[2];
      return '<dt>'+esc(r[0])+'</dt><dd id="'+id+'">'+esc(r[1])+'</dd><button type="button" class="copy" data-copy="'+id+'">Copy</button>';
    }).join("")+'</dl>';
  }
  function hasPay(){ return !!(pay.payid || (pay.bsb && pay.acct)); }
  function payLine(){ return pay.payid ? "PayID "+pay.payid+(pay.name?" ("+pay.name+")":"") : (pay.bsb && pay.acct ? "BSB "+pay.bsb+", account "+pay.acct+(pay.name?" ("+pay.name+")":"") : ""); }
  function renderPayDetails(){
    if(!hasPay()){ $("payDetails").innerHTML = '<p class="muted">We\'ll send our PayID and bank details when we confirm your order.</p>'; return; }
    $("payDetails").innerHTML = kvHtml(payRows(null),"h")+
      '<p class="muted" style="margin-top:10px">Put your order reference in the payment description.'+(pay.note?" "+esc(pay.note):"")+'</p>';
  }

  // ---- cloud (Supabase) ----
  var sb = null, session = null, role = null, canSave = false, canEdit = false;
  try{
    if(window.supabase && window.supabase.createClient && CFG.supabaseUrl && CFG.supabaseKey)
      sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, {auth:{persistSession:true, autoRefreshToken:true, detectSessionInUrl:true, flowType:"pkce", storageKey:"resinate-auth"}});
  }catch(e){ sb = null; }

  function showMsg(id, kind, text){ var m=$(id); m.hidden=false; m.className="msg "+kind; m.textContent=text; }

  // ---- checkout ----
  $("poCopy").addEventListener("click", function(){
    var text = "Resinate order\nName: "+$("poName").value.trim()+"\nContact: "+$("poContact").value.trim()+"\nCollection: "+$("poPickup").value+"\n"+cartText()+($("poNotes").value.trim()?"\nNotes: "+$("poNotes").value.trim():"");
    copyText(text, $("poCopy"), $("cart"));
  });

  function showPayNow(ref, name, price, paidMethod){
    var box = $("payNow"); box.hidden = false;
    var c = contactLinks();
    var ask = c.length ? '<p class="muted">Questions? '+c.join(" · ")+'</p>' : "";
    var head = '<span class="eyebrow">Order '+esc(ref)+' placed</span>';
    if(paidMethod){
      box.innerHTML = head+'<div class="amount num">'+money(price)+'</div><p><span class="pill ok">Paid · '+esc(paidMethod)+'</span> Thanks, '+esc(name)+'. The order is in the dashboard.</p>';
    } else if(price==null){
      box.innerHTML = head+'<p>Thanks, '+esc(name)+'! We\'ll confirm the final price with you, then you can pay. Keep this reference: <b id="pnRef">'+esc(ref)+'</b> <button type="button" class="copy" data-copy="pnRef">Copy</button></p>'+ask;
    } else {
      box.innerHTML = head+'<p>Thanks, '+esc(name)+'!</p><span class="muted">Amount to pay</span><div class="amount num">'+money(price)+'</div>'+
        (hasPay() ? kvHtml(payRows(ref),"pn")+'<p class="muted">Use the reference in the payment description so we can match it.'+(pay.note?" "+esc(pay.note):"")+'</p>'
                  : '<p>Reference: <b id="pnRef">'+esc(ref)+'</b> <button type="button" class="copy" data-copy="pnRef">Copy</button></p><p class="muted">We\'ll send our payment details when we confirm your order.</p>')+ask;
    }
    if(!paidMethod && ref.indexOf("?")<0) box.innerHTML += '<p class="muted" style="font-size:.9rem">You can check this order anytime under <a href="#track">Track order</a>.</p>';
    box.scrollIntoView({block:"nearest"});
  }

  function offlineOrder(why){
    var c = contactLinks();
    showMsg("poMsg","err", why+" Copy your order and send it to us"+(c.length?"":" or show it at our stall")+", and we'll confirm it.");
    if(c.length){ var m=$("poMsg"); var s=document.createElement("span"); s.innerHTML=" "+c.join(" · "); m.appendChild(s); }
    $("poCopy").hidden = false;
  }

  $("poForm").addEventListener("submit", function(e){
    e.preventDefault();
    var name=$("poName").value.trim(), contact=$("poContact").value.trim();
    if(!cart.length){ showMsg("poMsg","err","Your order is empty. Build a piece and press Add to order first."); return; }
    if(!name || !contact){ showMsg("poMsg","err","Add a name and a way to contact you so we can confirm your order."); (name?$("poContact"):$("poName")).focus(); return; }
    if($("poWebsite").value){ showPayNow("RSN-?????", name, null, ""); return; } // a bot filled the hidden field
    if(!sb || dbState==="missing"){ offlineOrder("Online ordering isn't available right now."); return; }
    var q = quoteCart(cart);
    var fixed = !q.open.length && q.lo===q.hi;
    var paidMethod = canSave ? $("poPaid").value : "";
    if(paidMethod && !fixed){ showMsg("poMsg","err","This order doesn't have a fixed price yet. Save it as not paid, set the price in the dashboard, then record the payment."); return; }
    var pickup = $("poPickup").value;
    $("poSubmit").disabled = true; $("poMsg").hidden = true;
    sb.rpc("resinate_place_order", {p_name:name, p_contact:contact, p_pickup:pickup, p_notes:$("poNotes").value.trim(), p_items:cart}).then(function(res){
      if(res.error) throw res.error;
      var row = Array.isArray(res.data) ? res.data[0] : res.data;
      if(!row || !row.ref) throw new Error("No order reference came back");
      if(!canSave) return {row:row};
      var patch = {source:"team"};
      if(paidMethod && row.price!=null){
        patch.payments = [{amount:row.price, method:paidMethod, at:Date.now()}];
        if(pickup==="Bought at the stall today") patch.status = "Collected";
      }
      return sb.from("resinate_orders").update(patch).eq("ref", row.ref).then(function(u){ return {row:row, patched:!u.error && !!patch.payments}; });
    }).then(function(r){
      if(!canSave && pref("remember", true)) rememberOrder(r.row.ref, contact);
      if(!canSave && session) loadMyOrders();
      showPayNow(r.row.ref, name, r.row.price, r.patched ? paidMethod : "");
      cart = []; saveDraft(); renderCart(); $("added").hidden = true;
      $("poName").value=""; $("poContact").value=""; $("poNotes").value=""; $("poPaid").value="";
      if(canSave) loadOrders();
    }).catch(function(err){
      offlineOrder("Your order didn't go through ("+errText(err)+").");
    }).then(function(){ $("poSubmit").disabled=false; });
  });

  // ---- track an order ----
  var TRACK_STEPS = ["New","Confirmed","Making","Ready","Collected"];
  var TRACK_TEXT = {New:"We've got your order and will confirm it soon.", Confirmed:"Your order is confirmed.", Making:"We're pouring and curing your pieces.", Ready:"Your order is ready to collect!", Collected:"Collected. Enjoy your pieces!", Cancelled:"This order was cancelled. Get in touch if that's a surprise."};
  function myOrders(){ try{ var a = JSON.parse(localStorage.getItem("resinate-mine")||"[]"); return Array.isArray(a) ? a : []; }catch(e){ return []; } }
  function rememberOrder(ref, contact){
    var a = myOrders().filter(function(o){ return o.ref!==ref; }); a.unshift({ref:ref, contact:contact, at:Date.now()});
    try{ localStorage.setItem("resinate-mine", JSON.stringify(a.slice(0,8))); }catch(e){}
    renderRecent();
  }
  function renderRecent(){
    var a = myOrders();
    $("recent").hidden = !a.length;
    $("recentList").innerHTML = a.map(function(o,i){
      return '<button type="button" class="copy" data-recent="'+i+'">'+esc(o.ref)+' · '+esc(new Date(o.at).toLocaleDateString(undefined,{day:"numeric",month:"short"}))+'</button>';
    }).join("");
  }
  $("recentList").addEventListener("click", function(e){
    var b = e.target.closest("[data-recent]"); if(!b) return;
    var o = myOrders()[+b.getAttribute("data-recent")]; if(!o) return;
    $("trRef").value = o.ref; $("trContact").value = o.contact; checkOrder();
  });
  function checkOrder(){
    var ref = $("trRef").value.trim().toUpperCase(), contact = $("trContact").value.trim();
    if(!/^RSN-[A-Z0-9]{5}$/.test(ref)){ showMsg("trMsg","err","References look like RSN-AB12C. You'll find yours on the order confirmation."); return; }
    if(contact.length<3){ showMsg("trMsg","err","Add the phone, email or Instagram you gave when you ordered."); return; }
    if(!sb || dbState==="missing"){ showMsg("trMsg","err","Order tracking isn't available right now. Message us and we'll let you know."); return; }
    $("trBtn").disabled = true; $("trMsg").hidden = true;
    sb.rpc("resinate_order_status", {p_ref:ref, p_contact:contact}).then(function(r){
      if(r.error) throw r.error;
      var o = Array.isArray(r.data) ? r.data[0] : r.data;
      if(!o){ $("trResult").hidden = true; showMsg("trMsg","err","We couldn't find an order with that reference and contact. Check both match what you used when ordering."); return; }
      renderTrack(o);
    }).catch(function(err){ showMsg("trMsg","err","Couldn't check the order ("+errText(err)+")."); })
      .then(function(){ $("trBtn").disabled = false; });
  }
  function renderTrack(o){
    $("trResult").hidden = false;
    $("trResult").innerHTML = trackHtml(o, "tr");
  }
  function trackHtml(o, prefix){
    var idx = TRACK_STEPS.indexOf(o.status);
    var steps = o.status==="Cancelled" ? '<span class="now">Cancelled</span>' : TRACK_STEPS.map(function(st,i){ return '<span class="'+(i<idx?"done":i===idx?"now":"")+'">'+st+'</span>'; }).join("");
    var pieces = (o.items||[]).map(function(it){ return "<li>"+((it.qty||1)>1?esc(it.qty)+" × ":"")+esc(itemSpec(it))+"</li>"; }).join("");
    var owed = o.price!=null ? Math.max(0, o.price-(o.paid||0)) : 0;
    var money_ = o.price==null
      ? '<p>We\'re confirming the price'+(o.low?' (estimate '+esc((o.needs_quote?"from ":"")+range(o.low,o.high))+')':'')+'. We\'ll be in touch before you pay.</p>'
      : '<div class="kv" style="grid-template-columns:auto 1fr"><span class="muted">Total</span><b class="num">'+money(o.price)+'</b><span class="muted">Paid</span><b class="num">'+money(o.paid||0)+'</b>'+(owed>0?'<span class="muted">Left to pay</span><b class="num">'+money(owed)+'</b>':'')+'</div>'+
        (owed>0 && hasPay() && o.status!=="Cancelled" ? kvHtml(payRows(o.ref),prefix+o.ref.replace(/\W/g,""))+'<p class="muted">Use the reference in the payment description. Payments can take a day to show here.</p>' : '')+
        (owed===0 ? '<p><span class="pill ok">Paid in full</span></p>' : '');
    return '<span class="eyebrow">Order '+esc(o.ref)+' · placed '+esc(new Date(o.created_at).toLocaleDateString(undefined,{day:"numeric",month:"short"}))+'</span>'+
      '<div class="track">'+steps+'</div><p>'+esc(TRACK_TEXT[o.status]||"")+'</p><ul style="margin:0;padding-left:1.1em">'+pieces+'</ul>'+money_;
  }
  $("trackForm").addEventListener("submit", function(e){ e.preventDefault(); checkOrder(); });
  renderRecent();

  // ---- back from an emailed sign-in link: finish signing in, or say why it didn't work ----
  (function(){
    var q = new URLSearchParams(location.search), h = new URLSearchParams(location.hash.slice(1));
    var errDesc = q.get("error_description") || h.get("error_description");
    var errCode = q.get("error_code") || h.get("error_code") || "";
    if(!q.has("code") && !errDesc) return;
    var hadVerifier = false; try{ for(var i=0;i<localStorage.length;i++) if(/^resinate-auth.*code-verifier$/.test(localStorage.key(i))) hadVerifier = true; }catch(e){}
    function tidy(hash){ setTimeout(function(){ history.replaceState(null, "", location.pathname+hash); applyView(); }, 0); }
    function failed(text){ tidy("#signin"); setTimeout(function(){ showMsg("siMsg","err",text); }, 0); }
    if(errDesc){
      failed(/expired|invalid|not found/i.test(errCode+" "+errDesc)
        ? "That sign-in link has already been used or has expired. Each link works once: send yourself a new one below."
        : "That sign-in link didn't work ("+errDesc.replace(/\+/g," ")+"). Send yourself a new one below.");
      return;
    }
    if(!sb){ failed("Sign-in isn't available right now. Please try again later."); return; }
    sb.auth.initialize().then(function(r){ return r && r.error ? r : sb.auth.getSession(); }).then(function(r){
      if(r && r.data && r.data.session){ tidy("#profile"); return; }
      var msg = r && r.error ? (r.error.message||"") : "";
      failed(/verifier/i.test(msg) || (!msg && !hadVerifier)
        ? "Open the sign-in link in the same browser you asked for it in (emails often open in a different app). Or send a new link and type the code from the email here."
        : "That sign-in link didn't work"+(msg?" ("+msg+")":"")+". It may have been used already: send yourself a new one below.");
    }).catch(function(err){ failed("That sign-in link didn't work ("+errText(err)+"). Send yourself a new one below."); });
  })();

  // ---- views ----
  var PAGES = {"#dashboard":"dashboard", "#profile":"profile", "#settings":"settings", "#signin":"signin", "#policies":"policies"};
  function applyView(){
    var view = PAGES[location.hash] || "shop";
    if(view==="signin" && session) { location.replace("#profile"); return; }
    document.body.setAttribute("data-view", view);
    $("dashLink").setAttribute("aria-current", view==="dashboard"?"page":"false");
    if(view!=="shop") scrollTo(0,0);
    if(view==="dashboard" && canSave) loadOrders();
    if(view==="profile" && session) loadMyOrders();
    if(view==="signin") setTimeout(function(){ if(!$("siEmailForm").hidden) $("siEmail").focus(); }, 30);
    syncCartBar();
  }
  addEventListener("hashchange", function(){
    var was = document.body.getAttribute("data-view");
    applyView();
    if(was!=="shop" && !PAGES[location.hash]){ var t=document.querySelector(location.hash||"#top"); if(t) t.scrollIntoView(); }
  });

  function applyAccess(){
    $("poSubmit").textContent = canSave ? "Save order" : "Place order";
    $("dashLink").hidden = !canSave;
    document.querySelectorAll(".team-only").forEach(function(el){ el.hidden = !canSave; });
    document.querySelectorAll(".team-opt").forEach(function(el){ el.hidden = !canSave; el.disabled = !canSave; });
    if(!canSave && $("poPickup").selectedOptions[0] && $("poPickup").selectedOptions[0].disabled) $("poPickup").selectedIndex = 0;
    var signedIn = !!session;
    var em = signedIn ? (session.user && session.user.email || "").toLowerCase() : "";
    $("dashOut").hidden = signedIn || !sb;
    $("noCloud").hidden = !!sb;
    $("notStaff").hidden = !(signedIn && !canSave && dbState!=="missing");
    $("setupBox").hidden = dbState!=="missing";
    $("nsEmail").textContent = em;
    $("dashBody").hidden = !canSave;
    $("whoBox").hidden = !signedIn;
    $("whoami").textContent = signedIn ? em + (role ? " · "+role : "") : "";
    renderAccount();
    $("settingsSec").hidden = !canEdit;
    $("pricesSec").hidden = !canEdit;
    $("designsSec").hidden = !canEdit;
    $("upForm").hidden = !canEdit;
    renderGallery(); renderStart();
  }

  // ---- team sign-in ----
  var siEmail = "";
  $("siEmailForm").addEventListener("submit", function(e){
    e.preventDefault();
    var em = $("siEmail").value.trim().toLowerCase();
    if(!/^\S+@\S+\.\S+$/.test(em)){ showMsg("siMsg","err","Enter your email address, like you@example.com."); return; }
    $("siSend").disabled = true;
    sb.auth.signInWithOtp({email:em, options:{shouldCreateUser:true, emailRedirectTo:location.origin+location.pathname}}).then(function(r){
      if(r.error) throw r.error;
      siEmail = em; $("siEmailForm").hidden = true; $("siCodeForm").hidden = false;
      showMsg("siMsg","ok","We emailed a sign-in link to "+em+". It can take a minute; check your spam folder too.");
      setTimeout(function(){ $("siCode").focus(); }, 30);
    }).catch(function(err){ showMsg("siMsg","err","Couldn't send the sign-in email ("+errText(err)+")."); })
      .then(function(){ $("siSend").disabled = false; });
  });
  $("siCodeForm").addEventListener("submit", function(e){
    e.preventDefault();
    var code = $("siCode").value.replace(/\D/g,"");
    if(code.length<6){ showMsg("siMsg","err","Enter the code from the email."); return; }
    $("siVerify").disabled = true;
    sb.auth.verifyOtp({email:siEmail, token:code, type:"email"}).then(function(r){
      if(r.error) throw r.error;
      $("siMsg").hidden = true; $("siCode").value = "";
    }).catch(function(err){ showMsg("siMsg","err","That code didn't work ("+errText(err)+"). Check it, or send a new one."); })
      .then(function(){ $("siVerify").disabled = false; });
  });
  $("siBack").addEventListener("click", function(){ $("siCodeForm").hidden = true; $("siEmailForm").hidden = false; $("siMsg").hidden = true; });
  function signOut(){ if(sb) sb.auth.signOut().then(function(){ toast("Signed out"); }); }
  $("signOut").addEventListener("click", signOut);

  function afterAuth(){
    var ask = session ? sb.rpc("resinate_my_role") : Promise.resolve({data:null});
    return Promise.resolve(ask).then(function(r){
      if(r && r.error && isMissing(r.error)) dbState = "missing";
      role = (r && !r.error) ? r.data : null;
    }, function(){ role = null; }).then(function(){
      canSave = role==="maker"; canEdit = canSave;
      if(!canSave){ orders = []; }
      applyAccess(); fillSettings(); fillPrices();
      loadProfile();
      renderOwnBox();
      if(session){ $("siCodeForm").hidden = true; $("siEmailForm").hidden = false; $("siMsg").hidden = true; }
      if(session && document.body.getAttribute("data-view")==="signin") location.replace("#profile");
      liveOrders(canSave);
      if(canSave){ loadOrders(); loadMessages(); } else { messages = []; renderMessages(); }
    });
  }

  var redrawHero = null;
  // ---- device preferences (Settings) ----
  function pref(k, dflt){ try{ var v = localStorage.getItem("resinate-pref-"+k); return v===null ? dflt : v==="1"; }catch(e){ return dflt; } }
  function setPref(k, v){ try{ localStorage.setItem("resinate-pref-"+k, v?"1":"0"); }catch(e){} }
  function currentTheme(){ try{ return localStorage.getItem("resinate-theme") || "system"; }catch(e){ return "system"; } }
  function applyTheme(t){
    if(t==="light"||t==="dark") document.documentElement.setAttribute("data-theme", t); else document.documentElement.removeAttribute("data-theme");
    try{ if(t==="system") localStorage.removeItem("resinate-theme"); else localStorage.setItem("resinate-theme", t); }catch(e){}
    if(typeof redrawHero==="function") redrawHero();
  }
  $("th"+{system:"System",light:"Light",dark:"Dark"}[currentTheme()]).checked = true;
  document.querySelectorAll('input[name="theme"]').forEach(function(r){ r.addEventListener("change", function(){ applyTheme(this.value); toast("Theme: "+this.value); }); });
  $("stCalm").checked = pref("calm", false);
  $("stCalm").addEventListener("change", function(){ setPref("calm", this.checked); if(typeof redrawHero==="function") redrawHero(); });
  $("stPrefill").checked = pref("prefill", true);
  $("stPrefill").addEventListener("change", function(){ setPref("prefill", this.checked); prefillCheckout(); });
  $("stRemember").checked = pref("remember", true);
  $("stRemember").addEventListener("change", function(){ setPref("remember", this.checked); });
  $("stClear").addEventListener("click", function(){
    try{ localStorage.removeItem("resinate-draft"); localStorage.removeItem("resinate-mine"); }catch(e){}
    cart = []; renderCart(); renderRecent(); $("added").hidden = true;
    toast("This device is cleared");
  });

  // ---- your account ----
  var profile = null;
  function initialOf(){ var n = (profile && profile.display_name) || (session && session.user && session.user.email) || "?"; return n.trim().charAt(0).toUpperCase(); }
  function avatarUrl(){
    if(!sb || !profile || !profile.avatar_path) return "";
    return sb.storage.from("resinate").getPublicUrl(profile.avatar_path).data.publicUrl + "?v=" + Date.parse(profile.updated_at||0);
  }
  function paintAvatar(el){
    var url = avatarUrl();
    el.style.backgroundImage = url ? 'url("'+url+'")' : "";
    el.textContent = url ? "" : initialOf();
  }
  function renderAccount(){
    var signedIn = !!session;
    var btn = $("acctBtn");
    btn.classList.toggle("out", !signedIn);
    btn.href = signedIn ? "#profile" : "#signin";
    $("acctName").textContent = signedIn ? ((profile && profile.display_name) || "Your account") : "Sign in";
    if(signedIn) paintAvatar($("acctAvatar"));
    // profile page
    $("pfOut").hidden = signedIn; $("pfIn").hidden = !signedIn;
    if(signedIn){
      paintAvatar($("pfAvatar"));
      $("pfName").textContent = (profile && profile.display_name) || "Your profile";
      $("pfRole").textContent = role==="maker" ? "Maker" : "Customer";
      $("pfRole").className = "rolepill"+(role==="maker"?" maker":"");
      $("pfSince").textContent = profile && profile.created_at ? "Member since "+new Date(profile.created_at).toLocaleDateString(undefined,{month:"long",year:"numeric"}) : "";
      $("pfDash").hidden = role!=="maker";
      $("pfEmail").value = session.user && session.user.email || "";
      $("pfPhotoRm").hidden = !(profile && profile.avatar_path);
      if(profile && !$("pfForm").contains(document.activeElement)){ $("pfDisplay").value = profile.display_name||""; $("pfContact").value = profile.contact||""; }
    }
    // settings page
    $("stOut").hidden = signedIn; $("stIn").hidden = !signedIn;
    $("stMaker").hidden = role!=="maker";
    if(signedIn){
      $("stEmail").textContent = session.user && session.user.email || "";
      $("stRoleTxt").textContent = role==="maker" ? "Maker account: you can open the dashboard." : "Customer account.";
    }
    prefillCheckout();
  }
  function prefillCheckout(){
    if(!profile || canSave || !pref("prefill", true)) return;
    if(!$("mgName").value && profile.display_name) $("mgName").value = profile.display_name;
    if(!$("mgContact").value && profile.contact) $("mgContact").value = profile.contact;
    if(!$("poName").value && profile.display_name) $("poName").value = profile.display_name;
    if(!$("poContact").value && profile.contact) $("poContact").value = profile.contact;
    if(!$("trContact").value && profile.contact) $("trContact").value = profile.contact;
  }
  function loadProfile(){
    if(!sb || !session){ profile = null; renderAccount(); return; }
    sb.from("resinate_profiles").select("*").eq("id", session.user.id).maybeSingle().then(function(r){
      profile = (r && !r.error) ? r.data : null;
      renderAccount();
    });
  }
  $("pfForm").addEventListener("submit", function(e){
    e.preventDefault();
    var patch = {display_name:$("pfDisplay").value.trim().slice(0,80), contact:$("pfContact").value.trim().slice(0,200), updated_at:new Date().toISOString()};
    $("pfSave").disabled = true;
    sb.from("resinate_profiles").update(patch).eq("id", session.user.id).select().maybeSingle().then(function(r){
      if(r.error) throw r.error;
      profile = r.data || Object.assign({}, profile, patch); renderAccount();
      showMsg("pfMsg","ok","Saved.");
    }).catch(function(err){ showMsg("pfMsg","err","Didn't save ("+errText(err)+")."); })
      .then(function(){ $("pfSave").disabled = false; });
  });
  // profile photo: cropped to a 256px square on the device, then uploaded over the old one
  function squareJpeg(file){
    return new Promise(function(resolve, reject){
      var img = new Image(), url = URL.createObjectURL(file);
      img.onload = function(){
        var side = Math.min(img.naturalWidth, img.naturalHeight), c = document.createElement("canvas");
        c.width = c.height = 256;
        c.getContext("2d").drawImage(img, (img.naturalWidth-side)/2, (img.naturalHeight-side)/2, side, side, 0, 0, 256, 256);
        URL.revokeObjectURL(url);
        c.toBlob(function(b){ b ? resolve(b) : reject(new Error("Couldn't read that image")); }, "image/jpeg", 0.88);
      };
      img.onerror = function(){ URL.revokeObjectURL(url); reject(new Error("That file isn't an image this browser can open")); };
      img.src = url;
    });
  }
  $("pfPhoto").addEventListener("change", function(){
    var f = this.files[0]; if(!f) return;
    var path = "avatars/"+session.user.id+"/avatar.jpg";
    showMsg("pfMsg","ok","Uploading your photo…");
    squareJpeg(f).then(function(blob){
      return sb.storage.from("resinate").upload(path, blob, {contentType:"image/jpeg", upsert:true});
    }).then(function(r){
      if(r.error) throw r.error;
      return sb.from("resinate_profiles").update({avatar_path:path, updated_at:new Date().toISOString()}).eq("id", session.user.id).select().maybeSingle();
    }).then(function(r){
      if(r.error) throw r.error;
      profile = r.data; renderAccount(); showMsg("pfMsg","ok","Photo updated."); $("pfPhoto").value = "";
    }).catch(function(err){ showMsg("pfMsg","err","Photo didn't upload ("+errText(err)+")."); });
  });
  $("pfPhotoRm").addEventListener("click", function(){
    if(!profile || !profile.avatar_path) return;
    var path = profile.avatar_path;
    sb.storage.from("resinate").remove([path]).then(function(){
      return sb.from("resinate_profiles").update({avatar_path:null, updated_at:new Date().toISOString()}).eq("id", session.user.id).select().maybeSingle();
    }).then(function(r){ if(r.error) throw r.error; profile = r.data; renderAccount(); toast("Photo removed"); })
      .catch(function(err){ toast("Couldn't remove it ("+errText(err)+")."); });
  });
  // your orders
  function loadMyOrders(){
    if(!sb || !session) return;
    sb.from("resinate_orders").select("ref,created_at,status,items,price,low,high,needs_quote,payments").eq("customer_id", session.user.id).order("created_at",{ascending:false}).then(function(r){
      if(r.error){ $("pfOrders").innerHTML = '<div class="empty">Your orders couldn\'t load ('+esc(errText(r.error))+').</div>'; return; }
      if(!r.data.length){ $("pfOrders").innerHTML = '<div class="empty">No orders yet. Orders you place while signed in show up here with their progress.</div>'; return; }
      $("pfOrders").innerHTML = r.data.map(function(o){ o.paid = paidOf(o); return '<div class="myorder">'+trackHtml(o, "my")+'</div>'; }).join("");
    });
  }
  // settings: account actions
  $("stSignOut").addEventListener("click", signOut);
  $("stSignOutAll").addEventListener("click", function(){ sb.auth.signOut({scope:"global"}).then(function(){ toast("Signed out on every device"); }); });
  $("stDelAsk").addEventListener("click", function(){ $("stDelBox").hidden = false; $("stDelWord").focus(); });
  $("stDelNo").addEventListener("click", function(){ $("stDelBox").hidden = true; $("stDelWord").value = ""; });
  $("stDelGo").addEventListener("click", function(){
    if($("stDelWord").value.trim().toUpperCase()!=="DELETE"){ toast("Type DELETE in the box to confirm."); return; }
    var btn = this; btn.disabled = true;
    var rm = (profile && profile.avatar_path) ? sb.storage.from("resinate").remove([profile.avatar_path]) : Promise.resolve();
    rm.then(function(){ return sb.rpc("resinate_delete_me"); }).then(function(r){
      if(r && r.error) throw r.error;
      return sb.auth.signOut({scope:"local"});
    }).then(function(){ $("stDelBox").hidden = true; $("stDelWord").value = ""; toast("Your account is deleted"); location.hash = "top"; })
      .catch(function(err){ toast("Couldn't delete the account ("+errText(err)+")."); })
      .then(function(){ btn.disabled = false; });
  });

  // ---- connection state ----
  var dbState = "unknown"; // "ok" once the Resinate tables answer, "missing" when the project has no Resinate tables
  function isMissing(err){
    var c = err && err.code || "", m = err && err.message || "";
    return c==="PGRST205" || c==="PGRST202" || c==="42P01" || c==="42883" || /schema cache|does not exist|Could not find/i.test(m);
  }
  (function(){
    var m = /^https:\/\/([a-z0-9]+)\.supabase\.co/i.exec(CFG.supabaseUrl||"");
    var ref = m ? m[1] : "";
    $("projRef").textContent = ref || (CFG.supabaseUrl || "none set");
    var link = ref ? "https://supabase.com/dashboard/project/"+ref+"/sql/new" : "https://supabase.com/dashboard";
    $("sqlEditorLink").href = link;
  })();
  var setupSql = null;
  $("copySetupSql").addEventListener("click", function(){
    var btn = this;
    (setupSql ? Promise.resolve(setupSql) : fetch("supabase/setup.sql").then(function(r){ if(!r.ok) throw new Error(r.status); return r.text(); }))
      .then(function(t){ setupSql = t; copyText(t, btn, null); })
      .catch(function(){ toast("Couldn't load the SQL here. Open supabase/setup.sql on GitHub and copy it from there."); });
  });

  // ---- live updates: new and changed orders arrive without reloading ----
  var channel = null, liveTimer = null;
  function liveOrders(on){
    if(!sb) return;
    if(!on){ if(channel){ sb.removeChannel(channel); channel = null; } return; }
    if(channel) return;
    channel = sb.channel("resinate-orders").on("postgres_changes", {event:"*", schema:"public", table:"resinate_orders"}, function(payload){
      if(payload.eventType==="INSERT" && payload.new && payload.new.name) toast("New order from "+payload.new.name+" ("+payload.new.ref+")");
      clearTimeout(liveTimer); liveTimer = setTimeout(loadOrders, 400);
    }).on("postgres_changes", {event:"*", schema:"public", table:"resinate_messages"}, function(payload){
      if(payload.eventType==="INSERT" && payload.new && payload.new.name) toast("New message from "+payload.new.name);
      clearTimeout(msgTimer); msgTimer = setTimeout(loadMessages, 400);
    }).subscribe();
  }

  // ---- messages from the "Message us" form ----
  var messages = [], msgTimer = null, confirmMsgDel = null;
  function loadMessages(){
    if(!sb || !canSave) return;
    sb.from("resinate_messages").select("*").order("created_at",{ascending:false}).limit(200).then(function(r){
      if(r.error){ $("msgList").innerHTML = '<div class="empty">Couldn\'t load messages ('+esc(errText(r.error))+').</div>'; return; }
      messages = r.data || []; renderMessages();
    });
  }
  function replyHref(m){
    var c = String(m.contact||"").trim(), sub = "Resinate"+(m.order_ref?" order "+m.order_ref:"");
    if(/^\S+@\S+\.\S+$/.test(c)) return "mailto:"+encodeURIComponent(c)+"?subject="+encodeURIComponent("Re: your message to "+sub)+"&body="+encodeURIComponent("Hi "+String(m.name||"").split(" ")[0]+",\n\n");
    var digits = c.replace(/[^0-9+]/g,"");
    if(digits.length>=8 && /^[0-9+ ()-]+$/.test(c)) return "sms:"+digits;
    if(/^@?[A-Za-z0-9._]{2,30}$/.test(c)) return "https://instagram.com/"+encodeURIComponent(c.replace(/^@/,""));
    return "";
  }
  function renderMessages(){
    var fresh = messages.filter(function(m){ return m.status==="New"; }).length;
    $("msgCount").hidden = !fresh; $("msgCount").textContent = fresh;
    $("dashBadge").hidden = !fresh; $("dashBadge").textContent = fresh;
    var f = $("msgFilter").value;
    var list = messages.filter(function(m){ return f==="all" || (f==="open" ? m.status!=="Done" : m.status===f); });
    if(!list.length){ $("msgList").innerHTML = '<div class="empty">'+(messages.length?"No messages match.":"No messages yet. Messages sent from the site's Message us form show up here.")+'</div>'; return; }
    $("msgList").innerHTML = list.map(function(m){
      var id = esc(m.id), when = new Date(m.created_at).toLocaleString(undefined,{day:"numeric",month:"short",hour:"numeric",minute:"2-digit"});
      var href = replyHref(m);
      return '<div class="msg" data-s="'+esc(m.status)+'"><div class="top"><span><b>'+esc(m.name)+'</b> <span class="spec">· '+esc(m.contact)+(m.order_ref?' · '+esc(m.order_ref):'')+'</span></span><span class="spec">'+esc(when)+' · '+esc(m.status)+'</span></div>'+
        '<div class="body">'+esc(m.body)+'</div><div class="acts">'+
        (href?'<a class="btn small" href="'+esc(href)+'" target="_blank" rel="noopener">Reply</a>':'')+
        '<button type="button" class="btn small ghost" data-copyc="'+id+'">Copy contact</button>'+
        '<select data-mstatus="'+id+'" aria-label="Status of message from '+esc(m.name)+'">'+["New","Replied","Done"].map(function(s){ return '<option'+(s===m.status?" selected":"")+'>'+s+'</option>'; }).join("")+'</select>'+
        (confirmMsgDel===m.id ? '<span class="spec">Delete for good?</span><button class="btn small danger" type="button" data-mdel="'+id+'">Delete</button><button class="btn small ghost" type="button" data-mkeep="1">Keep</button>'
          : '<button class="btn small ghost" type="button" data-mask="'+id+'">Delete</button>')+
        '</div></div>';
    }).join("");
  }
  $("msgFilter").addEventListener("change", renderMessages);
  $("msgList").addEventListener("change", function(e){
    var id = e.target.getAttribute("data-mstatus"); if(!id) return;
    var st = e.target.value;
    sb.from("resinate_messages").update({status:st}).eq("id", id).then(function(r){
      if(r.error){ toast("Didn't save ("+errText(r.error)+")"); return; }
      messages.forEach(function(m){ if(m.id===id) m.status = st; }); renderMessages();
    });
  });
  $("msgList").addEventListener("click", function(e){
    var b;
    if((b = e.target.closest("[data-copyc]"))){
      var m = messages.filter(function(x){ return x.id===b.getAttribute("data-copyc"); })[0];
      if(m && navigator.clipboard) navigator.clipboard.writeText(m.contact).then(function(){ toast("Contact copied"); });
    } else if((b = e.target.closest("[data-mask]"))){ confirmMsgDel = b.getAttribute("data-mask"); renderMessages(); }
    else if(e.target.closest("[data-mkeep]")){ confirmMsgDel = null; renderMessages(); }
    else if((b = e.target.closest("[data-mdel]"))){
      var id = b.getAttribute("data-mdel");
      sb.from("resinate_messages").delete().eq("id", id).then(function(r){
        if(r.error){ toast("Didn't delete ("+errText(r.error)+")"); return; }
        confirmMsgDel = null; messages = messages.filter(function(m){ return m.id!==id; }); renderMessages();
      });
    }
  });
  $("msgForm").addEventListener("submit", function(e){
    e.preventDefault();
    if($("mgWebsite").value) return; // a bot filled the hidden field
    var name = $("mgName").value.trim(), contact = $("mgContact").value.trim(), body = $("mgBody").value.trim();
    if(!name){ showMsg("mgMsg","err","Add your name."); $("mgName").focus(); return; }
    if(contact.length<3){ showMsg("mgMsg","err","Add a phone number, email or Instagram so we can reply."); $("mgContact").focus(); return; }
    if(!body){ showMsg("mgMsg","err","Write your message."); $("mgBody").focus(); return; }
    if(!sb){ showMsg("mgMsg","err","Messages can't be sent right now. Please call or email us instead."); return; }
    $("mgSend").disabled = true;
    sb.rpc("resinate_send_message", {p_name:name, p_contact:contact, p_ref:$("mgRef").value.trim(), p_body:body}).then(function(r){
      if(r.error) throw r.error;
      $("mgBody").value = ""; $("mgRef").value = "";
      showMsg("mgMsg","ok","Thanks! Your message is with the team, and we'll reply to "+contact+".");
    }).catch(function(err){ showMsg("mgMsg","err","Your message didn't send ("+errText(err)+"). Please try again, or call us."); })
      .then(function(){ $("mgSend").disabled = false; });
  });

  // ---- getting started checklist (makers) ----
  function renderStart(){
    if(!canEdit){ $("startBox").hidden = true; return; }
    var hidden = false; try{ hidden = localStorage.getItem("resinate-start-hidden")==="1"; }catch(e){}
    var items = [
      [true, "Database connected and you're a maker"],
      [hasPay(), "Add your PayID or bank details under Payment details, so customers can pay"],
      [photos.length>0, "Upload a photo of a finished piece for the Our work gallery"],
      [contactLinks().length>0, "Put your Instagram, email or phone in resinate/config.js so customers can reach you"]
    ];
    var left = items.filter(function(x){ return !x[0]; }).length;
    $("startBox").hidden = hidden || !left;
    $("startList").innerHTML = items.map(function(x){ return '<li class="'+(x[0]?"ok":"")+'"><span>'+esc(x[1])+'</span></li>'; }).join("");
  }
  $("startHide").addEventListener("click", function(){ try{ localStorage.setItem("resinate-start-hidden","1"); }catch(e){} $("startBox").hidden = true; });


  // ---- dashboard data ----
  var orders = [];
  var confirmDel = null;
  function fromRow(r){ var o = Object.assign({}, r); o.id = r.ref; o.createdAt = Date.parse(r.created_at); o.needsQuote = r.needs_quote; return o; }
  var loading = null;
  function loadOrders(){
    if(!sb || !canSave) return Promise.resolve();
    if(loading) return loading;
    loading = sb.from("resinate_orders").select("*").order("created_at",{ascending:false}).limit(2000).then(function(r){
      loading = null;
      if(r.error){ $("orders").innerHTML = '<div class="empty">Orders couldn\'t load ('+esc(errText(r.error))+'). If this is a new setup, run supabase/setup.sql in Supabase.</div>'; return; }
      orders = r.data.map(fromRow);
      $("lastSync").textContent = "Updated "+new Date().toLocaleTimeString(undefined,{hour:"numeric",minute:"2-digit"});
      renderDash();
    }, function(){ loading = null; });
    return loading;
  }
  setInterval(function(){ if(canSave && document.body.getAttribute("data-view")==="dashboard" && !document.hidden && !$("orders").contains(document.activeElement)) loadOrders(); }, 60000);
  $("refreshBtn").addEventListener("click", function(){ loadOrders().then(function(){ toast("Orders up to date"); }); });

  function itemsOf(o){ return Array.isArray(o.items) ? o.items : []; }
  function paidOf(o){ return (o.payments||[]).reduce(function(a,p){return a+(p.amount||0)},0); }
  function owedOf(o){ return o.price!=null ? Math.max(0,o.price-paidOf(o)) : 0; }
  function payState(o){
    if(o.status==="Cancelled") return {k:"mute", t:"Cancelled"};
    if(o.price==null) return {k:"mute", t:"Needs price"};
    var p = paidOf(o);
    if(p>=o.price) return {k:"ok", t:"Paid"};
    if(p>0) return {k:"warn", t:"Part paid"};
    return {k:"bad", t:"Unpaid"};
  }
  function isOpen(o){ return o.status!=="Collected" && o.status!=="Cancelled"; }
  function orderSpec(o){ return itemsOf(o).map(function(it){ return ((it.qty||1)>1?(it.qty)+" × ":"")+itemSpec(it); }).join("; "); }

  function renderDash(){
    var live = orders.filter(function(o){return o.status!=="Cancelled"});
    var received = 0, owed = 0;
    live.forEach(function(o){ received+=paidOf(o); owed+=owedOf(o); });
    $("kPaid").textContent = money(received);
    $("kOwed").textContent = money(owed);
    $("kOpen").textContent = orders.filter(isOpen).length;
    $("kQuote").textContent = orders.filter(function(o){return isOpen(o) && o.price==null}).length;
    drawWeeks(); drawSizes(live); renderToMake();
    renderOrders();
  }

  function renderToMake(){
    var c = {S:0,M:0,L:0,XL:0,print:0,sparkle:0,led:0,custom:0};
    orders.forEach(function(o){
      if(["New","Confirmed","Making"].indexOf(o.status)<0) return;
      itemsOf(o).forEach(function(it){ var n=it.qty||1; c[it.size]=(c[it.size]||0)+n; if(it.print) c.print+=n; if(it.sparkle) c.sparkle+=n; if(it.led) c.led+=n; if(it.custom) c.custom+=n; });
    });
    $("makegrid").innerHTML = [["S","Small"],["M","Medium"],["L","Large"],["XL","XL"],["print","Own designs"],["sparkle","With sparkle"],["led","LEDs"],["custom","Custom inclusions"]].map(function(x){
      return '<div><b>'+c[x[0]]+'</b><span>'+x[1]+'</span></div>';
    }).join("");
  }

  function messageFor(o){
    var first = String(o.name||"").split(" ")[0] || "there";
    var owed = owedOf(o), ref = o.ref;
    if(o.status==="Ready") return "Hi "+first+", your Resinate order "+ref+" is ready to collect!"+(owed>0?" There's "+money(owed)+" left to pay"+(payLine()?" to "+payLine()+" with reference "+ref:"")+".":"")+" Thanks!";
    if(o.price==null) return "Hi "+first+", thanks for your Resinate order ("+ref+": "+orderSpec(o)+"). We'll confirm the final price soon, then send payment details.";
    if(owed>0) return "Hi "+first+", thanks for your Resinate order ("+ref+": "+orderSpec(o)+"). The total is "+money(o.price)+(paidOf(o)>0?", with "+money(owed)+" still to pay":"")+"."+(payLine()?" Please pay to "+payLine()+" and use "+ref+" as the reference.":"")+(pay.note?" "+pay.note:"");
    return "Hi "+first+", we've received your payment for Resinate order "+ref+". Thank you! We'll let you know when it's ready.";
  }

  function renderOrders(){
    var f = $("filter").value, q = $("search").value.trim().toLowerCase();
    var list = orders.filter(function(o){
      var ps = payState(o).t;
      if(f==="open" && !isOpen(o)) return false;
      if(f==="unpaid" && !(ps==="Unpaid"||ps==="Part paid")) return false;
      if(f==="quote" && !(isOpen(o) && o.price==null)) return false;
      if(f==="paid" && ps!=="Paid") return false;
      if((f==="Ready"||f==="Collected"||f==="Cancelled") && o.status!==f) return false;
      if(q && (String(o.name)+" "+String(o.ref)+" "+String(o.contact)).toLowerCase().indexOf(q)<0) return false;
      return true;
    });
    if(!list.length){
      $("orders").innerHTML = '<div class="empty">'+(orders.length?"No orders match this filter.":"No orders yet. Orders placed on the shop, by customers or by the team, show up here.")+'</div>';
      return;
    }
    $("orders").innerHTML = list.map(function(o){
      var id = esc(o.id), ps = payState(o), paid = paidOf(o), owe = owedOf(o);
      var when = o.createdAt ? new Date(o.createdAt).toLocaleDateString(undefined,{day:"numeric",month:"short"}) : "";
      var priceLine = o.price!=null ? '<b>'+money(o.price)+'</b>' : '<b class="muted">'+esc((o.needsQuote?"from ":"")+range(o.low||0,o.high||0))+'</b>';
      var hist = (o.payments||[]).map(function(p){ return money(p.amount)+" "+esc(p.method)+(p.at?" on "+new Date(p.at).toLocaleDateString(undefined,{day:"numeric",month:"short"}):""); }).join(" · ");
      return '<div class="order" data-s="'+esc(o.status)+'">'+
        '<div style="min-width:0"><div class="ref">'+id+(when?' · '+when:'')+' · '+esc(o.status)+(o.source==="online"?' · online':'')+'</div>'+
        '<div class="who">'+esc(o.name)+' <span class="spec">· '+esc(o.contact)+'</span></div>'+
        '<div class="spec">'+esc(orderSpec(o))+'</div>'+
        itemsOf(o).filter(function(it){ return it.art && ART_RE.test(it.art); }).map(function(it){ return '<a class="artlink" href="'+esc(photoUrl(it.art))+'" target="_blank" rel="noopener"><img src="'+esc(photoUrl(it.art))+'" alt="Customer picture" loading="lazy"> Open picture</a>'; }).join("")+
        (o.notes?'<div class="spec">Notes: '+esc(o.notes)+'</div>':'')+
        '<div class="spec">'+esc(o.pickup||"")+'</div></div>'+
        '<div class="money">'+priceLine+'<span class="pill '+ps.k+'">'+ps.t+'</span>'+(paid?'<span class="spec">'+money(paid)+' paid</span>':'')+'</div>'+
        (hist?'<div class="hist">Payments: '+hist+'</div>':'')+
        '<div class="acts">'+
          '<label class="spec" for="st-'+id+'">Status</label><select id="st-'+id+'" data-status="'+id+'">'+
            STATUSES.map(function(s){return '<option'+(s===o.status?" selected":"")+'>'+s+'</option>'}).join("")+'</select>'+
          '<label class="spec" for="pr-'+id+'">Price $</label><input type="text" inputmode="decimal" id="pr-'+id+'" value="'+(o.price!=null?(o.price/100).toFixed(2):"")+'" placeholder="set"><button class="btn small ghost" data-price="'+id+'">Set price</button>'+
          (o.price!=null && owe>0 && o.status!=="Cancelled" ?
            '<label class="spec" for="pa-'+id+'">Payment $</label><input type="text" inputmode="decimal" id="pa-'+id+'" value="'+(owe/100).toFixed(2)+'">'+
            '<select id="pm-'+id+'" aria-label="Payment method">'+METHODS.map(function(m){return '<option>'+m+'</option>'}).join("")+'</select>'+
            '<button class="btn small" data-pay="'+id+'">Record payment</button>' : '')+
          '<button class="btn small ghost" data-msg="'+id+'">Copy message to customer</button>'+
          (confirmDel===o.id
            ? '<span class="spec">Delete this order for good?</span><button class="btn small danger" data-del="'+id+'">Delete</button><button class="btn small ghost" data-cancel="1">Keep</button>'
            : '<button class="btn small ghost" data-ask="'+id+'">Delete</button>')+
        '</div></div>';
    }).join("");
  }
  $("filter").addEventListener("change", renderOrders);
  $("search").addEventListener("input", renderOrders);

  function byId(id){ return orders.filter(function(o){return o.id===id})[0]; }
  function patchOrder(id, patch, okText, what){
    return sb.from("resinate_orders").update(patch).eq("ref", id).then(function(r){
      if(r.error) throw r.error;
      toast(okText); return loadOrders();
    }).catch(function(err){ toast(what+" didn't save ("+errText(err)+")."); });
  }

  $("orders").addEventListener("change", function(e){
    var id = e.target.getAttribute("data-status");
    if(id) patchOrder(id, {status:e.target.value}, "Status updated", "Status");
  });
  $("orders").addEventListener("click", function(e){
    var t = e.target.closest("button"); if(!t) return;
    var id;
    if((id = t.getAttribute("data-price"))){
      var c = cents($("pr-"+id).value);
      if(!(c>0)){ toast("Enter the agreed price in dollars, like 14.99."); return; }
      patchOrder(id, {price:c}, "Price set to "+money(c), "Price");
    } else if((id = t.getAttribute("data-pay"))){
      var amt = cents($("pa-"+id).value), o = byId(id);
      if(!(amt>0)){ toast("Enter the payment amount in dollars."); return; }
      var pays = (o.payments||[]).slice(); pays.push({amount:amt, method:$("pm-"+id).value, at:Date.now()});
      t.disabled = true;
      patchOrder(id, {payments:pays}, money(amt)+" recorded", "Payment");
    } else if((id = t.getAttribute("data-msg"))){
      copyText(messageFor(byId(id)), t, null);
    } else if((id = t.getAttribute("data-ask"))){ confirmDel = id; renderOrders(); }
    else if(t.getAttribute("data-cancel")){ confirmDel = null; renderOrders(); }
    else if((id = t.getAttribute("data-del"))){
      confirmDel = null;
      sb.from("resinate_orders").delete().eq("ref", id).then(function(r){ if(r.error) throw r.error; toast("Order deleted"); return loadOrders(); })
        .catch(function(err){ toast("Couldn't delete ("+errText(err)+")."); });
    }
  });

  // ---- export ----
  function csvCell(v){ v = String(v==null?"":v); return /[",\n]/.test(v) ? '"'+v.replace(/"/g,'""')+'"' : v; }
  $("exportBtn").addEventListener("click", function(){
    var head = ["Reference","Date","Name","Contact","Collection","Pieces","Price","Paid","Owed","Payment","Status","Source","Notes"];
    var rows = orders.map(function(o){
      return [o.ref, o.createdAt?new Date(o.createdAt).toISOString().slice(0,10):"", o.name, o.contact, o.pickup, orderSpec(o),
        o.price!=null?(o.price/100).toFixed(2):"", (paidOf(o)/100).toFixed(2), (owedOf(o)/100).toFixed(2), payState(o).t, o.status, o.source, o.notes];
    });
    var csv = [head].concat(rows).map(function(r){ return r.map(csvCell).join(","); }).join("\n");
    var a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿"+csv],{type:"text/csv"}));
    a.download = "resinate-orders-"+new Date().toISOString().slice(0,10)+".csv";
    document.body.appendChild(a); a.click(); setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); }, 500);
  });

  // ---- charts (single series each: no legend; latest/each value labelled; hover adds detail) ----
  var NS = "http://www.w3.org/2000/svg";
  function el(tag, attrs, parent){ var n=document.createElementNS(NS,tag); for(var k in attrs) n.setAttribute(k, attrs[k]); if(parent) parent.appendChild(n); return n; }
  function tipFor(chart){
    var t = chart.querySelector(".tip");
    if(!t){ t=document.createElement("div"); t.className="tip"; t.hidden=true; t.appendChild(document.createElement("b")); t.appendChild(document.createElement("span")); chart.appendChild(t); }
    return t;
  }
  function bindTip(g, chart, value, label){
    var tip = tipFor(chart);
    function show(){
      var cr = chart.getBoundingClientRect(), br = g.querySelector(".bar").getBoundingClientRect();
      tip.firstChild.textContent = value; tip.lastChild.textContent = label;
      tip.style.left = (br.left - cr.left + br.width/2)+"px"; tip.style.top = (br.top - cr.top - 4)+"px"; tip.hidden = false;
    }
    function hide(){ tip.hidden = true; }
    g.addEventListener("pointerenter", show); g.addEventListener("pointerleave", hide);
    g.addEventListener("focus", show); g.addEventListener("blur", hide);
  }
  function roundTopRect(x,y,w,h,r){
    if(h<=0) return "M0,0";
    r = Math.min(r, w/2, h);
    return "M"+x+","+(y+h)+"V"+(y+r)+"Q"+x+","+y+" "+(x+r)+","+y+"H"+(x+w-r)+"Q"+(x+w)+","+y+" "+(x+w)+","+(y+r)+"V"+(y+h)+"Z";
  }
  function weekStart(ts){ var d=new Date(ts); d.setHours(0,0,0,0); d.setDate(d.getDate()-((d.getDay()+6)%7)); return d.getTime(); }
  function niceStep(raw){
    if(!(raw>0)) return 500;
    var p = Math.pow(10, Math.floor(Math.log10(raw))), n = raw/p;
    return (n<=1?1:n<=2?2:n<=5?5:10)*p;
  }
  function drawWeeks(){
    var chart = $("chartWeeks"), plot = chart.querySelector(".plot"); plot.innerHTML = "";
    var now = weekStart(Date.now()), weeks = [];
    for(var i=7;i>=0;i--){ var d=new Date(now); d.setDate(d.getDate()-i*7); weeks.push({start:d.getTime(), sum:0}); }
    orders.forEach(function(o){ if(o.status==="Cancelled") return; (o.payments||[]).forEach(function(p){
      var ws = weekStart(p.at||o.createdAt||0); weeks.forEach(function(w){ if(w.start===ws) w.sum += p.amount||0; });
    }); });
    var max = Math.max.apply(null, weeks.map(function(w){return w.sum}));
    var VW=520, VH=200, L=44, B=26, T=18, R=6, ph=VH-B-T, pw=VW-L-R;
    var step = niceStep(max/3), top = Math.max(step*3, step*Math.ceil(max/step));
    var svg = el("svg",{viewBox:"0 0 "+VW+" "+VH, role:"img", "aria-label":"Bar chart of money received per week over the last 8 weeks"}, plot);
    for(var v=0; v<=top; v+=step){
      var y = T + ph - (v/top)*ph;
      el("line",{x1:L, x2:VW-R, y1:y, y2:y, "class":"grid"}, svg);
      el("text",{x:L-6, y:y+4, "text-anchor":"end"}, svg).textContent = "$"+Math.round(v/100);
    }
    var bw = pw/weeks.length, barW = Math.min(36, bw*0.62);
    weeks.forEach(function(w, i){
      var x = L + i*bw + (bw-barW)/2, h = top ? (w.sum/top)*ph : 0, y = T+ph-h;
      var g = el("g",{tabindex:"0"}, svg);
      el("rect",{x:L+i*bw, y:T, width:bw, height:ph, "class":"hit"}, g);
      el("path",{d: roundTopRect(x,y,barW,h,4), "class":"bar"}, g);
      var dlabel = new Date(w.start).toLocaleDateString(undefined,{day:"numeric",month:"short"});
      el("text",{x:L+i*bw+bw/2, y:VH-8, "text-anchor":"middle"}, svg).textContent = dlabel;
      if(i===weeks.length-1 && w.sum>0) el("text",{x:x+barW/2, y:y-7, "text-anchor":"middle", "class":"val"}, svg).textContent = money(w.sum);
      bindTip(g, chart, money(w.sum), "Week of "+dlabel);
    });
  }
  function drawSizes(live){
    var chart = $("chartSizes"), plot = chart.querySelector(".plot"); plot.innerHTML = "";
    var counts = SIZES.map(function(s){ return {k:s.k, name:s.name, n:0}; });
    live.forEach(function(o){ itemsOf(o).forEach(function(it){ counts.forEach(function(c){ if(c.k===it.size) c.n += it.qty||1; }); }); });
    var max = Math.max(1, Math.max.apply(null, counts.map(function(c){return c.n})));
    var VW=360, rowH=38, L=64, R=40, VH=counts.length*rowH+4;
    var svg = el("svg",{viewBox:"0 0 "+VW+" "+VH, role:"img", "aria-label":"Bar chart of pieces ordered by size"}, plot);
    counts.forEach(function(c, i){
      var y = i*rowH + 8, h = rowH-16, w = (c.n/max)*(VW-L-R);
      el("text",{x:L-8, y:y+h/2+4, "text-anchor":"end"}, svg).textContent = c.name;
      var g = el("g",{tabindex:"0"}, svg);
      el("rect",{x:L, y:i*rowH, width:VW-L, height:rowH, "class":"hit"}, g);
      el("path",{"class":"bar", d: w>4 ? "M"+L+","+y+"H"+(L+w-4)+"Q"+(L+w)+","+y+" "+(L+w)+","+(y+4)+"V"+(y+h-4)+"Q"+(L+w)+","+(y+h)+" "+(L+w-4)+","+(y+h)+"H"+L+"Z" : "M0,0"}, g);
      el("text",{x:L+w+6, y:y+h/2+4, "class":"val"}, svg).textContent = c.n;
      bindTip(g, chart, c.n+(c.n===1?" piece":" pieces"), c.name);
    });
  }

  // ---- prices form ----
  var PRICE_FIELDS = [["pbS",["base","S"]],["pbM",["base","M"]],["pbL",["base","L"]],["pbXL",["base","XL"]],
    ["ppS",["print","S"]],["ppM",["print","M"]],["ppL",["print","L"]],["ppXL",["print","XL"]],
    ["ptS",["theme","S"]],["ptM",["theme","M"]],["ptL",["theme","L"]],["ptXL",["theme","XL"]],
    ["pDye",["dye"]],["pSpLo",["sparkleLo"]],["pSpHi",["sparkleHi"]],["pSpXL",["sparkleXL"]],
    ["pLedL",["led","L"]],["pLedXL",["led","XL"]],["pCustom",["customMin"]],["pBundle",["bundleOff"]]];
  function getPath(o,p){ return p.length===1 ? o[p[0]] : o[p[0]][p[1]]; }
  function fillPrices(){ PRICE_FIELDS.forEach(function(f){ var v=getPath(P,f[1]); $(f[0]).value = v==null ? "" : (v/100).toFixed(2); }); }
  $("priceReset").addEventListener("click", function(){ fillPrices(); $("priceMsg").hidden = true; });
  $("priceForm").addEventListener("submit", function(e){
    e.preventDefault();
    var out = JSON.parse(JSON.stringify(P)), bad = null;
    PRICE_FIELDS.forEach(function(f){
      var raw = $(f[0]).value.trim(), c = cents(raw), p = f[1];
      if(f[0]==="pSpXL" && raw===""){ out.sparkleXL = null; return; }
      if(f[0]==="pBundle" && raw===""){ out.bundleOff = 0; return; }
      if(!(c>=0)){ bad = bad || f[0]; return; }
      if(p.length===1) out[p[0]] = c; else out[p[0]][p[1]] = c;
    });
    if(bad){ showMsg("priceMsg","err","One of the prices isn't a number. Use dollars, like 9.99."); $(bad).focus(); return; }
    if(out.sparkleHi < out.sparkleLo){ showMsg("priceMsg","err","Sparkle \"up to\" must be at least the \"from\" price."); $("pSpHi").focus(); return; }
    sb.from("resinate_settings").upsert({id:"prices", data:out, updated_at:new Date().toISOString()}).then(function(r){
      if(r.error) throw r.error;
      P = mergePrices(out); renderAll(); if(orders.length) renderDash();
      showMsg("priceMsg","ok","Saved. Visitors see these prices the next time they open the shop.");
    }).catch(function(err){ showMsg("priceMsg","err","Didn't save ("+errText(err)+"). Only editors can change prices."); });
  });

  // ---- payment settings form ----
  function fillSettings(){ $("sPayid").value = pay.payid||""; $("sName").value = pay.name||""; $("sBsb").value = pay.bsb||""; $("sAcct").value = pay.acct||""; $("sNote").value = pay.note||""; }
  $("setForm").addEventListener("submit", function(e){
    e.preventDefault();
    var data = {payid:$("sPayid").value.trim(), name:$("sName").value.trim(), bsb:$("sBsb").value.trim(), acct:$("sAcct").value.trim(), note:$("sNote").value.trim()};
    sb.from("resinate_settings").upsert({id:"payment", data:data, updated_at:new Date().toISOString()}).then(function(r){
      if(r.error) throw r.error;
      pay = data; renderPayDetails(); renderStart();
      showMsg("setMsg","ok","Saved. Customers now see these details.");
    }).catch(function(err){ showMsg("setMsg","err","Didn't save ("+errText(err)+"). Only editors can change payment details."); });
  });

  // ---- designs editor ----
  var draftDesigns = [];
  function fillDesigns(){ draftDesigns = JSON.parse(JSON.stringify(designs)); drawDesignRows(); }
  function drawDesignRows(){
    $("designRows").innerHTML = draftDesigns.length ? draftDesigns.map(function(d,i){
      return '<div class="drow" data-i="'+i+'">'+
        '<div class="field" style="margin:0"><label for="dn'+i+'">Name</label><input type="text" id="dn'+i+'" data-f="name" maxlength="30" value="'+esc(d.name)+'"></div>'+
        '<div class="field" style="margin:0"><label for="db'+i+'">Description</label><input type="text" id="db'+i+'" data-f="blurb" maxlength="160" value="'+esc(d.blurb)+'">'+
          '<span class="swatches" role="group" aria-label="Colours for '+esc(d.name||"this design")+'">'+COLOURS.map(function(c){
            return '<label class="sw'+(c[0]==="Clear"?" clear":"")+'" title="'+c[0]+'"><input type="checkbox" data-c="'+c[0]+'" aria-label="'+c[0]+'"'+(d.palette.indexOf(c[0])>=0?" checked":"")+'><span style="--c:'+c[1]+'"></span></label>';
          }).join("")+'</span></div>'+
          '<span class="row" style="margin-top:8px">'+(d.photo?'<img src="'+esc(photoUrl(d.photo))+'" alt="" style="width:44px;height:44px;object-fit:cover;border-radius:6px;border:1px solid var(--line)">':'')+
            '<label class="btn small ghost" for="dp'+i+'">'+(d.photo?"Change photo":"Add a photo")+'</label><input type="file" id="dp'+i+'" class="vh" accept="image/jpeg,image/png,image/webp" data-dphoto="'+i+'">'+
            (d.photo?'<button type="button" class="btn small ghost" data-dphrm="'+i+'">Remove photo</button>':'')+'</span></div>'+
        '<button type="button" class="btn small ghost" data-drm="'+i+'" aria-label="Remove '+esc(d.name||"design")+'" style="margin-top:26px">Remove</button></div>';
    }).join("") : '<div class="empty">No themed designs. Customers will only see a plain pour and their own design.</div>';
    $("designAdd").disabled = draftDesigns.length>=8;
  }
  $("designRows").addEventListener("input", function(e){
    var row = e.target.closest("[data-i]"), f = e.target.getAttribute("data-f"); if(!row || !f) return;
    draftDesigns[+row.getAttribute("data-i")][f] = e.target.value;
  });
  $("designRows").addEventListener("change", function(e){
    var di = e.target.getAttribute("data-dphoto");
    if(di!=null){
      var f = e.target.files[0]; if(!f) return;
      var path = "designs/themes/"+randName()+".jpg";
      showMsg("designMsg","ok","Uploading the photo…");
      fitJpeg(f, 1200).then(function(blob){ return sb.storage.from("resinate").upload(path, blob, {contentType:"image/jpeg", upsert:false}); })
        .then(function(r){ if(r.error) throw r.error; draftDesigns[+di].photo = path; drawDesignRows(); showMsg("designMsg","ok","Photo added. Press Save designs to show it."); })
        .catch(function(err){ showMsg("designMsg","err","The photo didn't upload ("+errText(err)+")."); });
      return;
    }
    var row = e.target.closest("[data-i]"), c = e.target.getAttribute("data-c"); if(!row || !c) return;
    var pal = draftDesigns[+row.getAttribute("data-i")].palette, k = pal.indexOf(c);
    if(e.target.checked){ if(k<0 && pal.length<MAX_COLOURS) pal.push(c); else if(k<0) e.target.checked = false; }
    else if(k>=0) pal.splice(k,1);
  });
  $("designRows").addEventListener("click", function(e){
    var ph = e.target.closest("[data-dphrm]");
    if(ph){ draftDesigns[+ph.getAttribute("data-dphrm")].photo = ""; drawDesignRows(); return; }
    var b = e.target.closest("[data-drm]"); if(!b) return;
    draftDesigns.splice(+b.getAttribute("data-drm"),1); drawDesignRows();
  });
  $("designAdd").addEventListener("click", function(){
    if(draftDesigns.length>=8) return;
    draftDesigns.push({name:"", blurb:"", palette:[], photo:""}); drawDesignRows();
    var n = $("dn"+(draftDesigns.length-1)); if(n) n.focus();
  });
  $("designUndo").addEventListener("click", function(){ fillDesigns(); $("designMsg").hidden = true; });
  $("designDefaults").addEventListener("click", function(){ draftDesigns = JSON.parse(JSON.stringify(DEFAULT_DESIGNS)); drawDesignRows(); showMsg("designMsg","ok","Starter designs filled in. Press Save designs to use them."); });
  $("designForm").addEventListener("submit", function(e){
    e.preventDefault();
    var names = {}, bad = null;
    draftDesigns.forEach(function(d,i){
      var n = d.name.trim().toLowerCase();
      if(!n) bad = bad || ["dn"+i, "Give every design a name, or remove it."];
      else if(n==="own" || names[n]) bad = bad || ["dn"+i, "Each design needs a different name."];
      names[n] = true;
    });
    if(bad){ showMsg("designMsg","err",bad[1]); $(bad[0]).focus(); return; }
    var list = cleanDesigns(draftDesigns);
    sb.from("resinate_settings").upsert({id:"designs", data:{list:list}, updated_at:new Date().toISOString()}).then(function(r){
      if(r.error) throw r.error;
      designs = list; fillDesigns(); renderAll();
      showMsg("designMsg","ok","Saved. Customers see these designs the next time they open the shop.");
    }).catch(function(err){ showMsg("designMsg","err","Didn't save ("+errText(err)+"). Only makers can change designs."); });
  });

  // ---- gallery ----
  var photos = [], confirmPhoto = null;
  function photoUrl(path){ return sb ? sb.storage.from("resinate").getPublicUrl(path).data.publicUrl : ""; }
  function loadPhotos(){
    if(!sb) return;
    sb.from("resinate_photos").select("*").order("created_at",{ascending:false}).then(function(r){ if(!r.error){ photos = r.data; renderGallery(); renderStart(); } });
  }
  function renderGallery(){
    $("work").hidden = !(photos.length || canEdit);
    if(!photos.length){ $("gallery").innerHTML = canEdit ? '<div class="empty" style="grid-column:1/-1">No photos yet. Upload your first finished piece below.</div>' : ""; return; }
    $("gallery").innerHTML = photos.map(function(ph){
      var del = canEdit ? (confirmPhoto===ph.id
        ? '<span class="row"><button type="button" class="copy" data-pdel="'+esc(ph.id)+'">Remove</button><button type="button" class="copy" data-pkeep="1">Keep</button></span>'
        : '<button type="button" class="copy" data-pask="'+esc(ph.id)+'">Remove</button>') : "";
      return '<figure><img src="'+esc(photoUrl(ph.path))+'" alt="'+esc(ph.caption||"Resin piece")+'" loading="lazy"><figcaption><span>'+esc(ph.caption||"")+'</span>'+del+'</figcaption></figure>';
    }).join("");
  }
  $("gallery").addEventListener("click", function(e){
    var b = e.target.closest("button"); if(!b) return;
    var id;
    if((id=b.getAttribute("data-pask"))){ confirmPhoto=id; renderGallery(); }
    else if(b.getAttribute("data-pkeep")){ confirmPhoto=null; renderGallery(); }
    else if((id=b.getAttribute("data-pdel"))){
      var ph = photos.filter(function(x){return x.id===id})[0]; confirmPhoto=null;
      sb.from("resinate_photos").delete().eq("id", id).then(function(r){
        if(r.error) throw r.error;
        if(ph) sb.storage.from("resinate").remove([ph.path]);
        toast("Photo removed"); loadPhotos();
      }).catch(function(err){ toast("Couldn't remove it ("+errText(err)+")."); });
    }
  });
  $("upForm").addEventListener("submit", function(e){
    e.preventDefault();
    var f = $("upFile").files[0];
    if(!f){ showMsg("upMsg","err","Choose a photo first."); return; }
    if(!/^image\//.test(f.type)){ showMsg("upMsg","err","That file isn't an image. Choose a JPG, PNG or similar."); return; }
    if(f.size > 10*1024*1024){ showMsg("upMsg","err","That photo is over 10 MB. Choose a smaller one."); return; }
    var ext = (f.name.split(".").pop()||"jpg").toLowerCase().replace(/[^a-z0-9]/g,"").slice(0,5) || "jpg";
    var path = "gallery/"+Date.now()+"-"+Math.random().toString(36).slice(2,8)+"."+ext;
    $("upBtn").disabled = true; showMsg("upMsg","ok","Uploading…");
    sb.storage.from("resinate").upload(path, f, {contentType:f.type, upsert:false}).then(function(r){
      if(r.error) throw r.error;
      return sb.from("resinate_photos").insert({path:path, caption:$("upCaption").value.trim()});
    }).then(function(r){
      if(r.error) throw r.error;
      showMsg("upMsg","ok","Added to Our work."); $("upFile").value=""; $("upCaption").value=""; loadPhotos();
    }).catch(function(err){ showMsg("upMsg","err","Upload didn't work ("+errText(err)+")."); })
      .then(function(){ $("upBtn").disabled = false; });
  });

  // ---- start ----
  drawWeeks(); drawSizes([]); renderToMake();
  applyView(); applyAccess();
  if(sb){
    sb.from("resinate_settings").select("id,data").then(function(r){
      if(r.error){ if(isMissing(r.error)){ dbState = "missing"; applyAccess(); } return; }
      dbState = "ok";
      r.data.forEach(function(row){
        if(row.id==="prices") P = mergePrices(row.data);
        if(row.id==="payment") pay = row.data || {};
        if(row.id==="designs" && row.data) designs = cleanDesigns(row.data.list);
      });
      renderAll(); renderPayDetails(); fillPrices(); fillSettings(); fillDesigns();
    });
    loadPhotos();
    sb.auth.onAuthStateChange(function(ev, s){
      session = s;
      setTimeout(afterAuth, 0); // don't call Supabase from inside this callback
    });
  }

  // ---- hero: an ocean-style resin pour with white lacing and gold flecks ----
  var cv = $("pour"), ctx = cv.getContext("2d");
  var reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  var flecks = [];
  for(var i=0;i<90;i++) flecks.push({x:Math.random(), y:Math.random(), r:Math.random()*1.8+0.5, p:Math.random()*6.28, gold:Math.random()<0.35});
  var cellsArr = [];
  for(var j=0;j<70;j++) cellsArr.push({u:Math.random(), band:Math.floor(Math.random()*3), r:Math.random()*0.012+0.004, off:(Math.random()-0.5)*0.03});
  function tok(n){ return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
  function size(){ var r=cv.getBoundingClientRect(), dpr=Math.min(devicePixelRatio||1,2); cv.width=Math.max(1,r.width*dpr); cv.height=Math.max(1,r.height*dpr); }
  function mix(a,b,t){
    var pa=parseInt(a.slice(1),16), pb=parseInt(b.slice(1),16);
    var r=Math.round(((pa>>16)&255)*(1-t)+((pb>>16)&255)*t), g=Math.round(((pa>>8)&255)*(1-t)+((pb>>8)&255)*t), bl=Math.round((pa&255)*(1-t)+(pb&255)*t);
    return "rgb("+r+","+g+","+bl+")";
  }
  function hex(v, fb){ return /^#[0-9a-f]{6}$/i.test(v) ? v : fb; }
  function draw(t){
    var w=cv.width, h=cv.height, resin=hex(tok("--resin"),"#0d6d70"), amber=hex(tok("--amber"),"#b86a07"), ink=hex(tok("--ink"),"#11282b");
    var deep = mix(resin,"#04161a",0.55), light = mix(resin,"#ffffff",0.55), sand = mix(amber,"#f4e4c8",0.55);
    ctx.clearRect(0,0,w,h);
    var cx=w/2, cy=h/2, R=w*0.43;
    ctx.save(); ctx.fillStyle = "rgba(0,0,0,.18)"; ctx.filter = "blur("+(w/40)+"px)";
    ctx.beginPath(); ctx.ellipse(cx+w*0.02, cy+w*0.04, R, R*0.98, 0, 0, 6.283); ctx.fill(); ctx.restore();
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, 6.283); ctx.clip();
    ctx.fillStyle = deep; ctx.fillRect(0,0,w,h);
    var bands = [{c:resin, o:0.30}, {c:light, o:0.04}, {c:sand, o:-0.26}];
    var phase = t*0.00018;
    function edge(k, s){ return bands[k].o + 0.035*Math.sin(s*7 + phase + k*1.7) + 0.02*Math.sin(s*15 - phase*1.3 + k); }
    function pt(s, off){
      var ax = -0.75 + s*1.5, ux = Math.SQRT1_2, uy = -Math.SQRT1_2, nx = Math.SQRT1_2, ny = Math.SQRT1_2;
      return [cx + (ax*ux + off*nx)*R*1.6, cy + (ax*uy + off*ny)*R*1.6];
    }
    bands.forEach(function(b, k){
      ctx.beginPath();
      for(var s=0;s<=1.0001;s+=0.02){ var p = pt(s, edge(k,s)); if(s===0) ctx.moveTo(p[0],p[1]); else ctx.lineTo(p[0],p[1]); }
      var e1 = pt(1, -1.2), e0 = pt(0, -1.2);
      ctx.lineTo(e1[0],e1[1]); ctx.lineTo(e0[0],e0[1]); ctx.closePath();
      ctx.fillStyle = b.c; ctx.fill();
      ctx.beginPath();
      for(var s2=0;s2<=1.0001;s2+=0.02){ var q = pt(s2, edge(k,s2)+0.006); if(s2===0) ctx.moveTo(q[0],q[1]); else ctx.lineTo(q[0],q[1]); }
      ctx.strokeStyle = "rgba(255,255,255,.85)"; ctx.lineWidth = w*0.009; ctx.lineJoin="round"; ctx.stroke();
      ctx.strokeStyle = "rgba(255,255,255,.35)"; ctx.lineWidth = w*0.022; ctx.stroke();
    });
    ctx.strokeStyle = "rgba(255,255,255,.7)"; ctx.lineWidth = Math.max(1,w/450);
    cellsArr.forEach(function(c){
      var p = pt(c.u, edge(c.band,c.u) + 0.025 + c.off);
      ctx.beginPath(); ctx.arc(p[0], p[1], c.r*w, 0, 6.283); ctx.stroke();
    });
    flecks.forEach(function(f){
      var tw = reduce ? 0.7 : 0.45 + 0.55*Math.abs(Math.sin(t*0.0016 + f.p));
      ctx.fillStyle = f.gold ? "rgba(232,184,92,"+(0.55+0.4*tw)+")" : "rgba(255,255,255,"+(0.25+0.6*tw)+")";
      ctx.beginPath(); ctx.arc(f.x*w, f.y*h, f.r*(w/420)*(f.gold?1.4:1), 0, 6.283); ctx.fill();
    });
    var hl = ctx.createRadialGradient(cx-R*0.35, cy-R*0.4, 0, cx-R*0.35, cy-R*0.4, R*0.9);
    hl.addColorStop(0,"rgba(255,255,255,.38)"); hl.addColorStop(0.45,"rgba(255,255,255,.06)"); hl.addColorStop(1,"rgba(255,255,255,0)");
    ctx.fillStyle = hl; ctx.fillRect(0,0,w,h);
    ctx.restore();
    ctx.strokeStyle = mix(ink, "#ffffff", 0.7); ctx.globalAlpha = .5; ctx.lineWidth = Math.max(1.5,w/160);
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, 6.283); ctx.stroke(); ctx.globalAlpha = 1;
  }
  function still(){ return reduce || pref("calm", false); }
  function loop(t){ if(!still() && document.body.getAttribute("data-view")==="shop" && !document.hidden) draw(t); requestAnimationFrame(loop); }
  redrawHero = function(){ setTimeout(function(){ size(); draw(still() ? 0 : performance.now()); }, 0); };
  size(); addEventListener("resize", redrawHero);
  addEventListener("hashchange", redrawHero);
  draw(0); requestAnimationFrame(loop);
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", redrawHero);
})();
