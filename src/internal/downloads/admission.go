package downloads

import (
	"context"
	"crypto/rand"
	"os"
	"strings"
	"time"

	"tangentry/internal/discovery"
)

// Start validates and admits one request while holding the service state lock.
// Repository and directory writes intentionally retain their existing ordering
// so duplicate and failure behavior stay unchanged.
func (s *Service) Start(ctx context.Context, request Request) (Job, error) {
	canonical, err := NormalizeURL(request.URL)
	if err != nil || len(request.Title) > 2000 {
		return Job{}, ErrInvalid
	}
	if request.MaxHeight < 0 || request.MaxHeight > 16384 || request.Options.normalize() != nil {
		return Job{}, ErrInvalid
	}
	request.Subdirectory, err = NormalizeSubdirectory(request.Subdirectory)
	if err != nil {
		return Job{}, err
	}
	request.OutputDirectory, err = normalizeOutputDirectory(request.OutputDirectory)
	if err != nil {
		return Job{}, err
	}
	// Douyin can be downloaded directly from the authenticated in-app page,
	// so yt-dlp/FFmpeg readiness must not prevent the job from entering the
	// queue. The media runner tries this path before yt-dlp.
	ref, douyinErr := discovery.ParseDouyin(canonical)
	if douyinErr == nil && ref.ID == "" {
		s.mu.Lock()
		resolve := s.douyinResolve
		s.mu.Unlock()
		if resolve != nil {
			resolved, resolveErr := resolve(ctx, canonical)
			if resolveErr == nil && resolved.ID != "" {
				canonical = resolved.URL
				ref = resolved
			}
		}
		if !s.runner.Ready() && ref.ID == "" {
			return Job{}, ErrDouyinShortLink
		}
	}
	if !s.runner.Ready() && douyinErr != nil {
		return Job{}, ErrTools
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.ctx.Err() != nil {
		return Job{}, ErrBusy
	}
	if s.failure != nil {
		return Job{}, s.failure
	}
	jobs, err := s.repo.ListDownloads(ctx)
	if err != nil {
		return Job{}, err
	}
	for _, job := range jobs {
		if sameURL(job.URL, canonical) && job.MaxHeight == request.MaxHeight && sameOptions(job.Options, request.Options) && job.Subdirectory == request.Subdirectory && (job.State == "queued" || job.State == "running") {
			return job, nil
		}
	}
	if len(s.queue) == cap(s.queue) {
		return Job{}, ErrBusy
	}
	if strings.TrimSpace(request.Title) == "" {
		_, id, _, _ := discovery.VideoURL(canonical)
		request.Title = id
		if request.Title == "" {
			request.Title = canonical
		}
	}
	now := time.Now().Unix()
	job := Job{Options: request.Options, ID: rand.Text(), URL: canonical, Title: strings.TrimSpace(request.Title), ThumbnailURL: strings.TrimSpace(request.ThumbnailURL), Subdirectory: request.Subdirectory, OutputDirectory: request.OutputDirectory, MaxHeight: request.MaxHeight, State: "queued", CreatedAt: now, UpdatedAt: now}
	if job.OutputDirectory != "" {
		retryable, occupied := false, false
		for _, existing := range jobs {
			if existing.Subdirectory == job.Subdirectory && existing.OutputDirectory == job.OutputDirectory && s.jobDirectoryUnlocked(existing.ID) == s.directory {
				sameRequest := sameURL(existing.URL, canonical) && existing.MaxHeight == job.MaxHeight && sameOptions(existing.Options, job.Options)
				if sameRequest && (existing.State == "failed" || existing.State == "interrupted" || existing.State == "cancelled") {
					retryable = true
				} else {
					occupied = true
				}
			}
		}
		if !retryable || occupied {
			job.OutputDirectory = s.availableOutputDirectory(job.OutputDirectory, job.Subdirectory, jobs)
		}
	}
	s.locations.Jobs[job.ID] = s.directory
	if err := s.saveDirectories(); err != nil {
		delete(s.locations.Jobs, job.ID)
		return Job{}, err
	}
	if err := s.repo.SaveDownload(ctx, job); err != nil {
		return Job{}, err
	}
	s.queue <- job.ID
	return job, nil
}

// Cancel persists the user-requested terminal state before cancelling the
// runner context, so a concurrent worker cannot overwrite it as completed.
func (s *Service) Cancel(ctx context.Context, id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	job, err := s.repo.GetDownload(ctx, id)
	if err != nil {
		return err
	}
	if job.State != "queued" && job.State != "running" {
		return nil
	}
	job.State, job.Message, job.UpdatedAt = "cancelled", "已取消下载。", time.Now().Unix()
	if err := s.repo.SaveDownload(ctx, job); err != nil {
		return err
	}
	if cancel := s.cancel[id]; cancel != nil {
		cancel()
	}
	return nil
}

// Delete removes terminal history. Active jobs must be cancelled first so the
// worker cannot recreate or overwrite a record while it is being removed.
func (s *Service) Delete(ctx context.Context, id string, removeFiles bool) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	job, err := s.repo.GetDownload(ctx, id)
	if err != nil {
		return err
	}
	if job.State == "queued" || job.State == "running" {
		return ErrActive
	}
	directory := s.jobDirectoryUnlocked(id)
	var outputDirectory string
	if removeFiles {
		outputDirectory, err = safeJobOutputDirectory(directory, job)
		if err != nil {
			return err
		}
		jobs, err := s.repo.ListDownloads(ctx)
		if err != nil {
			return err
		}
		if s.outputPathReferenced(outputDirectory, jobs, map[string]bool{id: true}) {
			outputDirectory = ""
		}
	}
	if err := s.repo.DeleteDownload(ctx, id); err != nil {
		return err
	}
	delete(s.locations.Jobs, id)
	if err := s.saveDirectories(); err != nil {
		return err
	}
	if removeFiles && outputDirectory != "" {
		if err := os.RemoveAll(outputDirectory); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) Clear(ctx context.Context, removeFiles bool) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	jobs, err := s.repo.ListDownloads(ctx)
	if err != nil {
		return err
	}
	ids := make([]string, 0, len(jobs))
	terminal := make([]Job, 0, len(jobs))
	for _, job := range jobs {
		if job.State == "queued" || job.State == "running" {
			continue
		}
		ids = append(ids, job.ID)
		terminal = append(terminal, job)
	}
	paths := make(map[string]string, len(terminal))
	if removeFiles {
		removed := make(map[string]bool, len(terminal))
		for _, job := range terminal {
			removed[job.ID] = true
		}
		for _, job := range terminal {
			directory := s.locations.Jobs[job.ID]
			if directory == "" {
				directory = s.originalDirectory
			}
			path, err := safeJobOutputDirectory(directory, job)
			if err != nil {
				return err
			}
			if !s.outputPathReferenced(path, jobs, removed) {
				paths[job.ID] = path
			}
		}
	}
	if err := s.repo.DeleteDownloads(ctx, ids); err != nil {
		return err
	}
	if removeFiles {
		for _, job := range terminal {
			if path := paths[job.ID]; path != "" {
				if err := os.RemoveAll(path); err != nil {
					return err
				}
			}
		}
	}
	for _, id := range ids {
		delete(s.locations.Jobs, id)
	}
	return s.saveDirectories()
}

// Called with mu held. Retrying a failed job can share its readable directory.
func (s *Service) outputPathReferenced(path string, jobs []Job, ignoredIDs map[string]bool) bool {
	for _, candidate := range jobs {
		if ignoredIDs[candidate.ID] {
			continue
		}
		root := s.jobDirectoryUnlocked(candidate.ID)
		other, err := safeJobOutputDirectory(root, candidate)
		if err == nil && other == path {
			return true
		}
	}
	return false
}
