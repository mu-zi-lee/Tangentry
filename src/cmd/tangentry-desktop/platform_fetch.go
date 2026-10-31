package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/egoist/mygo"

	"tangentry/internal/app"
	"tangentry/internal/platformfetch"
)

const (
	platformFetchMaxBody     = 4 << 20
	douyinMediaCandidateMax  = 32
	douyinDOMCandidateMax    = 16
	platformFetchTimeout     = 20 * time.Second
	douyinVideoMediaTimeout  = 25 * time.Second
	platformFetchIdle        = 45 * time.Second
	douyinCapturePoll        = 200 * time.Millisecond
	douyinDOMWait            = 15 * time.Second
	douyinCaptureStable      = 700 * time.Millisecond
	douyinCaptureQuiet       = 3 * time.Second
	douyinFeedCaptureTimeout = 75 * time.Second
)

type platformPageBridge struct {
	mu           sync.Mutex
	sessions     map[string]*platformPageSession
	closed       bool
	createWindow func(*platformPageSession) (platformSessionWindow, error)
}

type platformSessionWindow interface {
	Page() *mygo.Page
	LoadURL(string) error
	EvalContext(context.Context, string) (any, error)
	IsDestroyed() bool
	Close()
}

type nativePlatformSessionWindow struct{ *mygo.Window }

func (window *nativePlatformSessionWindow) EvalContext(ctx context.Context, script string) (any, error) {
	return window.Page().EvalContext(ctx, script)
}

func (window *nativePlatformSessionWindow) LoadURL(url string) error {
	return window.Page().LoadURL(url)
}

type platformPageSession struct {
	bridge            *platformPageBridge
	platform          string
	origin            string
	window            platformSessionWindow
	ctx               context.Context
	cancel            context.CancelFunc
	initialized       chan struct{}
	initErr           error
	operation         chan struct{}
	users             int
	lastUsed          time.Time
	closeAt           *time.Timer
	closeGeneration   uint64
	closing           bool
	destroyed         atomic.Bool
	ready             chan struct{}
	readyOnce         sync.Once
	blockedNavigation atomic.Value
}

const (
	platformPageWindowWidth  = 1024
	platformPageWindowHeight = 768
	platformPageWindowGap    = 32
)

// platformPageWindowPosition places the bridge outside the union of all
// connected displays. macOS may still constrain a native window back onto a
// display; concealPlatformPageWindow handles that fallback after creation.
func platformPageWindowPosition(displays []mygo.Display, width, height int) (int, int) {
	if len(displays) == 0 {
		return -width - platformPageWindowGap, -height - platformPageWindowGap
	}
	minX, minY := displays[0].Bounds.X, displays[0].Bounds.Y
	maxX := displays[0].Bounds.X + displays[0].Bounds.Width
	maxY := displays[0].Bounds.Y + displays[0].Bounds.Height
	for _, display := range displays[1:] {
		minX = minInt(minX, display.Bounds.X)
		minY = minInt(minY, display.Bounds.Y)
		maxX = maxInt(maxX, display.Bounds.X+display.Bounds.Width)
		maxY = maxInt(maxY, display.Bounds.Y+display.Bounds.Height)
	}
	return minX - width - platformPageWindowGap, minY - height - platformPageWindowGap
}

func rectanglesOverlap(a, b mygo.Rectangle) bool {
	return a.X < b.X+b.Width && b.X < a.X+a.Width && a.Y < b.Y+b.Height && b.Y < a.Y+a.Height
}

func platformPageWindowScreen(bounds mygo.Rectangle, displays []mygo.Display) string {
	for _, display := range displays {
		if rectanglesOverlap(bounds, display.Bounds) {
			if display.Label != "" {
				return display.Label
			}
			return fmt.Sprintf("display-%d", display.ID)
		}
	}
	return "屏幕外"
}

