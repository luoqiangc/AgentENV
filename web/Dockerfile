# Build from the repository root: docker build -f web/Dockerfile .
FROM node:22-bookworm-slim AS frontend
WORKDIR /build/web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM golang:1.25.9-bookworm AS gateway
ARG GOPROXY=https://proxy.golang.org,direct
WORKDIR /build/services
COPY services/go.mod services/go.sum ./
RUN go mod download
COPY services/ ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/gateway ./gateway/cmd

FROM alpine:3.23
RUN apk add --no-cache ca-certificates
WORKDIR /app
COPY --from=gateway /out/gateway /app/gateway
COPY --from=frontend /build/web/dist /app/web
EXPOSE 8081
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8081/ || exit 1
ENTRYPOINT ["/app/gateway", "-config", "/etc/agentenv-dashboard/config.json"]
