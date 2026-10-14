# Builder only: exports a native Linux runtime; it never starts Memento or indexes files.
# Pinned linux/amd64 child of swift:6.2-jammy (Ubuntu 22.04 / glibc 2.35).
FROM swift@sha256:9e97670bfa3c0dc94a2006c7cf40ce73c5ce11b86e34a07da2ed522dd81adabb AS builder
ARG DIGUP_REVISION=ca6e877be139997ef259e1a5f84881394c46332c
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates git curl python3 cmake ninja-build patchelf && rm -rf /var/lib/apt/lists/*
WORKDIR /source
RUN git init -q && git remote add origin https://github.com/ARahim3/DigUp.git && git fetch --depth=1 origin "$DIGUP_REVISION" && git checkout --detach FETCH_HEAD && test "$(git rev-parse HEAD)" = "$DIGUP_REVISION"
COPY build-linux.sh /build-linux.sh
RUN bash /build-linux.sh
FROM scratch AS runtime-artifact
COPY --from=builder /bundle/ /
