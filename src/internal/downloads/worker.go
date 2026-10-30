package downloads

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"os"
	"time"
)

func (s *Service) work() {
	defer s.wg.Done()
	for {
		select {
		case <-s.ctx.Done():
			return
		case id := <-s.queue:
			s.run(id)
		}
	}
}

func (s *Service) run(id string) {
	s.mu.Lock()
	job, err := s.repo.GetDownload(context.Background(), id)
	if err != nil || job.State != "queued" || s.ctx.Err() != nil {
		s.mu.Unlock()
		return
	}
	job.State, job.UpdatedAt = "running", time.Now().Unix()
	if err := s.repo.SaveDownload(context.Background(), job); err != nil {
		s.failStorage(err)
		s.mu.Unlock()
		return
	}
	ctx, cancel := context.WithTimeout(s.ctx, s.timeout)
	s.cancel[id] = cancel
	observer := s.observer
	s.mu.Unlock()
	s.notify(observer, job)
	directory, pathErr := s.jobOutputDirectory(job)
	if pathErr != nil {
		s.failPreparation(id, "下载目标目录无效。", cancel, observer)
		return
	}
	if err := ensureJobOutputDirectory(s.jobDirectory(id), job.Subdirectory, jobOutputName(job)); err != nil {
		s.failPreparation(id, "无法创建下载目录，请检查路径和磁盘权限。", cancel, observer)
		return
	}
	keepFile := false
	defer func() {
		if !keepFile {
			if err := os.RemoveAll(directory); err != nil {
				slog.Error("could not remove unfinished download", "id", id)
			}
		}
	}()
	outputDir := directory
	var result Result
	var runErr error
	if runner, ok := s.runner.(ProgressMediaRunner); ok {
		lastProgress := -1.0
		result, runErr = runner.DownloadMediaProgress(ctx, job.URL, outputDir, job.MaxHeight, job.Options, func(progress float64) {
			if math.IsNaN(progress) || progress < 0 || progress > 100 || progress < lastProgress+1 && progress != 100 {
				return
			}
			lastProgress = progress
			s.updateProgress(id, progress, observer)
		})
	} else if runner, ok := s.runner.(MediaRunner); ok {
		result, runErr = runner.DownloadMedia(ctx, job.URL, outputDir, job.MaxHeight, job.Options)
	} else {
		result.FileName, runErr = s.runner.Download(ctx, job.URL, outputDir, job.MaxHeight)
	}
	var files []string
	if runErr == nil {
		files, runErr = completedArtifacts(outputDir, result.FileName)
	}
	ctxErr := ctx.Err()
	cancel()
	finished := Job{ID: id, URL: job.URL, Title: job.Title, ThumbnailURL: job.ThumbnailURL, State: "failed"}
	defer func() { s.notify(observer, finished) }()
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.cancel, id)
	job, err = s.repo.GetDownload(context.Background(), id)
	if err != nil {
		return
	}
	finished = job
	if job.State == "cancelled" {
		return
	}
	job.UpdatedAt = time.Now().Unix()
	s.applyResult(&job, result, files, runErr, ctxErr, &keepFile)
	finished = job
	if err := s.repo.SaveDownload(context.Background(), job); err != nil {
		s.failStorage(err)
	}
}

func (s *Service) failPreparation(id, message string, cancel context.CancelFunc, observer func(Job)) {
	cancel()
	s.mu.Lock()
	delete(s.cancel, id)
	job, err := s.repo.GetDownload(context.Background(), id)
	if err == nil && job.State != "cancelled" {
		job.State, job.Message, job.UpdatedAt = "failed", message, time.Now().Unix()
		if saveErr := s.repo.SaveDownload(context.Background(), job); saveErr != nil {
			s.failStorage(saveErr)
		}
	}
	s.mu.Unlock()
	if err == nil {
		s.notify(observer, job)
	}
}

func (s *Service) applyResult(job *Job, result Result, files []string, runErr error, ctxErr error, keepFile *bool) {
	switch {
	case s.ctx.Err() != nil:
		job.State, job.Message = "interrupted", "服务关闭中断了任务，可以重新下载。"
	case errors.Is(ctxErr, context.DeadlineExceeded):
		job.State, job.Message = "failed", "下载超时，可以检查网络后重新下载。"
	case runErr != nil:
		job.State, job.Message = "failed", runErr.Error()
	case !validArtifactPath(result.FileName):
		job.State, job.Message = "failed", "下载工具没有提供有效的输出文件。"
	default:
		job.State, job.FileName, job.Message, job.Progress = "completed", result.FileName, result.Message, 100
		job.Files, job.FileSize, job.OriginalSize, job.Compressed = files, result.FileSize, result.OriginalSize, result.Compressed
		*keepFile = true
	}
}

func (s *Service) updateProgress(id string, progress float64, observer func(Job)) {
	s.mu.Lock()
	job, err := s.repo.GetDownload(context.Background(), id)
	if err != nil || job.State != "running" {
		s.mu.Unlock()
		return
	}
	job.Progress = progress
	job.Message = fmt.Sprintf("已下载 %.0f%%", progress)
	job.UpdatedAt = time.Now().Unix()
	if err := s.repo.SaveDownload(context.Background(), job); err != nil {
		s.mu.Unlock()
		s.mu.Lock()
		s.failStorage(err)
		s.mu.Unlock()
		return
	}
	s.mu.Unlock()
	s.notify(observer, job)
}

// Called while mu is held. A storage failure stops work and remains visible via the API.
func (s *Service) failStorage(err error) {
	s.failure = err
	s.stop()
	slog.Error("download state could not be saved; worker stopped")
}
