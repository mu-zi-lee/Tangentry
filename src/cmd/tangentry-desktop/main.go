package main

import (
	"crypto/rand"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"runtime"
	"runtime/debug"

	"github.com/egoist/mygo"

	"tangentry/internal/app"
	"tangentry/internal/server"
	"tangentry/web"
)

func main() {
	if err := run(); err != nil {
		slog.Error("Tangentry desktop failed", "error", err)
		os.Exit(1)
	}
}

func run() (runErr error) {
	// Keep idle backend heap retention bounded; model inference runs in a child process.
	debug.SetMemoryLimit(128 << 20)
	if os.Getenv("MYGO_GENERATE") != "" {
		return runBindingGeneration()
	}
	if !mygo.App.RequestSingleInstanceLock() {
		return nil
	}
	mygo.BindAs("DesktopCapture", desktopCapture{})
	logFile, err := openDesktopLog()
	if err != nil {
		return err
	}
	defer func() {
		if runErr != nil {
			slog.Error("Tangentry desktop failed", "error", runErr)
		}
		_ = logFile.Close()
	}()
	slog.SetDefault(slog.New(slog.NewTextHandler(logFile, nil)))
	dataDir, err := configureDesktopRuntime()
	if err != nil {
		return err
	}
	credentialKey, err := desktopCredentialKey(dataDir)
	if err != nil {
		return err
	}
	platformPages := newPlatformPageBridge()
	defer platformPages.Close()
	application, err := app.New(dataDir, web.Assets(), app.Options{CredentialKey: credentialKey, PlatformPageFetcher: platformPages})
	if err != nil {
		return err
	}
	application.SeedSamples()
	platformLogin := newPlatformLoginBridge(application.PlatformCredentialsPort())
	mygo.BindAs("PlatformLogin", platformLoginService{bridge: platformLogin})
	updater := newUpdaterService(dataDir)
	mygo.BindAs("Updater", updater)
	runtime := application.RuntimePort()
	activity := application.ActivityPort()
	backend := server.New(runtime, application.ShellStatePort(), server.ShellOptions{
		PickPath:      pickPath,
		PlatformLogin: platformLogin.Open,
		Capabilities:  server.Capabilities{WindowCapture: true, Notifications: true, KeepAwake: true, Updater: true},
	})
	defer func() {
		if err := backend.Close(); err != nil {
			slog.Error("could not close application services", "error", err)
		}
	}()
	address, _, err := backend.StartLoopback()
	if err != nil {
		return err
	}
	openWindow := newDesktopWindows(address, platformPages.Close).Open
	updater.StartBackground()
	activity.ObserveJobs(startJobActivity(openWindow).Observe)
	registerDesktopLifecycle(openWindow)
	mygo.App.WhenReady(openWindow)
	if err := mygo.App.Run(); err != nil {
		return fmt.Errorf("desktop event loop: %w", err)
	}
	return nil
}

