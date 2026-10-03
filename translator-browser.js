(function(){
"use strict";

var T={
  file:null,
  jobId:null,
  pollTimer:null,
  bridge:"http://127.0.0.1:8765",
  downloadUrl:null,
  healthTimer:null,
  lastLogs:[],
  clientLogs:[]
};

function $(s){return document.querySelector(s)}
function now(){return new Date().toLocaleTimeString([], {hour:"2-digit",minute:"2-digit",second:"2-digit"})}
function fmt(n){if(n<1024)return n+" B";if(n<1048576)return(n/1024).toFixed(1)+" KB";return(n/1048576).toFixed(1)+" MB"}
function setStatus(msg,error){var e=$("#translateStatus");if(!e)return;e.textContent=msg;e.classList.toggle("tool-error",Boolean(error))}
function setProgress(done,total,label){var p=$("#translateProgress"),t=$("#translateProgressText");if(p){p.max=Math.max(1,total||1);p.value=done||0}if(t)t.textContent=label||((done||0)+" / "+(total||0))}
function clientLog(message,type){
  var line="["+now()+"] "+(type||"INFO")+": "+message;
  T.clientLogs.push(line);
  T.clientLogs=T.clientLogs.slice(-100);
  renderEventLogs();
}
function renderEventLogs(){
  var box=$("#translatorEventLog");
  if(!box)return;
  var merged=T.clientLogs.concat(T.lastLogs||[]);
  if(!merged.length){box.textContent="Translation events will appear here.";return}
  box.innerHTML="";
  merged.slice(-250).forEach(function(line){
    var row=document.createElement("div");
    row.className="translator-log-row";
    row.textContent=line;
    box.appendChild(row);
  });
  box.scrollTop=box.scrollHeight;
}
function bridgeBase(){
  var input=$("#translateBridgeUrl");
  var v=(input&&input.value||T.bridge).trim().replace(/\/+$/,"");
  T.bridge=v||"http://127.0.0.1:8765";
  localStorage.setItem("poeTranslatorBridge",T.bridge);
  return T.bridge;
}
function markBridge(ok,msg){
  var b=$("#translateBridgeBadge");
  if(b){
    b.textContent=ok?"Bridge Connected":"Bridge Offline";
    b.classList.toggle("bridge-ok",ok);
    b.classList.toggle("bridge-off",!ok);
  }
  if(msg)setStatus(msg,!ok);
}
function connectionHint(error){
  var msg=String(error&&error.message||error||"");
  if(/Failed to fetch|NetworkError|Load failed/i.test(msg)){
    return "Could not reach http://127.0.0.1:8765. Make sure start_translator_bridge.bat is running. If it is running, open http://127.0.0.1:8765/health directly in Chrome once and verify that JSON is shown.";
  }
  return msg;
}
async function checkBridge(showMessage){
  var base=bridgeBase();
  if(showMessage)clientLog("Checking local bridge at "+base+"...");
  try{
    var r=await fetch(base+"/api/diagnostics",{method:"GET",cache:"no-store"});
    var j=await r.json();
    if(!r.ok||!j.ok)throw new Error((j&&j.error)||("HTTP "+r.status));
    T.lastLogs=Array.isArray(j.events)?j.events:[];
    renderEventLogs();

    var details=[
      "Bridge v"+(j.version||"?"),
      j.chrome_found?"Chrome found":"Chrome NOT found",
      j.chrome_path||"",
      "Python "+(j.python||"?"),
      "Selenium "+(j.selenium||"?")
    ].filter(Boolean).join(" · ");

    markBridge(true,showMessage?"Local bridge connected. "+details:null);
    if(showMessage)clientLog("Bridge connected. "+details);
    if(!j.chrome_found){
      setStatus("Bridge is running, but Google Chrome was not found. Install Chrome or set CHROME_PATH, then restart the bridge.",true);
    }
    return Boolean(j.chrome_found);
  }catch(e){
    var hint=connectionHint(e);
    markBridge(false,showMessage?hint:null);
    if(showMessage)clientLog("Bridge check failed: "+hint,"ERROR");
    return false;
  }
}
function resetJob(){
  if(T.pollTimer){clearTimeout(T.pollTimer);T.pollTimer=null}
  T.jobId=null;
  T.downloadUrl=null;
  T.lastLogs=[];
  $("#translateDownload").disabled=true;
  $("#translateCancel").disabled=true;
  renderEventLogs();
}
async function startTranslation(){
  if(!T.file){alert("Choose a PDF first.");return}
  var connected=await checkBridge(false);
  if(!connected){
    setStatus("The local translation bridge or Chrome is not ready. Start start_translator_bridge.bat, keep the window open, and click Check Bridge.",true);
    return;
  }

  resetJob();
  $("#translateStart").disabled=true;
  $("#translateCancel").disabled=false;
  setProgress(0,1,"Preparing...");
  setStatus("Uploading PDF to the local bridge...");
  clientLog("Starting translation for "+T.file.name+". Visible Chrome will open automatically.");

  var fd=new FormData();
  fd.append("file",T.file,T.file.name);
  fd.append("source_lang",$("#translateSource").value);
  fd.append("target_lang",$("#translateTarget").value);

  try{
    var r=await fetch(bridgeBase()+"/api/translate",{method:"POST",body:fd});
    var j=await r.json();
    if(!r.ok)throw new Error(j.error||("HTTP "+r.status));
    T.jobId=j.job_id;
    clientLog("Job accepted: "+T.jobId.slice(0,8)+".");
    setStatus("Translation job started. A visible Chrome window should open automatically. Pages will be translated sequentially.");
    pollJob();
  }catch(e){
    $("#translateStart").disabled=false;
    $("#translateCancel").disabled=true;
    var hint=connectionHint(e);
    setStatus("Could not start translation: "+hint,true);
    clientLog("Start failed: "+hint,"ERROR");
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
    T.lastLogs=Array.isArray(j.logs)?j.logs:[];
    renderEventLogs();

    var logs=T.lastLogs;
    var latest=logs.length?logs[logs.length-1]:"";
    var stage=String(j.status||"").replace(/_/g," ");
    setStatus((stage?stage.charAt(0).toUpperCase()+stage.slice(1)+". ":"")+(latest||""));

    if(j.status==="done"){
      $("#translateStart").disabled=false;
      $("#translateCancel").disabled=true;
      $("#translateDownload").disabled=false;
      T.downloadUrl=bridgeBase()+"/api/jobs/"+encodeURIComponent(T.jobId)+"/download";
      setStatus("Translation complete. Pages were processed sequentially and compiled into a PDF. Click Download Translated PDF.");
      clientLog("Translation job completed.");
      return;
    }
    if(j.status==="error"){
      $("#translateStart").disabled=false;
      $("#translateCancel").disabled=true;
      setStatus("Translation failed: "+(j.error||latest||"Unknown bridge error"),true);
      clientLog("Bridge job failed: "+(j.error||latest||"Unknown bridge error"),"ERROR");
      return;
    }
    if(j.status==="cancelled"){
      $("#translateStart").disabled=false;
      $("#translateCancel").disabled=true;
      setStatus("Translation cancelled.");
      clientLog("Translation cancelled.","WARN");
      return;
    }

    T.pollTimer=setTimeout(pollJob,900);
  }catch(e){
    $("#translateStart").disabled=false;
    $("#translateCancel").disabled=true;
    var hint=connectionHint(e);
    setStatus("Lost connection to local translation bridge: "+hint,true);
    clientLog("Polling failed: "+hint,"ERROR");
  }
}
async function cancelJob(){
  if(!T.jobId)return;
  try{
    await fetch(bridgeBase()+"/api/jobs/"+encodeURIComponent(T.jobId)+"/cancel",{method:"POST"});
    setStatus("Cancel requested. The bridge will stop between pages.");
    clientLog("Cancel requested.","WARN");
  }catch(e){
    setStatus("Could not send cancel request: "+e.message,true);
    clientLog("Cancel request failed: "+e.message,"ERROR");
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
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function(){URL.revokeObjectURL(url)},3000);
    setStatus("Translated PDF downloaded.");
    clientLog("Translated PDF downloaded.");
  }catch(e){
    setStatus("Download failed: "+e.message,true);
    clientLog("Download failed: "+e.message,"ERROR");
  }
}
function copyLogs(){
  var text=T.clientLogs.concat(T.lastLogs||[]).join("\n");
  if(!text)return;
  if(navigator.clipboard&&navigator.clipboard.writeText){
    navigator.clipboard.writeText(text).then(function(){clientLog("Event logs copied to clipboard.")}).catch(function(){prompt("Copy translation event logs:",text)});
  }else{
    prompt("Copy translation event logs:",text);
  }
}
async function refreshDiagnostics(){
  await checkBridge(true);
}
function openLocalTranslator(){window.open(bridgeBase()+"/translator","_blank","noopener")}
function startHealthLoop(){if(T.healthTimer)clearInterval(T.healthTimer);T.healthTimer=setInterval(function(){checkBridge(false)},4000)}
function bind(){
  if(!$("#documentTranslator"))return;

  T.bridge=localStorage.getItem("poeTranslatorBridge")||"http://127.0.0.1:8765";
  $("#translateBridgeUrl").value=T.bridge;

  $("#translateFile").onchange=function(e){
    T.file=e.target.files&&e.target.files[0]||null;
    $("#translateFileName").textContent=T.file?T.file.name+" · "+fmt(T.file.size):"No file selected";
    $("#translateStart").disabled=!T.file;
    resetJob();
    if(T.file)clientLog("Selected PDF: "+T.file.name+" ("+fmt(T.file.size)+").");
  };

  $("#translateStart").onclick=startTranslation;
  $("#translateCancel").onclick=cancelJob;
  $("#translateDownload").onclick=downloadResult;
  if($("#translateCheckBridge"))$("#translateCheckBridge").onclick=function(){checkBridge(true)}; if($("#translateOpenLocal"))$("#translateOpenLocal").onclick=openLocalTranslator;
  $("#translateBridgeUrl").onchange=function(){bridgeBase();checkBridge(false)};
  $("#translateCopyLogs").onclick=copyLogs;
  $("#translateRefreshLogs").onclick=refreshDiagnostics;
  $("#translateClearLogs").onclick=function(){T.clientLogs=[];T.lastLogs=[];renderEventLogs()};

  renderEventLogs();
  checkBridge(false);
  startHealthLoop();
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",bind);else bind();
})();