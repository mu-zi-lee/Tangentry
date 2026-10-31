package main

import (
	"encoding/json"
	"os/exec"
	"strings"
	"testing"
)

func TestPlatformMediaGuardPreservesCaptureThenReleasesResources(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node is unavailable")
	}
	scripts, _ := json.Marshal([]string{platformMediaBeginScript, platformMediaCleanupScript})
	harness := `
const assert=require('node:assert/strict'),scripts=` + string(scripts) + `;
let nativePlay=0,observers=0,listeners=0,loads=0,stops=0,callback;
const storage=new Map();
global.sessionStorage={getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)};
class Media {
  constructor(){this.nodeType=1;this.tagName='VIDEO';this.attrs=new Map([['src','fixture.mp4'],['autoplay','']]);this.source={nodeType:1,tagName:'SOURCE',attrs:new Map([['src','source.mp4']]),hasAttribute(name){return this.attrs.has(name)},removeAttribute(name){this.attrs.delete(name)},closest:()=>this};this.currentSrc='fixture.mp4';this.paused=false;this.preload='auto';this.networkState=1;this.stream=null;}
  play(){nativePlay++;return Promise.resolve()}
  pause(){this.paused=true}
  load(){loads++;this.currentSrc='';this.networkState=0}
  getAttribute(name){return this.attrs.get(name)||null}
  hasAttribute(name){return this.attrs.has(name)}
  removeAttribute(name){this.attrs.delete(name)}
  querySelectorAll(selector){return selector==='source'?[this.source]:[]}
  closest(){return this}
  get srcObject(){return this.stream}
  set srcObject(value){this.stream=value}
}
global.HTMLMediaElement=Media;
global.window={HTMLMediaElement:Media};
const media=new Media();
global.document={querySelectorAll:()=>[media],addEventListener(){listeners++}};
global.MutationObserver=class{constructor(fn){observers++;callback=fn}observe(){}};
(async()=>{
  // Before injection a reader's native media is unchanged.
  await media.play();assert.equal(nativePlay,1);
  eval(scripts[0]);const play=Media.prototype.play;
  await assert.rejects(media.play());assert.equal(nativePlay,1);
  assert.equal(media.getAttribute('src'),'fixture.mp4');assert.equal(media.source.attrs.get('src'),'source.mp4');assert.equal(loads,0);
  media.srcObject={getTracks:()=>[{stop(){stops++}}]};
  eval(scripts[0]);assert.equal(Media.prototype.play,play);assert.equal(observers,1);assert.equal(listeners,1);
  eval(scripts[1]);assert.equal(media.getAttribute('src'),null);assert.equal(media.source.attrs.has('src'),false);assert.equal(media.srcObject,null);assert.equal(stops,1);assert.equal(media.preload,'none');assert.equal(loads,1);
  eval(scripts[1]);assert.equal(loads,1);
  media.source.attrs.set('src','remounted.mp4');callback([{type:'attributes',target:media.source}]);assert.equal(media.source.attrs.has('src'),false);assert.equal(loads,2);
  media.srcObject={getTracks:()=>[{stop(){stops++}}]};assert.equal(media.srcObject,null);assert.equal(stops,2);
  eval(scripts[0]);media.attrs.set('src','next.mp4');callback([{type:'attributes',target:media}]);assert.equal(media.getAttribute('src'),'next.mp4');
  assert.equal(observers,1);assert.equal(listeners,1);
  console.log('media lifecycle fixture passed');
})().catch(error=>{console.error(error);process.exitCode=1});`
	if output, err := exec.Command(node, "-e", harness).CombinedOutput(); err != nil {
		t.Fatalf("media fixture: %v\n%s", err, strings.TrimSpace(string(output)))
	}
}
