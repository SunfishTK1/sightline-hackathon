# S3-compatible object storage for generated media.
#
# Railway has no managed S3, so this is MinIO, which speaks the same API. The
# point is to get the video bytes out of Postgres: a sixteen-second clip runs
# to nine megabytes, and storing that as `bytea` and shipping it base64 through
# JSON is what forced the 25MB body limit on voice-mcp in the first place.
#
# The upstream entrypoint expects its arguments, so the command is replaced
# rather than appended, and the listen address is taken from PORT so the
# service is reachable at minio.railway.internal on a predictable port.
# Docker Hub no longer serves minio/minio:latest; quay is MinIO's own registry.
# Pinned, so a rebuild cannot silently change the storage layer underneath us.
FROM quay.io/minio/minio:RELEASE.2025-09-07T16-13-09Z

ENV MINIO_BROWSER_REDIRECT=off

ENTRYPOINT []
CMD ["sh", "-c", "minio server /data --address :${PORT:-9000} --console-address :9001"]
