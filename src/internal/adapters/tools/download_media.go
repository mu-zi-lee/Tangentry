package tools

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"strings"

	"tangentry/internal/discovery"
	"tangentry/internal/downloads"
)

func (t *Toolkit) Inspect(ctx context.Context, rawURL string) (downloads.MediaInfo, error) {
	if !t.ytdlpReady() {
		return downloads.MediaInfo{}, downloads.ErrTools
	}
	cookies, clean, err := t.cookieArguments(rawURL)
	if err != nil {
		return downloads.MediaInfo{}, downloads.ErrTools
	}
	defer clean()
	args := []string{"--ignore-config", "--no-plugin-dirs", "--no-playlist", "--playlist-items", "1", "--no-cache-dir", "--simulate", "--skip-download", "--dump-single-json", "--socket-timeout", "12", "--retries", "0"}
	args = append(args, cookies...)
	args = append(args, "--", rawURL)
	cmd, err := t.ytdlpCommand(ctx, args...)
	if err != nil {
		return downloads.MediaInfo{}, t.toolDownloadError(ctx, err)
	}
	stdout, stderr := &metadataBuffer{limit: 8 << 20}, &boundedBuffer{}
	cmd.Stdout, cmd.Stderr = stdout, stderr
	if err := cmd.Run(); err != nil {
		if ctx.Err() != nil {
			return downloads.MediaInfo{}, ctx.Err()
		}
		return downloads.MediaInfo{}, &discovery.PlatformError{Message: classify(stderr.String()).Error()}
	}
	if stdout.exceeded {
		return downloads.MediaInfo{}, &discovery.PlatformError{Message: "媒体信息过大，请使用单条视频或音频链接。"}
	}
	return parseDownloadMetadata(stdout.Bytes(), rawURL)
}

func (t *Toolkit) mediaArguments(rawURL, directory string, height int, options downloads.Options) []string {
	container := options.Container
	if container == "" {
		container = "mp4"
	}
	video := "bv*"
	combined := "b"
	if height > 0 {
		filter := "[height<=?" + strconv.Itoa(height) + "]"
		video += filter
		combined += filter
	}
	if options.VideoOnly {
		video = strings.Replace(video, "bv*", "bv", 1)
	}
	if options.VideoFormatID != "" {
		video, combined = options.VideoFormatID, options.VideoFormatID
	}
	audio := "ba"
	if options.AudioFormatID != "" {
		audio = options.AudioFormatID
	}
	selector := video + "+" + audio + "/" + combined
	if options.VideoOnly {
		selector = video + "/" + combined
	}
	if options.Mode == "audio" {
		selector = audio + "/b"
	}
	args := []string{"--ignore-config", "--no-plugin-dirs"}
	platform, _, _, _ := discovery.VideoURL(rawURL)
	if platform != "bilibili" {
		args = append(args, "--no-playlist", "--playlist-items", "1")
	}
	output := "%(title).180B.%(ext)s"
	if platform == "bilibili" {
		output = "%(playlist_index&Season 1/|)s%(title).100B [%(id)s]%(playlist_index& - S01E{playlist_index:02d}|)s.%(ext)s"
	}
	if platform == "bilibili" && options.DownloadThumbnail {
		args = append(args, "--output", "thumbnail:%(playlist_index&Season 1/|)s%(title).100B [%(id)s]%(playlist_index& - S01E{playlist_index:02d}|)s.%(ext)s")
	}
	// Some Bilibili CDN edges reject the large range requests used by the
	// default downloader with HTTP 567. Smaller chunks are slower on a fast
	// connection but make downloads reliable on those edges and proxies.
	args = append(args, "--no-cache-dir", "--no-progress", "--no-warnings", "--socket-timeout", "20", "--retries", "1", "--fragment-retries", "1", "--concurrent-fragments", "1", "--http-chunk-size", "10M", "--no-overwrites", "--windows-filenames", "--ffmpeg-location", t.config.FFmpegPath, "--format", selector, "--paths", directory, "--output", output, "--print", "after_move:filepath")
	if options.Mode == "audio" {
		format := options.AudioFormat
		if format == "" {
			format = "best"
		}
		args = append(args, "--extract-audio", "--audio-format", format, "--audio-quality", "0")
	} else {
		args = append(args, "--merge-output-format", container, "--remux-video", container)
		if container == "mp4" {
			args = append(args, "--format-sort", "res,fps,vcodec:h264,acodec:aac")
		}
	}
	if len(options.SubtitleLanguages) > 0 || options.DownloadDanmaku {
		languages := "all,-danmaku,-live_chat"
		if options.DownloadDanmaku && len(options.SubtitleLanguages) == 0 {
			languages = "danmaku"
		} else if slices.Contains(options.SubtitleLanguages, "all") {
			if options.DownloadDanmaku {
				languages = "all,-live_chat"
			}
		} else {
			selected := make([]string, 0, len(options.SubtitleLanguages)+1)
			for _, language := range options.SubtitleLanguages {
				selected = append(selected, "^"+regexp.QuoteMeta(language)+"$")
			}
			if options.DownloadDanmaku {
				selected = append(selected, "danmaku")
			}
			languages = strings.Join(selected, ",")
		}
		// Bilibili exposes AI tracks in its regular subtitle map, not automatic_captions.
		if platform == "bilibili" && !options.AutomaticSubtitles {
			languages += ",-ai[-_].*"
		}
		args = append(args, "--write-subs", "--sub-langs", languages, "--sub-format", "srt/vtt/best")
		if options.AutomaticSubtitles {
			args = append(args, "--write-auto-subs")
		}
	}
	if options.DownloadThumbnail {
		args = append(args, "--write-thumbnail", "--convert-thumbnails", "jpg")
	}
	if options.DownloadInfoJSON {
		args = append(args, "--write-info-json")
	}
	return append(args, "--", rawURL)
}

