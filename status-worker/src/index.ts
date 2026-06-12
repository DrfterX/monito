// Monito Status Page — Worker that serves the public status dashboard
// Serves the full HTML page built in projects/monito/status/index.html

// prettier-ignore
const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>monito · Status</title>
  <meta name="description" content="Live system status — monito endpoint health monitoring dashboard">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    :root{--bg-primary:#0a0e14;--bg-card:#111820;--bg-card-hover:#1a2430;--border:#1e2a38;--text-primary:#e8edf5;--text-secondary:#7a8ba3;--text-muted:#4a5a70;--status-up:#22c55e;--status-down:#ef4444;--status-unknown:#f59e0b;--status-pulse:rgba(239,68,68,0.3);--accent:#3b82f6;--waveform:#22c55e;--waveform-bg:rgba(34,197,94,0.08);--font-mono:'JetBrains Mono','Fira Code','Cascadia Code',monospace;--font-sans:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;--radius:8px;--transition:200ms ease}
    html{font-size:16px;-webkit-font-smoothing:antialiased}
    body{font-family:var(--font-sans);background:var(--bg-primary);color:var(--text-primary);min-height:100vh;display:flex;flex-direction:column}
    body::after{content:'';position:fixed;inset:0;pointer-events:none;background:repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,0,0,0.08) 2px,rgba(0,0,0,0.08) 4px);z-index:9999}
    ::-webkit-scrollbar{width:6px}::-webkit-scrollbar-track{background:var(--bg-primary)}::-webkit-scrollbar-thumb{background:var(--border);border-radius:3px}
    .app-wrapper{max-width:960px;width:100%;margin:0 auto;padding:32px 20px 48px;flex:1}
    .app-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:32px;gap:16px;flex-wrap:wrap}
    .app-brand{display:flex;align-items:center;gap:12px}
    .app-logo{width:36px;height:36px;border:2px solid var(--status-up);border-radius:50%;display:flex;align-items:center;justify-content:center;font-family:var(--font-mono);font-size:12px;font-weight:600;color:var(--status-up);letter-spacing:1px;box-shadow:0 0 12px rgba(34,197,94,0.2);flex-shrink:0}
    .app-title{font-family:var(--font-mono);font-size:18px;font-weight:600;letter-spacing:.5px;color:var(--text-primary)}
    .app-title span{color:var(--text-muted);font-weight:400}
    .app-header-right{display:flex;align-items:center;gap:18px;font-size:13px}
    .last-updated{font-family:var(--font-mono);color:var(--text-muted);font-size:12px}
    .btn-refresh{background:none;border:1px solid var(--border);color:var(--text-secondary);font-family:var(--font-sans);font-size:12px;padding:6px 14px;border-radius:var(--radius);cursor:pointer;transition:all var(--transition)}
    .btn-refresh:hover{border-color:var(--accent);color:var(--accent);box-shadow:0 0 8px rgba(59,130,246,0.2)}
    .btn-refresh:active{transform:scale(0.96)}
    .status-banner{display:flex;align-items:center;gap:16px;padding:20px 24px;border-radius:var(--radius);border-left:4px solid var(--status-up);background:linear-gradient(135deg,rgba(34,197,94,0.06) 0%,rgba(34,197,94,0.02) 100%);margin-bottom:28px;transition:all 400ms ease;position:relative;overflow:hidden}
    .status-banner.status-down{border-left-color:var(--status-down);background:linear-gradient(135deg,rgba(239,68,68,0.08) 0%,rgba(239,68,68,0.02) 100%);animation:banner-alert 2s ease-in-out infinite}
    .status-banner.status-unknown{border-left-color:var(--status-unknown);background:linear-gradient(135deg,rgba(245,158,11,0.06) 0%,rgba(245,158,11,0.02) 100%)}
    .status-banner::before{content:'';position:absolute;inset:0;background:repeating-linear-gradient(90deg,transparent,transparent 24px,rgba(255,255,255,0.015) 24px,rgba(255,255,255,0.015) 25px);pointer-events:none}
    @keyframes banner-alert{0%,100%{box-shadow:none}50%{box-shadow:inset 0 0 30px rgba(239,68,68,0.08)}}
    .banner-icon{width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:16px}
    .banner-icon.up{background:rgba(34,197,94,0.15);color:var(--status-up);box-shadow:0 0 16px rgba(34,197,94,0.25)}
    .banner-icon.down{background:rgba(239,68,68,0.15);color:var(--status-down);box-shadow:0 0 16px rgba(239,68,68,0.25);animation:pulse-ring 2s ease-in-out infinite}
    .banner-icon.unknown{background:rgba(245,158,11,0.15);color:var(--status-unknown);box-shadow:0 0 16px rgba(245,158,11,0.25);animation:breathe 3s ease-in-out infinite}
    @keyframes pulse-ring{0%{box-shadow:0 0 0 0 var(--status-pulse)}50%{box-shadow:0 0 0 12px transparent}100%{box-shadow:0 0 0 0 transparent}}
    @keyframes breathe{0%,100%{opacity:.7}50%{opacity:1}}
    .banner-text h2{font-family:var(--font-mono);font-size:16px;font-weight:600;letter-spacing:.3px}
    .banner-text p{font-size:13px;color:var(--text-secondary);margin-top:2px}
    .summary-bar{display:flex;gap:24px;margin-bottom:24px;padding:0 4px;font-family:var(--font-mono);font-size:12px}
    .summary-stat{display:flex;align-items:center;gap:6px}
    .summary-stat .dot{width:6px;height:6px;border-radius:50%;display:inline-block}
    .summary-stat .dot.up{background:var(--status-up)}.summary-stat .dot.down{background:var(--status-down)}.summary-stat .dot.unknown{background:var(--status-unknown)}
    .summary-stat .count{color:var(--text-primary);font-weight:600}
    .monitor-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:28px}
    .monitor-card{background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius);padding:18px 20px 16px;cursor:pointer;transition:all var(--transition);animation:card-enter .5s ease-out both;position:relative;overflow:hidden}
    .monitor-card:hover{background:var(--bg-card-hover);border-color:var(--accent);box-shadow:0 0 16px rgba(59,130,246,0.1);transform:translateY(-2px)}
    .monitor-card.selected{border-color:var(--accent);box-shadow:0 0 20px rgba(59,130,246,0.15)}
    .monitor-card.status-down{border-left:3px solid var(--status-down)}
    .monitor-card.status-up{border-left:3px solid var(--status-up)}
    .monitor-card.status-unknown{border-left:3px solid var(--status-unknown)}
    @keyframes card-enter{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
    .card-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}
    .card-name{display:flex;align-items:center;gap:10px}
    .status-dot{width:10px;height:10px;border-radius:50%;flex-shrink:0}
    .status-dot.up{background:var(--status-up);box-shadow:0 0 8px rgba(34,197,94,0.4)}
    .status-dot.down{background:var(--status-down);animation:pulse-ring 2s ease-in-out infinite}
    .status-dot.unknown{background:var(--status-unknown);animation:breathe 3s ease-in-out infinite}
    .card-name h3{font-family:var(--font-mono);font-size:14px;font-weight:600}
    .card-latency{font-family:var(--font-mono);font-size:18px;font-weight:600;color:var(--status-up);letter-spacing:.5px}
    .card-latency.down{color:var(--status-down)}
    .card-latency .unit{font-size:11px;font-weight:400;color:var(--text-muted)}
    .card-body{display:flex;flex-direction:column;gap:4px;margin-bottom:10px}
    .card-row{display:flex;justify-content:space-between;font-size:12px}
    .card-row .label{color:var(--text-muted);font-family:var(--font-mono);font-size:11px}
    .card-row .value{color:var(--text-secondary);font-family:var(--font-mono);font-size:11px}
    .card-row .value.code-ok{color:var(--status-up)}
    .card-row .value.code-warn{color:var(--status-unknown)}
    .card-row .value.code-err{color:var(--status-down)}
    .card-waveform{height:32px;margin-top:4px;border-top:1px solid var(--border);padding-top:8px}
    .card-waveform canvas{width:100%;height:24px;display:block}
    .card-uptime{margin-top:8px;display:flex;align-items:center;gap:8px}
    .uptime-bar{flex:1;height:4px;background:var(--border);border-radius:2px;overflow:hidden}
    .uptime-bar-fill{height:100%;border-radius:2px;transition:width 600ms ease}
    .uptime-bar-fill.high{background:var(--status-up)}
    .uptime-bar-fill.medium{background:var(--status-unknown)}
    .uptime-bar-fill.low{background:var(--status-down)}
    .uptime-pct{font-family:var(--font-mono);font-size:11px;color:var(--text-muted);min-width:36px;text-align:right}
    .waveform-section{background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius);padding:20px 24px 18px;margin-bottom:28px;animation:card-enter .5s ease-out both;animation-delay:.2s}
    .waveform-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}
    .waveform-title{font-family:var(--font-mono);font-size:12px;color:var(--text-secondary);letter-spacing:.5px;text-transform:uppercase}
    .waveform-title span{color:var(--text-muted)}
    .waveform-monitor-label{font-family:var(--font-mono);font-size:11px;color:var(--accent)}
    .waveform-canvas-wrap{position:relative}
    .waveform-canvas-wrap canvas{width:100%;height:140px;display:block;border-radius:4px}
    .app-footer{text-align:center;padding:24px 0 8px;border-top:1px solid var(--border);font-size:12px;color:var(--text-muted);font-family:var(--font-mono)}
    .app-footer a{color:var(--text-secondary);text-decoration:none}
    .app-footer a:hover{color:var(--accent)}
    .footer-stats{display:flex;justify-content:center;gap:24px;margin-bottom:8px;font-size:11px}
    .loading-overlay{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:80px 20px;gap:20px}
    .loading-spinner{width:32px;height:32px;border:2px solid var(--border);border-top-color:var(--accent);border-radius:50%;animation:spin .8s linear infinite}
    @keyframes spin{to{transform:rotate(360deg)}}
    .loading-text{font-family:var(--font-mono);font-size:13px;color:var(--text-muted);animation:pulse-text 1.5s ease-in-out infinite}
    @keyframes pulse-text{0%,100%{opacity:.5}50%{opacity:1}}
    .loading-overlay.hidden,.content-area.hidden{display:none}
    .error-banner{background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.2);border-radius:var(--radius);padding:20px 24px;text-align:center;margin-bottom:20px}
    .error-banner p{font-family:var(--font-mono);font-size:13px;color:var(--status-down)}
    .error-banner .btn-retry{background:none;border:1px solid var(--status-down);color:var(--status-down);font-family:var(--font-sans);font-size:12px;padding:6px 16px;border-radius:var(--radius);margin-top:10px;cursor:pointer;transition:all var(--transition)}
    .error-banner .btn-retry:hover{background:rgba(239,68,68,0.1)}
    .empty-state{text-align:center;padding:60px 20px}
    .empty-state-icon{font-size:48px;opacity:.3;margin-bottom:16px}
    .empty-state h3{font-family:var(--font-mono);font-size:16px;color:var(--text-secondary);margin-bottom:6px}
    .empty-state p{font-size:13px;color:var(--text-muted)}
    @media(max-width:640px){.app-wrapper{padding:20px 14px 32px}.app-header{flex-direction:column;align-items:flex-start;gap:8px}.app-header-right{width:100%;justify-content:space-between}.monitor-grid{grid-template-columns:1fr;gap:12px}.status-banner{padding:16px 18px}.card-latency{font-size:16px}.waveform-section{padding:14px 16px}.waveform-canvas-wrap canvas{height:100px}.summary-bar{flex-wrap:wrap;gap:12px}.footer-stats{flex-direction:column;gap:4px}}
    .timer-bar{height:2px;background:var(--border);position:relative;overflow:hidden;border-radius:1px;margin-bottom:24px}
    .timer-bar-fill{height:100%;background:var(--accent);border-radius:1px;width:100%;animation:timer-countdown 60s linear forwards}
    .timer-bar-fill.reset{animation:none;width:100%}
    @keyframes timer-countdown{from{width:100%}to{width:0%}}
  </style>
