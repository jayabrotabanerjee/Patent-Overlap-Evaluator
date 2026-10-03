(function(){
"use strict";

var T={file:null,cancel:false,running:false,blob:null,filename:""};
function $(s){return document.querySelector(s)}
function sleep(ms){return new Promise(function(r){setTimeout(r,ms)})}
function fmt(n){if(n<1024)return n+" B";if(n<1048576)return(n/1024).toFixed(1)+" KB";return(n/1048576).toFixed(1)+" MB"}
function setStatus(msg,error){var e=$("#translateStatus");if(!e)return;e.textContent=msg;e.classList.toggle("tool-error",Boolean(error))}
function setProgress(done,total,label){var p=$("#translateProgress"),t=$("#translateProgressText");if(p){p.max=Math.max(1,total);p.value=done}if(t)t.textContent=label||((done||0)+" / "+(total||0))}
function getGemini(){
  var key=localStorage.getItem("patentOverlapEvaluatorGeminiKey")||"";
  var model=localStorage.getItem("patentOverlapEvaluatorGeminiModel")||"gemini-3.8-flash";
  if(!key){
    var entered=prompt("Enter your Gemini API key for document translation. It is stored only in this browser.");
    if(entered&&entered.trim()){key=entered.trim();localStorage.setItem("patentOverlapEvaluatorGeminiKey",key)}
  }
  return{key:key,model:model};
}
function languageName(sel){var el=$(sel);return el.options[el.selectedIndex].textContent}
function stripFence(t){
  var s=String(t||"").trim();
  var fence=String.fromCharCode(96)+String.fromCharCode(96)+String.fromCharCode(96);
  if(s.indexOf(fence+"json")===0)s=s.slice(7);
  else if(s.indexOf(fence)===0)s=s.slice(3);
  if(s.lastIndexOf(fence)===s.length-3)s=s.slice(0,-3);
  return s.trim();
}
async function geminiJson(promptText,images){
  var cfg=getGemini();
  if(!cfg.key)throw new Error("Gemini API key is required for translation.");
  var parts=[{text:promptText}];
  (images||[]).forEach(function(img){parts.push({inline_data:{mime_type:img.mime,data:img.data}})});
  var url="https://generativelanguage.googleapis.com/v1beta/models/"+encodeURIComponent(cfg.model)+":generateContent";
  var r=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json","x-goog-api-key":cfg.key},body:JSON.stringify({contents:[{role:"user",parts:parts}],generationConfig:{responseMimeType:"application/json",temperature:0.05}})});
  var raw=await r.text(),j={};
  try{j=raw?JSON.parse(raw):{}}catch(e){j={raw:raw}}
  if(!r.ok){
    var msg=j&&j.error&&j.error.message?j.error.message:(raw||("HTTP "+r.status));
    if(r.status===429)throw new Error("Gemini quota/rate limit reached. "+msg);
    if(r.status===401||r.status===403)throw new Error("Gemini authentication failed. "+msg);
    if(r.status===404)throw new Error("Selected Gemini model is unavailable. Choose another model in the top menu. "+msg);
    throw new Error("Gemini translation failed ("+r.status+"): "+msg);
  }
  var text=j.candidates&&j.candidates[0]&&j.candidates[0].content&&j.candidates[0].content.parts?j.candidates[0].content.parts.map(function(p){return p.text||""}).join(""):"";
  if(!text)throw new Error("Gemini returned an empty translation response.");
  return JSON.parse(stripFence(text));
}
async function loadPdfJs(){
  return await import("https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs");
}
function boxFromItem(pdfjs,viewport,item){
  var tx=pdfjs.Util.transform(viewport.transform,item.transform);
  var h=Math.max(5,Math.hypot(tx[2],tx[3]));
  var w=Math.max(2,(item.width||0)*viewport.scale);
  return{x:tx[4],y:tx[5]-h*0.88,w:w,h:h,text:String(item.str||""),font:h};
}
function groupLines(items){
  var useful=items.filter(function(x){return x.text&&x.text.trim()});
  useful.sort(function(a,b){var dy=a.y-b.y;if(Math.abs(dy)>3)return dy;return a.x-b.x});
  var rows=[];
  useful.forEach(function(it){
    var row=null,best=1e9;
    rows.forEach(function(r){var d=Math.abs(r.y-it.y);var tol=Math.max(3,Math.min(r.h,it.h)*0.55);if(d<=tol&&d<best){row=r;best=d}});
    if(!row){row={y:it.y,h:it.h,items:[]};rows.push(row)}
    row.items.push(it);row.y=(row.y*(row.items.length-1)+it.y)/row.items.length;row.h=Math.max(row.h,it.h);
  });
  rows.sort(function(a,b){return a.y-b.y});
  var blocks=[],id=1;
  rows.forEach(function(row){
    row.items.sort(function(a,b){return a.x-b.x});
    var seg=[],lastEnd=null;
    function flush(){
      if(!seg.length)return;
      var x1=Math.min.apply(null,seg.map(function(z){return z.x}));
      var x2=Math.max.apply(null,seg.map(function(z){return z.x+z.w}));
      var y1=Math.min.apply(null,seg.map(function(z){return z.y}));
      var y2=Math.max.apply(null,seg.map(function(z){return z.y+z.h}));
      var text="";
      seg.forEach(function(z,i){if(i){var gap=z.x-(seg[i-1].x+seg[i-1].w);if(gap>Math.max(2,z.font*0.18))text+=" "}text+=z.text});
      blocks.push({id:id++,x:x1,y:y1,w:Math.max(8,x2-x1),h:Math.max(7,y2-y1),font:Math.max.apply(null,seg.map(function(z){return z.font})),text:text.trim()});
      seg=[];lastEnd=null;
    }
    row.items.forEach(function(it){
      var gap=lastEnd==null?0:it.x-lastEnd;
      if(seg.length&&gap>Math.max(55,row.h*5.5))flush();
      seg.push(it);lastEnd=it.x+it.w;
    });
    flush();
  });
  return blocks.filter(function(b){return b.text&&b.text.trim()});
}
function batchBlocks(blocks,maxChars){
  var batches=[],cur=[],count=0;
  blocks.forEach(function(b){
    var add=b.text.length+40;
    if(cur.length&&(count+add>maxChars||cur.length>=45)){batches.push(cur);cur=[];count=0}
    cur.push(b);count+=add;
  });
  if(cur.length)batches.push(cur);
  return batches;
}
async function translateBlocks(blocks,source,target){
  var map={},batches=batchBlocks(blocks,9000);
  for(var bi=0;bi<batches.length;bi++){
    if(T.cancel)throw new Error("__CANCELLED__");
    var payload=batches[bi].map(function(b){return{id:b.id,text:b.text}});
    var promptText=[
      "Translate each entry into "+target+".",
      source==="Auto-detect"?"Detect the source language automatically.":"The source language is "+source+".",
      "This is a technical/patent document. Preserve patent numbers, standards identifiers, reference numerals, equations, chemical formulas, units, acronyms, citations, paragraph numbers and claim numbering unless they are ordinary words.",
      "Do not summarize, explain, omit, merge or split entries.",
      "Return ONLY JSON in the exact form {\"translations\":[{\"id\":1,\"text\":\"...\"}]}.",
      "INPUT:",
      JSON.stringify(payload)
    ].join("\n");
    var j=await geminiJson(promptText,[]);
    var arr=Array.isArray(j.translations)?j.translations:[];
    arr.forEach(function(x){map[Number(x.id)]=String(x.text==null?"":x.text)});
    await sleep(120);
  }
  return map;
}
function canvasData(canvas,mime,quality){
  return canvas.toDataURL(mime||"image/jpeg",quality==null?0.94:quality).split(",")[1];
}
async function ocrTranslatePage(canvas,source,target){
  var img=canvasData(canvas,"image/jpeg",0.9);
  var promptText=[
    "OCR and translate EVERY visible text block on this document page into "+target+".",
    source==="Auto-detect"?"Detect the source language automatically.":"The source language is "+source+".",
    "Preserve numbers, patent/standards identifiers, equations, symbols, units, acronyms and reference numerals.",
    "Return reading-order blocks with bounding boxes normalized to 0..1000 relative to page width/height.",
    "Return ONLY JSON: {\"items\":[{\"x\":0,\"y\":0,\"w\":100,\"h\":40,\"text\":\"translated text\"}]}",
    "Do not return explanations. Include all visible textual content, including headings, footnotes, labels and table text."
  ].join("\n");
  var j=await geminiJson(promptText,[{mime:"image/jpeg",data:img}]);
  return(Array.isArray(j.items)?j.items:[]).map(function(x,i){
    return{id:i+1,x:Math.max(0,Number(x.x)||0)/1000*canvas.width,y:Math.max(0,Number(x.y)||0)/1000*canvas.height,w:Math.max(5,Number(x.w)||0)/1000*canvas.width,h:Math.max(7,Number(x.h)||0)/1000*canvas.height,font:Math.max(9,(Number(x.h)||25)/1000*canvas.height*0.72),translated:String(x.text||"")};
  }).filter(function(x){return x.translated});
}
function wrap(ctx,text,maxWidth){
  var words=String(text||"").split(/\s+/),lines=[],line="";
  for(var i=0;i<words.length;i++){
    var test=line?line+" "+words[i]:words[i];
    if(line&&ctx.measureText(test).width>maxWidth){lines.push(line);line=words[i]}else line=test;
  }
  if(line)lines.push(line);
  return lines.length?lines:[""];
}
function drawTranslation(ctx,b,text){
  var pad=2,boxW=Math.max(10,b.w+pad*2),maxH=Math.max(b.h*2.7,b.h+10),size=Math.max(6,Math.min(42,b.font*0.92)),lines=[],lh=0;
  for(;size>=5;size-=0.5){
    ctx.font=size+"px Arial, 'Noto Sans', sans-serif";
    lines=wrap(ctx,text,boxW-pad*2);lh=size*1.14;
    if(lines.length*lh<=maxH)break;
  }
  var totalH=Math.max(b.h,lines.length*lh)+pad*2;
  ctx.fillStyle="rgba(255,255,255,0.97)";
  ctx.fillRect(Math.max(0,b.x-pad),Math.max(0,b.y-pad),Math.min(ctx.canvas.width-b.x+pad,boxW),Math.min(ctx.canvas.height-b.y+pad,totalH));
  ctx.fillStyle="#111";
  ctx.font=size+"px Arial, 'Noto Sans', sans-serif";
  ctx.textBaseline="top";
  for(var i=0;i<lines.length;i++)ctx.fillText(lines[i],b.x,b.y+pad+i*lh,boxW-pad*2);
}
async function processPage(pdfjs,page,source,target,scale,useVision){
  var viewport=page.getViewport({scale:scale});
  var canvas=document.createElement("canvas");
  canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
  var ctx=canvas.getContext("2d",{alpha:false});
  ctx.fillStyle="#fff";ctx.fillRect(0,0,canvas.width,canvas.height);
  await page.render({canvasContext:ctx,viewport:viewport}).promise;
  var content=await page.getTextContent();
  var boxes=groupLines(content.items.map(function(it){return boxFromItem(pdfjs,viewport,it)}));
  var chars=boxes.reduce(function(n,b){return n+b.text.length},0);
  if(useVision&&(chars<20||boxes.length<2)){
    setStatus("Scanned/image page detected. Using Gemini vision OCR + translation...");
    var ocr=await ocrTranslatePage(canvas,source,target);
    ocr.forEach(function(b){drawTranslation(ctx,b,b.translated)});
    return{canvas:canvas,blocks:ocr.length,mode:"vision"};
  }
  if(!boxes.length)return{canvas:canvas,blocks:0,mode:"original"};
  var translations=await translateBlocks(boxes,source,target);
  boxes.forEach(function(b){var tr=translations[b.id];if(tr)drawTranslation(ctx,b,tr)});
  return{canvas:canvas,blocks:boxes.length,mode:"text"};
}
async function translatePdf(){
  if(T.running)return;
  if(!T.file){alert("Choose a PDF first.");return}
  if(!window.PDFLib){alert("PDF export library did not load. Refresh the page and try again.");return}
  var source=languageName("#translateSource"),target=languageName("#translateTarget");
  if(target==="Auto-detect"){alert("Choose a target language.");return}
  var cfg=getGemini();if(!cfg.key)return;
  T.running=true;T.cancel=false;T.blob=null;$("#translateDownload").disabled=true;$("#translateStart").disabled=true;$("#translateCancel").disabled=false;
  try{
    setStatus("Loading PDF...");
    var pdfjs=await loadPdfJs();
    pdfjs.GlobalWorkerOptions.workerSrc="https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs";
    var bytes=new Uint8Array(await T.file.arrayBuffer());
    var pdf=await pdfjs.getDocument({data:bytes}).promise;
    var out=await PDFLib.PDFDocument.create();
    var dpi=Number($("#translateDpi").value)||250,scale=dpi/72;
    var useVision=$("#translateVision").checked;
    setProgress(0,pdf.numPages,"0 / "+pdf.numPages);
    for(var p=1;p<=pdf.numPages;p++){
      if(T.cancel)throw new Error("__CANCELLED__");
      setStatus("Translating page "+p+" of "+pdf.numPages+" ("+source+" → "+target+")...");
      var page=await pdf.getPage(p);
      try{
        var result=await processPage(pdfjs,page,source,target,scale,useVision);
        var jpeg=result.canvas.toDataURL("image/jpeg",0.94);
        var img=await out.embedJpg(jpeg);
        var v1=page.getViewport({scale:1});
        var op=out.addPage([v1.width,v1.height]);
        op.drawImage(img,{x:0,y:0,width:v1.width,height:v1.height});
      }catch(pageErr){
        if(String(pageErr.message||pageErr)==="__CANCELLED__")throw pageErr;
        setStatus("Page "+p+" translation failed; keeping original page. "+pageErr.message,true);
        var fallbackViewport=page.getViewport({scale:Math.min(scale,2.2)});
        var fc=document.createElement("canvas");fc.width=Math.ceil(fallbackViewport.width);fc.height=Math.ceil(fallbackViewport.height);
        var fctx=fc.getContext("2d",{alpha:false});fctx.fillStyle="#fff";fctx.fillRect(0,0,fc.width,fc.height);
        await page.render({canvasContext:fctx,viewport:fallbackViewport}).promise;
        var fj=fc.toDataURL("image/jpeg",0.94),fi=await out.embedJpg(fj),v=page.getViewport({scale:1}),fp=out.addPage([v.width,v.height]);fp.drawImage(fi,{x:0,y:0,width:v.width,height:v.height});
      }
      setProgress(p,pdf.numPages,p+" / "+pdf.numPages);
      await sleep(150);
    }
    var outBytes=await out.save();
    T.blob=new Blob([outBytes],{type:"application/pdf"});
    var base=T.file.name.replace(/\.pdf$/i,"");
    T.filename=base+" - Translated - "+target+".pdf";
    $("#translateDownload").disabled=false;
    setStatus("Translation complete. "+pdf.numPages+" page(s) processed. Click Download Translated PDF.");
  }catch(e){
    if(String(e.message||e)==="__CANCELLED__")setStatus("Translation cancelled. Pages already processed were discarded.");
    else setStatus(e.message||String(e),true);
  }finally{
    T.running=false;$("#translateStart").disabled=false;$("#translateCancel").disabled=true;
  }
}
function download(){
  if(!T.blob)return;
  var url=URL.createObjectURL(T.blob);
  var a=document.createElement("a");a.href=url;a.download=T.filename||"translated.pdf";document.body.appendChild(a);a.click();a.remove();setTimeout(function(){URL.revokeObjectURL(url)},2000);
}
function bind(){
  if(!$("#documentTranslator"))return;
  $("#translateFile").onchange=function(e){T.file=e.target.files&&e.target.files[0]||null;$("#translateFileName").textContent=T.file?T.file.name+" · "+fmt(T.file.size):"No file selected";$("#translateStart").disabled=!T.file};
  $("#translateStart").onclick=translatePdf;
  $("#translateCancel").onclick=function(){T.cancel=true;setStatus("Cancelling after the current page finishes...")};
  $("#translateDownload").onclick=download;
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",bind);else bind();
})();