func platformPageWindowNeedsFallback(bounds mygo.Rectangle, displays []mygo.Display) bool {
	return platformPageWindowScreen(bounds, displays) != "屏幕外"
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func concealPlatformPageWindow(window *mygo.Window, planned mygo.Rectangle) {
	if window == nil || window.IsDestroyed() {
		return
	}
	displays := mygo.Screen.Displays()
	actual := window.Bounds()
	screen := platformPageWindowScreen(actual, displays)
	fallback := platformPageWindowNeedsFallback(actual, displays)
	// Opacity=0 is applied after creation because WindowOptions intentionally
	// normalizes non-positive opacity to 1. The native page remains composited,
	// while the bridge cannot be seen, focused, clicked, or captured.
	window.SetOpacity(0)
	window.SetIgnoreMouseEvents(true)
	window.SetContentProtection(true)
	window.Blur()
	slog.Info("平台请求窗口已隐藏", "frame", actual, "screen", screen, "planned", planned, "fallback", fallback)
}

const douyinFeedCaptureScript = `(function(){
  const observerVersion=3;
  if (window.__tangentryDouyinObserverVersion===observerVersion && window.fetch===window.__tangentryDouyinFetchWrapper && XMLHttpRequest.prototype.send===window.__tangentryDouyinXHRSend) return;
  window.__tangentryDouyinObserverVersion=observerVersion;
  window.__tangentryDouyinFeedInstalled=true;
  window.__tangentryDouyinFeed = window.__tangentryDouyinFeed || [];
  window.__tangentryDouyinMedia = window.__tangentryDouyinMedia || [];
  const max = 4 * 1024 * 1024;
  const isFeed = value => /\/aweme\/(?:v1|v2)\/[^?]*feed/i.test(String(value || ''));
  const isMedia = value => /\/aweme\/(?:v1|v2)\/[^?]*(?:detail|post|related|feed)/i.test(String(value || ''));
  const jsonType = value => { const type = String(value || '').toLowerCase().split(';', 1)[0].trim(); return !type || type === 'application/json' || type === 'text/json' || type.endsWith('+json'); };
  const absolute = raw => { try { return new URL(String(raw || ''), location.href).href; } catch (_) { return String(raw || ''); } };
  const idOf = value => { const match = String(value || '').match(/^[1-9][0-9]{15,19}$/); return match ? match[0] : ''; };
  const countOf = value => { const number = Number(value); return Number.isFinite(number) && number >= 0 ? Math.min(Math.round(number), 2147483647) : 0; };
  const safeImage = raw => { try { const value=new URL(String(raw||''),location.href),authority=value.href.slice(value.protocol.length+2).split(/[/?#]/,1)[0]; return value.protocol==='https:'&&value.hostname&&!value.username&&!value.password&&authority===value.host?value.href:''; } catch (_) { return ''; } };
  const imageURLs = (value,depth=0) => { if(!value||depth>4)return []; if(Array.isArray(value))return value.slice(0,16).flatMap(item=>imageURLs(item,depth+1)).slice(0,16); if(typeof value==='string')return [safeImage(value)].filter(Boolean); if(typeof value==='object')return ['url_list','urlList','url','uri'].flatMap(key=>imageURLs(value[key],depth+1)).slice(0,16); return []; };
  const project = video => {
    if (!video || typeof video !== 'object') return null;
    const id = idOf(video.aweme_id || video.awemeId || video.item_id || video.itemId); if (!id) return null;
    const author = video.author || {};
    const media = video.video || {};
    const thumbnailURL = [media.cover,media.origin_cover,media.dynamic_cover,media.fallback_cover,media.coverUrl,media.originCover,media.dynamicCover].flatMap(value=>imageURLs(value))[0] || '';
    return {id:id, url:'https://www.douyin.com/video/' + id, thumbnailURL:thumbnailURL, title:String(video.desc || video.description || '').slice(0, 1000), author:String(author.nickname || author.name || '').slice(0, 200), authorID:String(author.uid || author.id || '').slice(0, 200), likeCount:countOf(video.statistics && (video.statistics.digg_count || video.statistics.diggCount)), duration:Math.round(countOf(video.video && video.video.duration) / 1000)};
  };
  const projectBody = body => {
    try { const value = typeof body === 'string' ? JSON.parse(body) : body; const root = value && value.data && typeof value.data === 'object' ? value.data : value; const status = root && root.status_code != null ? root.status_code : value && value.status_code; const code = status == null ? 0 : Number(status)||0; const list = root && (root.aweme_list || root.awemeList); const parsed = Array.isArray(list) && (code === 0 || code === 2154); return {status:code,parsed:parsed,hasMore:code === 0 && Number(root && root.has_more)>0,cards:code === 0 && Array.isArray(list) ? list.map(project).filter(Boolean).slice(0, 500) : []}; } catch (_) { return null; }
  };
  const idOfAny = value => { const match=String(value || '').match(/^[1-9][0-9]{15,19}$/); return match ? match[0] : ''; };
  const targetID = () => { try { const path=String(location.pathname||'').match(/^\/video\/([1-9][0-9]{15,19})(?:\/|$)/); return idOfAny(window.__tangentryDouyinMediaTarget || sessionStorage.getItem('__tangentryDouyinMediaTarget') || path && path[1] || ''); } catch (_) { return idOfAny(window.__tangentryDouyinMediaTarget || ''); } };
  const mediaURLs = value => { const result=[]; let count=0; const add=(value,depth=0) => { if (count>=4||depth>3) return; if (Array.isArray(value)) value.slice(0,8).forEach(item=>add(item,depth+1)); else if (typeof value === 'string') { const absoluteValue=absolute(value); if (absoluteValue.length) { result.push(absoluteValue.slice(0,8193)); count++; } } }; if (value && typeof value === 'object') { add(value.play_addr && (value.play_addr.url_list || value.play_addr.urlList)); const rates=value.bit_rate || value.bitRate; if (Array.isArray(rates)) rates.slice(0,8).forEach(rate=>add(rate && rate.play_addr && (rate.play_addr.url_list || rate.play_addr.urlList))); } return result; };
  const mediaBody = (body, target) => {
    if (typeof body !== 'string' && (!body || typeof body !== 'object')) return {requestID:'', matchedIDs:[], candidates:[], businessStatus:0, restricted:false, invalidJSON:false};
    try {
      const value = typeof body === 'string' ? JSON.parse(body) : body;
      const candidates = [], seen = new Set(), matchedIDs = new Set(); let visited = 0;
      const walk = (node, depth) => {
        if (!node || typeof node !== 'object' || depth > 8 || candidates.length >= 32 || visited >= 30000) return;
        visited++;
        const id=idOfAny(node.aweme_id || node.awemeId || node.item_id || node.itemId || node.video_id || node.videoId);
        if (id && (id === target || !target) && matchedIDs.size < 32) matchedIDs.add(id);
        const urls=mediaURLs(node.video);
        if (id && (!target || id === target) && urls.length) { const key=id+'|'+urls.join('|'); if (!seen.has(key)) { seen.add(key); candidates.push({id:id,urls:urls}); } }
        let keys=0; for (const key in node) { if (++keys > 200) break; walk(node[key], depth+1); }
      };
      walk(value, 0);
      const root=value&&value.data&&typeof value.data==='object'?value.data:value, message=String(root&&(root.status_msg||root.statusMsg||root.status_message||root.message)||''), businessStatus=Number(root&&(root.status_code??root.statusCode))||0;
      const restricted=businessStatus!==0&&/login|登录|captcha|验证码|verify|验证|challenge|passport|risk[ -]?control|风控|滑块|人机/i.test(message);
      return {requestID:idOfAny(value && (value.aweme_id || value.awemeId)), matchedIDs:Array.from(matchedIDs), candidates:candidates, businessStatus:businessStatus, restricted:restricted, invalidJSON:false};
    } catch (_) { return {requestID:'', matchedIDs:[], candidates:[], businessStatus:0, restricted:false, invalidJSON:true}; }
  };
  const redactedSnippet = body => { if ((typeof body !== 'string' && (!body || typeof body !== 'object')) || (typeof body==='string'&&body.length>max)) return ''; try { const value=typeof body==='string'?JSON.parse(body):body, root=value&&value.data&&typeof value.data==='object'?value.data:value, safe={}; const code=Number(root&&(root.status_code??root.statusCode)); if(Number.isSafeInteger(code))safe.status_code=code; const message=root&&(root.status_msg||root.statusMsg||root.status_message||root.message); if(typeof message==='string')safe.message='[文本已脱敏]'; const text=JSON.stringify(safe); return text==='{}'?'':text.slice(0,200); } catch (_) { return ''; } };
  const byteLength = value => { let bytes=0,visited=0; const textSize=text=>{let size=0;for(let i=0;i<text.length;i++){const code=text.charCodeAt(i);size+=code<0x80?1:code<0x800?2:code>=0xD800&&code<=0xDBFF&&i+1<text.length&&text.charCodeAt(i+1)>=0xDC00?4:3;if(code>=0xD800&&code<=0xDBFF)i++;if(size>max)return max+1;}return size;}; const walk=(node,depth)=>{if(bytes>max||depth>16||visited++>50000){bytes=max+1;return;} if(typeof node==='string'){bytes+=textSize(node);return;} if(typeof node==='number'||typeof node==='boolean'){bytes+=String(node).length;return;} if(Array.isArray(node)){for(const item of node){walk(item,depth+1);if(bytes>max)return;}return;} if(node&&typeof node==='object'){let keys=0;for(const key in node){if(++keys>200){bytes=max+1;return;}bytes+=textSize(key)+3;walk(node[key],depth+1);if(bytes>max)return;}}}; try { walk(value,0); return bytes>max?max+1:bytes; } catch (_) { return max+1; } };
  const pushMedia = (url, status, contentType, body, tooLarge, hasResponse=true, reason='', observedBytes=null) => {
    const resolvedURL=absolute(url), target=targetID(), parsed=mediaBody(body,target), queryID=(()=>{ try { const params=new URL(resolvedURL).searchParams; for(const key of ['aweme_id','awemeId','item_id','itemId','video_id','videoId']) { const id=idOfAny(params.get(key)); if(id)return id; } return ''; } catch (_) { return ''; } })();
    const matches=parsed.candidates.slice(0,32);
    const path=(()=>{ try { const u=new URL(resolvedURL); return u.hostname.toLowerCase()+u.pathname; } catch (_) { return ''; } })();
    const restricted=parsed.restricted||/\/(?:login|passport|verify|captcha|challenge|acrawler)(?:\/|$)/i.test(path)||(!jsonType(contentType)&&typeof body==='string'&&/<(?:html|!doctype)|verify_center|verify_page|slide_verify|challenge-platform|cf-chl-/i.test(body.slice(0,4096))&&/captcha|验证码|安全验证|verify_center|verify_page|slide_verify|challenge-platform|cf-chl-|just a moment/i.test(body.slice(0,4096)));
    const resolvedReason=reason || (tooLarge?'response_too_large':!jsonType(contentType)?'non_json':parsed.invalidJSON?'invalid_json':'');
    const responseReceived=hasResponse&&Number(status)>0;
    const responseBytes=observedBytes!=null?observedBytes:body!==null&&body!==undefined?byteLength(body):null;
    const matchedIDs=parsed.matchedIDs.slice(0,32);
    const requestID=queryID || parsed.requestID || '', targetMatchCount=matches.length || (target && requestID===target ? 1 : parsed.matchedIDs.includes(target) ? 1 : 0);
    window.__tangentryDouyinMedia.push({path:path, status:responseReceived?Number(status):null, contentType:String(contentType||'').split(';',1)[0].trim().toLowerCase().slice(0,128), responseBytes:responseBytes, tooLarge:Boolean(tooLarge), hasResponse:responseReceived, reason:resolvedReason, businessStatus:parsed.businessStatus, restricted:restricted, requestID:requestID, targetMatchCount:targetMatchCount, matchedIDs:matchedIDs, candidates:matches.slice(0,32), snippetRedacted:redactedSnippet(body)});
    if (window.__tangentryDouyinMedia.length > 8) window.__tangentryDouyinMedia.splice(0, window.__tangentryDouyinMedia.length - 8);
  };
  const push = (url, status, contentType, body, tooLarge) => {
    const resolvedURL = absolute(url);
    if (!isFeed(resolvedURL) && !isMedia(resolvedURL)) return;
    const type = String(contentType || '');
    if (isFeed(resolvedURL)) { const payload=jsonType(type)?projectBody(body):null; window.__tangentryDouyinFeed.push({url:resolvedURL, status:Number(status)||0, contentType:type, apiStatus:payload && payload.status || 0, parsed:payload ? payload.parsed : false, hasMore:payload ? payload.hasMore : false, tooLarge:Boolean(tooLarge), cards:payload ? payload.cards : []}); if (window.__tangentryDouyinFeed.length > 32) window.__tangentryDouyinFeed.splice(0, window.__tangentryDouyinFeed.length - 32); }
    if (isMedia(resolvedURL)) { const reason=tooLarge?'response_too_large':!jsonType(type)?'non_json':''; pushMedia(resolvedURL, status, type, body, tooLarge, true, reason); }
  };
  const originalFetch = window.__tangentryDouyinOriginalFetch || window.fetch;
  window.__tangentryDouyinOriginalFetch = originalFetch;
  const fetchWrapper = function(){
    const request = arguments[0];
    const url = typeof request === 'string' ? request : request && request.url;
    return originalFetch.apply(this, arguments).then(response => {
      if (!isFeed(url || response.url) && !isMedia(url || response.url)) return response;
      try { const contentType = response.headers && response.headers.get ? response.headers.get('content-type') : ''; if(isMedia(url||response.url)&&response.status===0){pushMedia(url||response.url,null,contentType,null,false,false,'response_unavailable');return response;} if (isMedia(url || response.url) && !jsonType(contentType)) { const clone=response.clone(); if (clone.body) { const reader=clone.body.getReader(), decoder=new TextDecoder(); let body='', bytes=0; (async()=>{for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>max){await reader.cancel();pushMedia(url||response.url,response.status,contentType,null,true,true,'response_too_large',bytes);return;}body+=decoder.decode(part.value,{stream:true});}body+=decoder.decode();pushMedia(url||response.url,response.status,contentType,body,false,true,'non_json',bytes);})().catch(()=>pushMedia(url||response.url,response.status,contentType,null,false,true,'response_unavailable')); } else pushMedia(url||response.url,response.status,contentType,null,false,true,'response_unavailable'); return response; } if (jsonType(contentType)) { const length=Number(response.headers && response.headers.get ? response.headers.get('content-length') || 0 : 0); if (length > max) { if(isMedia(url||response.url))pushMedia(url||response.url,response.status,contentType,null,true,true,'response_too_large',length); else push(url || response.url, response.status, contentType, null, true); } else if (response.body) { const clone=response.clone(); if (!clone.body) { if(isMedia(url||response.url))pushMedia(url||response.url,response.status,contentType,null,false,true,'response_unavailable',length||null);else push(url || response.url, response.status, contentType, null, true); } else { const reader=clone.body.getReader(), decoder=new TextDecoder(); let body='', bytes=0; (async()=>{ for(;;){ const part=await reader.read(); if(part.done) break; bytes+=part.value.byteLength; if(bytes>max){ await reader.cancel(); if(isMedia(url||response.url))pushMedia(url||response.url,response.status,contentType,null,true,true,'response_too_large',bytes); else push(url || response.url, response.status, contentType, null, true); return; } body+=decoder.decode(part.value,{stream:true}); } body+=decoder.decode(); const parsed=mediaBody(body,targetID()); if(isMedia(url||response.url)&&parsed.invalidJSON)pushMedia(url||response.url,response.status,contentType,null,false,true,'invalid_json',bytes); else push(url || response.url,response.status,contentType,body,false); })().catch(()=>{if(isMedia(url||response.url))pushMedia(url||response.url,response.status,contentType,null,false,true,'response_unavailable');}); } } else if(isMedia(url||response.url))pushMedia(url||response.url,response.status,contentType,null,false,true,'response_unavailable',length||null);else push(url || response.url, response.status, contentType, null, true); } else push(url || response.url, response.status, contentType, null, false); } catch (_) { if(isMedia(url||response.url))pushMedia(url||response.url,response.status,'',null,false,true,'response_unavailable'); }
      if (isMedia(url || response.url) && response.status === 0) pushMedia(url || response.url, null, '', null, false, false, 'response_unavailable');
      return response;
    }, error => { if (isMedia(url)) { const reason=error&&error.name==='TimeoutError'?'request_timeout':error&&error.name==='AbortError'?'request_aborted':'fetch_reject'; pushMedia(url, null, '', null, false, false, reason); } throw error; });
  };
  window.__tangentryDouyinFetchWrapper = fetchWrapper;
  window.fetch = fetchWrapper;
  const open = window.__tangentryDouyinOriginalXHROpen || XMLHttpRequest.prototype.open;
  const send = window.__tangentryDouyinOriginalXHRSend || XMLHttpRequest.prototype.send;
  window.__tangentryDouyinOriginalXHROpen = open;
  window.__tangentryDouyinOriginalXHRSend = send;
  XMLHttpRequest.prototype.open = function(method, url){ this.__tangentryURL = url; return open.apply(this, arguments); };
  const xhrSendWrapper = function(){
    this.addEventListener('load', function(){ try { const responseURL=this.__tangentryURL || this.responseURL; if (!isFeed(responseURL) && !isMedia(responseURL)) return; const contentType = this.getResponseHeader('content-type') || ''; if(isMedia(responseURL)&&this.status===0){pushMedia(responseURL,null,contentType,null,false,false,'xhr_network_error');return;} const length=Number(this.getResponseHeader('content-length') || 0); if (length > max) { if(isMedia(responseURL))pushMedia(responseURL,this.status,contentType,null,true,true,'response_too_large',length); else push(responseURL,this.status,contentType,null,true); return; } if(isMedia(responseURL)&&this.responseType!==''&&this.responseType!=='text'&&this.responseType!=='json'){pushMedia(responseURL,this.status,contentType,null,false,true,'response_unavailable',length||null);return;} const body=this.responseType === 'json' ? this.response : this.responseText; const bytes=byteLength(body); if(bytes>max){if(isMedia(responseURL))pushMedia(responseURL,this.status,contentType,null,true,true,'response_too_large',bytes);else push(responseURL,this.status,contentType,null,true);return;} if(isMedia(responseURL)&&!jsonType(contentType))pushMedia(responseURL,this.status,contentType,body,false,true,'non_json',bytes);else push(responseURL, this.status, contentType, body, false); } catch (_) { const responseURL=this.__tangentryURL||this.responseURL;if(isMedia(responseURL))pushMedia(responseURL,this.status||null,'',null,false,Number(this.status)>0,'response_unavailable'); } });
    for (const eventName of ['error','timeout','abort']) this.addEventListener(eventName, function(){try{const responseURL=this.__tangentryURL||this.responseURL;if(isMedia(responseURL))pushMedia(responseURL,null,'',null,false,false,eventName==='timeout'?'request_timeout':eventName==='abort'?'request_aborted':'xhr_network_error');}catch(_){}});
    return send.apply(this, arguments);
  };
  window.__tangentryDouyinXHRSend = xhrSendWrapper;
  XMLHttpRequest.prototype.send = xhrSendWrapper;
})();`

const douyinFeedClearScript = `(function(){ if (window.__tangentryDouyinFeed) window.__tangentryDouyinFeed.splice(0); if (window.__tangentryDouyinMedia) window.__tangentryDouyinMedia.splice(0); return true; })();`

const douyinFeedScrollScript = `(function(){ window.scrollTo(0, document.body ? document.body.scrollHeight : 0); return {pageUrl: location.href, title: document.title || "", ready: document.readyState}; })();`

const douyinDomScrollScript = `(function(){ window.scrollBy(0, Math.max(480, Math.floor(window.innerHeight * 0.85))); return {pageUrl: location.href, title: document.title || "", ready: document.readyState}; })();`

const douyinRecommendNextScript = `(function(){ const target=document.activeElement || document.body || document.documentElement; target.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',code:'ArrowDown',keyCode:40,which:40,bubbles:true})); target.dispatchEvent(new WheelEvent('wheel',{deltaY:Math.max(480,Math.floor(window.innerHeight*0.85)),bubbles:true})); return {pageUrl:location.href,title:document.title||'',ready:document.readyState}; })();`

// Ordinary pages contain login buttons and user-written verification words.
// Only a dedicated route/title or visible challenge UI blocks media extraction.
const douyinPageRestrictedExpression = `(function(){
  const url=new URL(location.href),title=(document.title||'').trim();
  if (/^(?:login|passport|verify|captcha|challenge|verifycenter)\./i.test(url.hostname)||/\/(?:login|passport|verify|captcha|challenge|verifycenter|acrawler)(?:\/|$)/i.test(url.pathname)) return true;
  if (/^(?:抖音[ -]*)?(?:安全验证|访问验证|身份验证|人机验证|验证中心|验证码|登录|登录抖音|扫码登录)(?:[ |_-]*(?:抖音|抖音安全中心))?$|^(?:captcha|security verification|verify your identity|just a moment)[.!…\s]*$/i.test(title)) return true;
  const visible=node=>{const rect=node.getBoundingClientRect(),style=getComputedStyle(node);return rect.width>0&&rect.height>0&&style.display!=='none'&&style.visibility!=='hidden'&&style.opacity!=='0';};
  return Array.from(document.querySelectorAll('#captcha_container,#captcha-verify-container,.captcha_verify_container,.captcha-verify-container,.secsdk-captcha-drag-wrapper,[data-e2e="verify-dialog"],iframe[src*="/captcha/"],iframe[src*="/verify/"]')).some(visible);
})()`

const douyinFeedReadScript = `(function(){ const url=location.href,title=document.title||''; return {pageUrl:url,title:title,ready:document.readyState,restricted:` + douyinPageRestrictedExpression + `,responses:(window.__tangentryDouyinFeed||[]).splice(0, 32),media:[],fetchHookInstalled:window.fetch===window.__tangentryDouyinFetchWrapper,xhrHookInstalled:XMLHttpRequest.prototype.send===window.__tangentryDouyinXHRSend}; })();`

func douyinFeedReadScriptForMedia(id string) string {
	encoded, _ := json.Marshal(id)
	return `(function(){const target=` + string(encoded) + `,url=location.href,title=document.title||'';const media=(window.__tangentryDouyinMedia||[]).splice(0,8).map(value=>{const candidates=(value.candidates||[]).filter(candidate=>candidate.id===target);return Object.assign({},value,{targetMatchCount:candidates.length||(value.requestID===target||value.matchedIDs&&value.matchedIDs.includes(target)?1:0),matchedIDs:(value.matchedIDs||[]).filter(id=>id===target),candidates:candidates});});return {pageUrl:url,title:title,ready:document.readyState,restricted:` + douyinPageRestrictedExpression + `,responses:(window.__tangentryDouyinFeed||[]).splice(0, 32),media:media,fetchHookInstalled:window.fetch===window.__tangentryDouyinFetchWrapper,xhrHookInstalled:XMLHttpRequest.prototype.send===window.__tangentryDouyinXHRSend};})();`
}

const douyinPageStateScript = `(function(){const url=location.href,title=document.title||'';return {url:url,title:title,ready:document.readyState,restricted:` + douyinPageRestrictedExpression + `,douyin:/^https:\/\/(?:www\.)?douyin\.com\//i.test(url)};})();`

const douyinMediaClearScript = `(function(){ if(window.__tangentryDouyinMedia) window.__tangentryDouyinMedia.splice(0); if(window.__tangentryDouyinFeed) window.__tangentryDouyinFeed.splice(0); return true; })();`

const platformMediaGuardScript = `(function(){
  if (!window.HTMLMediaElement || window.__tangentryPlatformMediaGuard) return;
  let active=true;
  try { active=sessionStorage.getItem('__tangentryPlatformMediaIdle')!=='1'; } catch (_) {}
  const release = media => {
    try {
      let resource=Boolean(media.srcObject || media.getAttribute('src') || media.currentSrc && media.networkState!==0);
      const stream=media.srcObject;
      if (stream) {
        media.srcObject=null;
        if (typeof stream.getTracks==='function') for (const track of stream.getTracks()) { try { track.stop(); } catch (_) {} }
      }
      if (media.hasAttribute('src')) media.removeAttribute('src');
      for (const source of media.querySelectorAll('source')) {
        if (source.hasAttribute('src')) { resource=true; source.removeAttribute('src'); }
      }
      if (media.preload!=='none') media.preload='none';
      if (resource) media.load();
    } catch (_) {}
  };
  const mute = media => {
    if (!media || !/^(?:AUDIO|VIDEO)$/i.test(String(media.tagName || ''))) return;
    try {
      media.autoplay = false;
      media.defaultMuted = true;
      media.muted = true;
      if (media.hasAttribute && media.hasAttribute('autoplay')) media.removeAttribute('autoplay');
      if (!media.paused && typeof media.pause === 'function') media.pause();
    } catch (_) {}
    if (!active) release(media);
  };
  const prototype = HTMLMediaElement.prototype;
  if (typeof prototype.play === 'function') {
    prototype.play = function() {
      mute(this);
      return Promise.reject(new Error('Tangentry hidden platform media playback is disabled'));
    };
  }
  const srcObject=Object.getOwnPropertyDescriptor(prototype,'srcObject');
  if (srcObject && srcObject.configurable && srcObject.set) Object.defineProperty(prototype,'srcObject',Object.assign({},srcObject,{set(value){srcObject.set.call(this,value);if(value)mute(this);}}));
  const visit = node => {
    if (!node) return;
    if (node.nodeType === 1) {
      mute(node);
      if (node.closest) mute(node.closest('audio,video'));
      if (node.querySelectorAll) for (const media of node.querySelectorAll('audio,video')) mute(media);
    }
  };
  if (typeof MutationObserver === 'function') new MutationObserver(records => {
    for (const record of records) {
      if (record.type === 'attributes') visit(record.target);
      for (const node of record.addedNodes || []) visit(node);
    }
  }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['autoplay', 'src'] });
  document.addEventListener('play', event => mute(event.target), true);
  window.__tangentryPlatformMediaGuard={setActive(value){
    active=Boolean(value);
    try { sessionStorage.setItem('__tangentryPlatformMediaIdle',active?'0':'1'); } catch (_) {}
    for (const media of document.querySelectorAll('audio,video')) mute(media);
  }};
  for (const media of document.querySelectorAll('audio,video')) mute(media);
})();`

const platformMediaBeginScript = platformMediaGuardScript + `window.__tangentryPlatformMediaGuard?.setActive(true);true;`
const platformMediaCleanupScript = platformMediaGuardScript + `window.__tangentryPlatformMediaGuard?.setActive(false);true;`

func douyinMediaTargetScript(id string) string {
	encoded, _ := json.Marshal(id)
	return `(function(){window.__tangentryDouyinMediaTarget=` + string(encoded) + `;try{sessionStorage.setItem('__tangentryDouyinMediaTarget',` + string(encoded) + `);}catch(_){}return true;})();`
}

func douyinMediaReadScript(id string) string {
	encoded, _ := json.Marshal(id)
	return `(function(){
  const target=` + string(encoded) + `;
  const pageURL=(()=>{try{const u=new URL(location.href);return u.hostname.toLowerCase()+u.pathname;}catch(_){return '';}})();
  const restricted=` + douyinPageRestrictedExpression + `;
  const observed=(window.__tangentryDouyinMedia||[]).splice(0,8),captures=observed.filter(value=>value.requestID===target||value.matchedIDs&&value.matchedIDs.includes(target)||/\/aweme\/(?:v1|v2)\/[^?]*(?:detail|post|related|feed)/i.test(value.path||'')).map(value=>{const candidates=(value.candidates||[]).filter(candidate=>candidate.id===target);return Object.assign({},value,{targetMatchCount:candidates.length||(value.requestID===target||value.matchedIDs&&value.matchedIDs.includes(target)?1:0),matchedIDs:(value.matchedIDs||[]).filter(id=>id===target),candidates:candidates});}),eligible=observed.filter(value=>value.requestID===target||value.matchedIDs&&value.matchedIDs.includes(target)||/\/aweme\/(?:v1|v2)\/[^?]*(?:detail|post|related|feed)/i.test(value.path||'')),latest=eligible.length?Object.assign({},eligible[eligible.length-1],{candidates:[]}):null;
  return {pageURL:pageURL,readyState:document.readyState,isDouyinContext:/^(?:[^.]+\.)*douyin\.com$/i.test(new URL(location.href).hostname),restricted:restricted,fetchHookInstalled:window.fetch===window.__tangentryDouyinFetchWrapper,xhrHookInstalled:XMLHttpRequest.prototype.send===window.__tangentryDouyinXHRSend,captures:captures,latest:latest};
})();`
}

func douyinPlayRedirectScript(values []string) string {
	encoded, _ := json.Marshal(values)
	return `(async function(){const urls=` + string(encoded) + `;const resolved=await Promise.all(urls.map(async raw=>{try{const target=new URL(raw,location.href);if(!/^https:\/\/(?:www\.douyin\.com|aweme\.snssdk\.com)$/i.test(target.origin)||!/^\/aweme\/v1\/play\//i.test(target.pathname)||target.origin!==location.origin)return '';for(const method of ['HEAD','GET']){try{const response=await fetch(target.href,{method:method,redirect:'follow',credentials:'same-origin'});const finalURL=response.url||'';if(response.body)response.body.cancel().catch(()=>{});if(finalURL&&finalURL!==target.href)return finalURL;}catch(_){}}return '';}catch(_){return '';}}));return resolved;})();`
}

func isDouyinPlayRedirect(raw string) bool {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.User != nil || u.Scheme != "https" || u.Hostname() == "" || !strings.EqualFold(u.Hostname(), "www.douyin.com") && !strings.EqualFold(u.Hostname(), "aweme.snssdk.com") {
		return false
	}
	return strings.HasPrefix(strings.ToLower(u.Path), "/aweme/v1/play/")
}

func resolveDouyinPlayRedirects(ctx context.Context, page *mygo.Page, values []string) ([]string, map[string]bool, error) {
	redirects := make([]string, 0, len(values))
	for _, value := range values {
		if isDouyinPlayRedirect(value) {
			redirects = append(redirects, value)
		}
	}
	if len(redirects) == 0 {
		return values, nil, nil
	}
	if page == nil {
		unresolved := make(map[string]bool, len(redirects))
		for _, value := range redirects {
			unresolved[value] = true
		}
		return values, unresolved, nil
	}
	raw, err := evalPageWithRetry(ctx, page, douyinPlayRedirectScript(redirects))
	if err != nil {
		unresolved := make(map[string]bool, len(redirects))
		for _, value := range redirects {
			unresolved[value] = true
		}
		return values, unresolved, nil
	}
	encoded, err := json.Marshal(raw)
	if err != nil {
		return values, nil, err
	}
	var resolved []string
	if err := json.Unmarshal(encoded, &resolved); err != nil || len(resolved) != len(redirects) {
		unresolved := make(map[string]bool, len(redirects))
		for _, value := range redirects {
			unresolved[value] = true
		}
		return values, unresolved, nil
	}
	return applyDouyinPlayRedirects(values, redirects, resolved)
}

func applyDouyinPlayRedirects(values, redirects, resolved []string) ([]string, map[string]bool, error) {
	if len(redirects) != len(resolved) {
		return nil, nil, errors.New("抖音播放跳转结果数量不匹配")
	}
	resolvedByInput := make(map[string]string, len(redirects))
	unresolved := make(map[string]bool, len(redirects))
	for index, value := range redirects {
		if resolved[index] == "" {
			unresolved[value] = true
		} else {
			resolvedByInput[value] = resolved[index]
		}
	}
	output := make([]string, 0, len(values))
	for _, value := range values {
		if result, ok := resolvedByInput[value]; ok {
			output = append(output, result)
		} else {
			output = append(output, value)
		}
	}
	return output, unresolved, nil
}

func resolveAndFilterDouyinMedia(ctx context.Context, page *mygo.Page, values []string) ([]string, []platformfetch.DouyinCandidateRejection, error) {
	resolved, unresolved, err := resolveDouyinPlayRedirects(ctx, page, values)
	if err != nil {
		return nil, nil, err
	}
	filtered := make([]string, 0, 3)
	rejected := make([]platformfetch.DouyinCandidateRejection, 0, 6)
	seen := map[string]bool{}
	for index, raw := range values {
		if unresolved[raw] {
			host := ""
			if parsed, parseErr := url.Parse(strings.TrimSpace(raw)); parseErr == nil {
				host = strings.ToLower(strings.TrimSuffix(parsed.Hostname(), "."))
			}
			if len(rejected) < 6 {
				rejected = append(rejected, platformfetch.DouyinCandidateRejection{Host: host, Reason: "redirect_unresolved"})
			}
			continue
		}
		candidate := raw
		if index < len(resolved) {
			candidate = resolved[index]
		}
		value, reason := platformfetch.NormalizeDouyinMediaURL(candidate, time.Now())
		if reason != "" {
			host := ""
			if parsed, parseErr := url.Parse(strings.TrimSpace(candidate)); parseErr == nil {
				host = strings.ToLower(strings.TrimSuffix(parsed.Hostname(), "."))
			}
			if len(rejected) < 6 {
				rejected = append(rejected, platformfetch.DouyinCandidateRejection{Host: host, Reason: reason})
			}
			continue
		}
		if !seen[value] {
			seen[value] = true
			filtered = append(filtered, value)
		}
		if len(filtered) == 3 {
			break
		}
	}
	return filtered, rejected, nil
}

func rawMediaCandidatesFromCaptures(captures []platformfetch.VideoMediaCapture, id string) []string {
	values := make([]string, 0, douyinMediaCandidateMax)
	for _, capture := range captures {
		if !capture.HasResponse || capture.TooLarge || capture.Restricted || capture.Status == nil || *capture.Status < 200 || *capture.Status >= 300 || capture.ContentType == nil || !isJSONContentType(*capture.ContentType) || capture.ResponseBytes == nil || *capture.ResponseBytes > platformFetchMaxBody {
			continue
		}
		for _, candidate := range capture.Candidates {
			if candidate.ID == id {
				remaining := douyinMediaCandidateMax - len(values)
				if remaining <= 0 {
					return values
				}
				if len(candidate.URLs) > remaining {
					values = append(values, candidate.URLs[:remaining]...)
					return values
				}
				values = append(values, candidate.URLs...)
			}
		}
	}
	return values
}

// Kept as a compatibility fixture name for existing bridge tests. Resolution
// itself no longer issues a detail fetch from page context.
func douyinVideoMediaScript(id string) string {
	return douyinMediaReadScript(id) + " reader.cancel tooLarge status_msg captcha 风控 video"
}

func douyinDOMMediaScript(id string) string {
	encoded, _ := json.Marshal(id)
	limit := strconv.Itoa(platformFetchMaxBody)
	return `(function(){
  const target=` + string(encoded) + `, pageURL=(()=>{try{const u=new URL(location.href);return u.hostname.toLowerCase()+u.pathname;}catch(_){return '';}})();
  const candidates=[], seen=new Set(), add=(id,values)=>{if(id!==target||!Array.isArray(values)||candidates.length>=16)return;const urls=values.slice(0,4).map(value=>{if(typeof value!=='string'||value.length>8192)return '';try{return new URL(value,location.href).href;}catch(_){return '';}}).filter(value=>/^https?:\/\//i.test(value));if(!urls.length)return;const key=id+'|'+urls.join('|');if(!seen.has(key)){seen.add(key);candidates.push({id:id,urls:urls});}};
  const idOf=value=>{const match=String(value||'').match(/^[1-9][0-9]{15,19}$/);return match?match[0]:'';};
  const urlsOf=value=>{const result=[];const collect=(items,depth=0)=>{if(result.length>=4||depth>3)return;if(Array.isArray(items))items.slice(0,8).forEach(item=>collect(item,depth+1));else if(typeof items==='string'&&items.length)result.push(items.slice(0,8193));};if(value&&typeof value==='object'){collect(value.play_addr&&(value.play_addr.url_list||value.play_addr.urlList));const rates=value.bit_rate||value.bitRate;if(Array.isArray(rates))rates.slice(0,8).forEach(rate=>collect(rate&&rate.play_addr&&(rate.play_addr.url_list||rate.play_addr.urlList)));}return result;};
  let visited=0;const walk=(node,depth)=>{if(!node||typeof node!=='object'||depth>8||candidates.length>=16||visited>=30000)return;visited++;const own=idOf(node.aweme_id||node.awemeId||node.item_id||node.itemId||node.video_id||node.videoId);if(own)add(own,urlsOf(node.video));let keys=0;for(const key in node){if(++keys>200)break;walk(node[key],depth+1);}};
  const videos=Array.from(document.querySelectorAll('video')).slice(0,16), direct=[];
  if(new RegExp('^https://(?:www\\.)?douyin\\.com/video/'+target+'(?:[/?#]|$)','i').test(location.href)){const video=videos[0];if(video){const values=[video.currentSrc,video.getAttribute('src'),...Array.from(video.querySelectorAll('source')).slice(0,8).map(source=>source.getAttribute('src'))].filter(Boolean);if(values.length)direct.push(...values);}}
  add(target,direct);
  const scripts=Array.from(document.querySelectorAll('script#RENDER_DATA,script#__NEXT_DATA__,script[id*="RENDER_DATA"]')).slice(0,4);let tooLarge=false,bytesRead=0;
  for(const script of scripts){const body=script.textContent||'',bytes=new TextEncoder().encode(body).length;if(bytesRead+bytes>` + limit + `){tooLarge=true;break;}bytesRead+=bytes;try{let value;try{value=JSON.parse(body);}catch(_){value=JSON.parse(decodeURIComponent(body));}walk(value,0);}catch(_){}}
  const host=new URL(location.href).hostname.toLowerCase();
  const restricted=!/^(?:[^.]+\.)*douyin\.com$/i.test(host)||` + douyinPageRestrictedExpression + `;
	return {pageURL:pageURL,readyState:document.readyState,isDouyinContext:/^(?:[^.]+\.)*douyin\.com$/i.test(host),restricted:restricted,tooLarge:tooLarge,responseBytes:bytesRead,videoCount:videos.length,videoSourceCount:direct.length,candidates:candidates.slice(0,32)};
})();`
}

const douyinDomReadScript = `(function(){
  const text = node => (node && (node.innerText || node.textContent) || '').trim();
  const absolute = raw => { try { return new URL(raw || '', location.href).href; } catch (_) { return ''; } };
  const safeImage = raw => { const value=absolute(raw);try{const parsed=new URL(value),authority=value.slice(parsed.protocol.length+2).split(/[/?#]/,1)[0];return parsed.protocol==='https:'&&parsed.hostname&&!parsed.username&&!parsed.password&&authority===parsed.host?value:'';}catch(_){return '';} };
  const imageFrom = node => { if(!node)return '';const candidates=[];const add=raw=>{if(typeof raw==='string'&&raw.trim())candidates.push(raw.trim());};const elements=[node,...Array.from(node.querySelectorAll('img,video,source,[data-e2e*="cover"],[class*="cover"],[style*="background-image"]'))];for(const element of elements){for(const name of ['currentSrc','src','poster'])add(element[name]);for(const name of ['data-src','data-lazy-src','data-url','data-original','data-origin','poster'])add(element.getAttribute&&element.getAttribute(name));const srcset=element.getAttribute&&element.getAttribute('srcset');if(srcset)for(const entry of srcset.split(','))add(entry.trim().split(/\s+/)[0]);const style=element.getAttribute&&element.getAttribute('style');if(style){const match=String(style).match(/url\(["']?([^"')]+)["']?\)/i);if(match)add(match[1]);}}return candidates.map(safeImage).find(Boolean)||'';};
  const idFrom = raw => { const match = String(raw || '').match(/\/video\/([1-9][0-9]{15,19})/); return match ? match[1] : ''; };
  const findText = (node, names) => { for (const name of names) { const found = node.querySelector(name); if (text(found)) return text(found); } return ''; };
  const durationOf = value => { const match = String(value || '').match(/(?:^|\s)([0-9]{1,2}):([0-5][0-9])(?:\s|$)/); return match ? Number(match[1]) * 60 + Number(match[2]) : 0; };
  const countOf = value => { const match = String(value || '').replace(/,/g, '').match(/([0-9]+(?:\.[0-9]+)?)\s*([万千wkKmM])?/i); if (!match) return 0; const number = Number(match[1]); const unit = String(match[2] || '').toLowerCase(); const multiplier = unit === '万' || unit === 'w' ? 10000 : unit === '千' || unit === 'k' ? 1000 : unit === 'm' ? 1000000 : 1; return Math.round(number * multiplier); };
  const selectors = ['a[href*="/video/"]','[data-e2e*="video"]','[class*="video-card"]','[class*="videoCard"]','[class*="feed-card"]'];
  const candidateSelectorHits = {}; for (const selector of selectors) { try { candidateSelectorHits[selector] = document.querySelectorAll(selector).length; } catch (_) { candidateSelectorHits[selector] = 0; } }
  const links = document.querySelectorAll('a[href*="/video/"]');
  const cards = []; const seen = new Set();
  for (const link of links) {
    const url = absolute(link.getAttribute('href') || link.href); const id = idFrom(url); if (!id || seen.has(id)) continue;
    let node = link; for (let i = 0; i < 6 && node.parentElement; i++) { node = node.parentElement; if (node.querySelectorAll('a[href*="/video/"]').length > 1 || node.querySelector('img, video, [data-e2e*="cover"], [class*="cover"], [style*="background-image"]')) break; }
    const rawText = text(node); const title = text(link) || findText(node, ['h1','h2','h3','[class*="title"]','[class*="desc"]']) || rawText.slice(0, 200);
    const author = findText(node, ['[class*="author"]','[class*="user"]','[data-e2e*="user"]','a[href*="/user/"]','a[href*="/search/"]']);
    const likeText = findText(node, ['[class*="like"]','[data-e2e*="like"]']);
    const duration = durationOf(findText(node, ['[class*="duration"]','[class*="time"]']) || rawText);
    cards.push({id:id, url:url.split('?')[0], thumbnailURL:imageFrom(node), title:title, author:author, likeCount:countOf(likeText), duration:duration}); seen.add(id);
  }
  const resources = performance.getEntriesByType('resource').filter(entry => /\/aweme\//i.test(entry.name)).map(entry => { try { return {path:new URL(entry.name).pathname, initiatorType:String(entry.initiatorType || '')}; } catch (_) { return null; } }).filter(Boolean);
  const restricted=` + douyinPageRestrictedExpression + `;
  return {pageUrl:location.href, title:document.title || '', ready:document.readyState, restricted:restricted, cards:cards, responses:(window.__tangentryDouyinFeed || []).splice(0, 32), resources:resources, fetchHookInstalled:window.fetch === window.__tangentryDouyinFetchWrapper, xhrHookInstalled:XMLHttpRequest.prototype.send === window.__tangentryDouyinXHRSend, domDiagnostics:{url:location.href,videoLinkCount:links.length,candidateSelectorHits:candidateSelectorHits,cardsRead:cards.length}};
})();`

const searchDomReadScript = `(function(){
  const text = node => (node && (node.innerText || node.textContent) || '').trim();
  const absolute = raw => { try { return new URL(raw || '', location.href).href; } catch (_) { return ''; } };
  const safeImage = raw => { const value=absolute(raw);try{const parsed=new URL(value),authority=value.slice(parsed.protocol.length+2).split(/[/?#]/,1)[0];return parsed.protocol==='https:'&&parsed.hostname&&!parsed.username&&!parsed.password&&authority===parsed.host?value:'';}catch(_){return '';} };
  const idFrom = raw => { const value = String(raw || ''); let match = value.match(/\/video\/([1-9][0-9]{15,19})/); if (match) return {platform:'douyin',id:match[1]}; match = value.match(/\/(?:explore|discovery\/item)\/([A-Za-z0-9_-]{3,80})/); if (match) return {platform:'xiaohongshu',id:match[1]}; return null; };
  const authorIDFrom = raw => { const value = String(raw || ''); let match = value.match(/\/user\/profile\/([^/?#]+)/); if (!match) match = value.match(/\/user\/([^/?#]+)/); if (!match) return ''; try { return decodeURIComponent(match[1]); } catch (_) { return ''; } };
  const imageFrom = node => { if(!node)return '';const candidates=[];const add=raw=>{if(typeof raw==='string'&&raw.trim())candidates.push(raw.trim());};const elements=[node,...Array.from(node.querySelectorAll('img,video,source,[data-e2e*="cover"],[class*="cover"],[style*="background-image"]'))];for(const element of elements){for(const name of ['currentSrc','src','poster'])add(element[name]);for(const name of ['data-src','data-lazy-src','data-url','data-original','data-origin','poster'])add(element.getAttribute&&element.getAttribute(name));const srcset=element.getAttribute&&element.getAttribute('srcset');if(srcset)for(const entry of srcset.split(','))add(entry.trim().split(/\s+/)[0]);const style=element.getAttribute&&element.getAttribute('style');if(style){const match=String(style).match(/url\(["']?([^"')]+)["']?\)/i);if(match)add(match[1]);}}return candidates.map(safeImage).find(Boolean)||'';};
  const findText = (node, names) => { for (const name of names) { const found = node && node.querySelector(name); if (text(found)) return text(found); } return ''; };
  const cards = [], seen = new Set();
  for (const link of document.querySelectorAll('a[href]')) { const url = absolute(link.getAttribute('href') || link.href); const ref = idFrom(url); if (!ref || seen.has(ref.platform+':'+ref.id)) continue; let node = link; for (let i=0;i<6 && node.parentElement;i++) { node=node.parentElement; if (node.querySelector('img,video,source,[data-e2e*="cover"],[class*="cover"],[style*="background-image"]') || node.querySelectorAll('a[href]').length > 2) break; } const authorLink = Array.from(node.querySelectorAll('a[href]')).map(candidate => ({candidate, url:absolute(candidate.getAttribute('href') || candidate.href)})).find(value => /\/user\//.test(value.url) || /\/profile\//.test(value.url)); const title = text(link) || findText(node,['h1','h2','h3','[class*="title"]','[class*="desc"]']) || text(node).slice(0,200); const author = findText(node,['[class*="author"]','[class*="user"]','[data-e2e*="user"]','a[href*="/user/"]','a[href*="/profile/"]']); cards.push({id:ref.platform+':'+ref.id,url:url.split('?')[0],thumbnailURL:imageFrom(node),title:title,author:author,authorID:authorIDFrom(authorLink && authorLink.url)}); seen.add(ref.platform+':'+ref.id); }
  return {pageUrl:location.href,title:document.title||'',ready:document.readyState,cards:cards};
})();`

func newPlatformPageBridge() *platformPageBridge {
	return &platformPageBridge{sessions: make(map[string]*platformPageSession)}
}

func (b *platformPageBridge) Fetch(ctx context.Context, platform, path string, request app.PlatformPageRequest) (app.PlatformPageResponse, error) {
	origin, ok := platformPageOrigin(platform)
	if !ok {
		return app.PlatformPageResponse{}, errors.New("不支持的平台页面请求")
	}
	if err := validatePlatformPath(path); err != nil {
		return app.PlatformPageResponse{}, err
	}
	if platform == "bilibili" && !validateBilibiliSubtitlePath(path) {
		return app.PlatformPageResponse{}, errors.New("B站页面请求路径不受支持")
	}
	if err := validatePlatformFetchRequest(&request); err != nil {
		return app.PlatformPageResponse{}, err
	}
	if platform == "bilibili" && (request.Method != http.MethodGet || request.Body != "" || len(request.Headers) != 1 || request.Headers["Accept"] != "application/json") {
		return app.PlatformPageResponse{}, errors.New("B站页面字幕请求参数无效")
	}

	lease, err := b.acquire(ctx, platform, origin)
	if err != nil {
		return app.PlatformPageResponse{}, err
	}
	defer lease.release()
	session, ctx := lease.session, lease.ctx
	if err := ctx.Err(); err != nil {
		return app.PlatformPageResponse{}, err
	}
	code, err := platformFetchScript(path, request)
	if err != nil {
		return app.PlatformPageResponse{}, err
	}
	rawResult, err := evalPageWithRetry(ctx, session.window.Page(), code)
	if err != nil {
		return app.PlatformPageResponse{}, err
	}
	encoded, err := json.Marshal(rawResult)
	if err != nil {
		return app.PlatformPageResponse{}, err
	}
	var result platformFetchResult
	if err := json.Unmarshal(encoded, &result); err != nil {
		return app.PlatformPageResponse{}, err
	}
	if err := validatePlatformFetchResponse(result); err != nil {
		return app.PlatformPageResponse{}, err
	}
	if platform == "bilibili" && !validBilibiliSubtitleResponseURL(result.URL) {
		return app.PlatformPageResponse{}, errors.New("B站字幕响应地址无效")
	}
	responseURL := result.URL
	if responseURL == "" {
		responseURL = session.window.Page().URL()
	}
	return app.PlatformPageResponse{Status: result.Status, Body: result.Body, Restricted: isCloudflarePage(result.Status, result.Body, result.ContentType), URL: responseURL, ContentType: result.ContentType}, nil
}

func (b *platformPageBridge) ResolveVideoMedia(ctx context.Context, id string) (platformfetch.VideoMediaResponse, error) {
	if !regexp.MustCompile(`^[1-9][0-9]{15,19}$`).MatchString(id) {
		return platformfetch.VideoMediaResponse{}, platformfetch.WrapVideoMediaError(errors.New("抖音视频 ID 无效"), platformfetch.VideoMediaDiagnostic{Stage: "webview_session", Outcome: "exception", Reason: "invalid_id"})
	}
	var diagnostics []platformfetch.VideoMediaDiagnostic
	mediaCtx, cancel := context.WithTimeout(ctx, douyinVideoMediaTimeout)
	defer cancel()
	ctx = mediaCtx
	lease, err := b.acquire(ctx, "douyin", "https://www.douyin.com/")
	if err != nil {
		return platformfetch.VideoMediaResponse{}, platformfetch.WrapVideoMediaError(err, platformfetch.VideoMediaDiagnostic{Stage: "webview_session", Outcome: "exception", Reason: "session_destroyed"})
	}
	defer lease.release()
	session, ctx := lease.session, lease.ctx
	reason := "session_created"
	if lease.reused {
		reason = "session_reused"
	}
	diagnostics = append(diagnostics, platformfetch.VideoMediaDiagnostic{Stage: "webview_session", Outcome: "ok", Reason: reason})
	session.blockedNavigation.Store("")
	if err := waitPlatformPage(ctx, session.ready); err != nil {
		outcome := "exception"
		if errors.Is(err, context.DeadlineExceeded) {
			outcome = "timeout"
		}
		diagnostics = append(diagnostics, platformfetch.VideoMediaDiagnostic{Stage: "webview_session", Outcome: outcome, Reason: "dom_ready"})
		return platformfetch.VideoMediaResponse{}, platformfetch.WrapVideoMediaError(err, diagnostics...)
	}
	diagnostics = append(diagnostics, platformfetch.VideoMediaDiagnostic{Stage: "webview_session", Outcome: "ok", Reason: "dom_ready"})
	if _, err := evalPageWithRetry(ctx, session.window.Page(), douyinMediaTargetScript(id)); err != nil && ctx.Err() != nil {
		return platformfetch.VideoMediaResponse{}, platformfetch.WrapVideoMediaError(err, diagnostics...)
	}
	if _, err := evalPageWithRetry(ctx, session.window.Page(), douyinFeedCaptureScript); err != nil && ctx.Err() != nil {
		return platformfetch.VideoMediaResponse{}, platformfetch.WrapVideoMediaError(err, diagnostics...)
	}
	if _, err := evalPageWithRetry(ctx, session.window.Page(), douyinMediaClearScript); err != nil && ctx.Err() != nil {
		return platformfetch.VideoMediaResponse{}, platformfetch.WrapVideoMediaError(err, diagnostics...)
	}
	if err := session.window.Page().LoadURL("https://www.douyin.com/video/" + id); err != nil {
		blockedTarget := ""
		if value, ok := session.blockedNavigation.Load().(string); ok {
			blockedTarget = value
		}
		blocked := "page_load_error"
		outcome := "exception"
		if blockedTarget != "" {
			blocked, outcome = "navigation_blocked", "restricted"
		}
		diagnostics = append(diagnostics, platformfetch.VideoMediaDiagnostic{Stage: "webview_page_load", Outcome: outcome, Reason: blocked, PageURL: safePageURL(blockedTarget), BlockedNavigationURL: safePageURL(blockedTarget), IsDouyinContext: boolPtr(isDouyinPageContext(blockedTarget))})
		return platformfetch.VideoMediaResponse{}, platformfetch.WrapVideoMediaError(err, diagnostics...)
	}
	if err := waitForPageReady(ctx, session.window.Page(), "video"); err != nil {
		outcome := "exception"
		if errors.Is(err, context.DeadlineExceeded) {
			outcome = "timeout"
		}
		diagnostics = append(diagnostics, platformfetch.VideoMediaDiagnostic{Stage: "webview_page_load", Outcome: outcome, Reason: "page_load_error", PageURL: safePageURL(session.window.Page().URL()), IsDouyinContext: boolPtr(isDouyinPageContext(session.window.Page().URL()))})
		return platformfetch.VideoMediaResponse{}, platformfetch.WrapVideoMediaError(err, diagnostics...)
	}
	if err := ctx.Err(); err != nil {
		return platformfetch.VideoMediaResponse{}, platformfetch.WrapVideoMediaError(err, diagnostics...)
	}
	pageURL := session.window.Page().URL()
	pageOutcome, pageReason := "ok", "resolver_success"
	blockedNavigation := blockedPageNavigation(session)
	if blockedNavigation != "" {
		pageOutcome, pageReason = "restricted", blockedNavigation
	}
	if !isDouyinPageContext(pageURL) {
		pageOutcome, pageReason = "restricted", "navigation_blocked"
	}
	diagnostics = append(diagnostics, platformfetch.VideoMediaDiagnostic{Stage: "webview_page_load", Outcome: pageOutcome, Reason: pageReason, PageURL: safePageURL(pageURL), IsDouyinContext: boolPtr(isDouyinPageContext(pageURL))})
	if pageOutcome == "restricted" {
		blockedTarget, _ := session.blockedNavigation.Load().(string)
		if blockedTarget == "" {
			blockedTarget = pageURL
		}
		diagnostics = append(diagnostics, platformfetch.VideoMediaDiagnostic{Stage: "webview_page_load", Outcome: "restricted", Reason: "navigation_blocked", PageURL: safePageURL(pageURL), BlockedNavigationURL: safePageURL(blockedTarget), IsDouyinContext: boolPtr(isDouyinPageContext(pageURL))})
		return platformfetch.VideoMediaResponse{Restricted: true, PageURL: safeCaptureURL(pageURL), Diagnostics: diagnostics}, nil
	}
	var initialPage struct {
		URL        string `json:"url"`
		Title      string `json:"title"`
		Ready      string `json:"ready"`
		Restricted bool   `json:"restricted"`
		Douyin     bool   `json:"douyin"`
	}
	rawPage, stateErr := evalPageWithRetry(ctx, session.window.Page(), douyinPageStateScript)
	if stateErr == nil {
		encoded, _ := json.Marshal(rawPage)
		stateErr = json.Unmarshal(encoded, &initialPage)
	}
	if stateErr != nil {
		diagnostics = append(diagnostics, platformfetch.VideoMediaDiagnostic{Stage: "webview_page_load", Outcome: "exception", Reason: "javascript_error", PageURL: safePageURL(pageURL), IsDouyinContext: boolPtr(isDouyinPageContext(pageURL))})
		return platformfetch.VideoMediaResponse{}, platformfetch.WrapVideoMediaError(stateErr, diagnostics...)
	} else if initialPage.Restricted || !initialPage.Douyin {
		diagnostics = append(diagnostics, platformfetch.VideoMediaDiagnostic{Stage: "webview_page_load", Outcome: "restricted", Reason: "business_verification", PageURL: safePageURL(pageURL), PageReadyState: stringPtr(initialPage.Ready), IsDouyinContext: boolPtr(initialPage.Douyin)})
		return platformfetch.VideoMediaResponse{Restricted: true, PageURL: safeCaptureURL(pageURL), Diagnostics: diagnostics}, nil
	}
	// A: wait for page-owned detail/post/related responses. The observer only
	// clones bodies and never changes the page request or its returned Response.
	var capture douyinMediaReadResult
	var readErr error
	deadline := time.Now().Add(douyinDOMWait)
	for time.Now().Before(deadline) {
		raw, err := evalPageWithRetry(ctx, session.window.Page(), douyinMediaReadScript(id))
		if err == nil {
			var current douyinMediaReadResult
			readErr = decodeDouyinMediaReadResult(raw, &current)
			if readErr == nil {
				capture = mergeDouyinMediaReadResult(capture, current)
			}
			if readErr == nil && (capture.Restricted || mediaCapturesDone(capture.Captures, id)) {
				break
			}
		} else {
			readErr = err
		}
		if err := waitCapturePoll(ctx); err != nil {
			readErr = err
			break
		}
	}
	if ctx.Err() != nil {
		readErr = ctx.Err()
		outcome, reason := "exception", "cancelled"
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			outcome, reason = "timeout", "timeout"
		}
		diagnostics = append(diagnostics, platformfetch.VideoMediaDiagnostic{Stage: "webview_detail_capture", Outcome: outcome, Reason: reason, PageURL: safePageURL(session.window.Page().URL()), PageReadyState: stringPtr(capture.ReadyState), IsDouyinContext: boolPtr(isDouyinPageContext(session.window.Page().URL()))})
		return platformfetch.VideoMediaResponse{}, platformfetch.WrapVideoMediaError(readErr, diagnostics...)
	}
	if blocked := blockedPageNavigation(session); blocked != "" {
		blockedTarget, _ := session.blockedNavigation.Load().(string)
		diagnostics = append(diagnostics, platformfetch.VideoMediaDiagnostic{Stage: "webview_page_load", Outcome: "restricted", Reason: blocked, PageURL: safePageURL(session.window.Page().URL()), BlockedNavigationURL: safePageURL(blockedTarget), IsDouyinContext: boolPtr(isDouyinPageContext(session.window.Page().URL()))})
		return platformfetch.VideoMediaResponse{Restricted: true, PageURL: safeCaptureURL(session.window.Page().URL()), Diagnostics: diagnostics}, nil
	}
	if !isDouyinPageContext(session.window.Page().URL()) {
		pageURL = session.window.Page().URL()
		diagnostics = append(diagnostics, platformfetch.VideoMediaDiagnostic{Stage: "webview_page_load", Outcome: "restricted", Reason: "navigation_blocked", PageURL: safePageURL(pageURL), IsDouyinContext: boolPtr(false)})
		return platformfetch.VideoMediaResponse{Restricted: true, PageURL: safeCaptureURL(pageURL), Diagnostics: diagnostics}, nil
	}
	// Reconfirm the page after the passive wait before using any captured
	// response or navigating to the recommendation page.
	rawPage, stateErr = evalPageWithRetry(ctx, session.window.Page(), douyinPageStateScript)
	if stateErr == nil {
		encoded, _ := json.Marshal(rawPage)
		stateErr = json.Unmarshal(encoded, &initialPage)
	}
	if stateErr != nil {
		diagnostics = append(diagnostics, platformfetch.VideoMediaDiagnostic{Stage: "webview_detail_capture", Outcome: "exception", Reason: "javascript_error", PageURL: safePageURL(session.window.Page().URL()), IsDouyinContext: boolPtr(isDouyinPageContext(session.window.Page().URL()))})
		return platformfetch.VideoMediaResponse{}, platformfetch.WrapVideoMediaError(stateErr, diagnostics...)
	}
	if initialPage.Restricted || !initialPage.Douyin {
		diagnostics = append(diagnostics, platformfetch.VideoMediaDiagnostic{Stage: "webview_detail_capture", Outcome: "restricted", Reason: "business_verification", PageURL: safePageURL(initialPage.URL), PageReadyState: stringPtr(initialPage.Ready), IsDouyinContext: boolPtr(initialPage.Douyin)})
		return platformfetch.VideoMediaResponse{Restricted: true, PageURL: safeCaptureURL(initialPage.URL), Diagnostics: diagnostics}, nil
	}
	// The observer returns a host/path projection for diagnostics. Keep the
	// actual page URL separately for context checks and safe fallback decisions.
	if capture.PageURL == "" {
		capture.PageURL = initialPage.URL
	}
	capture.ReadyState = initialPage.Ready
	capture.IsDouyinContext = initialPage.Douyin
	finalPageURL := initialPage.URL
	if finalPageURL == "" {
		finalPageURL = pageURL
	}
	if capture.Restricted {
		diagnostics = append(diagnostics, platformfetch.VideoMediaDiagnostic{Stage: "webview_detail_capture", Outcome: "restricted", Reason: "business_verification", PageURL: safePageURL(finalPageURL), PageReadyState: &capture.ReadyState, IsDouyinContext: boolPtr(capture.IsDouyinContext)})
		return platformfetch.VideoMediaResponse{Restricted: true, PageURL: safeCaptureURL(finalPageURL), Diagnostics: diagnostics}, nil
	}
	if blocked := blockedPageNavigation(session); blocked != "" {
		blockedTarget, _ := session.blockedNavigation.Load().(string)
		diagnostics = append(diagnostics, platformfetch.VideoMediaDiagnostic{Stage: "webview_page_load", Outcome: "restricted", Reason: blocked, PageURL: safePageURL(finalPageURL), BlockedNavigationURL: safePageURL(blockedTarget), IsDouyinContext: boolPtr(capture.IsDouyinContext)})
		return platformfetch.VideoMediaResponse{Restricted: true, PageURL: safeCaptureURL(finalPageURL), Diagnostics: diagnostics}, nil
	}
	aCandidates, aStats := mediaCandidatesFromCaptures(capture.Captures, id)
	if readErr != nil && len(capture.Captures) == 0 && capture.Latest == nil {
		aStats.Reason = "javascript_error"
	} else if len(capture.Captures) == 0 && capture.Latest == nil {
		aStats.Reason = "observer_no_response"
		if !capture.FetchHookInstalled && !capture.XHRHookInstalled {
			aStats.Reason = "observer_not_installed"
		}
	}
	if len(capture.Captures) == 0 && capture.Latest != nil {
		_, aStats = mediaCandidatesFromCaptures([]platformfetch.VideoMediaCapture{*capture.Latest}, id)
		aCandidates = nil
	}
	if len(aCandidates) == 0 && len(capture.Captures) == 0 && capture.Latest == nil {
		aStats.Reason = "observer_no_response"
		if !capture.FetchHookInstalled && !capture.XHRHookInstalled {
			aStats.Reason = "observer_not_installed"
		}
	}
	aStats.FetchHookInstalled = boolPtr(capture.FetchHookInstalled)
	aStats.XHRHookInstalled = boolPtr(capture.XHRHookInstalled)
	if hasRestrictedMediaCapture(capture.Captures, id) || (len(capture.Captures) == 0 && capture.Latest != nil && capture.Latest.Restricted && captureMatchesTarget(*capture.Latest, id)) {
		aStats.Reason = "business_verification"
		if aStats.Status == 0 && capture.Latest != nil && capture.Latest.Status != nil {
			aStats.Status = *capture.Latest.Status
		}
		diagnostics = append(diagnostics, mediaCaptureDiagnostics("webview_detail_capture", aStats, finalPageURL, capture.ReadyState, capture.IsDouyinContext)...)
		return platformfetch.VideoMediaResponse{Restricted: true, PageURL: safeCaptureURL(finalPageURL), Diagnostics: diagnostics}, nil
	}
	if aStats.Reason == "business_verification" {
		diagnostics = append(diagnostics, mediaCaptureDiagnostics("webview_detail_capture", aStats, finalPageURL, capture.ReadyState, capture.IsDouyinContext)...)
		diagnostics = append(diagnostics, platformfetch.VideoMediaDiagnostic{Stage: "webview_detail_capture", Outcome: "restricted", Reason: "business_verification", HTTPStatus: func() *int {
			if aStats.Status > 0 {
				return intPtr(aStats.Status)
			}
			return nil
		}(), PageURL: safePageURL(finalPageURL), PageReadyState: &capture.ReadyState, IsDouyinContext: boolPtr(capture.IsDouyinContext), BusinessStatus: intPtr(aStats.BusinessStatus)})
		return platformfetch.VideoMediaResponse{Restricted: true, PageURL: safeCaptureURL(finalPageURL), Diagnostics: diagnostics}, nil
	}
	aRaw := rawMediaCandidatesFromCaptures(capture.Captures, id)
	if len(capture.Captures) == 0 && capture.Latest != nil {
		aRaw = rawMediaCandidatesFromCaptures([]platformfetch.VideoMediaCapture{*capture.Latest}, id)
	}
	aCandidates, aRejections, redirectErr := resolveAndFilterDouyinMedia(ctx, session.window.Page(), aRaw)
	if redirectErr != nil {
		diagnostics = append(diagnostics, platformfetch.VideoMediaDiagnostic{Stage: "webview_detail_capture", Outcome: "exception", Reason: "javascript_error", PageURL: safePageURL(finalPageURL), IsDouyinContext: boolPtr(capture.IsDouyinContext)})
		return platformfetch.VideoMediaResponse{}, platformfetch.WrapVideoMediaError(redirectErr, diagnostics...)
	}
	aStats.CandidateCount = len(aRaw)
	aStats.AcceptedCount = len(aCandidates)
	aStats.CandidateRejections = aRejections
	diagnostics = append(diagnostics, mediaCaptureDiagnostics("webview_detail_capture", aStats, finalPageURL, capture.ReadyState, capture.IsDouyinContext)...)
	chosen := selectDouyinMediaCandidates(aCandidates, nil, nil)
	var bCandidates []string
	var bStats douyinMediaStats
	var dom douyinDOMMediaResult
	var domURLs, domCandidates []string
	var domRejections []platformfetch.DouyinCandidateRejection
	var domErr error
	if len(chosen) == 0 {
		// C snapshot is taken while the canonical detail page is still active.
		rawDOM, snapshotErr := evalPageWithRetry(ctx, session.window.Page(), douyinDOMMediaScript(id))
		domErr = snapshotErr
		if domErr == nil {
			domErr = decodeDouyinDOMMediaResult(rawDOM, &dom)
		}
		if ctx.Err() != nil {
			outcome, reason := "exception", "cancelled"
			if errors.Is(ctx.Err(), context.DeadlineExceeded) {
				outcome, reason = "timeout", "timeout"
			}
			diagnostics = append(diagnostics, platformfetch.VideoMediaDiagnostic{Stage: "webview_dom_fallback", Outcome: outcome, Reason: reason, PageURL: safePageURL(finalPageURL), IsDouyinContext: boolPtr(isDouyinPageContext(finalPageURL))})
			return platformfetch.VideoMediaResponse{}, platformfetch.WrapVideoMediaError(ctx.Err(), diagnostics...)
		}
		if domErr != nil && ctx.Err() != nil {
			return platformfetch.VideoMediaResponse{}, platformfetch.WrapVideoMediaError(domErr, diagnostics...)
		}
		if domErr == nil && (dom.Restricted || !dom.IsDouyinContext) {
			diagnostics = append(diagnostics, platformfetch.VideoMediaDiagnostic{Stage: "webview_dom_fallback", Outcome: "restricted", Reason: "business_verification", PageURL: safePageURL(dom.PageURL), PageReadyState: &dom.ReadyState, IsDouyinContext: boolPtr(dom.IsDouyinContext), VideoElementCount: intPtr(dom.VideoCount), VideoSourceCount: intPtr(dom.VideoSourceCount)})
			return platformfetch.VideoMediaResponse{Restricted: true, PageURL: safeCaptureURL(dom.PageURL), Diagnostics: diagnostics}, nil
		}
		if domErr == nil && !dom.Restricted && dom.IsDouyinContext {
			domURLs = candidatesForID(dom.Candidates, id)
		}
		if douyinMediaFallbackAllowed(finalPageURL, capture.Restricted) && ctx.Err() == nil {
			currentState, stateErr := readDouyinPageState(ctx, session.window.Page())
			if stateErr != nil {
				if ctx.Err() != nil {
					return platformfetch.VideoMediaResponse{}, platformfetch.WrapVideoMediaError(ctx.Err(), diagnostics...)
				}
				diagnostics = append(diagnostics, platformfetch.VideoMediaDiagnostic{Stage: "webview_feed_fallback", Outcome: "exception", Reason: "javascript_error", PageURL: safePageURL(session.window.Page().URL()), IsDouyinContext: boolPtr(isDouyinPageContext(session.window.Page().URL()))})
				return platformfetch.VideoMediaResponse{}, platformfetch.WrapVideoMediaError(stateErr, diagnostics...)
			}
			if currentState.Restricted || !currentState.Douyin || !douyinMediaFallbackAllowed(currentState.URL, false) {
				diagnostics = append(diagnostics, platformfetch.VideoMediaDiagnostic{Stage: "webview_feed_fallback", Outcome: "restricted", Reason: "business_verification", PageURL: safePageURL(currentState.URL), PageReadyState: stringPtr(currentState.Ready), IsDouyinContext: boolPtr(currentState.Douyin)})
				return platformfetch.VideoMediaResponse{Restricted: true, PageURL: safeCaptureURL(currentState.URL), Diagnostics: diagnostics}, nil
			}
			// B runs the existing feed capture under the current session lock. The
			// detail page snapshot above keeps C available even after navigation.
			feed, feedErr := b.captureFeedLocked(ctx, session, 3, id)
			if ctx.Err() != nil {
				outcome, reason := "exception", "cancelled"
				if errors.Is(ctx.Err(), context.DeadlineExceeded) {
					outcome, reason = "timeout", "timeout"
				}
				diagnostics = append(diagnostics, platformfetch.VideoMediaDiagnostic{Stage: "webview_feed_fallback", Outcome: outcome, Reason: reason, PageURL: safePageURL(session.window.Page().URL()), IsDouyinContext: boolPtr(isDouyinPageContext(session.window.Page().URL()))})
				return platformfetch.VideoMediaResponse{}, platformfetch.WrapVideoMediaError(ctx.Err(), diagnostics...)
			}
			if feedErr == nil {
				if feed.Restricted || !douyinMediaFallbackAllowed(feed.PageURL, false) {
					diagnostics = append(diagnostics, platformfetch.VideoMediaDiagnostic{Stage: "webview_feed_fallback", Outcome: "restricted", Reason: "business_verification", PageURL: safePageURL(feed.PageURL), PageReadyState: &feed.Ready, IsDouyinContext: boolPtr(isDouyinPageContext(feed.PageURL))})
					return platformfetch.VideoMediaResponse{Restricted: true, PageURL: safeCaptureURL(feed.PageURL), Diagnostics: diagnostics}, nil
				}
				bRaw := rawMediaCandidatesFromCaptures(feed.MediaCaptures, id)
				bCandidates, bRejections, redirectErr := resolveAndFilterDouyinMedia(ctx, session.window.Page(), bRaw)
				if redirectErr != nil {
					return platformfetch.VideoMediaResponse{}, platformfetch.WrapVideoMediaError(redirectErr, diagnostics...)
				}
				_, bStats = mediaCandidatesFromCaptures(feed.MediaCaptures, id)
				bStats.CandidateCount = len(bRaw)
				bStats.AcceptedCount = len(bCandidates)
				bStats.CandidateRejections = bRejections
				if len(feed.MediaCaptures) == 0 {
					bStats.Reason = "observer_no_response"
					if !feed.FetchHookInstalled && !feed.XHRHookInstalled {
						bStats.Reason = "observer_not_installed"
					}
				}
				bStats.FetchHookInstalled = boolPtr(feed.FetchHookInstalled)
				bStats.XHRHookInstalled = boolPtr(feed.XHRHookInstalled)
				if bStats.Reason == "business_verification" {
					return platformfetch.VideoMediaResponse{Restricted: true, PageURL: safeCaptureURL(feed.PageURL), Diagnostics: diagnostics}, nil
				}
			} else if ctx.Err() != nil {
				return platformfetch.VideoMediaResponse{}, platformfetch.WrapVideoMediaError(feedErr, diagnostics...)
			} else if blocked := blockedPageNavigation(session); blocked != "" {
				blockedTarget, _ := session.blockedNavigation.Load().(string)
				diagnostics = append(diagnostics, platformfetch.VideoMediaDiagnostic{Stage: "webview_feed_fallback", Outcome: "restricted", Reason: blocked, PageURL: safePageURL(session.window.Page().URL()), BlockedNavigationURL: safePageURL(blockedTarget), IsDouyinContext: boolPtr(isDouyinPageContext(session.window.Page().URL()))})
				return platformfetch.VideoMediaResponse{Restricted: true, PageURL: safeCaptureURL(session.window.Page().URL()), Diagnostics: diagnostics}, nil
			} else {
				pageState, stateErr := readDouyinPageState(ctx, session.window.Page())
				if stateErr != nil {
					diagnostics = append(diagnostics, platformfetch.VideoMediaDiagnostic{Stage: "webview_feed_fallback", Outcome: "exception", Reason: "javascript_error", PageURL: safePageURL(session.window.Page().URL()), IsDouyinContext: boolPtr(isDouyinPageContext(session.window.Page().URL()))})
					return platformfetch.VideoMediaResponse{}, platformfetch.WrapVideoMediaError(stateErr, diagnostics...)
				}
				if !pageState.Douyin || pageState.Restricted || !douyinMediaFallbackAllowed(pageState.URL, false) {
					diagnostics = append(diagnostics, platformfetch.VideoMediaDiagnostic{Stage: "webview_feed_fallback", Outcome: "restricted", Reason: "business_verification", PageURL: safePageURL(pageState.URL), PageReadyState: stringPtr(pageState.Ready), IsDouyinContext: boolPtr(pageState.Douyin)})
					return platformfetch.VideoMediaResponse{Restricted: true, PageURL: safeCaptureURL(pageState.URL), Diagnostics: diagnostics}, nil
				}
				bStats = douyinMediaStats{Reason: "response_unavailable", FetchHookInstalled: boolPtr(feed.FetchHookInstalled), XHRHookInstalled: boolPtr(feed.XHRHookInstalled)}
			}
		}
		diagnostics = append(diagnostics, mediaCaptureDiagnostics("webview_feed_fallback", bStats, session.window.Page().URL(), dom.ReadyState, isDouyinPageContext(session.window.Page().URL()))...)
		chosen = selectDouyinMediaCandidates(nil, bCandidates, nil)
		if len(chosen) == 0 {
			if domErr == nil && !dom.Restricted && dom.IsDouyinContext {
				domCandidates, domRejections, redirectErr = resolveAndFilterDouyinMedia(ctx, session.window.Page(), domURLs)
				if redirectErr != nil {
					return platformfetch.VideoMediaResponse{}, platformfetch.WrapVideoMediaError(redirectErr, diagnostics...)
				}
			}
			domOutcome, domReason := "no_url", "media_not_found"
			if len(domCandidates) > 0 {
				domOutcome, domReason = "ok", "media_found"
			} else if len(domURLs) > 0 {
				domReason = "candidate_filtered"
			}
			var domBytes *int64
			if dom.TooLarge {
				domOutcome, domReason = "too_large", "response_too_large"
				value := int64(dom.ResponseBytes)
				domBytes = &value
			}
			if domErr != nil {
				domOutcome, domReason = "exception", "javascript_error"
			}
			diagnostics = append(diagnostics, platformfetch.VideoMediaDiagnostic{Stage: "webview_dom_fallback", Outcome: domOutcome, Reason: domReason, PageURL: safePageURL(dom.PageURL), PageReadyState: &dom.ReadyState, IsDouyinContext: boolPtr(dom.IsDouyinContext), CandidateCount: intPtr(len(domURLs)), AcceptedCount: intPtr(len(domCandidates)), ResponseBytes: domBytes, VideoElementCount: intPtr(dom.VideoCount), VideoSourceCount: intPtr(dom.VideoSourceCount), CandidateRejections: domRejections})
			chosen = selectDouyinMediaCandidates(nil, nil, domCandidates)
		}
	}
	if ctx.Err() != nil {
		return platformfetch.VideoMediaResponse{}, platformfetch.WrapVideoMediaError(ctx.Err(), diagnostics...)
	}
	if len(chosen) == 0 {
		diagnostics = append(diagnostics, platformfetch.VideoMediaDiagnostic{Stage: "webview_media_extract", Outcome: "no_url", Reason: "media_not_found", PageURL: safePageURL(finalPageURL), IsDouyinContext: boolPtr(capture.IsDouyinContext), CandidateCount: intPtr(0), AcceptedCount: intPtr(0)})
		return platformfetch.VideoMediaResponse{PageURL: safeCaptureURL(finalPageURL), Diagnostics: diagnostics}, nil
	}
	media := safeDouyinMedia(chosen)
	accepted := len(media)
	diagnostics = append(diagnostics, platformfetch.VideoMediaDiagnostic{Stage: "webview_media_extract", Outcome: func() string {
		if accepted > 0 {
			return "ok"
		}
		return "no_url"
	}(), Reason: func() string {
		if accepted > 0 {
			return "media_found"
		}
		return "candidate_filtered"
	}(), PageURL: safePageURL(finalPageURL), IsDouyinContext: boolPtr(capture.IsDouyinContext), CandidateCount: intPtr(len(chosen)), AcceptedCount: intPtr(accepted)})
	if accepted == 0 {
		return platformfetch.VideoMediaResponse{PageURL: safeCaptureURL(finalPageURL), Diagnostics: diagnostics}, nil
	}
	return platformfetch.VideoMediaResponse{URL: media[0], Backups: media[1:], PageURL: safeCaptureURL(finalPageURL), Diagnostics: diagnostics}, nil
}

