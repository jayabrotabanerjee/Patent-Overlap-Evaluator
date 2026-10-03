(function(){
"use strict";

var DEFAULT_OR_MODELS=[
  "google/gemini-3.8-flash",
  "openai/gpt-5-mini",
  "anthropic/claude-sonnet-4.6"
];

var state={cooldowns:{},dialog:null};

function now(){return Date.now()}
function emit(message,level){
  try{window.dispatchEvent(new CustomEvent("poe-ai-event",{detail:{message:String(message||""),level:level||"INFO"}}))}catch(e){}
}
function safeJsonParse(value,fallback){try{return JSON.parse(value)}catch(e){return fallback}}
function lines(value){return String(value||"").split(/[\r\n,]+/).map(function(x){return x.trim()}).filter(Boolean)}
function unique(items){var out=[];items.forEach(function(x){if(x&&out.indexOf(x)<0)out.push(x)});return out}
function loadArray(key,legacyKey){
  var parsed=safeJsonParse(localStorage.getItem(key)||"[]",[]);
  if(!Array.isArray(parsed))parsed=[];
  if(legacyKey){
    var legacy=String(localStorage.getItem(legacyKey)||"").trim();
    if(legacy&&parsed.indexOf(legacy)<0)parsed.unshift(legacy);
  }
  return unique(parsed.map(String).map(function(x){return x.trim()}).filter(Boolean));
}
function saveArray(key,items){localStorage.setItem(key,JSON.stringify(unique(items)))}
function getConfig(){
  var orModels=lines(localStorage.getItem("poeOpenRouterModels")||DEFAULT_OR_MODELS.join("\n"));
  return{
    mode:localStorage.getItem("poeRoutingMode")||"auto",
    geminiKeys:loadArray("poeGeminiKeys","patentOverlapEvaluatorGeminiKey"),
    openRouterKeys:loadArray("poeOpenRouterKeys"),
    openRouterModels:orModels.length?orModels:DEFAULT_OR_MODELS.slice(),
    gatewayUrl:String(localStorage.getItem("poeGatewayUrl")||"").trim().replace(/\/+$/,""),
    gatewayKey:String(localStorage.getItem("poeGatewayKey")||"").trim(),
    gatewayModels:lines(localStorage.getItem("poeGatewayModels")||""),
    gatewayFirst:localStorage.getItem("poeGatewayFirst")==="true"
  };
}
function setCooldown(id,ms){state.cooldowns[id]=now()+ms}
function cooling(id){return Number(state.cooldowns[id]||0)>now()}
function cleanJsonText(text){
  var s=String(text||"").trim();
  var fence=String.fromCharCode(96)+String.fromCharCode(96)+String.fromCharCode(96);
  if(s.indexOf(fence+"json")===0)s=s.slice(7);
  else if(s.indexOf(fence)===0)s=s.slice(3);
  if(s.lastIndexOf(fence)===s.length-3)s=s.slice(0,-3);
  s=s.split(fence).join("").trim();
  return s;
}
function parseJsonOrThrow(text){
  var cleaned=cleanJsonText(text);
  try{return JSON.parse(cleaned)}
  catch(e){
    var first=cleaned.indexOf("{"),last=cleaned.lastIndexOf("}");
    if(first>=0&&last>first){try{return JSON.parse(cleaned.slice(first,last+1))}catch(ignore){}}
    throw new Error("Model returned text that was not valid JSON.");
  }
}
function retryableStatus(status){return status===401||status===402||status===403||status===404||status===408||status===409||status===429||status>=500}
function quotaLike(message){return /quota|rate limit|resource exhausted|insufficient|credits|billing|limit reached|too many requests/i.test(String(message||""))}
function networkLike(message){return /failed to fetch|networkerror|load failed|network request failed|connection|timeout/i.test(String(message||""))}
async function fetchWithTimeout(url,options,timeoutMs){
  var controller=new AbortController();
  var timer=setTimeout(function(){controller.abort()},timeoutMs||120000);
  try{return await fetch(url,Object.assign({},options||{},{signal:controller.signal}))}
  finally{clearTimeout(timer)}
}
async function callGeminiKey(key,index,model,promptValue,wantJson){
  var id="gemini:"+index;
  if(cooling(id))throw new Error("Gemini key "+(index+1)+" is cooling down after a recent quota/auth failure.");
  var selected=String(model||"gemini-3.8-flash").trim()||"gemini-3.8-flash";
  var url="https://generativelanguage.googleapis.com/v1beta/models/"+encodeURIComponent(selected)+":generateContent";
  emit("Trying Gemini key "+(index+1)+" with "+selected+"...");
  var body={
    contents:[{role:"user",parts:[{text:promptValue}]}],
    generationConfig:wantJson?{responseMimeType:"application/json"}:{temperature:0.08}
  };
  var r,raw,j={};
  try{
    r=await fetchWithTimeout(url,{method:"POST",headers:{"Content-Type":"application/json","x-goog-api-key":key},body:JSON.stringify(body)},150000);
    raw=await r.text();
  }catch(e){throw new Error("Gemini network error: "+e.message)}
  try{j=raw?JSON.parse(raw):{}}catch(e){j={raw:raw}}
  if(!r.ok){
    var msg=j&&j.error&&j.error.message?j.error.message:(raw||("HTTP "+r.status));
    if(r.status===429||quotaLike(msg))setCooldown(id,5*60*1000);
    else if(r.status===401||r.status===403)setCooldown(id,30*60*1000);
    var err=new Error("Gemini key "+(index+1)+" failed ("+r.status+"): "+msg);
    err.status=r.status;err.retryable=retryableStatus(r.status)||quotaLike(msg);throw err;
  }
  var text=j.candidates&&j.candidates[0]&&j.candidates[0].content&&j.candidates[0].content.parts?j.candidates[0].content.parts.map(function(p){return p.text||""}).join(""):"";
  if(!text)throw new Error("Gemini returned an empty response.");
  emit("Gemini key "+(index+1)+" succeeded with "+selected+".");
  return{provider:"Gemini",model:selected,text:text,parsed:wantJson?parseJsonOrThrow(text):null};
}
async function callOpenRouterKey(key,index,models,promptValue,wantJson){
  var id="openrouter:"+index;
  if(cooling(id))throw new Error("OpenRouter key "+(index+1)+" is cooling down after a recent quota/auth failure.");
  var modelList=unique((models||[]).filter(Boolean));
  if(!modelList.length)modelList=DEFAULT_OR_MODELS.slice();
  emit("Trying OpenRouter key "+(index+1)+" with provider + model failover...");
  var body={models:modelList,messages:[{role:"user",content:promptValue}],provider:{allow_fallbacks:true},temperature:0.05};
  var r,raw,j={};
  try{
    r=await fetchWithTimeout("https://openrouter.ai/api/v1/chat/completions",{
      method:"POST",
      headers:{
        "Authorization":"Bearer "+key,
        "Content-Type":"application/json",
        "HTTP-Referer":location.origin+location.pathname,
        "X-Title":"Patent Overlap Evaluator"
      },
      body:JSON.stringify(body)
    },180000);
    raw=await r.text();
  }catch(e){throw new Error("OpenRouter network error: "+e.message)}
  try{j=raw?JSON.parse(raw):{}}catch(e){j={raw:raw}}
  if(!r.ok){
    var msg=j&&j.error&&(j.error.message||(j.error.metadata&&j.error.metadata.raw))?(j.error.message||j.error.metadata.raw):(raw||("HTTP "+r.status));
    if(r.status===429||r.status===402||quotaLike(msg))setCooldown(id,5*60*1000);
    else if(r.status===401||r.status===403)setCooldown(id,30*60*1000);
    var err=new Error("OpenRouter key "+(index+1)+" failed ("+r.status+"): "+msg);
    err.status=r.status;err.retryable=retryableStatus(r.status)||quotaLike(msg);throw err;
  }
  var text=j&&j.choices&&j.choices[0]&&j.choices[0].message?String(j.choices[0].message.content||""):"";
  if(!text)throw new Error("OpenRouter returned an empty response.");
  var used=j.model||"routed model";
  emit("OpenRouter succeeded with "+used+".");
  return{provider:"OpenRouter",model:used,text:text,parsed:wantJson?parseJsonOrThrow(text):null};
}
async function callGateway(cfg,promptValue,wantJson){
  if(!cfg.gatewayUrl)throw new Error("No custom gateway URL configured.");
  var models=cfg.gatewayModels.length?cfg.gatewayModels:["auto"];
  emit("Trying custom OpenAI-compatible gateway "+cfg.gatewayUrl+"...");
  var body={model:models[0],messages:[{role:"user",content:promptValue}],temperature:0.05};
  if(models.length>1)body.models=models;
  var headers={"Content-Type":"application/json"};
  if(cfg.gatewayKey)headers.Authorization="Bearer "+cfg.gatewayKey;
  var endpoint=/\/chat\/completions$/i.test(cfg.gatewayUrl)?cfg.gatewayUrl:cfg.gatewayUrl+"/chat/completions";
  var r,raw,j={};
  try{
    r=await fetchWithTimeout(endpoint,{method:"POST",headers:headers,body:JSON.stringify(body)},180000);
    raw=await r.text();
  }catch(e){throw new Error("Custom gateway network error: "+e.message)}
  try{j=raw?JSON.parse(raw):{}}catch(e){j={raw:raw}}
  if(!r.ok){
    var msg=j&&j.error&&(j.error.message||j.error)?(j.error.message||String(j.error)):(raw||("HTTP "+r.status));
    var err=new Error("Custom gateway failed ("+r.status+"): "+msg);
    err.status=r.status;err.retryable=retryableStatus(r.status)||quotaLike(msg)||networkLike(msg);throw err;
  }
  var text=j&&j.choices&&j.choices[0]&&j.choices[0].message?String(j.choices[0].message.content||""):"";
  if(!text)throw new Error("Custom gateway returned an empty response.");
  var used=j.model||models[0];
  emit("Custom gateway succeeded with "+used+".");
  return{provider:"Gateway",model:used,text:text,parsed:wantJson?parseJsonOrThrow(text):null};
}
function buildRouteOrder(cfg){
  if(cfg.mode==="gemini")return["gemini"];
  if(cfg.mode==="openrouter")return["openrouter"];
  if(cfg.mode==="gateway")return["gateway"];
  if(cfg.gatewayFirst)return["gateway","gemini","openrouter"];
  return["gemini","openrouter","gateway"];
}
async function call(promptValue,options){
  options=options||{};
  var wantJson=options.json!==false;
  var cfg=getConfig();
  var model=options.geminiModel||localStorage.getItem("patentOverlapEvaluatorGeminiModel")||"gemini-3.8-flash";
  var order=buildRouteOrder(cfg),errors=[];
  for(var oi=0;oi<order.length;oi++){
    var route=order[oi];
    if(route==="gemini"){
      if(!cfg.geminiKeys.length){errors.push("Gemini: no keys configured");continue}
      for(var gi=0;gi<cfg.geminiKeys.length;gi++){
        try{return await callGeminiKey(cfg.geminiKeys[gi],gi,model,promptValue,wantJson)}
        catch(e){errors.push(e.message);emit(e.message,"WARN");if(e.retryable===false)break}
      }
    }else if(route==="openrouter"){
      if(!cfg.openRouterKeys.length){errors.push("OpenRouter: no keys configured");continue}
      for(var ri=0;ri<cfg.openRouterKeys.length;ri++){
        try{return await callOpenRouterKey(cfg.openRouterKeys[ri],ri,cfg.openRouterModels,promptValue,wantJson)}
        catch(e2){errors.push(e2.message);emit(e2.message,"WARN");if(e2.retryable===false)break}
      }
    }else if(route==="gateway"){
      if(!cfg.gatewayUrl){errors.push("Gateway: no URL configured");continue}
      try{return await callGateway(cfg,promptValue,wantJson)}
      catch(e3){errors.push(e3.message);emit(e3.message,"WARN")}
    }
  }
  var err=new Error("All configured AI routes failed. "+errors.slice(-8).join(" | "));
  err.routeErrors=errors;throw err;
}
function ensureDialog(){
  if(state.dialog)return state.dialog;
  var d=document.createElement("dialog");
  d.id="aiRouterDialog";
  d.innerHTML='<div class="router-modal">'+
    '<h3>AI Router Configuration</h3>'+
    '<p class="router-help">Auto Failover rotates across your configured Gemini keys, then OpenRouter, then an optional OpenAI-compatible gateway. Keys stay in this browser and are never committed to GitHub.</p>'+
    '<label>Routing mode<select id="routerMode"><option value="auto">Auto Failover</option><option value="gemini">Gemini only</option><option value="openrouter">OpenRouter only</option><option value="gateway">Custom gateway only</option></select></label>'+
    '<label>Gemini API keys <span>one per line; use only projects/accounts you are authorized to use</span><textarea id="routerGeminiKeys" placeholder="AIza...&#10;AIza..."></textarea></label>'+
    '<label>OpenRouter API keys <span>one per line</span><textarea id="routerOpenRouterKeys" placeholder="sk-or-v1-..."></textarea></label>'+
    '<label>OpenRouter fallback models <span>one per line, tried in order</span><textarea id="routerOpenRouterModels"></textarea></label>'+
    '<div class="router-grid">'+
      '<label>Custom gateway URL <span>OmniRoute / Cloudflare / any OpenAI-compatible /v1 endpoint</span><input id="routerGatewayUrl" placeholder="http://localhost:20128/v1"></label>'+
      '<label>Gateway API key <span>optional for local gateways</span><input id="routerGatewayKey" type="password" placeholder="API key"></label>'+
    '</div>'+
    '<label>Gateway model / fallback models <span>one per line</span><textarea id="routerGatewayModels" placeholder="combo-name&#10;backup-model"></textarea></label>'+
    '<label class="router-inline"><input id="routerGatewayFirst" type="checkbox"> Try custom gateway before direct Gemini/OpenRouter in Auto mode</label>'+
    '<div id="routerTestStatus" class="router-status">Not tested.</div>'+
    '<div class="router-actions"><button id="routerCancel" class="btn2">Cancel</button><button id="routerTest" class="btn2">Test Router</button><button id="routerSave" class="small">Save</button></div>'+
  '</div>';
  document.body.appendChild(d);
  d.querySelector("#routerCancel").onclick=function(){d.close()};
  d.querySelector("#routerSave").onclick=function(){saveDialog(d);d.close();emit("AI Router configuration saved.")};
  d.querySelector("#routerTest").onclick=async function(){
    saveDialog(d);
    var status=d.querySelector("#routerTestStatus");
    status.textContent="Testing...";
    try{
      var result=await call('Return ONLY this JSON object: {"ok":true,"service":"router-test"}',{json:true});
      status.textContent="Success: "+result.provider+" · "+result.model;
      status.classList.remove("router-error");
    }catch(e){
      status.textContent=e.message;
      status.classList.add("router-error");
    }
  };
  state.dialog=d;return d;
}
function saveDialog(d){
  localStorage.setItem("poeRoutingMode",d.querySelector("#routerMode").value);
  var gs=lines(d.querySelector("#routerGeminiKeys").value);
  saveArray("poeGeminiKeys",gs);
  if(gs.length)localStorage.setItem("patentOverlapEvaluatorGeminiKey",gs[0]);else localStorage.removeItem("patentOverlapEvaluatorGeminiKey");
  saveArray("poeOpenRouterKeys",lines(d.querySelector("#routerOpenRouterKeys").value));
  localStorage.setItem("poeOpenRouterModels",lines(d.querySelector("#routerOpenRouterModels").value).join("\n"));
  localStorage.setItem("poeGatewayUrl",d.querySelector("#routerGatewayUrl").value.trim());
  localStorage.setItem("poeGatewayKey",d.querySelector("#routerGatewayKey").value.trim());
  localStorage.setItem("poeGatewayModels",lines(d.querySelector("#routerGatewayModels").value).join("\n"));
  localStorage.setItem("poeGatewayFirst",d.querySelector("#routerGatewayFirst").checked?"true":"false");
}
function openConfig(){
  var d=ensureDialog(),cfg=getConfig();
  d.querySelector("#routerMode").value=cfg.mode;
  d.querySelector("#routerGeminiKeys").value=cfg.geminiKeys.join("\n");
  d.querySelector("#routerOpenRouterKeys").value=cfg.openRouterKeys.join("\n");
  d.querySelector("#routerOpenRouterModels").value=cfg.openRouterModels.join("\n");
  d.querySelector("#routerGatewayUrl").value=cfg.gatewayUrl;
  d.querySelector("#routerGatewayKey").value=cfg.gatewayKey;
  d.querySelector("#routerGatewayModels").value=cfg.gatewayModels.join("\n");
  d.querySelector("#routerGatewayFirst").checked=cfg.gatewayFirst;
  d.querySelector("#routerTestStatus").textContent="Not tested.";
  d.querySelector("#routerTestStatus").classList.remove("router-error");
  d.showModal();
}
function status(){
  var cfg=getConfig(),parts=[];
  if(cfg.geminiKeys.length)parts.push(cfg.geminiKeys.length+" Gemini key"+(cfg.geminiKeys.length===1?"":"s"));
  if(cfg.openRouterKeys.length)parts.push(cfg.openRouterKeys.length+" OpenRouter key"+(cfg.openRouterKeys.length===1?"":"s"));
  if(cfg.gatewayUrl)parts.push("Gateway");
  return{mode:cfg.mode,configured:parts.length>0,summary:parts.length?parts.join(" + "):"No AI route configured"};
}
window.POEAI={
  callJson:function(promptValue,options){return call(promptValue,Object.assign({},options||{},{json:true}))},
  callText:function(promptValue,options){return call(promptValue,Object.assign({},options||{},{json:false}))},
  openConfig:openConfig,
  status:status,
  getConfig:getConfig,
  clearCooldowns:function(){state.cooldowns={};emit("AI Router cooldowns cleared.")}
};
})();