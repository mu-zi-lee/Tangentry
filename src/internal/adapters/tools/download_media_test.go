package tools

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"testing"
	"time"

	"tangentry/internal/config"
	"tangentry/internal/downloads"
)

func TestDownloadProgressHandlesPartialLinesAndInvalidPercentages(t *testing.T) {
	var got []float64
	buffer := &downloadProgressBuffer{report: func(value float64) { got = append(got, value) }}
	for _, chunk := range []string{
		"[download]   12.",
		"5% of 2MiB\n[Merger] 50% ignored\n[download] NaN%\n[download] +Inf%\n[download] -1%\n[download] 101%\n",
		"[download] 100% of 2MiB\n",
	} {
		if n, err := buffer.Write([]byte(chunk)); n != len(chunk) || err != nil {
			t.Fatal(n, err)
		}
	}
	if !slices.Equal(got, []float64{12.5, 100}) {
		t.Fatalf("progress: %v", got)
	}
}

func TestDownloadMetadataOnlyExposesChoicesAndRejectsPlaylists(t *testing.T) {
	raw := []byte(`{"title":"标题测试","uploader":"作者","thumbnail":"https://example.com/cover.jpg","formats":[
		{"format_id":"137","ext":"mp4","height":1080,"vcodec":"avc1","acodec":"none","url":"https://secret.invalid/token","http_headers":{"Cookie":"private"}},
		{"format_id":"140","ext":"m4a","vcodec":"none","acodec":"aac","filesize_approx":1234},
		{"format_id":"drm","vcodec":"avc1","acodec":"none","has_drm":true},
		{"format_id":"storyboard","vcodec":"none","acodec":"none"}],
		"subtitles":{"en":[{"name":"English"}],"live_chat":[{"name":"chat"}]},
		"automatic_captions":{"zh-Hans":[{"name":"中文"}]}}`)
	info, err := parseDownloadMetadata(raw, "https://example.com/video")
	if err != nil || len(info.Formats) != 2 || len(info.Subtitles) != 2 || !info.Formats[1].Approximate || !info.Subtitles[1].Automatic {
		t.Fatal(info, err)
	}
	mapped, _ := json.Marshal(info)
	if strings.Contains(string(mapped), "secret") || strings.Contains(string(mapped), "Cookie") {
		t.Fatal("extractor secrets leaked")
	}
	for _, raw := range []string{`{"_type":"playlist","title":"playlist"}`, `{"title":"empty","formats":[]}`, `{"title":"bad","duration":-1}`} {
		if _, err := parseDownloadMetadata([]byte(raw), "https://example.com/video"); err == nil {
			t.Fatal("invalid metadata accepted", raw)
		}
	}
}