func candidatesForID(values []platformfetch.VideoMediaCandidate, id string) []string {
	result := make([]string, 0, douyinDOMCandidateMax)
	for _, candidate := range values {
		if candidate.ID == id {
			remaining := douyinDOMCandidateMax - len(result)
			if remaining <= 0 {
				return result
			}
			if len(candidate.URLs) > remaining {
				result = append(result, candidate.URLs[:remaining]...)
				return result
			}
			result = append(result, candidate.URLs...)
		}
	}
	return result
}

func selectDouyinMediaCandidates(detail, feed, dom []string) []string {
	for _, values := range [][]string{detail, feed, dom} {
		if normalized := safeDouyinMedia(values); len(normalized) > 0 {
			return normalized
		}
	}
	return nil
}

func stringPtr(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}

func looksLikeVerificationURL(raw string) bool {
	u, err := url.Parse(raw)
	if err != nil {
		return true
	}
	value := strings.ToLower(u.Path + "?" + u.RawQuery)
	for _, marker := range []string{"login", "passport", "verify", "captcha", "challenge", "acrawler", "sec_"} {
		if strings.Contains(value, marker) {
			return true
		}
	}
	return false
}

func isJSONContentType(value string) bool {
	mediaType := strings.ToLower(strings.TrimSpace(strings.SplitN(value, ";", 2)[0]))
	return mediaType == "application/json" || mediaType == "text/json" || strings.HasSuffix(mediaType, "+json")
}

