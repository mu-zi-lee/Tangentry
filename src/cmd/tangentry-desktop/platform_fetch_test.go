package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"os/exec"
	"strings"
	"testing"
	"time"

	"github.com/egoist/mygo"

	"tangentry/internal/app"
	"tangentry/internal/platformfetch"
)

func validateDouyinCaptureScripts() error {
	node, err := exec.LookPath("node")
	if err != nil {
		return nil
	}
	for _, script := range []string{douyinFeedCaptureScript, douyinMediaReadScript("6961737553342991651"), douyinFeedReadScriptForMedia("6961737553342991651"), douyinDOMMediaScript("6961737553342991651"), douyinDomReadScript, searchDomReadScript, platformMediaBeginScript, platformMediaCleanupScript} {
		command := exec.Command(node, "-e", "new Function(require('fs').readFileSync(0, 'utf8'))")
		command.Stdin = strings.NewReader(script)
		if output, err := command.CombinedOutput(); err != nil {
			return errors.New(strings.TrimSpace(string(output)))
		}
	}
	return nil
}

func TestSanitizeDouyinCardPreservesOnlySafeHTTPSCoverURL(t *testing.T) {
	cover := "https://p3.douyinpic.com/cover.jpg?sign=fixture#preview"
	if got := sanitizeDouyinCard(platformfetch.DOMCard{ThumbnailURL: cover}).ThumbnailURL; got != "https://p3.douyinpic.com/cover.jpg?sign=fixture" {
		t.Fatalf("signed cover query not preserved or fragment not stripped: %q", got)
	}
	for _, raw := range []string{"http://p3.douyinpic.com/cover.jpg", "https://user:fixture@p3.douyinpic.com/cover.jpg", "javascript:bad", "https://p3.douyinpic.com/cover.jpg" + strings.Repeat("x", 4097)} {
		if got := sanitizeDouyinCard(platformfetch.DOMCard{ThumbnailURL: raw}).ThumbnailURL; got != "" {
			t.Fatalf("unsafe or oversized cover retained: %q -> %q", raw, got)
		}
	}
}

func TestRecommendationAndSearchDOMReadLazyCoverURLs(t *testing.T) {
	for _, test := range []struct {
		name   string
		script string
		image  map[string]string
		want   string
	}{
		{name: "recommendation lazy source", script: douyinDomReadScript, image: map[string]string{"data-src": "//p3.douyinpic.com/lazy.jpg?sign=fixture"}, want: "https://p3.douyinpic.com/lazy.jpg?sign=fixture"},
		{name: "search background image", script: searchDomReadScript, image: map[string]string{"style": `background-image:url("https://p3.douyinpic.com/search.jpg?sign=fixture")`}, want: "https://p3.douyinpic.com/search.jpg?sign=fixture"},
	} {
		t.Run(test.name, func(t *testing.T) {
			cards := runDouyinCardProjectionFixture(t, test.script, test.image)
			if len(cards) != 1 || cards[0].ThumbnailURL != test.want {
				t.Fatalf("DOM cover was not captured: %+v", cards)
			}
		})
	}
}

func runDouyinCardProjectionFixture(t *testing.T, script string, attributes map[string]string) []platformfetch.DOMCard {
	t.Helper()
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node is unavailable for isolated card projection fixture")
	}
	encodedScript, err := json.Marshal(script)
	if err != nil {
		t.Fatal(err)
	}
	encodedAttributes, err := json.Marshal(attributes)
	if err != nil {
		t.Fatal(err)
	}
	harness := `
const id='6961737553342991651',attributes=` + string(encodedAttributes) + `;
global.location={href:'https://www.douyin.com/jingxuan',hostname:'www.douyin.com'};
const image={tagName:'IMG',innerText:'',currentSrc:'',src:'',poster:'',getAttribute(name){return attributes[name]||null;}};
const container={innerText:'测试视频',textContent:'测试视频',parentElement:null,querySelectorAll(selector){return selector.includes('a[href')?[]:selector.includes('img')||selector.includes('background-image')?[image]:[];},querySelector(selector){return selector.includes('img')||selector.includes('background-image')?image:null;},getAttribute(){return null;}};
const link={href:'https://www.douyin.com/video/'+id,getAttribute(name){return name==='href'?this.href:null;},innerText:'测试视频',textContent:'测试视频',parentElement:container};
global.document={title:'精选',readyState:'complete',body:{innerText:'测试'},querySelectorAll(selector){if(selector==='a[href*="/video/"]'||selector==='a[href]')return [link];return [];}};
global.performance={getEntriesByType(){return [];}};
global.window={__tangentryDouyinFeed:[],fetch:function(){}};
global.XMLHttpRequest=function(){};XMLHttpRequest.prototype.send=function(){};
console.log(JSON.stringify(eval(` + string(encodedScript) + `).cards));`
	output, err := exec.Command(node, "-e", harness).CombinedOutput()
	if err != nil {
		t.Fatalf("DOM card fixture failed: %s", strings.TrimSpace(string(output)))
	}
	var cards []platformfetch.DOMCard
	if err := json.Unmarshal(output, &cards); err != nil {
		t.Fatalf("decode DOM card projection: %v", err)
	}
	return cards
}

func TestDouyinCaptureObserverProjectsTargetForFetchAndXHR(t *testing.T) {
	payload := `{"data":{"aweme_list":[{"aweme_id":"6961737553342991651","video":{"play_addr":{"url_list":["https://v1.douyinvod.com/fixture.mp4"]}}},{"aweme_id":"9999999999999999999","video":{"play_addr":{"url_list":["https://v1.douyinvod.com/other.mp4"]}}}]}}`
	captures := runDouyinCaptureObserverTest(t, payload, douyinObserverFixture{})
	if len(captures.Fetch) != 1 || len(captures.XHR) != 1 || len(captures.Fetch[0].Candidates) != 1 || captures.Fetch[0].Candidates[0].ID != "6961737553342991651" || captures.Fetch[0].Candidates[0].URLs[0] != "https://v1.douyinvod.com/fixture.mp4" || len(captures.XHR[0].Candidates) != 1 || captures.XHR[0].Candidates[0].ID != "6961737553342991651" {
		t.Fatalf("fetch/XHR target projection incorrect: %+v", captures)
	}
}

func TestDouyinFeedObserverProjectsSignedCoverVariants(t *testing.T) {
	payload := `{"status_code":0,"aweme_list":[{"aweme_id":"6961737553342991651","desc":"投影测试","video":{"cover":{"url_list":["javascript:bad"]},"origin_cover":{"urlList":["https://p3.douyinpic.com/cover.jpg?sign=fixture"]}}}]}`
	result := runDouyinCaptureObserverTest(t, payload, douyinObserverFixture{RequestURL: "/aweme/v1/web/tab/feed/"})
	if len(result.Feed) == 0 || len(result.Feed[0].Cards) != 1 || result.Feed[0].Cards[0].ThumbnailURL != "https://p3.douyinpic.com/cover.jpg?sign=fixture" {
		t.Fatalf("feed projection lost safe cover variant: %+v", result.Feed)
	}
}

func TestDouyinFeedObserverFindsLaterCoverVariant(t *testing.T) {
	payload := `{"status_code":0,"aweme_list":[{"aweme_id":"6961737553342991651","desc":"备用封面","video":{"cover":{"url_list":["javascript:bad"]},"origin_cover":{"url_list":["data:image/jpeg;base64,AAAA"]},"fallback_cover":{"url_list":["https://p3.douyinpic.com/fallback.jpg?sign=fixture"]}}}]}`
	result := runDouyinCaptureObserverTest(t, payload, douyinObserverFixture{RequestURL: "/aweme/v1/web/tab/feed/"})
	if len(result.Feed) == 0 || len(result.Feed[0].Cards) != 1 || result.Feed[0].Cards[0].ThumbnailURL != "https://p3.douyinpic.com/fallback.jpg?sign=fixture" {
		t.Fatalf("feed projection did not continue past invalid cover fields: %+v", result.Feed)
	}
}

