# ---- Build stage ----
FROM golang:1.25-alpine AS build
RUN apk add --no-cache build-base git sqlite-dev
WORKDIR /src
COPY go.mod ./
RUN go mod download || true
COPY . .
ENV CGO_ENABLED=1
RUN go mod tidy && go build -tags "sqlite_omit_load_extension" -o /out/bridge .

# ---- Runtime ----
FROM alpine:3.20
RUN apk add --no-cache ca-certificates sqlite-libs tzdata
WORKDIR /app
COPY --from=build /out/bridge /app/bridge
ENV AUTH_DIR=/data/auth
RUN mkdir -p /data/auth
EXPOSE 8080
CMD ["/app/bridge"]