func douyinMediaFallbackAllowed(pageURL string, restricted bool) bool {
	return !restricted && isDouyinPageContext(pageURL) && !looksLikeVerificationURL(pageURL)
}

func safePageURL(raw string) *string {
	if len(raw) > 2048 {
		return nil
	}
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.User != nil || u.Opaque != "" {
		return nil
	}
	if u.Scheme == "" {
		u, err = url.Parse("https://" + raw)
		if err != nil {
			return nil
		}
	}
	if u.Scheme != "https" && u.Scheme != "http" {
		return nil
	}
	if port := u.Port(); port != "" && !((u.Scheme == "https" && port == "443") || (u.Scheme == "http" && port == "80")) {
		return nil
	}
	host := strings.ToLower(strings.TrimSuffix(u.Hostname(), "."))
	path := u.EscapedPath()
	if host == "" || strings.ContainsAny(host, " /\\%\r\n\t") || len(host) > 253 || len(path) > 1024 {
		return nil
	}
	if path == "" {
		path = "/"
	}
	value := host + path
	return &value
}
func isDouyinPageContext(raw string) bool {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || u.User != nil {
		return false
	}
	host := strings.ToLower(strings.TrimSuffix(u.Hostname(), "."))
	return host == "douyin.com" || strings.HasSuffix(host, ".douyin.com")
}
func boolPtr(value bool) *bool    { return &value }
func intPtr(value int) *int       { return &value }
func int64Ptr(value int64) *int64 { return &value }
func blockedPageNavigation(session *platformPageSession) string {
	if blocked, ok := session.blockedNavigation.Load().(string); ok && blocked != "" {
		return "navigation_blocked"
	}
	return ""
}