func (t *Toolkit) DownloadMedia(ctx context.Context, rawURL, directory string, height int, options downloads.Options) (downloads.Result, error) {
	var douyinFallbackErr error
	if ref, parseErr := discovery.ParseDouyin(rawURL); parseErr == nil && ref.ID != "" {
		if result, fallbackErr := t.downloadDouyinFallback(ctx, ref.URL, directory, height, options); fallbackErr == nil {
			return result, nil
		} else {
			douyinFallbackErr = fallbackErr
		}
	}
	if !t.Ready() {
		if douyinFallbackErr != nil {
			if options.Mode == "audio" {
				return downloads.Result{}, douyinFallbackErr
			}
			return downloads.Result{}, fmt.Errorf("应用内抖音页面下载失败，且 yt-dlp 尚未就绪：%v", douyinFallbackErr)
		}
		return downloads.Result{}, downloads.ErrTools
	}
	if err := os.MkdirAll(directory, 0700); err != nil {
		return downloads.Result{}, errors.New("无法创建下载目录，请检查磁盘权限。")
	}
	cookies, clean, err := t.cookieArguments(rawURL)
	if err != nil {
		return downloads.Result{}, downloads.ErrTools
	}
	defer clean()
	args := append(cookies, t.mediaArguments(rawURL, directory, height, options)...)
	cmd, err := t.ytdlpCommand(ctx, args...)
	if err != nil {
		if err = t.toolDownloadError(ctx, err); errors.Is(err, downloads.ErrTools) {
			err = errors.New("yt-dlp 未能下载，请检查网络后重试；工具设置中可查看下载状态。")
		}
		return downloads.Result{}, err
	}
	stdout, stderr := &metadataBuffer{limit: 4 << 20}, &boundedBuffer{}
	cmd.Stdout, cmd.Stderr = stdout, stderr
	if err := cmd.Run(); err != nil {
		if ctx.Err() != nil {
			return downloads.Result{}, ctx.Err()
		}
		if ref, parseErr := discovery.ParseDouyin(rawURL); parseErr == nil && ref.ID != "" {
			cookieArgs, _, _ := t.cookieArguments(rawURL)
			return downloads.Result{}, classifyDouyin(stderr.String(), len(cookieArgs) > 0)
		}
		return downloads.Result{}, classify(stderr.String())
	}
	if stdout.exceeded {
		return downloads.Result{}, errors.New("下载生成的文件清单过大，请缩小收藏夹视频或分 P 数量后重试。")
	}
	root, rootErr := filepath.Abs(directory)
	if rootErr != nil {
		return downloads.Result{}, errors.New("下载工具返回了无效的文件位置。")
	}
	type downloadedFile struct {
		absolute string
		relative string
	}
	paths := make([]downloadedFile, 0, 1)
	seen := make(map[string]bool)
	for _, line := range strings.Split(stdout.String(), "\n") {
		if name := strings.TrimSpace(line); name != "" {
			abs, err := filepath.Abs(name)
			relative, relativeErr := filepath.Rel(root, abs)
			_, artifactErr := downloads.NormalizeArtifactPath(filepath.ToSlash(relative))
			if err != nil || relativeErr != nil || artifactErr != nil || !filepath.IsLocal(relative) || seen[abs] {
				return downloads.Result{}, errors.New("下载工具返回了无效的文件位置。")
			}
			if err := ensureSafeDownloadedPath(root, relative); err != nil {
				return downloads.Result{}, errors.New("下载工具返回了无效的文件位置。")
			}
			info, err := os.Lstat(abs)
			if err != nil || !info.Mode().IsRegular() || info.Size() == 0 {
				return downloads.Result{}, errors.New("下载未产生完整的媒体文件。")
			}
			seen[abs] = true
			paths = append(paths, downloadedFile{absolute: abs, relative: filepath.ToSlash(relative)})
		}
	}
	if len(paths) == 0 {
		return downloads.Result{}, errors.New("下载工具没有返回媒体文件位置。")
	}
	var result downloads.Result
	for index, path := range paths {
		info, err := os.Lstat(path.absolute)
		if err != nil {
			return result, errors.New("下载未产生完整的媒体文件。")
		}
		if options.Mode != "audio" {
			if platform, _, _, parseErr := discovery.VideoURL(rawURL); parseErr == nil && platform == "xiaohongshu" && info.Size() < 100<<10 {
				return result, errors.New("小红书视频文件过小，疑似触发风控。请稍后重试，或在工具设置配置小红书 Cookie。")
			}
		}
		current := downloads.Result{FileName: path.relative, FileSize: info.Size(), OriginalSize: info.Size()}
		if options.Mode != "audio" && (options.VideoOnly || options.Compress) {
			current, err = t.optimizeVideo(ctx, path.absolute, options, current)
			if err != nil {
				return result, err
			}
		}
		if index == 0 {
			result.FileName = current.FileName
		}
		result.FileSize += current.FileSize
		result.OriginalSize += current.OriginalSize
		result.Compressed = result.Compressed || current.Compressed
		if current.Message != "" {
			result.Message = current.Message
		}
	}
	if platform, _, _, parseErr := discovery.VideoURL(rawURL); parseErr == nil && platform == "bilibili" {
		videoPaths := make([]string, 0, len(paths))
		for _, path := range paths {
			if isVideoArtifact(path.relative) {
				videoPaths = append(videoPaths, path.relative)
			}
		}
		if options.DownloadInfoJSON {
			if err := generateBilibiliNFO(directory, rawURL, videoPaths); err != nil {
				return result, errors.New("无法生成媒体库视频信息文件。")
			}
		}
		if options.DownloadDanmaku {
			generated, err := convertDanmakuXML(directory)
			if err != nil {
				return result, errors.New("无法将弹幕转换为 ASS 字幕。")
			}
			for _, name := range generated {
				info, err := os.Stat(filepath.Join(directory, filepath.FromSlash(name)))
				if err != nil || !info.Mode().IsRegular() {
					return result, errors.New("弹幕文件生成后无法读取。")
				}
				result.FileSize += info.Size()
				result.OriginalSize += info.Size()
			}
		}
	}
	return result, nil
}