</head>
<body>
<div class="app-wrapper">
  <header class="app-header">
    <div class="app-brand">
      <div class="app-logo">M</div>
      <div class="app-title">monito <span>· Status</span></div>
    </div>
    <div class="app-header-right">
      <span class="last-updated" id="lastUpdated">---</span>
      <button class="btn-refresh" id="btnRefresh" title="Refresh now">↺ Refresh</button>
    </div>
  </header>
  <div class="timer-bar"><div class="timer-bar-fill" id="timerFill"></div></div>
  <div class="loading-overlay" id="loadingOverlay">
    <div class="loading-spinner"></div>
    <div class="loading-text">Establishing signals &hellip;</div>
  </div>
  <div class="content-area hidden" id="contentArea">
    <div class="status-banner" id="statusBanner">
      <div class="banner-icon up" id="bannerIcon">◆</div>
      <div class="banner-text">
        <h2 id="bannerTitle">All Systems Operational</h2>
        <p id="bannerSubtitle">Checking endpoints &hellip;</p>
      </div>
    </div>
    <div class="error-banner hidden" id="errorBanner">
      <p>⚠ Failed to fetch status data</p>
      <button class="btn-retry" id="btnRetry">Retry</button>
    </div>
    <div class="summary-bar">
      <div class="summary-stat"><span class="dot up"></span> <span class="count" id="countUp">0</span> operational</div>
      <div class="summary-stat"><span class="dot down"></span> <span class="count" id="countDown">0</span> degraded</div>
      <div class="summary-stat"><span class="dot unknown"></span> <span class="count" id="countUnknown">0</span> unknown</div>
    </div>
    <div class="monitor-grid" id="monitorGrid"></div>
    <div class="waveform-section">
      <div class="waveform-header">
        <div class="waveform-title">Response Time <span>&mdash; Last 60 checks</span></div>
        <div class="waveform-monitor-label" id="waveformLabel">All monitors</div>
      </div>
      <div class="waveform-canvas-wrap">
        <canvas id="waveformCanvas"></canvas>
      </div>
    </div>
    <footer class="app-footer">
      <div class="footer-stats">
        <span>System: <span id="footerSystem">---</span></span>
        <span>Cron: <span id="footerCron">---</span></span>
        <span>Version: <span id="footerVersion">---</span></span>
      </div>
      <a href="https://monito.yycomyy.workers.dev" target="_blank" rel="noopener">monito</a> &middot; API Health Monitoring
    </footer>
  </div>
  <div class="empty-state hidden" id="emptyState">
    <div class="empty-state-icon">📡</div>
    <h3>No monitors configured</h3>
    <p>Add endpoints to monito to see their status here.</p>
  </div>