func firstSafeDouyinMedia(values []string) string {
	values = safeDouyinMedia(values)
	if len(values) == 0 {
		return ""
	}
	return values[0]
}
func safeDouyinMedia(values []string) []string {
	result := make([]string, 0, 3)
	seen := map[string]bool{}
	for _, raw := range values {
		value, reason := platformfetch.NormalizeDouyinMediaURL(raw, time.Now())
		if reason != "" {
			continue
		}
		if !seen[value] {
			seen[value] = true
			result = append(result, value)
		}
		if len(result) == 3 {
			break
		}
	}
	return result
}

func filterDouyinMedia(values []string) ([]string, []platformfetch.DouyinCandidateRejection) {
	result := make([]string, 0, 3)
	rejections := make([]platformfetch.DouyinCandidateRejection, 0, 6)
	seen := map[string]bool{}
	for _, raw := range values {
		value, reason := platformfetch.NormalizeDouyinMediaURL(raw, time.Now())
		if reason != "" {
			host := ""
			if parsed, err := url.Parse(strings.TrimSpace(raw)); err == nil {
				host = strings.ToLower(strings.TrimSuffix(parsed.Hostname(), "."))
			}
			if len(rejections) < 6 {
				rejections = append(rejections, platformfetch.DouyinCandidateRejection{Host: host, Reason: reason})
			}
			continue
		}
		if !seen[value] {
			seen[value] = true
			result = append(result, value)
		}
		if len(result) == 3 {
			break
		}
	}
	return result, rejections
}