func TestDouyinObserverReinstallsWhenLegacyInstalledFlagExists(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node is unavailable for isolated capture observer fixture")
	}
	harness := `
global.location={href:'https://www.douyin.com/video/6961737553342991651',pathname:'/video/6961737553342991651'};
global.sessionStorage={getItem(){return '6961737553342991651'}};
class FixtureXHR{open(){}send(){}}
global.XMLHttpRequest=FixtureXHR;
global.window={__tangentryDouyinFeedInstalled:true,__tangentryDouyinFeed:[],__tangentryDouyinMedia:[],fetch(){return Promise.resolve({});}};
` + douyinFeedCaptureScript + `
console.log(JSON.stringify({version:window.__tangentryDouyinObserverVersion,fetch:window.fetch===window.__tangentryDouyinFetchWrapper,xhr:XMLHttpRequest.prototype.send===window.__tangentryDouyinXHRSend}));`
	output, err := exec.Command(node, "-e", harness).CombinedOutput()
	if err != nil {
		t.Fatalf("observer fixture failed: %s", strings.TrimSpace(string(output)))
	}
	var result struct {
		Version int  `json:"version"`
		Fetch   bool `json:"fetch"`
		XHR     bool `json:"xhr"`
	}
	if err := json.Unmarshal(output, &result); err != nil || result.Version != 3 || !result.Fetch || !result.XHR {
		t.Fatalf("legacy observer flag prevented install: %+v err=%v output=%s", result, err, output)
	}
}

type douyinObserverFixture struct {
	RequestURL    string `json:"requestURL"`
	ContentType   string `json:"contentType"`
	ContentLength int64  `json:"contentLength"`
	Status        int    `json:"status"`
	FetchError    string `json:"fetchError"`
	XHRError      string `json:"xhrError"`
}

type douyinObserverFixtureResult struct {
	Fetch []platformfetch.VideoMediaCapture `json:"fetch"`
	XHR   []platformfetch.VideoMediaCapture `json:"xhr"`
	Feed  []struct {
		Cards []platformfetch.DOMCard `json:"cards"`
	} `json:"feed"`
}

func runDouyinCaptureObserverTest(t *testing.T, payload string, fixture douyinObserverFixture) douyinObserverFixtureResult {
	t.Helper()
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node is unavailable for isolated capture observer fixture")
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	if fixture.RequestURL == "" {
		fixture.RequestURL = "/aweme/v1/web/aweme/detail/?aweme_id=6961737553342991651"
	}
	if fixture.ContentType == "" {
		fixture.ContentType = "application/json"
	}
	if fixture.Status == 0 {
		fixture.Status = 200
	}
	fixtureJSON, err := json.Marshal(fixture)
	if err != nil {
		t.Fatal(err)
	}
	harness := `
const target='6961737553342991651';
global.location={href:'https://www.douyin.com/video/'+target,pathname:'/video/'+target};
global.sessionStorage={getItem:()=>target};
const payload=` + string(encoded) + `;
const fixture=` + string(fixtureJSON) + `;
function bytesFor(text){return new TextEncoder().encode(text);}
function streamFor(bytes){let done=false;return {getReader(){return {async read(){if(done)return {done:true};done=true;return {done:false,value:bytes};},async cancel(){done=true;}};}};}
function response(text){const bytes=bytesFor(text);const headers={get(name){return name==='content-type'?fixture.contentType:name==='content-length'?String(fixture.contentLength||bytes.length):null;}};return {status:fixture.status,url:new URL(fixture.requestURL,location.href).href,headers,body:{},clone(){return {headers,body:streamFor(bytes)};}};}
class FixtureXHR{constructor(){this.listeners={};this.responseType='json';this.status=fixture.status;this.responseURL='';this.response=null;}addEventListener(name,fn){this.listeners[name]=fn;}getResponseHeader(name){return name==='content-type'?fixture.contentType:name==='content-length'?String(fixture.contentLength||0):null;}open(method,url){this.responseURL=new URL(url,location.href).href;this.__tangentryURL=url;}send(){if(fixture.xhrError){this.status=0;setTimeout(()=>this.listeners[fixture.xhrError].call(this),0);return;}this.response=JSON.parse(payload);setTimeout(()=>this.listeners.load.call(this),0);}}
global.XMLHttpRequest=FixtureXHR;
global.window={__tangentryDouyinFeed:[],__tangentryDouyinMedia:[],fetch(){if(fixture.fetchError){const error=new Error('synthetic');error.name=fixture.fetchError;return Promise.reject(error);}return Promise.resolve(response(payload));}};
` + douyinFeedCaptureScript + `
(async()=>{try{await window.fetch(fixture.requestURL);}catch(_){}await new Promise(resolve=>setTimeout(resolve,10));const fetchCaptures=window.__tangentryDouyinMedia.splice(0);const xhr=new XMLHttpRequest();xhr.open('GET',fixture.requestURL);xhr.send();await new Promise(resolve=>setTimeout(resolve,10));console.log(JSON.stringify({fetch:fetchCaptures,xhr:window.__tangentryDouyinMedia,feed:window.__tangentryDouyinFeed}));})().catch(error=>{console.error(error);process.exitCode=1;});`
	command := exec.Command(node, "-e", harness)
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("observer fixture failed: %s", strings.TrimSpace(string(output)))
	}
	var result douyinObserverFixtureResult
	if err := json.Unmarshal(output, &result); err != nil {
		t.Fatalf("decode observer fixture projection: %v", err)
	}
	return result
}

func TestDouyinDOMMediaFallbackProjectsVideoAndRenderDataForTarget(t *testing.T) {
	result := runDouyinDOMMediaFixture(t, `[{"aweme_id":"6961737553342991651","video":{"play_addr":{"url_list":["https://v1.douyinvod.com/render.mp4"]}}},{"aweme_id":"9999999999999999999","video":{"play_addr":{"url_list":["https://v1.douyinvod.com/other.mp4"]}}}]`)
	if !result.IsDouyinContext || result.Restricted || len(result.Candidates) != 2 {
		t.Fatalf("embedded state did not isolate target: %+v", result)
	}
	seen := map[string]bool{}
	for _, candidate := range result.Candidates {
		if candidate.ID != "6961737553342991651" {
			t.Fatalf("non-target DOM candidate escaped projection: %+v", candidate)
		}
		for _, value := range candidate.URLs {
			seen[value] = true
		}
	}
	if !seen["https://v1.douyinvod.com/video.mp4"] || !seen["https://v1.douyinvod.com/render.mp4"] || seen["https://v1.douyinvod.com/other.mp4"] {
		t.Fatalf("video/render candidates were not isolated: %v", seen)
	}
}

func TestDouyinDOMMediaFallbackBlocksNonDetailVideoAndOversizedRenderData(t *testing.T) {
	result := runDouyinDOMMediaFixtureAt(t, "https://www.douyin.com/jingxuan", `[{"aweme_id":"6961737553342991651","video":{"play_addr":{"url_list":["https://v1.douyinvod.com/render.mp4"]}}}]`)
	if len(result.Candidates) != 1 || result.Candidates[0].URLs[0] != "https://v1.douyinvod.com/render.mp4" {
		t.Fatalf("matching embedded state missing outside detail route: %+v", result)
	}

	result = runDouyinDOMMediaFixtureAt(t, "https://www.douyin.com/video/6961737553342991651", "__OVERSIZED_RENDER_DATA__")
	if !result.TooLarge || result.ResponseBytes != 0 {
		t.Fatalf("oversized embedded state was parsed or not bounded: %+v", result)
	}
	for _, candidate := range result.Candidates {
		for _, value := range candidate.URLs {
			if strings.Contains(value, "render.mp4") {
				t.Fatalf("oversized embedded state was parsed: %+v", result.Candidates)
			}
		}
	}
}

