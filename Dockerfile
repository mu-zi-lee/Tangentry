# syntax=docker/dockerfile:1
# Headless Tangentry server. Build: docker build -t tangentry .
# Multi-arch: docker buildx build --platform linux/amd64,linux/arm64 .
ARG NODE_VERSION=24.21.0
ARG GO_VERSION=1.27.1
ARG VERSION=0.0.3.5

# The frontend is architecture-independent, so it builds once on the builder.
FROM --platform=$BUILDPLATFORM node:${NODE_VERSION}-slim AS web
WORKDIR /src/web
COPY src/web/package.json src/web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY src/web/ ./
RUN npm run build

# Go cross-compiles; modernc.org/sqlite needs no cgo.
FROM --platform=$BUILDPLATFORM golang:${GO_VERSION} AS server
ARG TARGETOS TARGETARCH
WORKDIR /src
COPY src/go.mod src/go.sum ./
RUN go mod download
COPY src/cmd/ cmd/
COPY src/internal/ internal/
COPY src/web/assets.go web/
COPY --from=web /src/web/dist web/dist
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH \
    go build -trimpath -ldflags="-s -w" -o /out/tangentry-server ./cmd/tangentry-server

# yt-dlp needs a JavaScript runtime to resolve YouTube streams; Node is
# target-arch and is used for nothing else (recommendations are Go).
FROM node:${NODE_VERSION}-slim AS node

# yt-dlp's standalone build, verified against the release checksums. Same
# version as the desktop runtime (src/tools/desktop/prepare.mjs).
FROM debian:stable-slim AS ytdlp
ARG TARGETARCH
ARG YTDLP_VERSION=2026.08.19
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl && rm -rf /var/lib/apt/lists/*
RUN set -eu; \
    case "$TARGETARCH" in amd64) asset=yt-dlp_linux ;; arm64) asset=yt-dlp_linux_aarch64 ;; *) echo "unsupported: $TARGETARCH" >&2; exit 1 ;; esac; \
    base="https://github.com/yt-dlp/yt-dlp/releases/download/$YTDLP_VERSION"; \
    cd /tmp; curl -fsSLO "$base/$asset"; curl -fsSLO "$base/SHA2-256SUMS"; \
    grep " $asset\$" SHA2-256SUMS | sha256sum -c -; \
    install -m 0755 "$asset" /usr/local/bin/yt-dlp

FROM debian:stable-slim
ARG VERSION
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates ffmpeg libstdc++6 tzdata \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 10001 tangentry \
    && useradd --system --uid 10001 --gid 10001 --home-dir /data --no-create-home tangentry \
    && mkdir -p /data && chown tangentry:tangentry /data \
    && printf -- '--js-runtimes node\n' > /etc/yt-dlp.conf
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=ytdlp /usr/local/bin/yt-dlp /usr/local/bin/yt-dlp
COPY --from=server /out/tangentry-server /usr/local/bin/tangentry-server
ENV TANGENTRY_ADDR=:7380 \
    TANGENTRY_DATA=/data
LABEL org.opencontainers.image.title="Tangentry" \
      org.opencontainers.image.description="Local-first multi-platform content reader" \
      org.opencontainers.image.version="$VERSION" \
      org.opencontainers.image.source="https://github.com/mu-zi-lee/Tangentry"
USER tangentry
VOLUME /data
EXPOSE 7380
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD ["tangentry-server", "-health"]
ENTRYPOINT ["tangentry-server"]