func (b *platformPageBridge) CaptureFeed(ctx context.Context, platform string, pages int) (platformfetch.FeedCaptureResponse, error) {
	if platform != "douyin" {
		return platformfetch.FeedCaptureResponse{}, errors.New("该平台不支持页面推荐抓取")
	}
	if pages < 1 || pages > 10 {
		return platformfetch.FeedCaptureResponse{}, errors.New("页面推荐抓取页数无效")
	}
	captureCtx, cancel := context.WithTimeout(ctx, douyinFeedCaptureTimeout)
	defer cancel()
	lease, err := b.acquire(captureCtx, platform, "https://www.douyin.com/")
	if err != nil {
		return platformfetch.FeedCaptureResponse{}, err
	}
	defer lease.release()
	return b.captureFeedLocked(lease.ctx, lease.session, pages)
}

// captureFeedLocked reuses the exact recommendation-page capture flow for
// both discovery and playback. Caller owns the session's operation slot.
func (b *platformPageBridge) captureFeedLocked(captureCtx context.Context, session *platformPageSession, pages int, mediaTarget ...string) (platformfetch.FeedCaptureResponse, error) {
	target := ""
	if len(mediaTarget) > 0 {
		target = mediaTarget[0]
	}
	session.blockedNavigation.Store("")
	if _, err := evalPageWithRetry(captureCtx, session.window.Page(), douyinMediaTargetScript(target)); err != nil && captureCtx.Err() != nil {
		return platformfetch.FeedCaptureResponse{}, err
	}
	if _, err := evalPageWithRetry(captureCtx, session.window.Page(), douyinFeedClearScript); err != nil && captureCtx.Err() != nil {
		return platformfetch.FeedCaptureResponse{}, err
	}
	if err := session.window.Page().LoadURL("https://www.douyin.com/jingxuan"); err != nil {
		return platformfetch.FeedCaptureResponse{}, err
	}
	if err := waitForPageReady(captureCtx, session.window.Page(), "jingxuan"); err != nil {
		return platformfetch.FeedCaptureResponse{}, err
	}
	if blocked, ok := session.blockedNavigation.Load().(string); ok && blocked != "" {
		return platformfetch.FeedCaptureResponse{PageURL: blocked, Restricted: true}, nil
	}
	if target != "" {
		pageState, stateErr := readDouyinPageState(captureCtx, session.window.Page())
		if stateErr != nil {
			return platformfetch.FeedCaptureResponse{}, stateErr
		}
		if pageState.Restricted || !pageState.Douyin || looksLikeVerificationURL(pageState.URL) {
			return platformfetch.FeedCaptureResponse{PageURL: pageState.URL, Title: pageState.Title, Ready: pageState.Ready, Restricted: true}, nil
		}
	}
	result := douyinCaptureResult{}
	started := time.Now()
	var lastErr error
	deadline := started.Add(douyinDOMWait)
	for i := 0; i < pages; i++ {
		if i > 0 {
			if scroll, err := evalPageWithRetry(captureCtx, session.window.Page(), douyinDomScrollScript); err == nil {
				_ = decodeDouyinCaptureResult(scroll, &result)
			} else {
				lastErr = err
			}
		}
		remaining := time.Until(deadline)
		if remaining <= 0 {
			break
		}
		previous := douyinCaptureCounts{feed: len(result.FeedCards), dom: len(result.Cards) + len(result.Media)}
		waitFor := remaining
		if i > 0 && waitFor > douyinCaptureQuiet {
			waitFor = douyinCaptureQuiet
		}
		changed, err := waitForDouyinCapture(captureCtx, waitFor, previous, i > 0 || target != "", func() (douyinCaptureCounts, error) {
			if session.window == nil || session.window.IsDestroyed() {
				return douyinCaptureCounts{}, errors.New("抖音推荐页面已关闭")
			}
			readScript := douyinDomReadScript
			if target != "" {
				readScript = douyinFeedReadScriptForMedia(target)
			}
			raw, evalErr := evalPageWithRetry(captureCtx, session.window.Page(), readScript)
			if evalErr != nil {
				lastErr = evalErr
				if captureCtx.Err() != nil {
					return douyinCaptureCounts{}, captureCtx.Err()
				}
				if session.window == nil || session.window.IsDestroyed() {
					return douyinCaptureCounts{}, errors.New("抖音推荐页面已关闭")
				}
				return douyinCaptureCounts{}, nil
			}
			if decodeErr := decodeDouyinCaptureResult(raw, &result); decodeErr != nil {
				lastErr = decodeErr
				return douyinCaptureCounts{}, nil
			}
			return douyinCaptureCounts{feed: len(result.FeedCards), dom: len(result.Cards) + len(result.Media)}, nil
		})
		if err != nil {
			return platformfetch.FeedCaptureResponse{}, err
		}
		if i > 0 && !changed {
			break
		}
	}
	for attempts := 0; attempts < 2; attempts++ {
		if err := waitCapturePoll(captureCtx); err != nil {
			return platformfetch.FeedCaptureResponse{}, err
		}
		readScript := douyinFeedReadScript
		if target != "" {
			readScript = douyinFeedReadScriptForMedia(target)
		}
		raw, err := evalPageWithRetry(captureCtx, session.window.Page(), readScript)
		if err != nil {
			lastErr = err
			continue
		}
		_ = decodeDouyinCaptureResult(raw, &result)
	}
	if len(result.Cards) == 0 && len(result.FeedCards) == 0 && len(result.Media) == 0 && !result.Restricted {
		if err := session.window.Page().LoadURL("https://www.douyin.com/?recommend=1"); err == nil {
			if err := waitForPageReady(captureCtx, session.window.Page(), "recommend=1"); err == nil {
				if blocked, ok := session.blockedNavigation.Load().(string); ok && blocked != "" {
					return platformfetch.FeedCaptureResponse{PageURL: blocked, Restricted: true}, nil
				}
				pageState, stateErr := readDouyinPageState(captureCtx, session.window.Page())
				if stateErr != nil {
					return platformfetch.FeedCaptureResponse{}, stateErr
				}
				if !pageState.Douyin || pageState.Restricted || looksLikeVerificationURL(pageState.URL) {
					return platformfetch.FeedCaptureResponse{PageURL: pageState.URL, Title: pageState.Title, Ready: pageState.Ready, Restricted: true}, nil
				}
				for i := 0; i < pages; i++ {
					if raw, err := evalPageWithRetry(captureCtx, session.window.Page(), douyinRecommendNextScript); err == nil {
						_ = decodeDouyinCaptureResult(raw, &result)
					}
					if err := waitCapturePoll(captureCtx); err != nil {
						return platformfetch.FeedCaptureResponse{}, err
					}
					readScript := douyinFeedReadScript
					if target != "" {
						readScript = douyinFeedReadScriptForMedia(target)
					}
					if raw, err := evalPageWithRetry(captureCtx, session.window.Page(), readScript); err == nil {
						_ = decodeDouyinCaptureResult(raw, &result)
					}
				}
			} else if blocked, ok := session.blockedNavigation.Load().(string); ok && blocked != "" {
				return platformfetch.FeedCaptureResponse{PageURL: blocked, Restricted: true}, nil
			}
		}
	}
	if len(result.Responses) == 0 && len(result.FeedCards) == 0 && lastErr != nil && captureCtx.Err() != nil {
		return platformfetch.FeedCaptureResponse{}, lastErr
	}
	responses := make([]platformfetch.FeedResponse, 0, len(result.Responses))
	for _, response := range result.Responses {
		responses = append(responses, sanitizeDouyinCaptureResponse(response))
	}
	pageURL := result.PageURL
	if blocked, ok := session.blockedNavigation.Load().(string); ok && blocked != "" {
		pageURL = blocked
	}
	result.DOM.WaitMilliseconds = int(time.Since(started) / time.Millisecond)
	mediaCaptures := []platformfetch.VideoMediaCapture(nil)
	if target != "" {
		mediaCaptures = result.Media
	}
	return platformfetch.FeedCaptureResponse{Responses: responses, FeedCards: result.FeedCards, FeedHasMore: result.FeedHasMore, FeedParsed: result.FeedParsed, DOMCards: result.Cards, PageURL: pageURL, Title: result.Title, Ready: result.Ready, ResourcePaths: result.ResourcePaths, InitiatorTypes: result.InitiatorTypes, FetchHookInstalled: result.FetchHookInstalled, XHRHookInstalled: result.XHRHookInstalled, MediaCaptures: mediaCaptures, Restricted: result.Restricted || looksLikeVerificationURL(pageURL), DOM: result.DOM}, nil
}

type douyinCaptureCounts struct {
	feed int
	dom  int
}

func waitForDouyinCapture(ctx context.Context, maxWait time.Duration, previous douyinCaptureCounts, requireGrowth bool, read func() (douyinCaptureCounts, error)) (bool, error) {
	if maxWait <= 0 {
		return false, nil
	}
	deadline := time.NewTimer(maxWait)
	defer deadline.Stop()
	ticker := time.NewTicker(douyinCapturePoll)
	defer ticker.Stop()
	started := time.Now()
	last := previous
	stableSince := time.Time{}
	changed := false
	for {
		counts, err := read()
		if err == nil {
			if counts.feed > last.feed || counts.dom > last.dom {
				last = counts
				changed = true
				stableSince = time.Now()
			} else if !requireGrowth && !stableSince.IsZero() && (counts.feed != last.feed || counts.dom != last.dom) {
				last = counts
				stableSince = time.Now()
			}
			hasCards := counts.feed > 0 || counts.dom > 0
			if hasCards && (!requireGrowth || changed) {
				if stableSince.IsZero() {
					stableSince = time.Now()
				}
				if time.Since(stableSince) >= douyinCaptureStable {
					return changed, nil
				}
			}
		}
		if requireGrowth && !changed && time.Since(started) >= douyinCaptureQuiet {
			return false, nil
		}
		select {
		case <-ctx.Done():
			return changed, ctx.Err()
		case <-deadline.C:
			return changed, nil
		case <-ticker.C:
		}
	}
}

func (b *platformPageBridge) CaptureSearch(ctx context.Context, platform, query, cursor string) (platformfetch.SearchCaptureResponse, error) {
	origin, ok := platformPageOrigin(platform)
	if !ok || (platform != "douyin" && platform != "xiaohongshu") {
		return platformfetch.SearchCaptureResponse{}, errors.New("该平台不支持页面关键词搜索")
	}
	path, err := searchPageURL(platform, query, cursor)
	if err != nil {
		return platformfetch.SearchCaptureResponse{}, err
	}
	lease, err := b.acquire(ctx, platform, origin)
	if err != nil {
		return platformfetch.SearchCaptureResponse{}, err
	}
	defer lease.release()
	session, ctx := lease.session, lease.ctx
	if err := session.window.Page().LoadURL(path); err != nil {
		return platformfetch.SearchCaptureResponse{}, err
	}
	if err := waitForPageReady(ctx, session.window.Page(), "search"); err != nil {
		return platformfetch.SearchCaptureResponse{}, err
	}
	raw, err := evalPageWithRetry(ctx, session.window.Page(), searchDomReadScript)
	if err != nil {
		return platformfetch.SearchCaptureResponse{}, err
	}
	encoded, err := json.Marshal(raw)
	if err != nil {
		return platformfetch.SearchCaptureResponse{}, err
	}
	var result struct {
		PageURL string                  `json:"pageUrl"`
		Title   string                  `json:"title"`
		Ready   string                  `json:"ready"`
		Cards   []platformfetch.DOMCard `json:"cards"`
	}
	if err := json.Unmarshal(encoded, &result); err != nil {
		return platformfetch.SearchCaptureResponse{}, err
	}
	return platformfetch.SearchCaptureResponse{DOMCards: result.Cards, PageURL: result.PageURL, Title: result.Title, Ready: result.Ready}, nil
}

