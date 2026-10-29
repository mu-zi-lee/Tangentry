.DEFAULT_GOAL := build
.PHONY: dev dev-local build server docker test test-unit test-e2e check-race desktop desktop-build desktop-build-windows desktop-build-linux desktop-build-all clean

VERSION ?= 0.0.3.3
IMAGE ?= tangentry
SOURCE_DIR ?= src
WEB_DIR := $(SOURCE_DIR)/web

# Build prerequisites are developer-only; the resulting apps carry their runtime.
# PLATFORMS lists MyGo targets; the macOS runtime needs an Apple silicon Mac,
# while Windows and Linux runtimes and apps cross-build from any machine.
PLATFORMS ?= darwin/arm64

desktop-build:
	cd $(WEB_DIR) && npm ci && npm run build
	node $(SOURCE_DIR)/tools/desktop/prepare.mjs --platform $(PLATFORMS)
	cd $(SOURCE_DIR) && go tool mygo build -platform $(PLATFORMS)

desktop-build-windows:
	$(MAKE) desktop-build PLATFORMS=windows/amd64,windows/arm64

desktop-build-linux:
	$(MAKE) desktop-build PLATFORMS=linux/amd64,linux/arm64

desktop-build-all:
	$(MAKE) desktop-build PLATFORMS=darwin/arm64,windows/amd64,windows/arm64,linux/amd64,linux/arm64

desktop:
	cd $(WEB_DIR) && npm run build
	node $(SOURCE_DIR)/tools/desktop/prepare.mjs
	cd $(SOURCE_DIR) && go tool mygo dev

dev: desktop

# Local browser testing uses the same data as the installed macOS app. The
# server is intentionally loopback-only and skips the sign-in page.
dev-local:
	@set -e; \
	data="$(HOME)/Library/Application Support/Tangentry"; \
	(cd $(SOURCE_DIR) && TANGENTRY_DEV_LOCAL=1 TANGENTRY_DATA="$$data" go run ./cmd/tangentry-server -addr 127.0.0.1:7380) & \
	server_pid=$$!; \
	trap 'kill $$server_pid 2>/dev/null || true' EXIT INT TERM; \
	cd $(WEB_DIR) && npm run dev -- --host 127.0.0.1

# Headless server for Docker / NAS hosts; see README.
server:
	cd $(WEB_DIR) && npm ci && npm run build
	mkdir -p build
	cd $(SOURCE_DIR) && go build -o ../build/tangentry-server ./cmd/tangentry-server

docker:
	docker build --build-arg VERSION=$(VERSION) -t $(IMAGE):$(VERSION) -t $(IMAGE):latest .

build: desktop-build

# Unit tests cover the details; a few Playwright flows cover what users do most.
test: test-unit test-e2e

test-unit:
	cd $(WEB_DIR) && npm run build && npm test
	cd $(SOURCE_DIR) && go test ./...

test-e2e:
	cd $(WEB_DIR) && npm run test:e2e

check-race:
	cd $(SOURCE_DIR) && go vet ./cmd/... ./internal/...
	cd $(SOURCE_DIR) && go test -race ./internal/...

clean:
	rm -rf build src/build src/resources src/.mygo src/.mygo-resources src/web/dist src/web/test-results src/web/playwright-report