func runBindingGeneration() error {
	dataDir, err := os.MkdirTemp("", "tangentry-bindings-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(dataDir)
	mygo.App.SetPath(mygo.PathUserData, dataDir)
	mygo.BindAs("DesktopCapture", desktopCapture{})
	application, err := app.New(dataDir, web.Assets())
	if err != nil {
		return err
	}
	application.SeedSamples()
	defer application.Close()
	platformLogin := newPlatformLoginBridge(application.PlatformCredentialsPort())
	mygo.BindAs("PlatformLogin", platformLoginService{bridge: platformLogin})
	mygo.BindAs("Updater", newUpdaterService(dataDir))
	return mygo.App.Run()
}

func desktopCredentialKey(dataDir string) ([]byte, error) {
	if !useSystemCredentialStore(runtime.GOOS, macOSAdHocOrUnsigned()) {
		return fileCredentialKey(dataDir)
	}
	key, err := keychainCredentialKey()
	if err != nil {
		return nil, err
	}
	// Keep a copy for a later ad-hoc build. The signed build continues to use
	// the keychain as its source of truth, so this copy follows that key.
	if runtime.GOOS == "darwin" {
		_ = writeCredentialKey(dataDir, key)
	}
	return key, nil
}

func useSystemCredentialStore(goos string, adHocOrUnsigned bool) bool {
	return goos != "darwin" || !adHocOrUnsigned
}

func keychainCredentialKey() ([]byte, error) {
	const keyName = "tangentry-credential-key"
	key, err := mygo.Secrets.Get(keyName)
	if err == nil {
		if len(key) != 32 {
			return nil, errors.New("桌面凭据密钥长度无效")
		}
		return key, nil
	}
	if !errors.Is(err, mygo.ErrSecretNotFound) {
		if errors.Is(err, errors.ErrUnsupported) {
			// Minimal Linux desktops may not run Secret Service. Keep the
			// existing 0600 credential file path so the app remains usable;
			// packaged desktops use the keyring-backed encrypted path above.
			return nil, nil
		}
		return nil, fmt.Errorf("无法访问系统凭据存储：%w", err)
	}
	key = make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		return nil, fmt.Errorf("无法生成桌面凭据密钥：%w", err)
	}
	if err := mygo.Secrets.Set(keyName, key); err != nil {
		if errors.Is(err, errors.ErrUnsupported) {
			return nil, nil
		}
		return nil, fmt.Errorf("无法保存系统凭据密钥：%w", err)
	}
	return key, nil
}

func fileCredentialKey(dataDir string) ([]byte, error) {
	directory := filepath.Join(dataDir, "credentials")
	if err := ensureCredentialDirectory(directory); err != nil {
		return nil, err
	}
	path := filepath.Join(directory, "desktop.key")
	if key, err := os.ReadFile(path); err == nil {
		if len(key) != 32 {
			return nil, errors.New("桌面凭据密钥长度无效")
		}
		if err := os.Chmod(path, 0600); err != nil {
			return nil, fmt.Errorf("无法设置桌面凭据密钥权限：%w", err)
		}
		return key, nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return nil, fmt.Errorf("无法读取本地凭据密钥：%w", err)
	}
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		return nil, fmt.Errorf("无法生成桌面凭据密钥：%w", err)
	}
	if err := createCredentialKey(dataDir, key); err != nil {
		if errors.Is(err, os.ErrExist) {
			return fileCredentialKey(dataDir)
		}
		return nil, err
	}
	return key, nil
}

func writeCredentialKey(dataDir string, key []byte) error {
	if err := createCredentialKey(dataDir, key); err != nil && !errors.Is(err, os.ErrExist) {
		return err
	}
	return nil
}

func createCredentialKey(dataDir string, key []byte) error {
	if len(key) != 32 {
		return errors.New("桌面凭据密钥长度无效")
	}
	directory := filepath.Join(dataDir, "credentials")
	if err := ensureCredentialDirectory(directory); err != nil {
		return err
	}
	path := filepath.Join(directory, "desktop.key")
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return err
	}
	if _, err := file.Write(key); err != nil {
		_ = file.Close()
		_ = os.Remove(path)
		return fmt.Errorf("无法保存本地凭据密钥：%w", err)
	}
	if err := file.Sync(); err != nil {
		_ = file.Close()
		_ = os.Remove(path)
		return fmt.Errorf("无法保存本地凭据密钥：%w", err)
	}
	if err := file.Close(); err != nil {
		_ = os.Remove(path)
		return fmt.Errorf("无法保存本地凭据密钥：%w", err)
	}
	return os.Chmod(path, 0600)
}

func ensureCredentialDirectory(directory string) error {
	if err := os.MkdirAll(directory, 0700); err != nil {
		return fmt.Errorf("无法创建本地凭据目录：%w", err)
	}
	if err := os.Chmod(directory, 0700); err != nil {
		return fmt.Errorf("无法设置本地凭据目录权限：%w", err)
	}
	return nil
}
