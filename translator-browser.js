(function(){
"use strict";

var T={file:null,jobId:null,pollTimer:null,bridge:"http://127.0.0.1:8765",downloadUrl:null};

function $(s){return document.querySelector(s)}
function fmt(n){if(n<1024)return n+" B";if(n<1048576)return(n/1024).toFixed(1)+" KB";return(n/1048576).toFixed(1)+" MB"}
function setStatus(msg,error){var e=$("#translateStatus");if(!e)return;e.textContent=msg;e.classList.toggle("tool-error",Boolean(error))}
function setProgress(done,total,label){var p=$("#translateProgress"),t=$("#translateProgressText");if(p){p.max=Math.max(1,total||1);p.value=done||0}if(t)t.textContent=label||((done||0)+" / "+(total||0))}
function bridgeBase(){var input=$("#translateBridgeUrl");var v=(input&&input.value||T.bridge).trim().replace(/\/+$/,"");T.bridge=v||"http://127.0.0.1:8765";localStorage.setItem("poeTranslatorBridge",T.bridge);return T.bridge}
function markBridge(ok,msg){var b=$("#translateBridgeBadge");if(b){b.textContent=ok?"Bridge Connected":"Bridge Offline";b.classList.toggle("bridge-ok",ok);b.classList.toggle("bridge-off",!ok)}if(msg)setStatus(msg,!ok)}
async function checkBridge(showMessage){
  var base=bridgeBase();
  try{
    var r=await fetch(base+"/health",{method:"GET",cache:"no-store"});
    var j=await r.json();
    if(!r.ok||!j.ok)throw new Error((j&&j.error)||("HTTP "+r.status));
    markBridge(true,showMessage?"Local bridge connected. Translation method: "+(j.method||"Google Translate Images via Selenium/CDP")+".":null);
    return true;
  }catch(e){
    markBridge(false,showMessage?"Local translator bridge is not running. Start start_translator_bridge.bat, keep its window open, then click Check Bridge.":null);
    return false;
  }
}
function resetJob(){
  if(T.pollTimer){clearTimeout(T.pollTimer);T.pollTimer=null}
  T.jobId=null;T.downloadUrl=null;
  $("#translateDownload").disabled=true;
  $("#translateCancel").disabled=true;
}
async function startTranslation(){
  if(!T.file){alert("Choose a PDF first.");return}
  var connected=await checkBridge(false);
  if(!connected){
    setStatus("The browser cannot run Selenium/ChromeDriver itself. Start the local translation bridge first using start_translator_bridge.bat, then click Check Bridge.",true);
    return;
  }

  resetJob();
  $("#translateStart").disabled=true;
  $("#translateCancel").disabled=false;
  setProgress(0,1,"Preparing...");
  setStatus("Uploading PDF to the local bridge...");

  var fd=new FormData();
  fd.append("file",T.file,T.file.name);
  fd.append("source_lang",$("#translateSource").value);
  fd.append("target_lang",$("#translateTarget").value);
  fd.append("show_window",$("#translateShowWindow").checked?"true":"false");

  try{
    var r=await fetch(bridgeBase()+"/api/translate",{method:"POST",body:fd});
    var j=await r.json();
    if(!r.ok)throw new Error(j.error||("HTTP "+r.status));
    T.jobId=j.job_id;
    setStatus("Translation job started. The local bridge is rendering the PDF and controlling Google Translate Images...");
    pollJob();
  }catch(e){
    $("#translateStart").disabled=false;
    $("#translateCancel").disabled=true;
    setStatus("Could not start translation: "+e.message,true);
  }
}
async function pollJob(){
  if(!T.jobId)return;
  try{
    var r=await fetch(bridgeBase()+"/api/jobs/"+encodeURIComponent(T.jobId),{cache:"no-store"});
    var j=await r.json();
    if(!r.ok)throw new Error(j.error||("HTTP "+r.status));

    var total=Number(j.total_pages||0),done=Number(j.progress||0);
    setProgress(done,total,total?done+" / "+total:"Preparing...");
    var logs=Array.isArray(j.logs)?j.logs:[];
    var latest=logs.length?logs[logs.length-1]:"";
    var stage=String(j.status||"").replace(/_/g," ");
    setStatus((stage?stage.charAt(0).toUpperCase()+stage.slice(1)+". ":"")+(latest||""));

    if(j.status==="done"){
      $("#translateStart").disabled=false;
      $("#translateCancel").disabled=true;
      $("#translateDownload").disabled=false;
      T.downloadUrl=bridgeBase()+"/api/jobs/"+encodeURIComponent(T.jobId)+"/download";
      setStatus("Translation complete using the Google Translate Images/Selenium method. Click Download Translated PDF.");
      return;
    }
    if(j.status==="error"){
      $("#translateStart").disabled=false;
      $("#translateCancel").disabled=true;
      setStatus("Translation failed: "+(j.error||latest||"Unknown bridge error"),true);
      return;
    }
    if(j.status==="cancelled"){
      $("#translateStart").disabled=false;
      $("#translateCancel").disabled=true;
      setStatus("Translation cancelled.");
      return;
    }
    T.pollTimer=setTimeout(pollJob,1200);
  }catch(e){
    $("#translateStart").disabled=false;
    $("#translateCancel").disabled=true;
    setStatus("Lost connection to local translation bridge: "+e.message,true);
  }
}
async function cancelJob(){
  if(!T.jobId)return;
  try{
    await fetch(bridgeBase()+"/api/jobs/"+encodeURIComponent(T.jobId)+"/cancel",{method:"POST"});
    setStatus("Cancel requested. The bridge will stop between pages.");
  }catch(e){
    setStatus("Could not send cancel request: "+e.message,true);
  }
}
async function downloadResult(){
  if(!T.downloadUrl)return;
  try{
    setStatus("Downloading translated PDF...");
    var r=await fetch(T.downloadUrl);
    if(!r.ok){var text=await r.text();throw new Error(text||("HTTP "+r.status))}
    var blob=await r.blob();
    var url=URL.createObjectURL(blob);
    var a=document.createElement("a");
    a.href=url;
    a.download=(T.file?T.file.name.replace(/\.pdf$/i,""):"document")+" - Translated.pdf";
    document.body.appendChild(a);a.click();a.remove();
    setTimeout(function(){URL.revokeObjectURL(url)},3000);
    setStatus("Translated PDF downloaded.");
  }catch(e){
    setStatus("Download failed: "+e.message,true);
  }
}
function bind(){
  if(!$("#documentTranslator"))return;

  T.bridge=localStorage.getItem("poeTranslatorBridge")||"http://127.0.0.1:8765";
  $("#translateBridgeUrl").value=T.bridge;

  $("#translateFile").onchange=function(e){
    T.file=e.target.files&&e.target.files[0]||null;
    $("#translateFileName").textContent=T.file?T.file.name+" · "+fmt(T.file.size):"No file selected";
    $("#translateStart").disabled=!T.file;
    resetJob();
  };
  $("#translateStart").onclick=startTranslation;
  $("#translateCancel").onclick=cancelJob;
  $("#translateDownload").onclick=downloadResult;
  $("#translateCheckBridge").onclick=function(){checkBridge(true)};
  $("#translateBridgeUrl").onchange=function(){bridgeBase();checkBridge(false)};

  checkBridge(false);
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",bind);else bind();
})();