func runDouyinDOMMediaFixture(t *testing.T, renderData string) douyinDOMMediaResult {
	return runDouyinDOMMediaFixtureAt(t, "https://www.douyin.com/video/6961737553342991651", renderData)
}

func runDouyinDOMMediaFixtureAt(t *testing.T, pageURL, renderData string) douyinDOMMediaResult {
	t.Helper()
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node is unavailable for isolated DOM capture fixture")
	}
	encodedData, err := json.Marshal(renderData)
	if err != nil {
		t.Fatal(err)
	}
	encodedURL, err := json.Marshal(pageURL)
	if err != nil {
		t.Fatal(err)
	}
	encodedScript, err := json.Marshal(douyinDOMMediaScript("6961737553342991651"))
	if err != nil {
		t.Fatal(err)
	}
	harness := `
const target='6961737553342991651';
global.location={href:` + string(encodedURL) + `,hostname:new URL(` + string(encodedURL) + `).hostname};
global.TextEncoder=class{encode(text){return new Uint8Array(text==='__OVERSIZED_RENDER_DATA__'?4*1024*1024+1:Buffer.byteLength(text));}};
const video={currentSrc:'https://v1.douyinvod.com/video.mp4',getAttribute(name){return name==='src'?'video.mp4':null;},querySelectorAll(){return [{getAttribute(){return 'source.mp4';}}];}};
const script={textContent:` + string(encodedData) + `};
global.document={title:'fixture',readyState:'complete',body:{innerText:'fixture'},querySelectorAll(selector){if(selector==='video')return [video];if(selector.startsWith('script'))return [script];return [];}};
console.log(JSON.stringify(eval(` + string(encodedScript) + `)));`
	command := exec.Command(node, "-e", harness)
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("DOM fixture failed: %s", strings.TrimSpace(string(output)))
	}
	var result douyinDOMMediaResult
	if err := json.Unmarshal(output, &result); err != nil {
		t.Fatalf("decode DOM projection: %v", err)
	}
	return result
}

func TestDouyinPageRestrictionIgnoresContentAndDetectsVisibleChallenges(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node is unavailable for isolated page state fixture")
	}
	scripts, _ := json.Marshal([]string{douyinPageStateScript, douyinFeedReadScript, douyinFeedReadScriptForMedia("6961737553342991651"), douyinMediaReadScript("6961737553342991651"), douyinDOMMediaScript("6961737553342991651"), douyinDomReadScript})
	harness := `
const scripts=` + string(scripts) + `;
function run(url,title,text,challenge){
  global.location={href:url,hostname:new URL(url).hostname};
  global.window={__tangentryDouyinFeed:[],__tangentryDouyinMedia:[]};
  global.XMLHttpRequest={prototype:{}};
  global.performance={getEntriesByType(){return [];}};
  const node={getBoundingClientRect(){return {width:300,height:challenge==='hidden'?0:200};}};
  global.getComputedStyle=()=>({display:'block',visibility:'visible',opacity:'1'});
  global.document={title,readyState:'complete',body:{innerText:text},querySelectorAll(selector){return selector.startsWith('#captcha')&&challenge?[node]:[];}};
  return scripts.map(script=>eval(script).restricted);
}
const url='https://www.douyin.com/video/6961737553342991651';
console.log(JSON.stringify({
  content:run(url,'验证这个登录方法是否可行 - 抖音','登录 发现 视频 登录后体验更多 captcha verify challenge',null),
  hidden:run(url,'普通视频','登录','hidden'),
  challenge:run(url,'普通视频','请完成验证','visible'),
  route:run('https://www.douyin.com/passport/login','抖音','',null),
  title:run(url,'安全验证 - 抖音','',null)
}));`
	output, err := exec.Command(node, "-e", harness).CombinedOutput()
	if err != nil {
		t.Fatalf("page state fixture failed: %s", strings.TrimSpace(string(output)))
	}
	var result map[string][]bool
	if err := json.Unmarshal(output, &result); err != nil {
		t.Fatal(err)
	}
	for name, values := range result {
		want := name != "content" && name != "hidden"
		if len(values) != 6 {
			t.Fatalf("%s: not all page readers were checked: %v", name, values)
		}
		for index, restricted := range values {
			if restricted != want {
				t.Errorf("%s reader %d restricted=%v, want %v", name, index, restricted, want)
			}
		}
	}
}

func TestDouyinObserverIgnoresVerificationWordsInSuccessfulJSON(t *testing.T) {
	payload := `{"status_code":0,"aweme_detail":{"aweme_id":"6961737553342991651","desc":"登录 验证 captcha challenge verify passport","video":{"play_addr":{"url_list":["https://v1.douyinvod.com/video.mp4"]}}}}`
	result := runDouyinCaptureObserverTest(t, payload, douyinObserverFixture{})
	for name, captures := range map[string][]platformfetch.VideoMediaCapture{"fetch": result.Fetch, "xhr": result.XHR} {
		if len(captures) != 1 || captures[0].Restricted || len(captures[0].Candidates) != 1 {
			t.Fatalf("%s classified ordinary video JSON as verification: %+v", name, captures)
		}
	}
	restricted := runDouyinCaptureObserverTest(t, `{"status_code":8,"status_msg":"请完成安全验证"}`, douyinObserverFixture{})
	if len(restricted.Fetch) != 1 || !restricted.Fetch[0].Restricted || len(restricted.XHR) != 1 || !restricted.XHR[0].Restricted {
		t.Fatalf("explicit verification response was not blocked: %+v", restricted)
	}
}

func TestPlatformPageWindowPositionUsesAllDisplayBounds(t *testing.T) {
	displays := []mygo.Display{
		{Label: "Built-in", Bounds: mygo.Rectangle{X: 0, Y: 0, Width: 1728, Height: 1117}},
		{Label: "Left", Bounds: mygo.Rectangle{X: -1920, Y: -120, Width: 1920, Height: 1080}},
		{Label: "Above", Bounds: mygo.Rectangle{X: 100, Y: -900, Width: 1200, Height: 900}},
	}
	x, y := platformPageWindowPosition(displays, 1024, 768)
	planned := mygo.Rectangle{X: x, Y: y, Width: 1024, Height: 768}
	for _, display := range displays {
		if rectanglesOverlap(planned, display.Bounds) {
			t.Fatalf("planned bridge window overlaps %s: %+v", display.Label, planned)
		}
	}
	if x > -1920-1024-platformPageWindowGap || y > -900-768-platformPageWindowGap {
		t.Fatalf("position does not clear union bounds: x=%d y=%d", x, y)
	}
}

func TestPlatformPageWindowScreenReportsVisibleAndOffscreen(t *testing.T) {
	displays := []mygo.Display{{Label: "Main", ID: 1, Bounds: mygo.Rectangle{X: 0, Y: 0, Width: 1000, Height: 800}}}
	if got := platformPageWindowScreen(mygo.Rectangle{X: 100, Y: 100, Width: 20, Height: 20}, displays); got != "Main" {
		t.Fatalf("visible screen = %q", got)
	}
	if got := platformPageWindowScreen(mygo.Rectangle{X: -200, Y: -200, Width: 20, Height: 20}, displays); got != "屏幕外" {
		t.Fatalf("offscreen screen = %q", got)
	}
	if !platformPageWindowNeedsFallback(mygo.Rectangle{X: 100, Y: 100, Width: 20, Height: 20}, displays) {
		t.Fatal("visible bridge window did not request concealment fallback")
	}
	if platformPageWindowNeedsFallback(mygo.Rectangle{X: -200, Y: -200, Width: 20, Height: 20}, displays) {
		t.Fatal("offscreen bridge window unexpectedly requested fallback")
	}
}