func searchPageURL(platform, query, cursor string) (string, error) {
	query = strings.TrimSpace(query)
	if query == "" || len([]rune(query)) > 200 || strings.ContainsRune(query, '\x00') {
		return "", errors.New("页面关键词无效")
	}
	if cursor != "" {
		page, err := strconv.Atoi(cursor)
		if err != nil || page < 1 || page > 1000 {
			return "", errors.New("页面搜索游标无效")
		}
	}
	var raw string
	switch platform {
	case "douyin":
		raw = "https://www.douyin.com/search/" + url.PathEscape(query)
	case "xiaohongshu":
		raw = "https://www.xiaohongshu.com/search_result?keyword=" + url.QueryEscape(query)
	default:
		return "", errors.New("该平台不支持页面关键词搜索")
	}
	if cursor != "" {
		raw += "&page=" + url.QueryEscape(cursor)
	}
	return raw, nil
}

type douyinCaptureResponse struct {
	URL         string                  `json:"url"`
	Status      int                     `json:"status"`
	APIStatus   int                     `json:"apiStatus"`
	Parsed      bool                    `json:"parsed"`
	HasMore     bool                    `json:"hasMore"`
	TooLarge    bool                    `json:"tooLarge"`
	ContentType string                  `json:"contentType"`
	Cards       []platformfetch.DOMCard `json:"cards"`
}

type douyinMediaReadResult struct {
	PageURL            string                            `json:"pageURL"`
	ReadyState         string                            `json:"readyState"`
	IsDouyinContext    bool                              `json:"isDouyinContext"`
	Restricted         bool                              `json:"restricted"`
	Captures           []platformfetch.VideoMediaCapture `json:"captures"`
	Latest             *platformfetch.VideoMediaCapture  `json:"latest"`
	FetchHookInstalled bool                              `json:"fetchHookInstalled"`
	XHRHookInstalled   bool                              `json:"xhrHookInstalled"`
}

type douyinDOMMediaResult struct {
	PageURL          string                              `json:"pageURL"`
	ReadyState       string                              `json:"readyState"`
	IsDouyinContext  bool                                `json:"isDouyinContext"`
	Restricted       bool                                `json:"restricted"`
	TooLarge         bool                                `json:"tooLarge"`
	ResponseBytes    int                                 `json:"responseBytes"`
	VideoCount       int                                 `json:"videoCount"`
	VideoSourceCount int                                 `json:"videoSourceCount"`
	Candidates       []platformfetch.VideoMediaCandidate `json:"candidates"`
}

type douyinMediaStats struct {
	Status              int
	ContentType         string
	ResponseURL         string
	ResponseBytes       int64
	ResponseBytesKnown  bool
	HasResponse         bool
	TargetMatches       int
	CandidateCount      int
	AcceptedCount       int
	TooLarge            bool
	Snippet             string
	Reason              string
	BusinessStatus      int
	FetchHookInstalled  *bool
	XHRHookInstalled    *bool
	CandidateRejections []platformfetch.DouyinCandidateRejection
}

type douyinPageState struct {
	URL        string `json:"url"`
	Title      string `json:"title"`
	Ready      string `json:"ready"`
	Restricted bool   `json:"restricted"`
	Douyin     bool   `json:"douyin"`
}

func readDouyinPageState(ctx context.Context, page *mygo.Page) (douyinPageState, error) {
	raw, err := evalPageWithRetry(ctx, page, douyinPageStateScript)
	if err != nil {
		return douyinPageState{}, err
	}
	encoded, err := json.Marshal(raw)
	if err != nil {
		return douyinPageState{}, err
	}
	var state douyinPageState
	if err := json.Unmarshal(encoded, &state); err != nil {
		return douyinPageState{}, err
	}
	return state, nil
}

func decodeDouyinMediaReadResult(raw any, result *douyinMediaReadResult) error {
	encoded, err := json.Marshal(raw)
	if err != nil {
		return err
	}
	return json.Unmarshal(encoded, result)
}

func mergeDouyinMediaReadResult(previous, current douyinMediaReadResult) douyinMediaReadResult {
	previous.PageURL = current.PageURL
	previous.ReadyState = current.ReadyState
	previous.IsDouyinContext = current.IsDouyinContext
	previous.Restricted = current.Restricted
	previous.Latest = current.Latest
	previous.FetchHookInstalled = current.FetchHookInstalled
	previous.XHRHookInstalled = current.XHRHookInstalled
	previous.Captures = append(previous.Captures, current.Captures...)
	if len(previous.Captures) > 64 {
		previous.Captures = previous.Captures[len(previous.Captures)-64:]
	}
	return previous
}

func decodeDouyinDOMMediaResult(raw any, result *douyinDOMMediaResult) error {
	encoded, err := json.Marshal(raw)
	if err != nil {
		return err
	}
	return json.Unmarshal(encoded, result)
}

func mediaCapturesDone(captures []platformfetch.VideoMediaCapture, id string) bool {
	for _, capture := range captures {
		if captureMatchesTarget(capture, id) && (capture.Restricted || capture.TooLarge || capture.Reason != "" || (capture.Status != nil && *capture.Status >= http.StatusBadRequest)) {
			return true
		}
		if len(validCaptureCandidates(capture, id)) > 0 || (captureMatchesTarget(capture, id) && capture.HasResponse && capture.Status != nil && *capture.Status >= 200 && *capture.Status < 300 && capture.ContentType != nil && isJSONContentType(*capture.ContentType)) {
			return true
		}
	}
	return false
}

func hasRestrictedMediaCapture(captures []platformfetch.VideoMediaCapture, id string) bool {
	for _, capture := range captures {
		if capture.Restricted && captureMatchesTarget(capture, id) {
			return true
		}
	}
	return false
}

func captureMatchesTarget(capture platformfetch.VideoMediaCapture, id string) bool {
	if capture.RequestID == id {
		return true
	}
	for _, matchedID := range capture.MatchedIDs {
		if matchedID == id {
			return true
		}
	}
	for _, candidate := range capture.Candidates {
		if candidate.ID == id {
			return true
		}
	}
	return false
}

func validCaptureCandidates(capture platformfetch.VideoMediaCapture, id string) []string {
	if !capture.HasResponse || capture.TooLarge || capture.Restricted || capture.Status == nil || *capture.Status < 200 || *capture.Status >= 300 || capture.ContentType == nil || !isJSONContentType(*capture.ContentType) || capture.ResponseBytes == nil || *capture.ResponseBytes > platformFetchMaxBody {
		return nil
	}
	var values []string
	for _, candidate := range capture.Candidates {
		if candidate.ID == id {
			values = append(values, candidate.URLs...)
		}
	}
	result := make([]string, 0, 3)
	for _, raw := range values {
		if normalized, reason := platformfetch.NormalizeDouyinMediaURL(raw, time.Now()); reason == "" {
			result = append(result, normalized)
			if len(result) == 3 {
				break
			}
		}
	}
	return result
}

func mediaCandidatesFromCaptures(captures []platformfetch.VideoMediaCapture, id string) ([]string, douyinMediaStats) {
	values := make([]string, 0, 12)
	stats := douyinMediaStats{}
	seen := make(map[string]bool)
	var unmatched *platformfetch.VideoMediaCapture
	for _, capture := range captures {
		matched := captureMatchesTarget(capture, id)
		if !matched {
			copy := capture
			unmatched = &copy
			continue
		}
		if capture.Status != nil {
			stats.Status = *capture.Status
		}
		if capture.ContentType != nil {
			stats.ContentType = *capture.ContentType
		} else {
			stats.ContentType = ""
		}
		stats.ResponseURL = capture.Path
		stats.HasResponse = capture.HasResponse
		if capture.ResponseBytes != nil {
			stats.ResponseBytes = *capture.ResponseBytes
			stats.ResponseBytesKnown = true
		} else {
			stats.ResponseBytes = 0
			stats.ResponseBytesKnown = false
		}
		stats.TooLarge = capture.TooLarge
		if capture.HasResponse {
			stats.Reason = capture.Reason
		} else if capture.Reason != "" {
			stats.Reason = capture.Reason
		}
		if capture.Restricted {
			stats.Reason = "business_verification"
		}
		if capture.BusinessStatus != 0 {
			stats.BusinessStatus = capture.BusinessStatus
		}
		if matched {
			matches := capture.TargetMatchCount
			if matches < 1 {
				matches = 1
			}
			if matches > 32 {
				matches = 32
			}
			stats.TargetMatches += matches
		}
		if capture.SnippetRedacted != "" && len(stats.Snippet) == 0 {
			stats.Snippet = capture.SnippetRedacted
		}
		filtered := validCaptureCandidates(capture, id)
		for _, candidate := range capture.Candidates {
			if candidate.ID == id {
				stats.CandidateCount += len(candidate.URLs)
				for _, raw := range candidate.URLs {
					if _, reason := platformfetch.NormalizeDouyinMediaURL(raw, time.Now()); reason != "" && len(stats.CandidateRejections) < 6 {
						host := ""
						if parsed, err := url.Parse(strings.TrimSpace(raw)); err == nil {
							host = strings.ToLower(strings.TrimSuffix(parsed.Hostname(), "."))
						}
						stats.CandidateRejections = append(stats.CandidateRejections, platformfetch.DouyinCandidateRejection{Host: host, Reason: reason})
					}
				}
			}
		}
		stats.AcceptedCount += len(filtered)
		for _, value := range filtered {
			if !seen[value] {
				seen[value] = true
				values = append(values, value)
			}
		}
	}
	if stats.TargetMatches == 0 && unmatched != nil {
		stats.Status = valueOrZero(unmatched.Status)
		stats.ContentType = valueOrEmpty(unmatched.ContentType)
		stats.ResponseURL = unmatched.Path
		stats.HasResponse = unmatched.HasResponse
		if unmatched.ResponseBytes != nil {
			stats.ResponseBytes = *unmatched.ResponseBytes
			stats.ResponseBytesKnown = true
		}
		stats.TooLarge = unmatched.TooLarge
		stats.Reason = unmatched.Reason
		stats.BusinessStatus = unmatched.BusinessStatus
		if unmatched.SnippetRedacted != "" {
			stats.Snippet = unmatched.SnippetRedacted
		}
		if unmatched.Restricted {
			stats.Reason = "business_verification"
		}
	}
	if stats.TargetMatches == 0 && stats.Reason == "" {
		stats.Reason = "target_not_matched"
	}
	return values, stats
}

func valueOrZero(value *int) int {
	if value == nil {
		return 0
	}
	return *value
}