func isVideoArtifact(name string) bool {
	return slices.Contains([]string{".mp4", ".mkv", ".webm", ".mov", ".flv", ".ts", ".m4v", ".avi"}, strings.ToLower(filepath.Ext(name)))
}

func ensureSafeDownloadedPath(root, relative string) error {
	clean, err := downloads.NormalizeArtifactPath(filepath.ToSlash(relative))
	if err != nil {
		return err
	}
	current := root
	parts := strings.Split(filepath.FromSlash(clean), string(filepath.Separator))
	for index, part := range parts {
		current = filepath.Join(current, part)
		info, err := os.Lstat(current)
		if err != nil {
			return err
		}
		if info.Mode()&os.ModeSymlink != 0 || index < len(parts)-1 && !info.IsDir() {
			return downloads.ErrInvalid
		}
	}
	return nil
}

func safeGeneratedPath(root, relative string) (string, error) {
	clean, err := downloads.NormalizeArtifactPath(filepath.ToSlash(relative))
	if err != nil {
		return "", err
	}
	current := root
	parts := strings.Split(filepath.FromSlash(clean), string(filepath.Separator))
	for index, part := range parts {
		current = filepath.Join(current, part)
		info, err := os.Lstat(current)
		if errors.Is(err, os.ErrNotExist) && index == len(parts)-1 {
			return current, nil
		}
		if err != nil {
			return "", err
		}
		if info.Mode()&os.ModeSymlink != 0 || index < len(parts)-1 && !info.IsDir() || index == len(parts)-1 && !info.Mode().IsRegular() {
			return "", downloads.ErrInvalid
		}
	}
	return current, nil
}