func TestValidatePlatformPath(t *testing.T) {
	for _, raw := range []string{"/latest.json", "/top.json?page=2", "/aweme/v2/web/module/feed/?refresh_index=1"} {
		if err := validatePlatformPath(raw); err != nil {
			t.Fatalf("valid path %q rejected: %v", raw, err)
		}
	}
	for _, raw := range []string{"", "https://linux.do/latest.json", "//evil.example/latest.json", "/../latest.json", "/x/../latest.json", "/x\\evil", "/x\r\n"} {
		if err := validatePlatformPath(raw); err == nil {
			t.Fatalf("invalid path %q accepted", raw)
		}
	}
}

func TestPlatformPageOriginAndCloudflareRecognition(t *testing.T) {
	for _, test := range []struct {
		platform, origin string
	}{
		{"linuxdo", "https://linux.do/"},
		{"douyin", "https://www.douyin.com/"},
		{"xiaohongshu", "https://www.xiaohongshu.com/"},
		{"bilibili", "https://www.bilibili.com/"},
	} {
		origin, ok := platformPageOrigin(test.platform)
		if !ok || origin != test.origin {
			t.Fatalf("origin(%q) = %q, %v", test.platform, origin, ok)
		}
	}
	if _, ok := platformPageOrigin("other"); ok {
		t.Fatal("unsupported platform accepted")
	}
	for _, body := range []string{"<title>Just a moment...</title>", "cf-chl-abc", "challenge-platform", "Cloudflare"} {
		if !isCloudflarePage(httpStatusOK, body, "text/html; charset=utf-8") {
			t.Fatalf("challenge body not recognized: %q", body)
		}
	}
	if isCloudflarePage(403, "json") || isCloudflarePage(200, `{"ok":true}`) || isCloudflarePage(httpStatusOK, "<title>Just a moment...</title>") {
		t.Fatal("status/body challenge recognition is incorrect")
	}
}

func TestBilibiliSubtitlePageAllowlist(t *testing.T) {
	for _, raw := range []string{
		"/x/web-interface/nav",
		"/x/web-interface/view?bvid=BV17x411w7KC",
		"/x/player/v2?bvid=BV17x411w7KC&cid=111",
		"/x/player/v2?aid=11&cid=111",
		"/x/player/wbi/v2?aid=11&cid=111",
		"/x/player/wbi/v2?aid=11&cid=111&wts=1761000000&w_rid=0123456789abcdef0123456789abcdef",
	} {
		if !validateBilibiliSubtitlePath(raw) || !platformPageURLAllowed("https://www.bilibili.com"+raw, "bilibili") {
			t.Fatalf("valid B站字幕路径 rejected: %q", raw)
		}
	}
	for _, raw := range []string{
		"/x/player/v2?bvid=BV17x411w7KC&cid=111&extra=1",
		"/x/web-interface/view?bvid=not-a-bvid",
		"/x/web-interface/nav?bvid=BV17x411w7KC",
		"/x/player/wbi/v2?bvid=BV17x411w7KC&cid=111",
		"/x/player/wbi/v2?aid=11&cid=111&wts=1761000000&w_rid=bad",
		"/x/player/wbi/v2?aid=11&cid=111&wts=1761000000&w_rid=0123456789abcdef0123456789abcdef&extra=1",
		"https://evil.example/x/player/v2?bvid=BV17x411w7KC&cid=111",
	} {
		if validateBilibiliSubtitlePath(raw) {
			t.Fatalf("unsafe B站字幕路径 accepted: %q", raw)
		}
	}
}

func TestPlatformFetchScriptHonorsMethodBodyAndLimits(t *testing.T) {
	code, err := platformFetchScript("/feed.json", app.PlatformPageRequest{Method: "POST", Headers: map[string]string{"Accept": "application/json"}, Body: "a=1"})
	if err != nil {
		t.Fatal(err)
	}
	for _, part := range []string{"/feed.json", "method:\"POST\"", "body:\"a=1\"", "AbortController", "tooLarge", "content-length"} {
		if !strings.Contains(code, part) {
			t.Fatalf("script does not contain %q: %s", part, code)
		}
	}
}