func TestDownloadArgumentsUseTitleContainerAndLiteralChoices(t *testing.T) {
	tk := &Toolkit{config: config.Config{FFmpegPath: "/test/ffmpeg"}}
	cases := []struct {
		options downloads.Options
		want    []string
	}{
		{downloads.Options{Container: "mkv", VideoFormatID: "137", AudioFormatID: "140", SubtitleLanguages: []string{"zh-Hans"}, AutomaticSubtitles: true}, []string{"137+140/137", "--remux-video mkv", "--merge-output-format mkv", "^zh-Hans$", "--write-auto-subs"}},
		{downloads.Options{SubtitleLanguages: []string{"all"}, DownloadDanmaku: true, DownloadThumbnail: true, DownloadInfoJSON: true}, []string{"all,-live_chat", "--write-thumbnail", "--convert-thumbnails", "jpg", "--output thumbnail:%(playlist_index&Season 1/|)s%(title).100B [%(id)s]%(playlist_index& - S01E{playlist_index:02d}|)s.%(ext)s", "--write-info-json"}},
		{downloads.Options{SubtitleLanguages: []string{"zh-Hans"}, DownloadDanmaku: true}, []string{"^zh-Hans$", "danmaku"}},
		{downloads.Options{DownloadDanmaku: true}, []string{"--sub-langs danmaku"}},
		{downloads.Options{Mode: "audio", AudioFormat: "mp3"}, []string{"ba/b", "--extract-audio", "--audio-format mp3"}},
		{downloads.Options{VideoOnly: true}, []string{"bv[height<=?720]/b[height<=?720]", "--remux-video mp4"}},
	}
	for _, tc := range cases {
		rawURL := "https://example.com/media"
		if tc.options.DownloadThumbnail {
			rawURL = "https://www.bilibili.com/video/BV17x411w7KC/"
		}
		args := tk.mediaArguments(rawURL, "/test/output", 720, tc.options)
		text := strings.Join(args, " ")
		if !strings.Contains(text, "--http-chunk-size 10M") {
			t.Fatalf("CDN chunking fallback missing in %s", text)
		}
		if !strings.Contains(text, "--newline --progress") || strings.Contains(text, "--no-progress") {
			t.Fatalf("download progress must remain enabled with --print: %s", text)
		}
		wantOutput := "%(title).180B.%(ext)s"
		if rawURL == "https://www.bilibili.com/video/BV17x411w7KC/" {
			wantOutput = "%(playlist_index&Season 1/|)s%(title).100B [%(id)s]%(playlist_index& - S01E{playlist_index:02d}|)s.%(ext)s"
		}
		if !strings.Contains(text, wantOutput) || strings.Contains(text, "--restrict-filenames") {
			t.Fatal("title naming missing", text)
		}
		for _, want := range tc.want {
			if !strings.Contains(text, want) {
				t.Fatalf("missing %q in %s", want, text)
			}
		}
	}
}

func TestBilibiliDownloadsAllPagesButOtherPlatformsStaySingleItem(t *testing.T) {
	tk := &Toolkit{config: config.Config{FFmpegPath: "/test/ffmpeg"}}
	bilibili := strings.Join(tk.mediaArguments("https://www.bilibili.com/video/BV17x411w7KC/", "/test/output", 0, downloads.Options{}), " ")
	if strings.Contains(bilibili, "--no-playlist") || strings.Contains(bilibili, "--playlist-items 1") || !strings.Contains(bilibili, "Season 1/") || !strings.Contains(bilibili, "S01E{playlist_index:02d}") || strings.Contains(bilibili, "{:02d}") {
		t.Fatalf("Bilibili pages were limited to one entry: %s", bilibili)
	}
	other := strings.Join(tk.mediaArguments("https://www.youtube.com/watch?v=jNQXAC9IVRw", "/test/output", 0, downloads.Options{}), " ")
	if !strings.Contains(other, "--no-playlist --playlist-items 1") || !strings.Contains(other, "%(title).180B.%(ext)s") {
		t.Fatalf("non-Bilibili playlist behavior changed: %s", other)
	}
}

func TestBilibiliAISubtitlesRespectAutomaticSwitch(t *testing.T) {
	tk := &Toolkit{config: config.Config{FFmpegPath: "/test/ffmpeg"}}
	for _, automatic := range []bool{false, true} {
		args := tk.mediaArguments("https://www.bilibili.com/video/BV17x411w7KC/", "/test/output", 0, downloads.Options{SubtitleLanguages: []string{"all"}, AutomaticSubtitles: automatic})
		text := strings.Join(args, " ")
		if strings.Contains(text, "-ai[-_].*") == automatic || strings.Contains(text, "--write-auto-subs") != automatic {
			t.Fatalf("automatic=%v arguments=%s", automatic, text)
		}
	}
	info, err := parseDownloadMetadata([]byte(`{"title":"Bilibili fixture","formats":[{"format_id":"1","ext":"mp4"}],"subtitles":{"ai-zh":[{}],"zh-Hans":[{}]}}`), "https://www.bilibili.com/video/BV17x411w7KC/")
	if err != nil || len(info.Subtitles) != 2 || info.Subtitles[0].Automatic || !info.Subtitles[1].Automatic || info.Subtitles[1].Language != "ai-zh" {
		t.Fatalf("AI subtitle metadata = %+v, %v", info.Subtitles, err)
	}
}