func (t *Toolkit) optimizeVideo(ctx context.Context, file string, options downloads.Options, result downloads.Result) (downloads.Result, error) {
	compress := options.Compress
	if compress {
		// Avoid silently reducing HDR or high-bit-depth sources to 8-bit SDR.
		ffprobe := executable(filepath.Join(filepath.Dir(t.config.FFmpegPath), "ffprobe"), "")
		if ffprobe == "" {
			ffprobe = executable("", "ffprobe")
		}
		cmd := command(ctx, ffprobe, "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=color_transfer,pix_fmt", "-of", "json", file)
		cmd.Env = toolEnvironment()
		output, stderr := &metadataBuffer{limit: 16384}, &boundedBuffer{}
		cmd.Stdout, cmd.Stderr = output, stderr
		var probe struct {
			Streams []struct {
				Transfer    string `json:"color_transfer"`
				PixelFormat string `json:"pix_fmt"`
			} `json:"streams"`
		}
		if cmd.Run() != nil || output.exceeded || json.Unmarshal(output.Bytes(), &probe) != nil || len(probe.Streams) == 0 {
			compress = false
			result.Message = "无法确认视频色彩信息，已保留原始画质。"
		} else {
			stream := probe.Streams[0]
			if stream.Transfer == "smpte2084" || stream.Transfer == "arib-std-b67" || strings.Contains(stream.PixelFormat, "10") || strings.Contains(stream.PixelFormat, "12") || strings.Contains(stream.PixelFormat, "16") {
				compress = false
				result.Message = "高动态范围或高位深视频已保留原始画质。"
			}
		}
	}
	if ctx.Err() != nil {
		return result, ctx.Err()
	}
	if !compress && !options.VideoOnly {
		return result, nil
	}
	temp := filepath.Join(filepath.Dir(file), ".optimized"+filepath.Ext(file))
	defer os.Remove(temp)
	args := []string{"-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-i", file, "-map", "0:v:0", "-map_metadata", "0", "-map_chapters", "0"}
	if !options.VideoOnly {
		args = append(args, "-map", "0:a?", "-c:a", "copy")
	}
	if compress {
		args = append(args, "-c:v", "libx264", "-crf", "22", "-preset", "medium", "-threads", "2", "-pix_fmt", "yuv420p", "-fps_mode", "passthrough", "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2")
	} else {
		args = append(args, "-c:v", "copy")
	}
	if strings.EqualFold(filepath.Ext(file), ".mp4") {
		args = append(args, "-movflags", "+faststart")
	}
	args = append(args, temp)
	cmd := command(ctx, t.config.FFmpegPath, args...)
	cmd.Env = toolEnvironment()
	output := &boundedBuffer{}
	cmd.Stdout, cmd.Stderr = output, output
	if err := cmd.Run(); err != nil {
		if ctx.Err() != nil {
			return result, ctx.Err()
		}
		return result, errors.New("视频压缩或音轨处理失败，请关闭节省空间后重试，或检查 FFmpeg 配置。")
	}
	info, err := os.Lstat(temp)
	if err != nil || !info.Mode().IsRegular() || info.Size() == 0 {
		return result, errors.New("视频处理没有生成完整文件。")
	}
	if info.Size() >= result.OriginalSize && !options.VideoOnly {
		result.Message = "原文件已较紧凑，保留体积更小的原始文件。"
		return result, nil
	}
	if info.Size() >= result.OriginalSize && compress {
		// Audio removal must still happen even when transcoding adds bytes.
		options.Compress = false
		return t.optimizeVideo(ctx, file, options, result)
	}
	if err := os.Rename(temp, file); err != nil {
		return result, errors.New("无法保存处理后的视频，请检查磁盘权限。")
	}
	result.FileSize, result.Compressed = info.Size(), compress
	return result, nil
}

// toolDownloadError explains a failed or unfinished first-use yt-dlp download.
func (t *Toolkit) toolDownloadError(ctx context.Context, err error) error {
	if t.ytdlp != nil && t.ytdlp.snapshot().Downloading {
		return downloads.ErrToolBusy
	}
	if ctx.Err() != nil {
		return ctx.Err()
	}
	return downloads.ErrTools
}