func TestBilibiliSubtitleScriptUsesAPIFromSiteContext(t *testing.T) {
	code, err := platformFetchScript("/x/player/v2?bvid=BV17x411w7KC&cid=111", app.PlatformPageRequest{
		Method:  http.MethodGet,
		Headers: map[string]string{"Accept": "application/json"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(code, `fetch("https://api.bilibili.com" + "/x/player/v2?bvid=BV17x411w7KC`) || !strings.Contains(code, `credentials:"include"`) {
		t.Fatalf("B站字幕请求 does not use the signed-in site context: %s", code)
	}
	ordinary, err := platformFetchScript("/feed.json", app.PlatformPageRequest{Method: http.MethodGet, Headers: map[string]string{"Accept": "application/json"}})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(ordinary, `fetch(location.origin + "/feed.json"`) {
		t.Fatalf("ordinary platform fetch unexpectedly targets the B站 API: %s", ordinary)
	}
}

func TestDouyinFeedCaptureScriptHooksPageRequests(t *testing.T) {
	for _, part := range []string{
		"__tangentryDouyinFeed",
		"XMLHttpRequest.prototype.open",
		"XMLHttpRequest.prototype.send",
		"__tangentryDouyinMedia",
		"detail|post|related|feed",
		"window.fetch",
		"responseType === 'json'",
		"aweme\\/(?:v1|v2)\\/",
	} {
		if !strings.Contains(douyinFeedCaptureScript, part) {
			t.Fatalf("capture script does not contain %q", part)
		}
	}
	for _, part := range []string{"pageUrl", "ready"} {
		if !strings.Contains(douyinFeedScrollScript, part) || !strings.Contains(douyinFeedReadScript, part) {
			t.Fatalf("capture execution scripts do not contain %q", part)
		}
	}
	for _, part := range []string{"window.scrollTo", "splice(0, 32)"} {
		code := douyinFeedScrollScript + douyinFeedReadScript + douyinFeedClearScript
		if !strings.Contains(code, part) {
			t.Fatalf("capture execution script does not contain %q: %s", part, code)
		}
	}
	if !strings.Contains(douyinDomReadScript, "performance.getEntriesByType('resource')") || !strings.Contains(douyinDomReadScript, "fetchHookInstalled") || !strings.Contains(douyinDomReadScript, `a[href*="/video/"]`) {
		t.Fatal("DOM capture script lacks diagnostics or card selectors")
	}
	if !strings.Contains(douyinRecommendNextScript, "ArrowDown") || !strings.Contains(douyinRecommendNextScript, "WheelEvent") {
		t.Fatal("recommendation fallback does not advance the page")
	}
	if err := validateDouyinCaptureScripts(); err != nil {
		t.Fatalf("capture script syntax: %v", err)
	}
}

func TestDouyinVideoMediaScriptUsesBoundedPageContextReads(t *testing.T) {
	code := douyinVideoMediaScript("6961737553342991651")
	for _, part := range []string{"__tangentryDouyinMedia", "fetchHookInstalled", "captcha", "风控", "video", "6961737553342991651"} {
		if !strings.Contains(code, part) {
			t.Fatalf("video media script does not contain %q", part)
		}
	}
	if strings.Contains(code, "fetch('/aweme/v1/web/aweme/detail") || strings.Contains(code, "AbortController") || strings.Contains(code, "credentials:'include'") {
		t.Fatal("detail media read must not issue an active signed request")
	}
	if !strings.Contains(douyinMediaTargetScript("6961737553342991651"), "sessionStorage.setItem") || !strings.Contains(douyinFeedCaptureScript, "sessionStorage.getItem") {
		t.Fatal("target ID is not preserved across the page-owned feed navigation")
	}
	if strings.Contains(douyinFeedClearScript, "splice(0, 32)") {
		t.Fatal("fixture should not assert a feed clear limit")
	}
}

func TestDouyinFeedCaptureScriptsDrainOnlyBoundedMediaBatches(t *testing.T) {
	for _, code := range []string{douyinMediaReadScript("6961737553342991651"), douyinFeedReadScriptForMedia("6961737553342991651")} {
		if !strings.Contains(code, "splice(0,8)") || !strings.Contains(code, "targetMatchCount:candidates.length||(") || !strings.Contains(code, "matchedIDs:(value.matchedIDs||[]).filter(id=>id===target)") {
			t.Fatalf("media observer read does not drain a bounded, target-aware batch: %s", code)
		}
	}
	if !strings.Contains(douyinDOMMediaScript("6961737553342991651"), "responseBytes:bytesRead") {
		t.Fatal("DOM fallback does not report bounded embedded-state bytes")
	}
}

func TestMediaCandidatesRequireTargetAndPreserveHTTPEvidence(t *testing.T) {
	status := 403
	typeValue := "application/json"
	bytes := int64(48)
	values, stats := mediaCandidatesFromCaptures([]platformfetch.VideoMediaCapture{
		{Path: "www.douyin.com/aweme/v1/web/aweme/detail/", Status: &status, ContentType: &typeValue, ResponseBytes: &bytes, HasResponse: true, Reason: "http_status", Candidates: []platformfetch.VideoMediaCandidate{{ID: "9999999999999999999", URLs: []string{"https://v1.douyinvod.com/wrong.mp4"}}}},
		{Path: "www.douyin.com/aweme/v1/web/aweme/detail/", Status: &status, ContentType: &typeValue, ResponseBytes: &bytes, HasResponse: true, Reason: "http_status", TargetMatchCount: 1, Candidates: []platformfetch.VideoMediaCandidate{{ID: "6961737553342991651", URLs: []string{"https://v1.douyinvod.com/right.mp4"}}}},
	}, "6961737553342991651")
	if len(values) != 0 || stats.Status != status || stats.ResponseBytes != bytes || stats.CandidateCount != 1 || stats.AcceptedCount != 0 {
		t.Fatalf("target matching or HTTP evidence incorrect: values=%v stats=%+v", values, stats)
	}
}

func TestMediaCaptureDiagnosticsDistinguishRejectAndHTTPResponse(t *testing.T) {
	status := 403
	typeValue := "application/json"
	rejected := mediaCaptureDiagnostics("webview_detail_capture", douyinMediaStats{Reason: "fetch_reject"}, "https://www.douyin.com/video/6961737553342991651", "complete", true)[0]
	if rejected.HTTPStatus != nil || rejected.ResponseBytes != nil || rejected.Reason != "fetch_reject" {
		t.Fatalf("fetch reject fabricated response evidence: %+v", rejected)
	}
	httpStats := douyinMediaStats{Status: status, ContentType: typeValue, HasResponse: true, ResponseBytes: 12, ResponseBytesKnown: true, Reason: "http_status"}
	httpStage := mediaCaptureDiagnostics("webview_detail_capture", httpStats, "https://www.douyin.com/video/6961737553342991651", "complete", true)[0]
	if httpStage.HTTPStatus == nil || *httpStage.HTTPStatus != 403 || httpStage.ResponseBytes == nil || *httpStage.ResponseBytes != 12 {
		t.Fatalf("HTTP evidence was lost: %+v", httpStage)
	}
}

func TestMediaCaptureStatsIgnoreUnmatchedResponses(t *testing.T) {
	statusOther, statusTarget := 500, 200
	typeValue := "application/json"
	bytesOther, bytesTarget := int64(99), int64(42)
	values, stats := mediaCandidatesFromCaptures([]platformfetch.VideoMediaCapture{
		{Path: "www.douyin.com/aweme/v1/web/aweme/detail/", Status: &statusOther, ContentType: &typeValue, ResponseBytes: &bytesOther, HasResponse: true, Reason: "http_status", Candidates: []platformfetch.VideoMediaCandidate{{ID: "9999999999999999999"}}},
		{Path: "www.douyin.com/aweme/v1/web/aweme/post/", Status: &statusTarget, ContentType: &typeValue, ResponseBytes: &bytesTarget, HasResponse: true, Reason: "", TargetMatchCount: 1, Candidates: []platformfetch.VideoMediaCandidate{{ID: "6961737553342991651", URLs: []string{"https://v1.douyinvod.com/target.mp4"}}}},
	}, "6961737553342991651")
	if len(values) != 1 || stats.Status != statusTarget || stats.ResponseBytes != bytesTarget || stats.CandidateCount != 1 {
		t.Fatalf("unmatched response contaminated target stats: values=%v stats=%+v", values, stats)
	}
}

func TestMediaCaptureMatchesTargetIDWithoutMediaCandidate(t *testing.T) {
	capture := platformfetch.VideoMediaCapture{Path: "www.douyin.com/aweme/v1/web/aweme/detail/", MatchedIDs: []string{"6961737553342991651"}}
	if !captureMatchesTarget(capture, "6961737553342991651") {
		t.Fatal("target ID in response was ignored when it had no play address")
	}
}

func TestUnmatchedMediaCaptureRetainsDiagnosticsWithoutAcceptingCandidate(t *testing.T) {
	status, bytes := 403, int64(64)
	contentType := "application/json"
	capture := platformfetch.VideoMediaCapture{Path: "www.douyin.com/aweme/v1/web/aweme/detail/", Status: &status, ContentType: &contentType, ResponseBytes: &bytes, HasResponse: true, Reason: "http_status", Candidates: []platformfetch.VideoMediaCandidate{{ID: "9999999999999999999", URLs: []string{"https://v1.douyinvod.com/other.mp4"}}}}
	values, stats := mediaCandidatesFromCaptures([]platformfetch.VideoMediaCapture{capture}, "6961737553342991651")
	if len(values) != 0 || stats.Status != status || stats.ResponseBytes != bytes || stats.CandidateCount != 0 || stats.Reason != "http_status" {
		t.Fatalf("unmatched media data was accepted or diagnostics lost: values=%v stats=%+v", values, stats)
	}
}

func TestDouyinMediaReadResultAccumulatesBoundedDrainedBatches(t *testing.T) {
	var result douyinMediaReadResult
	for index := 0; index < 70; index++ {
		result = mergeDouyinMediaReadResult(result, douyinMediaReadResult{Captures: []platformfetch.VideoMediaCapture{{Path: "www.douyin.com/aweme/v1/web/aweme/detail/", RequestID: "6961737553342991651", TargetMatchCount: 1}}})
	}
	if len(result.Captures) != 64 || !captureMatchesTarget(result.Captures[len(result.Captures)-1], "6961737553342991651") {
		t.Fatalf("capture batches were not accumulated within bound: %d", len(result.Captures))
	}
}

func TestMediaCaptureDiagnosticsKeepNoResponseNullAndHTTPEvidence(t *testing.T) {
	withoutResponse := mediaCaptureDiagnostics("webview_detail_capture", douyinMediaStats{Reason: "fetch_reject"}, "https://www.douyin.com/video/6961737553342991651", "complete", true)[0]
	if withoutResponse.HTTPStatus != nil || withoutResponse.ResponseBytes != nil {
		t.Fatalf("missing response was reported as HTTP evidence: %+v", withoutResponse)
	}
	status := 403
	bytes := int64(17)
	withHTTP := mediaCaptureDiagnostics("webview_detail_capture", douyinMediaStats{Status: status, HasResponse: true, ResponseBytes: bytes, ResponseBytesKnown: true, Reason: "http_status"}, "https://www.douyin.com/video/6961737553342991651", "complete", true)[0]
	if withHTTP.HTTPStatus == nil || *withHTTP.HTTPStatus != status || withHTTP.ResponseBytes == nil || *withHTTP.ResponseBytes != bytes {
		t.Fatalf("HTTP response evidence was lost: %+v", withHTTP)
	}
}

func TestMediaCaptureDiagnosticsReportFilteredCandidates(t *testing.T) {
	status := 200
	contentType := "application/json"
	bytes := int64(20)
	capture := platformfetch.VideoMediaCapture{RequestID: "6961737553342991651", Status: &status, ContentType: &contentType, ResponseBytes: &bytes, HasResponse: true, Candidates: []platformfetch.VideoMediaCandidate{{ID: "6961737553342991651", URLs: []string{"https://unsafe.example/video.mp4"}}}}
	_, stats := mediaCandidatesFromCaptures([]platformfetch.VideoMediaCapture{capture}, "6961737553342991651")
	diagnostic := mediaCaptureDiagnostics("webview_detail_capture", stats, "https://www.douyin.com/video/6961737553342991651", "complete", true)[0]
	if diagnostic.Outcome != "no_url" || diagnostic.Reason != "candidate_filtered" || diagnostic.CandidateCount == nil || *diagnostic.CandidateCount != 1 || diagnostic.AcceptedCount == nil || *diagnostic.AcceptedCount != 0 {
		t.Fatalf("filtered candidate diagnostic = %+v", diagnostic)
	}
}

func TestDouyinMediaNormalizationUpgradesHTTPAndUsesSharedHosts(t *testing.T) {
	for _, raw := range []string{"http://v26-web.douyinvod.com/video.mp4", "http://media.zjcdn.com/video.mp4", "https://cdn.douyinvod.net/video.mp4"} {
		got := safeDouyinMedia([]string{raw})
		if len(got) != 1 || !strings.HasPrefix(got[0], "https://") {
			t.Fatalf("allowlisted candidate not normalized: %q -> %v", raw, got)
		}
	}
	if got := safeDouyinMedia([]string{"https://media.evil.example/video.mp4"}); len(got) != 0 {
		t.Fatalf("non-allowlisted host accepted: %v", got)
	}
}

func TestDouyinMediaRejectsExpiredXExpiresAndReportsSafeRejection(t *testing.T) {
	url := "https://v26-web.douyinvod.com/video.mp4?x-expires=1&signature=private"
	filtered, rejected := filterDouyinMedia([]string{url})
	if len(filtered) != 0 || len(rejected) != 1 || rejected[0].Host != "v26-web.douyinvod.com" || rejected[0].Reason != "expired" {
		t.Fatalf("expired candidate result = %v, %+v", filtered, rejected)
	}
	if strings.Contains(strings.Join([]string{rejected[0].Host, rejected[0].Reason}, " "), "private") {
		t.Fatal("candidate rejection leaked query data")
	}
}

func TestDouyinPlayRedirectResolutionScriptRequiresSameOriginAndManualPageContext(t *testing.T) {
	code := douyinPlayRedirectScript([]string{"https://www.douyin.com/aweme/v1/play/?video_id=fixture"})
	for _, expected := range []string{"target.origin!==location.origin", "redirect:'follow'", "credentials:'same-origin'", "response.url", "'HEAD'", "'GET'"} {
		if !strings.Contains(code, expected) {
			t.Fatalf("redirect resolver missing %q", expected)
		}
	}
	if !isDouyinPlayRedirect("https://aweme.snssdk.com/aweme/v1/play/?video_id=fixture") || isDouyinPlayRedirect("https://www.douyin.com/aweme/v1/feed/?token=fixture") {
		t.Fatal("play redirect URL recognition is incorrect")
	}
	filtered, rejected, err := resolveAndFilterDouyinMedia(context.Background(), nil, []string{"https://www.douyin.com/aweme/v1/play/?video_id=fixture"})
	if err != nil || len(filtered) != 0 || len(rejected) != 1 || rejected[0].Reason != "redirect_unresolved" {
		t.Fatalf("unresolved redirect result = %v, %+v, %v", filtered, rejected, err)
	}
}

func TestDouyinCandidateProjectionCapsAAndCSources(t *testing.T) {
	status := 200
	contentType := "application/json"
	bytes := int64(10)
	candidates := make([]platformfetch.VideoMediaCandidate, douyinMediaCandidateMax+1)
	for index := range candidates {
		candidates[index] = platformfetch.VideoMediaCandidate{ID: "6961737553342991651", URLs: []string{"https://v1.douyinvod.com/video.mp4"}}
	}
	capture := platformfetch.VideoMediaCapture{HasResponse: true, Status: &status, ContentType: &contentType, ResponseBytes: &bytes, Candidates: candidates}
	if got := rawMediaCandidatesFromCaptures([]platformfetch.VideoMediaCapture{capture}, "6961737553342991651"); len(got) != douyinMediaCandidateMax {
		t.Fatalf("A candidate projection count = %d, want %d", len(got), douyinMediaCandidateMax)
	}
	if got := candidatesForID(candidates, "6961737553342991651"); len(got) != douyinDOMCandidateMax {
		t.Fatalf("C candidate projection count = %d, want %d", len(got), douyinDOMCandidateMax)
	}
}

func TestDouyinPlayRedirectResolverAcceptsOnlyResolvedAllowlistedHost(t *testing.T) {
	pageScript := douyinPlayRedirectScript([]string{"https://www.douyin.com/aweme/v1/play/?video_id=fixture"})
	if strings.Contains(pageScript, "Authorization") || strings.Contains(pageScript, "Cookie") || !strings.Contains(pageScript, "target.origin!==location.origin") {
		t.Fatal("play resolver is not same-origin or includes credentials explicitly")
	}
	playURL := "https://www.douyin.com/aweme/v1/play/?video_id=fixture"
	resolved, unresolved, err := applyDouyinPlayRedirects([]string{playURL}, []string{playURL}, []string{"https://cdn.zjcdn.com/video.mp4"})
	if err != nil || unresolved[playURL] || len(resolved) != 1 || resolved[0] != "https://cdn.zjcdn.com/video.mp4" {
		t.Fatalf("play URL was not mapped to its final CDN URL: %v %v %v", resolved, unresolved, err)
	}
	if got, rejected := filterDouyinMedia(resolved); len(got) != 1 || len(rejected) != 0 {
		t.Fatalf("resolved allowlisted CDN rejected: %v %+v", got, rejected)
	}
	if got, rejected := filterDouyinMedia([]string{"https://evil.example/video.mp4"}); len(got) != 0 || len(rejected) != 1 || rejected[0].Reason != "host_not_allowed" {
		t.Fatalf("resolved non-allowlisted CDN accepted: %v %+v", got, rejected)
	}
	if _, unresolved, err := applyDouyinPlayRedirects([]string{playURL}, []string{playURL}, []string{""}); err != nil || !unresolved[playURL] {
		t.Fatalf("unresolved play URL did not remain marked: %v %v", unresolved, err)
	}
}

func TestDouyinPlayRedirectResolverRunsInPageContextAndResolvesResponseURL(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node is unavailable for isolated redirect fixture")
	}
	pageScript, err := json.Marshal(douyinPlayRedirectScript([]string{"https://www.douyin.com/aweme/v1/play/?video_id=fixture"}))
	if err != nil {
		t.Fatal(err)
	}
	harness := `
global.location={href:'https://www.douyin.com/video/6961737553342991651',origin:'https://www.douyin.com'};
const requests=[];
global.fetch=async (url,options)=>{requests.push({url,options});return {url:'https://media.zjcdn.com/video.mp4',body:{cancel:async()=>{}}};};
(async()=>{const result=await eval(` + string(pageScript) + `);console.log(JSON.stringify({result:result,requests:requests}));})().catch(error=>{console.error(error);process.exitCode=1;});`
	output, err := exec.Command(node, "-e", harness).CombinedOutput()
	if err != nil {
		t.Fatalf("redirect fixture failed: %s", strings.TrimSpace(string(output)))
	}
	var result struct {
		Result   []string `json:"result"`
		Requests []struct {
			URL     string `json:"url"`
			Options struct {
				Method      string `json:"method"`
				Redirect    string `json:"redirect"`
				Credentials string `json:"credentials"`
			} `json:"options"`
		} `json:"requests"`
	}
	if err := json.Unmarshal(output, &result); err != nil || len(result.Result) != 1 || result.Result[0] != "https://media.zjcdn.com/video.mp4" || len(result.Requests) != 1 || result.Requests[0].Options.Method != "HEAD" || result.Requests[0].Options.Redirect != "follow" || result.Requests[0].Options.Credentials != "same-origin" {
		t.Fatalf("page-context play redirect result = %+v err=%v output=%s", result, err, output)
	}
}

func TestDouyinCandidateSelectionFallsThroughExpiredAAndUsesABCOrder(t *testing.T) {
	got := selectDouyinMediaCandidates(
		[]string{"https://v1.douyinvod.com/expired.mp4?deadline=1"},
		[]string{"https://media.zjcdn.com/b.mp4"},
		[]string{"https://v1.douyinvod.com/c.mp4"},
	)
	if len(got) != 1 || got[0] != "https://media.zjcdn.com/b.mp4" {
		t.Fatalf("expired A did not fall through to B: media=%v", got)
	}
	got = selectDouyinMediaCandidates(nil, nil, []string{"https://v1.douyinvod.com/c.mp4"})
	if len(got) != 1 || got[0] != "https://v1.douyinvod.com/c.mp4" {
		t.Fatalf("C did not remain last in A -> B -> C selection: %v", got)
	}
}

func TestMediaCapturesDoneRecognizesMatchedJSONWithoutMedia(t *testing.T) {
	status := 200
	contentType := "application/json"
	capture := platformfetch.VideoMediaCapture{RequestID: "6961737553342991651", Status: &status, ContentType: &contentType, HasResponse: true}
	if !mediaCapturesDone([]platformfetch.VideoMediaCapture{capture}, "6961737553342991651") {
		t.Fatal("successful target JSON response without media should end passive wait")
	}
}

func TestDouyinMediaFallbackRequiresConfirmedSafeContext(t *testing.T) {
	for _, test := range []struct {
		name       string
		pageURL    string
		restricted bool
		want       bool
	}{
		{name: "canonical", pageURL: "https://www.douyin.com/video/6961737553342991651", want: true},
		{name: "verification", pageURL: "https://www.douyin.com/verify", want: false},
		{name: "other host", pageURL: "https://passport.douyin.com/login", want: false},
		{name: "flagged", pageURL: "https://www.douyin.com/video/6961737553342991651", restricted: true, want: false},
	} {
		t.Run(test.name, func(t *testing.T) {
			if got := douyinMediaFallbackAllowed(test.pageURL, test.restricted); got != test.want {
				t.Fatalf("fallback allowed = %v, want %v", got, test.want)
			}
		})
	}
}

func TestSelectDouyinMediaCandidatesUsesReliabilityOrder(t *testing.T) {
	if got := selectDouyinMediaCandidates([]string{"https://v1.douyinvod.com/detail.mp4"}, []string{"https://v1.douyinvod.com/feed.mp4"}, []string{"https://v1.douyinvod.com/dom.mp4"}); len(got) != 1 || got[0] != "https://v1.douyinvod.com/detail.mp4" {
		t.Fatalf("A candidate did not win: %v", got)
	}
	if got := selectDouyinMediaCandidates(nil, []string{"https://v1.douyinvod.com/feed.mp4"}, []string{"https://v1.douyinvod.com/dom.mp4"}); len(got) != 1 || got[0] != "https://v1.douyinvod.com/feed.mp4" {
		t.Fatalf("B candidate did not win over C: %v", got)
	}
	if got := selectDouyinMediaCandidates(nil, nil, []string{"https://v1.douyinvod.com/dom.mp4"}); len(got) != 1 || got[0] != "https://v1.douyinvod.com/dom.mp4" {
		t.Fatalf("C candidate was not used as final fallback: %v", got)
	}
}

func TestSafeDouyinMediaDeduplicatesAndCapsBackups(t *testing.T) {
	values := []string{
		"https://v1.douyinvod.com/a.mp4",
		"https://v1.douyinvod.com/a.mp4",
		"https://v2.douyinvod.com/b.mp4",
		"https://v3.douyinvod.com/c.mp4",
		"https://v4.douyinvod.com/d.mp4",
		"https://fixture.invalid/e.mp4",
		"http://v1.douyinvod.com/f.mp4",
	}
	got := safeDouyinMedia(values)
	if len(got) != 3 || got[0] != values[0] || got[1] != values[2] || got[2] != values[3] {
		t.Fatalf("candidate filtering/deduplication/cap = %v", got)
	}
}

func TestSafePageURLStripsQueryAndRejectsUnsafeAuthorities(t *testing.T) {
	for _, raw := range []string{"https://passport.douyin.com/login?next=fixture", "https://user:pass@fixture.example/private", "https://fixture.example:8443/private"} {
		got := safePageURL(raw)
		if raw == "https://passport.douyin.com/login?next=fixture" {
			if got == nil || *got != "passport.douyin.com/login" {
				t.Fatalf("safe page URL = %v", got)
			}
		} else if got != nil {
			t.Fatalf("unsafe page URL retained: %q", *got)
		}
	}
}

func TestSearchDOMReadScriptMapsAuthorLinks(t *testing.T) {
	for _, part := range []string{"authorIDFrom", "/user\\/profile", "authorID", "cards"} {
		if !strings.Contains(searchDomReadScript, part) {
			t.Fatalf("search DOM script does not contain %q", part)
		}
	}
}

func TestSearchPageURLValidatesPlatformQueryAndCursor(t *testing.T) {
	tests := []struct {
		platform string
		query    string
		cursor   string
		want     string
	}{
		{"douyin", "猫 / 狗", "", "https://www.douyin.com/search/%E7%8C%AB%20%2F%20%E7%8B%97"},
		{"xiaohongshu", "旅行笔记", "2", "https://www.xiaohongshu.com/search_result?keyword=%E6%97%85%E8%A1%8C%E7%AC%94%E8%AE%B0&page=2"},
	}
	for _, test := range tests {
		got, err := searchPageURL(test.platform, test.query, test.cursor)
		if err != nil || got != test.want {
			t.Fatalf("searchPageURL(%q, %q, %q) = %q, %v; want %q", test.platform, test.query, test.cursor, got, err, test.want)
		}
	}
	for _, test := range [][3]string{
		{"", "query", ""}, {"other", "query", ""}, {"douyin", "", ""}, {"douyin", "query", "0"}, {"douyin", "query", "1001"}, {"douyin", strings.Repeat("x", 201), ""}, {"douyin", "query\x00", ""},
	} {
		if got, err := searchPageURL(test[0], test[1], test[2]); err == nil || got != "" {
			t.Fatalf("invalid searchPageURL(%q, %q, %q) = %q, %v", test[0], test[1], test[2], got, err)
		}
	}
}

func TestEvalWithRetryRetriesDestroyedPageContext(t *testing.T) {
	calls := 0
	value, err := evalWithRetry(context.Background(), func(context.Context, string) (any, error) {
		calls++
		if calls < 3 {
			return nil, errors.New("Completion handler for function call is no longer reachable")
		}
		return "ok", nil
	}, "return true")
	if err != nil || value != "ok" || calls != 3 {
		t.Fatalf("retry result=%v err=%v calls=%d", value, err, calls)
	}
}

func TestEvalWithRetryDoesNotRetryUnrelatedErrors(t *testing.T) {
	calls := 0
	_, err := evalWithRetry(context.Background(), func(context.Context, string) (any, error) {
		calls++
		return nil, errors.New("syntax error")
	}, "return true")
	if err == nil || calls != 1 {
		t.Fatalf("unrelated error calls=%d err=%v", calls, err)
	}
}

func TestDecodeDouyinCaptureResultParsesDOMCardsAndResources(t *testing.T) {
	var result douyinCaptureResult
	raw := map[string]any{
		"pageUrl":            "https://www.douyin.com/jingxuan",
		"title":              "精选",
		"ready":              "complete",
		"cards":              []map[string]any{{"id": "6961737553342991651", "title": "测试"}},
		"resources":          []map[string]any{{"path": "/aweme/v1/feed/", "initiatorType": "fetch"}},
		"fetchHookInstalled": true,
		"xhrHookInstalled":   false,
	}
	if err := decodeDouyinCaptureResult(raw, &result); err != nil || len(result.Cards) != 1 || len(result.ResourcePaths) != 1 || result.ResourcePaths[0] != "/aweme/v1/feed/" || !result.FetchHookInstalled || result.XHRHookInstalled {
		t.Fatalf("decoded capture=%+v err=%v", result, err)
	}
}

func TestDecodeDouyinCaptureResultKeepsSafeFeedProjectionMetadata(t *testing.T) {
	var result douyinCaptureResult
	raw := map[string]any{
		"responses": []map[string]any{{"status": 200, "contentType": "application/json", "apiStatus": 0, "parsed": true, "hasMore": true, "cards": []map[string]any{{"id": "6961737553342991651", "title": "页面投影"}}}},
	}
	if err := decodeDouyinCaptureResult(raw, &result); err != nil || !result.FeedParsed || !result.FeedHasMore || len(result.FeedCards) != 1 || result.FeedCards[0].Title != "页面投影" {
		t.Fatalf("feed projection metadata lost: %+v err=%v", result, err)
	}
}

func TestSanitizeDouyinCaptureResponseDropsQueryAndLimitsMetadata(t *testing.T) {
	response := sanitizeDouyinCaptureResponse(douyinCaptureResponse{Status: 200, APIStatus: 2154, Parsed: true, HasMore: true, URL: "https://www.douyin.com/aweme/v2/web/module/feed/?msToken=fixture", ContentType: strings.Repeat("x", 300)})
	if strings.Contains(response.URL, "msToken") || len(response.ContentType) > 256 || response.APIStatus != 2154 || !response.Parsed || !response.HasMore {
		t.Fatalf("capture metadata was not sanitized: %+v", response)
	}
}

func TestDecodeDouyinCaptureResultUsesLatestHookState(t *testing.T) {
	var result douyinCaptureResult
	if err := decodeDouyinCaptureResult(map[string]any{"fetchHookInstalled": true, "xhrHookInstalled": true}, &result); err != nil {
		t.Fatal(err)
	}
	if err := decodeDouyinCaptureResult(map[string]any{"fetchHookInstalled": false, "xhrHookInstalled": false}, &result); err != nil {
		t.Fatal(err)
	}
	if result.FetchHookInstalled || result.XHRHookInstalled {
		t.Fatalf("hook state was not refreshed: %+v", result)
	}
}

func TestMergeDOMCardsDeduplicatesAndCompletesMissingFields(t *testing.T) {
	merged := mergeDOMCards([]platformfetch.DOMCard{{ID: "1", Title: "保留标题"}}, []platformfetch.DOMCard{
		{ID: "1", ThumbnailURL: "https://example.invalid/cover.jpg", Author: "作者", Duration: 10},
		{ID: "2", Title: "新卡片"},
	})
	if len(merged) != 2 || merged[0].Title != "保留标题" || merged[0].Author != "作者" || merged[0].Duration != 10 || merged[1].Title != "新卡片" {
		t.Fatalf("DOM merge failed: %+v", merged)
	}
}

func TestWaitCapturePollHonorsContext(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := waitCapturePoll(ctx); !errors.Is(err, context.Canceled) {
		t.Fatalf("wait error=%v", err)
	}
}

func TestWaitForDouyinCaptureWaitsForStableCardsAndCancellation(t *testing.T) {
	reads := 0
	started := time.Now()
	changed, err := waitForDouyinCapture(context.Background(), 2*time.Second, douyinCaptureCounts{}, false, func() (douyinCaptureCounts, error) {
		reads++
		if reads < 2 {
			return douyinCaptureCounts{dom: reads}, nil
		}
		return douyinCaptureCounts{dom: 2}, nil
	})
	if err != nil || !changed || reads < 4 || time.Since(started) < douyinCaptureStable {
		t.Fatalf("capture did not wait for stability: changed=%v err=%v reads=%d", changed, err, reads)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := waitForDouyinCapture(ctx, time.Second, douyinCaptureCounts{}, false, func() (douyinCaptureCounts, error) { return douyinCaptureCounts{}, nil }); !errors.Is(err, context.Canceled) {
		t.Fatalf("capture cancellation err=%v", err)
	}
}

func TestPlatformFetchRequestAndResponseLimits(t *testing.T) {
	request := app.PlatformPageRequest{Method: "", Body: strings.Repeat("x", 256<<10)}
	if err := validatePlatformFetchRequest(&request); err != nil || request.Method != "GET" {
		t.Fatalf("default request rejected: %v, method=%q", err, request.Method)
	}
	request = app.PlatformPageRequest{Method: "PUT"}
	if err := validatePlatformFetchRequest(&request); err == nil {
		t.Fatal("unsupported method accepted")
	}
	request = app.PlatformPageRequest{Method: "POST", Body: strings.Repeat("x", 256<<10+1)}
	if err := validatePlatformFetchRequest(&request); err == nil {
		t.Fatal("oversized request accepted")
	}
	if err := validatePlatformFetchResponse(platformFetchResult{TooLarge: true}); err == nil || !strings.Contains(err.Error(), "过大或无法限制大小") {
		t.Fatal("oversized response marker accepted")
	}
	if err := validatePlatformFetchResponse(platformFetchResult{Body: strings.Repeat("x", platformFetchMaxBody+1)}); err == nil {
		t.Fatal("oversized response body accepted")
	}
	for _, request := range []app.PlatformPageRequest{
		{Method: "GET", Headers: map[string]string{"X-Test": "line\nfeed"}},
		{Method: "GET", Headers: map[string]string{"": "value"}},
		{Method: "GET", Headers: map[string]string{"X-Test": strings.Repeat("x", 8193)}},
	} {
		if err := validatePlatformFetchRequest(&request); err == nil {
			t.Fatal("invalid header accepted")
		}
	}
}

func TestPlatformPageURLAllowed(t *testing.T) {
	for _, test := range []struct {
		platform, raw string
		allowed       bool
	}{
		{"linuxdo", "https://linux.do/", true},
		{"linuxdo", "https://www.linux.do/login", false},
		{"linuxdo", "https://challenges.cloudflare.com/", false},
		{"douyin", "https://www.douyin.com/", true},
		{"douyin", "https://douyin.com/", false},
		{"douyin", "https://passport.douyin.com/", false},
		{"douyin", "https://aweme.snssdk.com/aweme/v1/play/?video_id=fixture", true},
		{"douyin", "https://www.douyin.com.evil.example/", false},
		{"xiaohongshu", "https://www.xiaohongshu.com/", true},
		{"xiaohongshu", "https://xiaohongshu.com/", false},
		{"xiaohongshu", "https://edith.xiaohongshu.com/", false},
		{"bilibili", "https://www.bilibili.com/", true},
		{"bilibili", "https://api.bilibili.com/", false},
		{"bilibili", "https://www.bilibili.com.evil.example/", false},
	} {
		if got := platformPageURLAllowed(test.raw, test.platform); got != test.allowed {
			t.Fatalf("platformPageURLAllowed(%q, %q) = %v, want %v", test.raw, test.platform, got, test.allowed)
		}
	}
}

const httpStatusOK = 200