func TestBilibiliMultiPageDownloadValidatesEveryPrintedVideo(t *testing.T) {
	if os.PathSeparator != '/' {
		t.Skip("POSIX fake tool")
	}
	root := t.TempDir()
	ytdlp := filepath.Join(root, "yt-dlp")
	ffmpeg := filepath.Join(root, "ffmpeg")
	script := "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then echo fixture; exit 0; fi\ndir=\nwhile [ $# -gt 0 ]; do if [ \"$1\" = \"--paths\" ]; then shift; dir=$1; fi; shift; done\nmkdir -p \"$dir/Season 1\"\nprintf page1 > \"$dir/Season 1/Page 1.mp4\"\nprintf page2 > \"$dir/Season 1/Page 2.mp4\"\nprintf '%s\\n%s\\n' \"$dir/Season 1/Page 1.mp4\" \"$dir/Season 1/Page 2.mp4\"\n"
	if err := os.WriteFile(ytdlp, []byte(script), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(ffmpeg, []byte("#!/bin/sh\nexit 0\n"), 0700); err != nil {
		t.Fatal(err)
	}
	tk := New(config.Config{YTDLPPath: ytdlp, FFmpegPath: ffmpeg})
	directory := filepath.Join(root, "output")
	result, err := tk.DownloadMedia(context.Background(), "https://www.bilibili.com/video/BV17x411w7KC/", directory, 0, downloads.Options{})
	if err != nil || result.FileName != "Season 1/Page 1.mp4" || result.FileSize != 10 || result.OriginalSize != 10 {
		t.Fatalf("multi-page result = %+v, %v", result, err)
	}
	for _, name := range []string{"Page 1.mp4", "Page 2.mp4"} {
		if _, err := os.Stat(filepath.Join(directory, "Season 1", name)); err != nil {
			t.Fatalf("page artifact %q missing: %v", name, err)
		}
	}
}

func TestSmallXiaohongshuVideoDownloadFailsAt100KiBBoundaryOnly(t *testing.T) {
	if os.PathSeparator != '/' {
		t.Skip("POSIX fake tool")
	}
	run := func(size int64, rawURL string, options downloads.Options) (downloads.Result, error) {
		root := t.TempDir()
		ytdlp := filepath.Join(root, "yt-dlp")
		ffmpeg := filepath.Join(root, "ffmpeg")
		script := "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then echo fixture; exit 0; fi\ndir=\nwhile [ $# -gt 0 ]; do if [ \"$1\" = \"--paths\" ]; then shift; dir=$1; fi; shift; done\nmkdir -p \"$dir\"\ntruncate -s " + strconv.FormatInt(size, 10) + " \"$dir/fixture.mp4\"\nprintf '%s\\n' \"$dir/fixture.mp4\"\n"
		if err := os.WriteFile(ytdlp, []byte(script), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(ffmpeg, []byte("#!/bin/sh\nexit 0\n"), 0700); err != nil {
			t.Fatal(err)
		}
		tk := New(config.Config{YTDLPPath: ytdlp, FFmpegPath: ffmpeg})
		return tk.DownloadMedia(context.Background(), rawURL, filepath.Join(root, "output"), 0, options)
	}
	const signed = "https://www.xiaohongshu.com/explore/6411cf99000000001300b6d9?xsec_token=fixture"
	if _, err := run(100<<10-1, signed, downloads.Options{Mode: "video"}); err == nil || !strings.Contains(err.Error(), "疑似触发风控") || !strings.Contains(err.Error(), "工具设置") {
		t.Fatalf("small Xiaohongshu video did not produce actionable error: %v", err)
	}
	if _, err := run(100<<10, signed, downloads.Options{Mode: "video"}); err != nil {
		t.Fatalf("100 KiB boundary rejected: %v", err)
	}
	if _, err := run(100, signed, downloads.Options{Mode: "audio"}); err != nil {
		t.Fatalf("small Xiaohongshu audio rejected: %v", err)
	}
	if _, err := run(100, "https://www.example.com/video.mp4", downloads.Options{Mode: "video"}); err != nil {
		t.Fatalf("small non-Xiaohongshu video rejected: %v", err)
	}
}

func TestRealVideoOptimizationKeepsPlayableMediaAndSmallerOriginal(t *testing.T) {
	if os.Getenv("TANGENTRY_TOOL_SMOKE") != "1" {
		t.Skip("set TANGENTRY_TOOL_SMOKE=1 for installed-tool integration")
	}
	ffmpeg, err := exec.LookPath("ffmpeg")
	if err != nil {
		t.Fatal(err)
	}
	ffprobe, err := exec.LookPath("ffprobe")
	if err != nil {
		t.Fatal(err)
	}
	tk := &Toolkit{config: config.Config{FFmpegPath: ffmpeg}}
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	for _, tc := range []struct {
		name             string
		compress, silent bool
		crf              string
	}{
		{"compress", true, false, "0"},
		{"silent", false, true, "18"},
		{"compact", true, false, "45"},
		{"hdr", true, false, "18"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			file := filepath.Join(t.TempDir(), "Media title.mp4")
			args := []string{"-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=s=320x180:r=24", "-f", "lavfi", "-i", "sine=frequency=440", "-t", "2", "-c:v", "libx264", "-crf", tc.crf, "-pix_fmt", "yuv420p", "-c:a", "aac"}
			if tc.name == "hdr" {
				args = append(args, "-color_trc", "smpte2084", "-x264-params", "transfer=smpte2084")
			}
			cmd := command(ctx, ffmpeg, append(args, file)...)
			if output, err := cmd.CombinedOutput(); err != nil {
				t.Fatal(err, string(output))
			}
			before, _ := os.Stat(file)
			result, err := tk.optimizeVideo(ctx, file, downloads.Options{Compress: tc.compress, VideoOnly: tc.silent}, downloads.Result{FileName: filepath.Base(file), FileSize: before.Size(), OriginalSize: before.Size()})
			if err != nil {
				t.Fatal(err)
			}
			output, err := command(ctx, ffprobe, "-v", "error", "-show_entries", "stream=codec_type,width,height:format=duration", "-of", "json", file).Output()
			if err != nil {
				t.Fatal(err)
			}
			var probe struct {
				Streams []struct {
					Type          string `json:"codec_type"`
					Width, Height int
				}
				Format struct{ Duration string }
			}
			if json.Unmarshal(output, &probe) != nil || len(probe.Streams) == 0 || probe.Streams[0].Width != 320 || probe.Streams[0].Height != 180 {
				t.Fatal("video dimensions lost", string(output))
			}
			if tc.silent && len(probe.Streams) != 1 || !tc.silent && len(probe.Streams) != 2 {
				t.Fatal("wrong audio stream count", string(output))
			}
			if tc.name == "compress" && (!result.Compressed || result.FileSize >= result.OriginalSize) {
				t.Fatal("compression did not reduce fixture", result)
			}
			if tc.name == "compact" && (result.Compressed || result.FileSize != result.OriginalSize) {
				t.Fatal("larger result replaced compact original", result)
			}
			if tc.name == "hdr" && (result.Compressed || result.FileSize != result.OriginalSize || result.Message == "") {
				t.Fatal("HDR was altered", result)
			}
			if output, err := command(ctx, ffmpeg, "-v", "error", "-i", file, "-f", "null", "-").CombinedOutput(); err != nil {
				t.Fatal("processed video cannot be fully decoded", err, string(output))
			}
			if _, err := os.Stat(filepath.Join(filepath.Dir(file), ".optimized.mp4")); !os.IsNotExist(err) {
				t.Fatal("temporary compression output was retained", err)
			}
			t.Logf("before=%d bytes after=%d bytes compressed=%t", result.OriginalSize, result.FileSize, result.Compressed)
		})
	}
}
