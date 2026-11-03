ARG GO_VERSION=1.24.13

FROM golang:${GO_VERSION}-bookworm AS build
ARG MINIO_VERSION=RELEASE.2025-10-15T17-29-55Z
ARG MC_VERSION=RELEASE.2025-08-13T08-35-41Z
ENV CGO_ENABLED=0
ENV GOTOOLCHAIN=local
RUN go install github.com/minio/minio@${MINIO_VERSION} \
  && go install github.com/minio/mc@${MC_VERSION}

FROM alpine:3.22 AS server
RUN apk add --no-cache ca-certificates \
  && addgroup -S -g 10001 minio \
  && adduser -S -D -H -u 10001 -G minio minio \
  && mkdir -p /data \
  && chown minio:minio /data
COPY --from=build /go/bin/minio /usr/bin/minio
USER 10001:10001
VOLUME ["/data"]
ENTRYPOINT ["/usr/bin/minio"]
CMD ["server", "/data", "--console-address", ":9001"]

FROM alpine:3.22 AS mc
RUN apk add --no-cache ca-certificates
COPY --from=build /go/bin/mc /usr/bin/mc
ENTRYPOINT ["/usr/bin/mc"]