</div>
<script>
(function(){'use strict'
const B='https://monito.yycomyy.workers.dev',P=6e4,L=60,W=20
let M=[],C={},S=null,T=null,U=false
const $=s=>document.querySelector(s),$$=s=>document.querySelectorAll(s)
const LO=$('#loadingOverlay'),CA=$('#contentArea'),ES=$('#emptyState'),EB=$('#errorBanner'),MG=$('#monitorGrid')
const BE=$('#statusBanner'),BI=$('#bannerIcon'),BT=$('#bannerTitle'),BS=$('#bannerSubtitle')
const CU=$('#countUp'),CD=$('#countDown'),CK=$('#countUnknown'),LU=$('#lastUpdated'),TF=$('#timerFill')
const WC=$('#waveformCanvas'),WL=$('#waveformLabel'),FS=$('#footerSystem'),FC=$('#footerCron'),FV=$('#footerVersion')
function p(t){return new Date(t.replace(' ','T')+'Z')}
function a(d){var f=Math.floor((Date.now()-p(d).getTime())/1e3);return f<0?'just now':f<60?f+'s ago':f<3600?Math.floor(f/60)+'m ago':Math.floor(f/3600)+'h ago'}
function m(v){return v==null?'---':v<1e3?v+' <span class="unit">ms</span>':(v/1e3).toFixed(2)+' <span class="unit">s</span>'}
function sc(c){return c>=200&&c<300?'code-ok':c>=400&&c<500?'code-warn':'code-err'}
function up(cl){if(!cl||!cl.length)return 100;return Math.round(cl.filter(c=>c.status_code>=200&&c.status_code<400).length/cl.length*100)}
function gc(p){return p>=99?'high':p>=95?'medium':'low'}
function e(s){return(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
function tu(u){if(!u)return'';try{var a=new URL(u);return a.hostname+(a.pathname.length>1?a.pathname.substr(0,20)+(a.pathname.length>20?'…':''):'')}catch{return u.length>30?u.substr(0,30)+'…':u}}
function ai(d){var a=new Date(d);var f=Math.floor((Date.now()-a.getTime())/1e3);return f<0?'just now':f<60?f+'s ago':f<3600?Math.floor(f/60)+'m ago':Math.floor(f/3600)+'h ago'}
async function fS(){var r=await fetch(B+'/api/status');if(!r.ok)throw Error(r.status);return r.json()}
async function fC(i,l){var r=await fetch(B+'/api/monitors/'+i+'/checks?limit='+l);if(!r.ok)return[];return r.json()}
async function fH(){var r=await fetch(B+'/health');if(!r.ok)return null;return r.json()}
function rB(d){var dn=d.monitors.filter(m=>m.status==='down').length,uk=d.monitors.filter(m=>m.status==='unknown').length
BE.className='status-banner status-'+(dn?'down':uk?'unknown':'up')
BI.className='banner-icon '+(dn?'down':uk?'unknown':'up')
BT.textContent=dn===0&&uk===0?'All Systems Operational':dn&&uk?dn+' degraded &middot; '+uk+' unknown':dn?dn+' service'+(dn>1?'s':'')+' degraded':uk+' service'+(uk>1?'s':'')+' status unknown'}
function rS(d){CU.textContent=d.monitors.filter(m=>m.status==='up').length;CD.textContent=d.monitors.filter(m=>m.status==='down').length;CK.textContent=d.monitors.filter(m=>m.status==='unknown').length}
function rC(d){var l=d.monitors,fr=document.createDocumentFragment()
l.forEach(function(m,i){var c=document.createElement('div');c.className='monitor-card status-'+m.status+(m.id===S?' selected':'');c.dataset.id=m.id;c.style.animationDelay=(.05*i)+'s'
var ch=C[m.id]||[],ut=up(ch),mc=ch.slice(0,W).reverse()
c.innerHTML='<div class="card-header"><div class="card-name"><span class="status-dot '+m.status+'"></span><h3>'+e(m.name||m.url)+'</h3></div><div class="card-latency '+(m.status==='down'?'down':'')+'">'+(m.last_response_time_ms!=null?m(m.last_response_time_ms):'---')+'</div></div><div class="card-body"><div class="card-row"><span class="label">Status Code</span><span class="value '+sc(m.last_status_code)+'">'+(m.last_status_code||'---')+'</span></div><div class="card-row"><span class="label">Last Check</span><span class="value">'+(m.last_check_at?a(m.last_check_at):'---')+'</span></div><div class="card-row"><span class="label">Endpoint</span><span class="value">'+e(tu(m.url))+'</span></div></div><div class="card-waveform"><canvas data-mini="'+m.id+'" width="300" height="48"></canvas></div><div class="card-uptime"><div class="uptime-bar"><div class="uptime-bar-fill '+gc(ut)+'" style="width:'+ut+'%"></div></div><span class="uptime-pct">'+ut+'%</span></div>'
c.addEventListener('click',function(){if(S===m.id){S=null;rWA()}else{S=m.id;rW(m.id)}
document.querySelectorAll('.monitor-card.selected').forEach(function(el){el.classList.remove('selected')});if(S)c.classList.add('selected');WL.textContent=S?(m.name||m.url):'All monitors'})
fr.appendChild(c)})
MG.innerHTML='';MG.appendChild(fr)
requestAnimationFrame(function(){l.forEach(function(m){var ch=C[m.id]||[];dMW(m.id,ch)})})}
function rT(d){var lt=d.monitors.reduce(function(l,m){return m.last_check_at&&(!l||m.last_check_at>l)?m.last_check_at:l},null)
BS.textContent=lt?'Last checked '+a(lt):'No checks yet';LU.textContent=lt?'Updated '+a(lt):'---'}
function rF(h){if(!h){FS.textContent='---';FC.textContent='---';FV.textContent='---';return}
FS.textContent=h.status==='ok'?'OK':h.status==='warning'?'⚠ Warning':'Starting'
FC.textContent=h.last_cron_run?ai(h.last_cron_run):'---';FV.textContent=h.version||'---'}
function rW(i){var ch=C[i]||[];dW(ch.slice().reverse(),WC)}
function rWA(){var ac=M.map(function(m){return C[m.id]||[]}).filter(function(c){return c.length>0})
if(!ac.length){dW([],WC);return};var p=ac.reduce(function(a,b){return a.length>=b.length?a:b},[]);dW(p.slice().reverse(),WC)}
function dMW(id,ch){var cv=document.querySelector('canvas[data-mini="'+id+'"]');if(!cv)return
cv.width=300;cv.height=48;var ctx=cv.getContext('2d'),data=ch.slice(0,W).reverse()
if(data.length<2){ctx.strokeStyle='#4a5a70';ctx.beginPath();ctx.moveTo(0,24);ctx.lineTo(300,24);ctx.stroke();return}
var mV=Math.max.apply(null,data.map(function(d){return d.response_time_ms}),1),pd=2,dW=296,dH=44,st=dW/(data.length-1)
ctx.clearRect(0,0,300,48);ctx.strokeStyle='#22c55e';ctx.lineWidth=1.5;ctx.beginPath()
data.forEach(function(d,i){var x=pd+i*st,y=pd+dH-(d.response_time_ms/mV)*dH;i===0?ctx.moveTo(x,y):ctx.lineTo(x,y)});ctx.stroke()}
function dW(data,canvas){var pr=canvas.parentElement,r=pr.getBoundingClientRect(),dpr=window.devicePixelRatio||1,w=r.width,h=r.height||140
canvas.style.width=w+'px';canvas.style.height=h+'px';canvas.width=w*dpr;canvas.height=h*dpr
var ctx=canvas.getContext('2d');ctx.scale(dpr,dpr);var pd={top:12,right:16,bottom:20,left:44},dW=w-pd.left-pd.right,dH=h-pd.top-pd.bottom
ctx.clearRect(0,0,w,h)
if(!data||data.length<2){ctx.fillStyle='#4a5a70';ctx.font='12px JetBrains Mono,Fira Code,monospace';ctx.textAlign='center';ctx.fillText('Waiting for data …',w/2,h/2+4);return}
var vs=data.map(function(d){return d.response_time_ms}).filter(function(v){return v!=null});if(!vs.length)return
var mV=Math.max.apply(null,vs),nM=Math.ceil(mV/100)*100||100,gL=4
ctx.strokeStyle='rgba(30,42,56,0.6)';ctx.lineWidth=.5
for(var i=0;i<=gL;i++){var y=pd.top+(dH/gL)*i;ctx.beginPath();ctx.moveTo(pd.left,y);ctx.lineTo(w-pd.right,y);ctx.stroke()
ctx.fillStyle='#4a5a70';ctx.font='11px JetBrains Mono,Fira Code,monospace';ctx.textAlign='right';ctx.textBaseline='middle';ctx.fillText(Math.round(nM-(nM/gL)*i),pd.left-6,y)}
var st=dW/(data.length-1),bY=pd.top+dH
ctx.beginPath();ctx.moveTo(pd.left,bY)
data.forEach(function(d,i){var x=pd.left+i*st,y=pd.top+dH-((d.response_time_ms||0)/nM)*dH;ctx.lineTo(x,y)})
ctx.lineTo(pd.left+(data.length-1)*st,bY);ctx.closePath();ctx.fillStyle='rgba(34,197,94,0.06)';ctx.fill()
ctx.beginPath();ctx.strokeStyle='#22c55e';ctx.lineWidth=1.5;ctx.shadowColor='rgba(34,197,94,0.3)';ctx.shadowBlur=4
data.forEach(function(d,i){var x=pd.left+i*st,y=pd.top+dH-((d.response_time_ms||0)/nM)*dH;i===0?ctx.moveTo(x,y):ctx.lineTo(x,y)})
ctx.stroke();ctx.shadowBlur=0
if(data.length){var la=data[data.length-1],lx=pd.left+(data.length-1)*st,ly=pd.top+dH-((la.response_time_ms||0)/nM)*dH
ctx.beginPath();ctx.arc(lx,ly,3,0,Math.PI*2);ctx.fillStyle='#22c55e';ctx.shadowColor='rgba(34,197,94,0.5)';ctx.shadowBlur=8;ctx.fill();ctx.shadowBlur=0}
ctx.fillStyle='#4a5a70';ctx.font='10px JetBrains Mono,Fira Code,monospace';ctx.textAlign='left';ctx.textBaseline='top'
ctx.fillText(data.length+' checks',pd.left,h-pd.bottom+4);ctx.textAlign='right'
if(data.length)ctx.fillText(data[data.length-1].checked_at?data[data.length-1].checked_at.slice(11,16):'',w-pd.right,h-pd.bottom+4)}
async function up(){if(U)return;U=true
try{var[sD,hD]=await Promise.all([fS(),fH().catch(function(){return null})]);M=sD.monitors||[]
var cP=M.map(function(m){return fC(m.id,L).then(function(ch){C[m.id]=ch}).catch(function(){C[m.id]=[]})});await Promise.all(cP)
EB.classList.add('hidden')
if(!M.length){CA.classList.add('hidden');ES.classList.remove('hidden');LO.classList.add('hidden');U=false;return}
ES.classList.add('hidden');CA.classList.remove('hidden');LO.classList.add('hidden')
rB(sD);rS(sD);rC(sD);rT(sD);rF(hD)
if(S&&C[S]){rW(S);WL.textContent=(M.find(function(m){return m.id===S})||{}).name||'Monitor'}
else{S=null;rWA();WL.textContent='All monitors'}}catch(err){console.error(err);EB.classList.remove('hidden');LO.classList.add('hidden')}
U=false}
function rTmr(){TF.className='timer-bar-fill reset';void TF.offsetWidth;TF.className='timer-bar-fill'}
function sAR(){if(T)clearInterval(T);rTmr();T=setInterval(function(){rTmr();up()},P)}
$('#btnRefresh').addEventListener('click',function(){rTmr();up()})
$('#btnRetry').addEventListener('click',function(){EB.classList.add('hidden');LO.classList.remove('hidden');up()})
up().then(sAR)
var rTm=null;window.addEventListener('resize',function(){if(rTm)clearTimeout(rTm);rTm=setTimeout(function(){S&&C[S]?rW(S):rWA();M.forEach(function(m){var ch=C[m.id]||[];dMW(m.id,ch)})},200)})
})()
<\/script>
</body>
</html>`

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    // API endpoints: redirect to main monito worker
    if (url.pathname.startsWith('/api/') || url.pathname === '/health') {
      return fetch('https://monito.yycomyy.workers.dev' + url.pathname + url.search, {
        method: request.method,
        headers: request.headers,
        body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined,
      })
    }

    // Serve the HTML page
    return new Response(HTML, {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-cache, no-store, must-revalidate',
        'x-robots-tag': 'index, follow',
      },
    })
  }
}