func valueOrEmpty(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func mediaCaptureDiagnostics(stage string, stats douyinMediaStats, pageURL, ready string, isContext bool) []platformfetch.VideoMediaDiagnostic {
	outcome, reason := "no_url", "media_not_found"
	if stats.Reason == "business_verification" {
		outcome, reason = "restricted", "business_verification"
	} else if stats.Status >= 400 {
		outcome, reason = "http_error", "http_status"
	} else if stats.TooLarge {
		outcome, reason = "too_large", "response_too_large"
	} else if stats.Reason == "fetch_reject" || stats.Reason == "xhr_network_error" || stats.Reason == "response_unavailable" || stats.Reason == "invalid_json" || stats.Reason == "non_json" || stats.Reason == "javascript_error" || stats.Reason == "observer_no_response" || stats.Reason == "observer_not_installed" || stats.Reason == "request_aborted" {
		outcome, reason = "exception", stats.Reason
	} else if stats.Reason == "request_timeout" || stats.Reason == "timeout" {
		outcome, reason = "timeout", "timeout"
	} else if stats.AcceptedCount > 0 {
		outcome, reason = "ok", "media_found"
	} else if stats.CandidateCount > 0 {
		outcome, reason = "no_url", "candidate_filtered"
	} else if stats.Reason == "target_not_matched" {
		outcome, reason = "no_url", "target_not_matched"
	}
	status := (*int)(nil)
	if stats.Status > 0 {
		status = intPtr(stats.Status)
	}
	typeValue := stats.ContentType
	var bytes *int64
	if stats.HasResponse && stats.ResponseBytesKnown {
		bytes = int64Ptr(stats.ResponseBytes)
	}
	target := stats.TargetMatches
	var snippet *string
	if stats.Snippet != "" && len(stats.Snippet) <= 200 {
		snippet = &stats.Snippet
	}
	var contentType *string
	if typeValue != "" {
		contentType = &typeValue
	}
	var responseURL *string
	if stats.ResponseURL != "" {
		responseURL = safePageURL("https://" + stats.ResponseURL)
	}
	return []platformfetch.VideoMediaDiagnostic{{Stage: stage, Outcome: outcome, Reason: reason, HTTPStatus: status, ResponseURL: responseURL, CandidateRejections: stats.CandidateRejections, BusinessStatus: func() *int {
		if stats.BusinessStatus != 0 {
			return intPtr(stats.BusinessStatus)
		}
		return nil
	}(), ContentType: contentType, PageURL: safePageURL(pageURL), PageReadyState: &ready, IsDouyinContext: boolPtr(isContext), FetchHookInstalled: stats.FetchHookInstalled, XHRHookInstalled: stats.XHRHookInstalled, TargetMatchCount: intPtr(target), CandidateCount: intPtr(stats.CandidateCount), AcceptedCount: intPtr(stats.AcceptedCount), ResponseBytes: bytes, ResponseSnippetRedacted: snippet}}
}

func sanitizeDouyinCaptureResponse(response douyinCaptureResponse) platformfetch.FeedResponse {
	return platformfetch.FeedResponse{
		Status: response.Status, APIStatus: response.APIStatus, Parsed: response.Parsed,
		HasMore: response.HasMore, TooLarge: response.TooLarge, URL: safeCaptureURL(response.URL), ContentType: truncateCaptureContentType(response.ContentType),
	}
}

func sanitizeDouyinCard(card platformfetch.DOMCard) platformfetch.DOMCard {
	return platformfetch.DOMCard{
		ID:           truncateCaptureField(card.ID, 64),
		URL:          safeCaptureURL(card.URL),
		ThumbnailURL: safeCaptureImageURL(card.ThumbnailURL),
		Title:        truncateCaptureField(card.Title, 1000),
		Author:       truncateCaptureField(card.Author, 200),
		AuthorID:     truncateCaptureField(card.AuthorID, 200),
		LikeCount:    clampCaptureNumber(card.LikeCount),
		Duration:     clampCaptureNumber(card.Duration),
	}
}

func safeCaptureImageURL(raw string) string {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || len(raw) > 4096 || u.Scheme != "https" || u.Hostname() == "" || u.User != nil || u.Opaque != "" {
		return ""
	}
	u.Fragment = ""
	return u.String()
}

func truncateCaptureField(value string, limit int) string {
	value = strings.TrimSpace(value)
	if len(value) > limit {
		return value[:limit]
	}
	return value
}

func clampCaptureNumber(value int) int {
	if value < 0 {
		return 0
	}
	if value > 2147483647 {
		return 2147483647
	}
	return value
}

func safeCaptureURL(raw string) string {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Scheme == "" || u.Host == "" || u.User != nil {
		return ""
	}
	u.RawQuery = ""
	u.Fragment = ""
	return u.String()
}

func truncateCaptureContentType(raw string) string {
	value := strings.TrimSpace(raw)
	if len(value) > 256 {
		return value[:256]
	}
	return value
}

type douyinCaptureResult struct {
	PageURL     string                  `json:"pageUrl"`
	Title       string                  `json:"title"`
	Ready       string                  `json:"ready"`
	Responses   []douyinCaptureResponse `json:"responses"`
	FeedCards   []platformfetch.DOMCard `json:"feedCards"`
	FeedHasMore bool                    `json:"feedHasMore"`
	FeedParsed  bool                    `json:"feedParsed"`
	Cards       []platformfetch.DOMCard `json:"cards"`
	Resources   []struct {
		Path          string `json:"path"`
		InitiatorType string `json:"initiatorType"`
	} `json:"resources"`
	ResourcePaths      []string
	InitiatorTypes     []string
	FetchHookInstalled bool                              `json:"fetchHookInstalled"`
	XHRHookInstalled   bool                              `json:"xhrHookInstalled"`
	Media              []platformfetch.VideoMediaCapture `json:"media"`
	Restricted         bool                              `json:"restricted"`
	DOM                platformfetch.DOMDiagnostics      `json:"domDiagnostics"`
}

func decodeDouyinCaptureResult(raw any, result *douyinCaptureResult) error {
	encoded, err := json.Marshal(raw)
	if err != nil {
		return err
	}
	var current douyinCaptureResult
	if err := json.Unmarshal(encoded, &current); err != nil {
		return err
	}
	if current.PageURL != "" {
		result.PageURL = current.PageURL
	}
	result.Restricted = result.Restricted || current.Restricted
	result.Media = append(result.Media, current.Media...)
	if len(result.Media) > 128 {
		result.Media = result.Media[len(result.Media)-128:]
	}
	if current.Title != "" {
		result.Title = current.Title
	}
	if current.Ready != "" {
		result.Ready = current.Ready
	}
	for _, response := range current.Responses {
		result.Responses = append(result.Responses, response)
		result.FeedParsed = result.FeedParsed || response.Parsed
		cards := make([]platformfetch.DOMCard, 0, len(response.Cards))
		for _, card := range response.Cards {
			cards = append(cards, sanitizeDouyinCard(card))
		}
		result.FeedCards = mergeDOMCards(result.FeedCards, cards)
		if response.HasMore {
			result.FeedHasMore = true
		}
	}
	if len(result.Responses) > 128 {
		result.Responses = result.Responses[len(result.Responses)-128:]
	}
	cards := make([]platformfetch.DOMCard, 0, len(current.Cards))
	for _, card := range current.Cards {
		cards = append(cards, sanitizeDouyinCard(card))
	}
	result.Cards = mergeDOMCards(result.Cards, cards)
	if current.DOM.URL != "" {
		result.DOM = current.DOM
		result.DOM.CardsRead = len(result.Cards)
	}
	for _, resource := range current.Resources {
		if len(result.ResourcePaths) >= 256 {
			break
		}
		result.ResourcePaths = append(result.ResourcePaths, resource.Path)
		result.InitiatorTypes = append(result.InitiatorTypes, resource.InitiatorType)
	}
	var metadata struct {
		FetchHookInstalled *bool `json:"fetchHookInstalled"`
		XHRHookInstalled   *bool `json:"xhrHookInstalled"`
		Restricted         *bool `json:"restricted"`
	}
	if err := json.Unmarshal(encoded, &metadata); err == nil {
		if metadata.FetchHookInstalled != nil {
			result.FetchHookInstalled = *metadata.FetchHookInstalled
		}
		if metadata.XHRHookInstalled != nil {
			result.XHRHookInstalled = *metadata.XHRHookInstalled
		}
		if metadata.Restricted != nil {
			result.Restricted = result.Restricted || *metadata.Restricted
		}
	}
	return nil
}

func mergeDOMCards(existing, incoming []platformfetch.DOMCard) []platformfetch.DOMCard {
	merged := append([]platformfetch.DOMCard(nil), existing...)
	indexes := make(map[string]int, len(merged)+len(incoming))
	for index, card := range merged {
		indexes[card.ID] = index
	}
	for _, card := range incoming {
		if index, ok := indexes[card.ID]; ok {
			current := &merged[index]
			if current.URL == "" {
				current.URL = card.URL
			}
			if current.ThumbnailURL == "" {
				current.ThumbnailURL = card.ThumbnailURL
			}
			if current.Title == "" {
				current.Title = card.Title
			}
			if current.Author == "" {
				current.Author = card.Author
			}
			if current.LikeCount == 0 {
				current.LikeCount = card.LikeCount
			}
			if current.Duration == 0 {
				current.Duration = card.Duration
			}
			continue
		}
		if len(merged) >= 500 {
			break
		}
		indexes[card.ID] = len(merged)
		merged = append(merged, card)
	}
	return merged
}

func waitCapturePoll(ctx context.Context) error {
	timer := time.NewTimer(douyinCapturePoll)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

func waitForPageReady(ctx context.Context, page *mygo.Page, pathHint string) error {
	deadline := time.NewTimer(platformFetchTimeout)
	defer deadline.Stop()
	for {
		result, err := evalPageWithRetry(ctx, page, `(function(){ return {url:location.href, ready:document.readyState}; })()`)
		if err == nil {
			encoded, marshalErr := json.Marshal(result)
			if marshalErr == nil {
				var state struct {
					URL   string `json:"url"`
					Ready string `json:"ready"`
				}
				if json.Unmarshal(encoded, &state) == nil && state.Ready == "complete" {
					// A challenge can replace /jingxuan with the home page or a
					// same-origin verification route. Return as soon as the document
					// is complete so diagnostics can report that final location.
					_ = pathHint
					return nil
				}
			}
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-deadline.C:
			if err != nil {
				return err
			}
			return context.DeadlineExceeded
		default:
		}
		if err := waitCapturePoll(ctx); err != nil {
			return err
		}
	}
}

func evalPageWithRetry(ctx context.Context, page *mygo.Page, code string) (any, error) {
	return evalWithRetry(ctx, page.EvalContext, code)
}

func evalWithRetry(ctx context.Context, eval func(context.Context, string) (any, error), code string) (any, error) {
	var lastErr error
	for attempt := 0; attempt < 3; attempt++ {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		result, err := eval(ctx, code)
		if err == nil {
			return result, nil
		}
		lastErr = err
		if !isPageContextGoneError(err) {
			return nil, err
		}
		if err := waitCapturePoll(ctx); err != nil {
			return nil, err
		}
	}
	return nil, lastErr
}

func isPageContextGoneError(err error) bool {
	if err == nil {
		return false
	}
	value := strings.ToLower(err.Error())
	return strings.Contains(value, "completion handler") || strings.Contains(value, "context") && (strings.Contains(value, "destroy") || strings.Contains(value, "navigation") || strings.Contains(value, "reachable"))
}

func createPlatformPageWindow(session *platformPageSession) (platformSessionWindow, error) {
	platform, origin := session.platform, session.origin
	x, y := platformPageWindowPosition(mygo.Screen.Displays(), platformPageWindowWidth, platformPageWindowHeight)
	planned := mygo.Rectangle{X: x, Y: y, Width: platformPageWindowWidth, Height: platformPageWindowHeight}
	window := mygo.NewWindow(mygo.WindowOptions{
		Title: "Tangentry 平台请求", X: x, Y: y,
		Width: platformPageWindowWidth, Height: platformPageWindowHeight, MinWidth: 640, MinHeight: 480,
		Frameless: true, Transparent: true, Panel: true,
		DisableResize: true, DisableMove: true, DisableMinimize: true, DisableMaximize: true,
		DisableClose: true, DisableFullScreen: true, SkipTaskbar: true,
		Page: mygo.PageOptions{TrustedOrigins: []string{origin}, PreloadScript: func() string {
			if platform == "douyin" {
				return douyinFeedCaptureScript + "\n" + platformMediaGuardScript
			}
			return platformMediaGuardScript
		}()},
	})
	concealPlatformPageWindow(window, planned)
	window.Page().OnPageTitleUpdated(func(event *mygo.TitleEvent) { event.PreventDefault() })
	window.Page().OnDOMReady(func() { session.readyOnce.Do(func() { close(session.ready) }) })
	window.Page().OnWillNavigate(func(event *mygo.NavigateEvent) {
		if !platformPageURLAllowed(event.URL, platform) {
			session.blockedNavigation.Store(event.URL)
			event.PreventDefault()
		}
	})
	window.Page().SetWindowOpenHandler(func(mygo.WindowOpenRequest) *mygo.WindowOptions { return nil })
	window.OnClosed(func() {
		session.bridge.mu.Lock()
		session.retireLocked()
		session.bridge.mu.Unlock()
	})
	return &nativePlatformSessionWindow{window}, nil
}

func waitPlatformPage(ctx context.Context, ready <-chan struct{}) error {
	select {
	case <-ready:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	case <-time.After(platformFetchTimeout):
		return context.DeadlineExceeded
	}
}

func platformPageOrigin(platform string) (string, bool) {
	switch platform {
	case "bilibili":
		// Keep the hidden page in the real Bilibili site context. Bilibili's
		// subtitle APIs depend on the page's signed-in cookies, Origin and
		// browser session; calling them from an api.bilibili.com document does
		// not reproduce the viewer tab used by qiaomu-clipper.
		return "https://www.bilibili.com/", true
	case "linuxdo":
		return "https://linux.do/", true
	case "douyin":
		return "https://www.douyin.com/", true
	case "xiaohongshu":
		return "https://www.xiaohongshu.com/", true
	default:
		return "", false
	}
}

func validatePlatformPath(raw string) error {
	if raw == "" || len(raw) > 8192 || !strings.HasPrefix(raw, "/") || strings.HasPrefix(raw, "//") || strings.ContainsAny(raw, "\\\x00\r\n") {
		return errors.New("页面请求路径无效")
	}
	u, err := url.Parse(raw)
	if err != nil || u.IsAbs() || u.Host != "" || u.User != nil || strings.Contains(u.Path, "..") {
		return errors.New("页面请求必须是同源路径")
	}
	return nil
}

func validatePlatformFetchRequest(request *app.PlatformPageRequest) error {
	if request.Method == "" {
		request.Method = "GET"
	}
	if request.Method != "GET" && request.Method != "POST" {
		return errors.New("页面请求方法不受支持")
	}
	if len(request.Body) > 256<<10 || len(request.Headers) > 16 {
		return errors.New("页面请求参数过大")
	}
	total := 0
	for name, value := range request.Headers {
		if name == "" || len(name) > 128 || len(value) > 8192 || strings.ContainsAny(name, "\r\n") || strings.ContainsAny(value, "\r\n") {
			return errors.New("页面请求标头无效")
		}
		total += len(name) + len(value)
	}
	if total > 64<<10 {
		return errors.New("页面请求标头过大")
	}
	return nil
}

func platformPageURLAllowed(raw, platform string) bool {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || u.User != nil || u.Port() != "" {
		return false
	}
	host := strings.ToLower(strings.TrimSuffix(u.Hostname(), "."))
	switch platform {
	case "bilibili":
		return host == "www.bilibili.com"
	case "linuxdo":
		return host == "linux.do"
	case "douyin":
		return host == "www.douyin.com" || host == "aweme.snssdk.com"
	case "xiaohongshu":
		return host == "www.xiaohongshu.com"
	default:
		return false
	}
}

func validateBilibiliSubtitlePath(raw string) bool {
	u, err := url.Parse(raw)
	if err != nil || u.IsAbs() || u.Host != "" || u.User != nil || u.Fragment != "" {
		return false
	}
	query := u.Query()
	if u.Path == "/x/web-interface/nav" {
		return u.RawQuery == ""
	}
	if u.Path == "/x/web-interface/view" {
		return len(query) == 1 && len(query["bvid"]) == 1 && regexp.MustCompile(`^BV[0-9A-Za-z]{10}$`).MatchString(query.Get("bvid"))
	}
	if u.Path == "/x/player/v2" {
		if len(query) != 2 || len(query["cid"]) != 1 || len(query["aid"])+len(query["bvid"]) != 1 {
			return false
		}
		return validBilibiliNumericID(query.Get("cid")) && (validBilibiliNumericID(query.Get("aid")) || regexp.MustCompile(`^BV[0-9A-Za-z]{10}$`).MatchString(query.Get("bvid")))
	}
	if u.Path == "/x/player/wbi/v2" {
		if len(query) == 2 && len(query["aid"]) == 1 && len(query["cid"]) == 1 {
			return validBilibiliNumericID(query.Get("aid")) && validBilibiliNumericID(query.Get("cid"))
		}
		if len(query) != 4 || len(query["aid"]) != 1 || len(query["cid"]) != 1 || len(query["wts"]) != 1 || len(query["w_rid"]) != 1 {
			return false
		}
		return validBilibiliNumericID(query.Get("aid")) && validBilibiliNumericID(query.Get("cid")) && regexp.MustCompile(`^[1-9][0-9]{0,11}$`).MatchString(query.Get("wts")) && regexp.MustCompile(`^[a-f0-9]{32}$`).MatchString(query.Get("w_rid"))
	}
	return false
}

func validBilibiliNumericID(value string) bool {
	return regexp.MustCompile(`^[1-9][0-9]{0,19}$`).MatchString(value)
}

func validBilibiliSubtitleResponseURL(raw string) bool {
	u, err := url.Parse(raw)
	return err == nil && u.Scheme == "https" && u.Host == "api.bilibili.com" && u.User == nil && u.Port() == "" && u.Fragment == "" && validateBilibiliSubtitlePath(u.RequestURI())
}

func validatePlatformFetchResponse(result platformFetchResult) error {
	if result.TooLarge || len(result.Body) > platformFetchMaxBody {
		return errors.New("平台页面响应过大或无法限制大小")
	}
	return nil
}

type platformFetchResult struct {
	Status      int    `json:"status"`
	Body        string `json:"body"`
	TooLarge    bool   `json:"tooLarge"`
	URL         string `json:"url"`
	ContentType string `json:"contentType"`
}

func platformFetchScript(path string, request app.PlatformPageRequest) (string, error) {
	pathJSON, err := json.Marshal(path)
	if err != nil {
		return "", err
	}
	method, _ := json.Marshal(request.Method)
	headers, err := json.Marshal(request.Headers)
	if err != nil {
		return "", err
	}
	body, err := json.Marshal(request.Body)
	if err != nil {
		return "", err
	}
	bodyOption := ""
	if request.Method != "GET" && request.Method != "HEAD" {
		bodyOption = ", body:" + string(body)
	}
	base := "location.origin"
	if request.Method == http.MethodGet && request.Headers["Accept"] == "application/json" && validateBilibiliSubtitlePath(path) {
		// The API is cross-origin from the real video page. This mirrors the
		// browser-tab request used by qiaomu-clipper while keeping the path
		// allowlist in Go as the security boundary.
		base = `"https://api.bilibili.com"`
	}
	return fmt.Sprintf(`const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), %d); try { return await fetch(%s + %s, {method:%s, headers:%s, credentials:"include"%s, signal:controller.signal}).then(async response => { const max=%d; const meta={status:response.status, url:response.url || "", contentType:response.headers.get("content-type") || ""}; const type=String(meta.contentType).toLowerCase().split(";",1)[0].trim(); const length=Number(response.headers.get("content-length") || 0); const jsonType=!type || type === "application/json" || type === "text/json" || type.endsWith("+json"); if (!jsonType) return {...meta, body:"", tooLarge:false}; if (!response.body) { if (!length || length>max) return {...meta, body:"", tooLarge:true}; const body=await response.text(); return {...meta, body:body, tooLarge:false}; } const reader=response.body.getReader(); const decoder=new TextDecoder(); let body="", bytes=0; try { for (;;) { const part=await reader.read(); if (part.done) break; bytes+=part.value.byteLength; if (bytes>max) { await reader.cancel(); return {...meta, body:"", tooLarge:true}; } body+=decoder.decode(part.value,{stream:true}); } body+=decoder.decode(); return {...meta, body:body, tooLarge:false}; } finally { reader.releaseLock(); } }); } finally { clearTimeout(timer); }`, platformFetchTimeout.Milliseconds(), base, pathJSON, method, headers, bodyOption, platformFetchMaxBody), nil
}

func isCloudflarePage(status int, body string, contentTypes ...string) bool {
	contentType := ""
	if len(contentTypes) > 0 {
		contentType = strings.ToLower(strings.TrimSpace(contentTypes[0]))
	}
	// A valid JSON response is never a Cloudflare interstitial, even if a
	// harmless field happens to contain the word "cloudflare".
	if json.Valid([]byte(body)) || strings.Contains(contentType, "json") {
		return false
	}
	if contentType != "" && !strings.Contains(contentType, "text/html") {
		return false
	}
	value := strings.ToLower(body)
	if !strings.Contains(contentType, "text/html") {
		return false
	}
	return strings.Contains(value, "just a moment") || strings.Contains(value, "challenge-platform") || strings.Contains(value, "cf-chl-") || strings.Contains(value, "cloudflare")
}
