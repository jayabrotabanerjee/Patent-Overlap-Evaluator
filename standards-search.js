(function(){
"use strict";

var STATE={results:[],searching:false};
function $(s){return document.querySelector(s)}
function $$(s){return Array.prototype.slice.call(document.querySelectorAll(s))}
function esc(s){return String(s==null?"":s).replace(/[&<>"']/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]})}
function cut(s,n){s=String(s||"").replace(/\s+/g," ").trim();return s.length<=n?s:s.slice(0,n-1)+"…"}
function hostOk(url,fragment){try{return new URL(url).hostname.toLowerCase().indexOf(fragment.toLowerCase())>=0}catch(e){return false}}
function cleanUrl(u){return String(u||"").replace(/&amp;/g,"&").replace(/[)>.,;]+$/,"")}
function extension(u){var m=cleanUrl(u).match(/\.([a-z0-9]{2,5})(?:[?#].*)?$/i);return m?m[1].toLowerCase():""}
function directLinks(text){var out=[],m,re=/https?:\/\/[^\s<>"')\]]+/gi,s=String(text||"");while((m=re.exec(s))!==null){var u=cleanUrl(m[0]);if(out.indexOf(u)<0)out.push(u)}return out}

var SOURCES=[
{id:"ieee11",label:"IEEE 802.11 Mentor",site:"https://mentor.ieee.org/802.11",host:"mentor.ieee.org",hint:"IEEE 802.11 WLAN Wi-Fi contribution submission motion PHY MAC presentation",files:["ppt","pptx","doc","docx","pdf"]},
{id:"ieee11wg",label:"IEEE 802.11 WG Reports",site:"https://www.ieee802.org/11",host:"ieee802.org",hint:"IEEE 802.11 task group technical submission meeting report",files:["ppt","pptx","doc","docx","pdf"]},
{id:"ieee15",label:"IEEE 802.15 Mentor",site:"https://mentor.ieee.org/802.15",host:"mentor.ieee.org",hint:"IEEE 802.15 wireless contribution submission presentation",files:["ppt","pptx","doc","docx","pdf"]},
{id:"ieee1",label:"IEEE 802.1 Public",site:"https://www.ieee802.org/1",host:"ieee802.org",hint:"IEEE 802.1 bridging TSN contribution presentation",files:["ppt","pptx","pdf","doc","docx"]},
{id:"ieee3",label:"IEEE 802.3 Public",site:"https://www.ieee802.org/3",host:"ieee802.org",hint:"IEEE 802.3 Ethernet contribution presentation",files:["ppt","pptx","pdf"]},
{id:"3gpp",label:"3GPP TDocs / Change Requests",site:"https://www.3gpp.org",host:"3gpp.org",hint:"3GPP TDoc change request CR RAN SA CT GERAN contribution meeting zip",files:["zip","doc","docx","pdf","xlsx","xls"]},
{id:"etsi",label:"ETSI Meeting Contributions",site:"https://docbox.etsi.org",host:"docbox.etsi.org",hint:"ETSI meeting contribution technical proposal",files:["ppt","pptx","doc","docx","zip","pdf"]},
{id:"ietf",label:"IETF Datatracker",site:"https://datatracker.ietf.org",host:"datatracker.ietf.org",hint:"IETF Internet-Draft RFC working group slides",files:["txt","pdf"]},
{id:"rfc",label:"RFC Editor",site:"https://www.rfc-editor.org",host:"rfc-editor.org",hint:"RFC protocol specification",files:["txt","pdf"]},
{id:"itu",label:"ITU-T Public Material",site:"https://www.itu.int",host:"itu.int",hint:"ITU-T contribution recommendation meeting telecom",files:["pdf","doc","docx","zip"]},
{id:"wfa",label:"Wi-Fi Alliance Public Resources",site:"https://www.wi-fi.org",host:"wi-fi.org",hint:"Wi-Fi Alliance technical specification whitepaper certification",files:["pdf"]}
];

var STOP=new Set(("a an the and or of to in for on at by from with without within wherein comprising comprises configured configure configuration first second third one more least plurality said receiving receive received transmitting transmit transmitted generating generate based using use used device apparatus system method station user network data information signal signals communication communications means module unit portion part associated corresponding determine determining calculated calculating performs performing between into through over under before after during than such that which when if is are was were be being been has have having including includes include respective each any").split(/\s+/));

function keywords(claim){
  var words=(String(claim||"").toLowerCase().match(/[a-z][a-z0-9-]{3,}/g)||[]).filter(function(w){return !STOP.has(w)});
  var counts={};words.forEach(function(w){counts[w]=(counts[w]||0)+1});
  return Object.keys(counts).sort(function(a,b){return counts[b]-counts[a]||b.length-a.length}).slice(0,15);
}
function phraseSeeds(claim){
  var parts=String(claim||"").replace(/\r/g,"\n").split(/[;\n]+/).map(function(s){return s.trim()}).filter(function(s){return s.length>18});
  return parts.slice(0,3).map(function(s){return cut(s.replace(/^(a|an|the)\s+/i,""),120)});
}
function queryFor(source,claim,extra){
  if(extra&&extra.trim())return cut(extra.trim()+" "+source.hint,420);
  var ks=keywords(claim),phr=phraseSeeds(claim);
  var q=ks.slice(0,11).join(" ");
  if(phr[0])q='"'+phr[0].replace(/"/g,"")+'" '+q;
  return cut(q+" "+source.hint,480);
}

function getJinaKey(){
  var key=localStorage.getItem("patentOverlapEvaluatorJinaKey")||"";
  if(!key){
    var entered=prompt("Enter a Jina Search API key. It is used only for standards-source web search and is stored in this browser.");
    if(entered&&entered.trim()){key=entered.trim();localStorage.setItem("patentOverlapEvaluatorJinaKey",key)}
  }
  return key;
}
function configureJina(){
  var old=localStorage.getItem("patentOverlapEvaluatorJinaKey")||"";
  var key=prompt("Enter your Jina Search API key. Leave blank to clear it.",old);
  if(key===null)return;
  if(key.trim())localStorage.setItem("patentOverlapEvaluatorJinaKey",key.trim());
  else localStorage.removeItem("patentOverlapEvaluatorJinaKey");
  refreshSearchKey();
}
function refreshSearchKey(){
  var b=$("#standardsKey");
  if(!b)return;
  b.textContent=localStorage.getItem("patentOverlapEvaluatorJinaKey")?"Search API Key ✓":"Configure Search API Key";
}
async function jinaSearch(source,query,key,num){
  var r=await fetch("https://s.jina.ai/",{
    method:"POST",
    headers:{
      "Authorization":"Bearer "+key,
      "Content-Type":"application/json",
      "Accept":"application/json",
      "X-Site":source.site,
      "X-With-Links-Summary":"true"
    },
    body:JSON.stringify({q:query,num:num||5})
  });
  var raw=await r.text(),j;
  try{j=JSON.parse(raw)}catch(e){throw new Error(source.label+": search returned non-JSON response")}
  if(!r.ok)throw new Error(source.label+": "+((j&&j.detail)||j.message||raw||("HTTP "+r.status)));
  var arr=[];
  if(Array.isArray(j))arr=j;
  else if(Array.isArray(j.data))arr=j.data;
  else if(j.data&&Array.isArray(j.data.results))arr=j.data.results;
  else if(Array.isArray(j.results))arr=j.results;
  else if(j.data&&typeof j.data==="object"&&j.data.url)arr=[j.data];
  return arr.map(function(x){return{
    title:x.title||x.name||"",
    url:x.url||x.link||"",
    content:x.content||x.description||x.text||"",
    published:x.publishedTime||x.published_time||x.publishedDate||x.published_date||x.date||x.timestamp||""
  }});
}

function detectedDate(item){
  var candidates=[item.published];
  var text=(item.title||"")+"\n"+(item.content||"");
  var explicit=text.match(/(?:cover date|meeting date|date|published|publication date)\s*[:\-]\s*(20\d{2}[-\/.]\d{1,2}[-\/.]\d{1,2})/i);
  if(explicit)candidates.push(explicit[1]);
  var iso=text.match(/\b(19\d{2}|20\d{2})[-\/.](0?[1-9]|1[0-2])[-\/.](0?[1-9]|[12]\d|3[01])\b/);
  if(iso)candidates.push(iso[0]);
  var month=text.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+([0-3]?\d),?\s+(19\d{2}|20\d{2})\b/i);
  if(month)candidates.push(month[0]);
  for(var i=0;i<candidates.length;i++){
    if(!candidates[i])continue;
    var d=new Date(candidates[i]);
    if(!isNaN(d.getTime()))return{iso:d.toISOString().slice(0,10),label:d.toISOString().slice(0,10)};
  }
  var ieee=(item.url||"").match(/\/dcn\/(\d{2})\/11-(\d{2})-/i);
  if(ieee){var y=2000+Number(ieee[2]);return{iso:y+"-01-01",label:String(y)+" (document year)"}}
  return{iso:"",label:"Date not resolved"};
}
function relevance(claim,item){
  var ks=keywords(claim),hay=((item.title||"")+" "+(item.content||"")).toLowerCase(),hit=[];
  ks.forEach(function(k){if(hay.indexOf(k)>=0)hit.push(k)});
  var score=ks.length?hit.length/ks.length:0;
  return{score:score,terms:hit.slice(0,8)};
}
function fileCandidates(item,source){
  var urls=[item.url].concat(directLinks(item.content));
  var out=[];
  urls.forEach(function(u){
    u=cleanUrl(u);var ext=extension(u);
    if(source.files.indexOf(ext)>=0&&hostOk(u,source.host)&&out.indexOf(u)<0)out.push(u);
  });
  return out;
}
function tdocIds(text){
  var m=String(text||"").match(/\b(?:R[1-4]|RP|S[1-6]|SP|C[1-6]|CP|N[1-4]|NP|T[1-3]|TP|GP|G[1-4])[-‑]\d{6,7}\b/gi)||[];
  return Array.from(new Set(m.map(function(x){return x.replace("‑","-").toUpperCase()}))).slice(0,3);
}
function ieeeDcns(text){
  var m=String(text||"").match(/\b11-\d{2}[\/-]\d{4}(?:r\d+|-\d{2})?/gi)||[];
  return Array.from(new Set(m.map(function(x){return x.toUpperCase()}))).slice(0,3);
}
async function resolveDownload(result,key){
  if(result.downloads&&result.downloads.length)return result;
  if(result.source.id==="3gpp"){
    var ids=tdocIds(result.title+" "+result.content);
    if(ids.length){
      try{
        var q='"'+ids[0]+'.zip" 3GPP';
        var xs=await jinaSearch(result.source,q,key,5);
        for(var i=0;i<xs.length;i++){
          var links=fileCandidates(xs[i],result.source);
          if(links.length){result.downloads=links;return result}
        }
      }catch(e){}
    }
  }
  if(result.source.id.indexOf("ieee")===0){
    var dcns=ieeeDcns(result.title+" "+result.content);
    if(dcns.length){
      try{
        var q='"'+dcns[0]+'" pptx presentation';
        var xs2=await jinaSearch(result.source,q,key,5);
        for(var j=0;j<xs2.length;j++){
          var links2=fileCandidates(xs2[j],result.source);
          if(links2.length){result.downloads=links2;return result}
        }
      }catch(e2){}
    }
  }
  if(result.source.id==="ietf"){
    var dm=(result.title+" "+result.content).match(/\b(draft-[a-z0-9-]+-\d{2})\b/i);
    if(dm)result.downloads=["https://www.ietf.org/archive/id/"+dm[1].toLowerCase()+".txt"];
  }
  if(result.source.id==="rfc"){
    var rm=(result.title+" "+result.content).match(/\bRFC\s*(\d{3,5})\b/i);
    if(rm)result.downloads=["https://www.rfc-editor.org/rfc/rfc"+rm[1]+".pdf"];
  }
  return result;
}
function checkedSources(){var ids=$$(".standards-source:checked").map(function(x){return x.value});return SOURCES.filter(function(s){return ids.indexOf(s.id)>=0})}
function status(msg,error){var e=$("#standardsStatus");if(!e)return;e.textContent=msg;e.classList.toggle("tool-error",Boolean(error))}
function fmtScore(x){return Math.round((x||0)*100)+"%"}
function cutoffAllows(dateInfo,cutoff){
  if(!cutoff||!dateInfo.iso)return true;
  return dateInfo.iso<=cutoff;
}
function render(){
  var box=$("#standardsResults");if(!box)return;
  if(!STATE.results.length){box.innerHTML='<div class="standards-empty">No candidates found yet.</div>';return}
  var html='<div class="standards-result-head"><strong>'+STATE.results.length+' candidate documents</strong><span>Sorted by claim-term overlap within the official-source search results.</span></div>';
  html+='<div class="standards-table-wrap"><table class="standards-table"><thead><tr><th>Source</th><th>Document / Link</th><th>Date</th><th>Disclosure Lead</th><th>Download</th></tr></thead><tbody>';
  STATE.results.forEach(function(r,i){
    var dl=(r.downloads||[]).slice(0,3).map(function(u){var ex=extension(u).toUpperCase()||"FILE";return '<a class="file-link" href="'+esc(u)+'" target="_blank" rel="noopener">Download '+esc(ex)+'</a>'}).join(" ");
    var terms=r.rel.terms.length?'Matched: '+r.rel.terms.join(", "):"Search-ranked source candidate";
    var badge=r.rel.score>=0.55?"High-interest candidate":r.rel.score>=0.3?"Potential overlap":"Context lead";
    html+='<tr><td><strong>'+esc(r.source.label)+'</strong></td><td><a href="'+esc(r.url)+'" target="_blank" rel="noopener">'+esc(r.title||r.url)+'</a><div class="result-snippet">'+esc(cut(r.content,420))+'</div></td><td>'+esc(r.date.label)+'</td><td><span class="lead-badge">'+esc(badge)+' · '+fmtScore(r.rel.score)+'</span><div class="matched-terms">'+esc(terms)+'</div></td><td>'+(dl||'<span class="no-file">No direct file resolved</span>')+'</td></tr>';
  });
  html+='</tbody></table></div>';
  box.innerHTML=html;
}
async function runSearch(){
  if(STATE.searching)return;
  var claim=$("#standardsClaim").value.trim();
  if(!claim){alert("Paste a claim or click Use Subject Claim first.");return}
  var sources=checkedSources();
  if(!sources.length){alert("Select at least one standards source.");return}
  var key=getJinaKey();
  if(!key){alert("A Jina Search API key is required to search the official standards repositories.");return}
  var cutoff=$("#standardsCutoff").value||"";
  var extra=$("#standardsTerms").value||"";
  STATE.searching=true;$("#searchStandards").disabled=true;$("#searchStandards").textContent="Searching...";
  STATE.results=[];render();status("Searching "+sources.length+" official standards-source collections...");
  try{
    var tasks=sources.map(async function(source){
      try{
        var q=queryFor(source,claim,extra);
        var items=await jinaSearch(source,q,key,6);
        return items.map(function(item){
          var date=detectedDate(item),rel=relevance(claim,item);
          return{source:source,title:item.title||"Untitled result",url:item.url,content:item.content||"",date:date,rel:rel,downloads:fileCandidates(item,source)}
        }).filter(function(x){return x.url&&cutoffAllows(x.date,cutoff)});
      }catch(e){
        return[{source:source,error:e.message,title:"",url:"",content:"",date:{iso:"",label:""},rel:{score:0,terms:[]},downloads:[]}];
      }
    });
    var grouped=await Promise.all(tasks),errors=[];
    grouped.forEach(function(g){g.forEach(function(x){if(x.error)errors.push(x.source.label+": "+x.error);else STATE.results.push(x)})});
    STATE.results.sort(function(a,b){return b.rel.score-a.rel.score});
    STATE.results=STATE.results.slice(0,35);
    var toResolve=STATE.results.filter(function(r){return !r.downloads.length&&(r.source.id==="3gpp"||r.source.id.indexOf("ieee")===0||r.source.id==="ietf"||r.source.id==="rfc")}).slice(0,10);
    await Promise.all(toResolve.map(function(r){return resolveDownload(r,key)}));
    render();
    status("Search complete. "+STATE.results.length+" candidates retained"+(cutoff?" through cutoff "+cutoff:"")+(errors.length?". Some sources reported errors: "+errors.join(" | "):"."));
  }catch(e){
    status("Standards search failed: "+e.message,true);
  }finally{
    STATE.searching=false;$("#searchStandards").disabled=false;$("#searchStandards").textContent="Search Standards Prior Art";
  }
}
function useSubjectClaim(){
  var c=$("#claim");
  if(!c||!c.value.trim()){alert("The Subject Patent claim field is empty.");return}
  $("#standardsClaim").value=c.value.trim();
}
function fillSources(){
  var box=$("#standardsSources");if(!box)return;
  box.innerHTML=SOURCES.map(function(s){return '<label class="source-check"><input class="standards-source" type="checkbox" value="'+esc(s.id)+'" checked> '+esc(s.label)+'</label>'}).join("");
}
function bind(){
  if(!$("#standardsSearch"))return;
  fillSources();refreshSearchKey();render();
  $("#standardsKey").onclick=configureJina;
  $("#searchStandards").onclick=runSearch;
  $("#useSubjectClaim").onclick=useSubjectClaim;
  $("#selectAllStandards").onclick=function(){$$(".standards-source").forEach(function(x){x.checked=true})};
  $("#clearAllStandards").onclick=function(){$$(".standards-source").forEach(function(x){x.checked=false})};
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",bind);else bind();
})();