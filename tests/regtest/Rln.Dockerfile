# syntax=docker/dockerfile:1
FROM rust:1.94-slim-bookworm@sha256:cf9dd0ec73e75f827fe59123fff9dc65af1a1c8363c3c31ee8d7f8ad0b6a5fb2 AS builder
RUN apt-get update && apt-get install -y --no-install-recommends git pkg-config libssl-dev ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY . .
RUN --mount=type=secret,id=org_read_token,required=true \
    CARGO_NET_GIT_FETCH_WITH_CLI=true \
    GIT_CONFIG_COUNT=3 \
    GIT_CONFIG_KEY_0=credential.helper GIT_CONFIG_VALUE_0= \
    GIT_CONFIG_KEY_1=credential.helper GIT_CONFIG_VALUE_1='!sh /src/source-credential.sh' \
    GIT_CONFIG_KEY_2=credential.useHttpPath GIT_CONFIG_VALUE_2=true \
    cargo build --release --locked --bin rgb-lightning-node -j 4
FROM node:22-bookworm@sha256:5647be709086c696ff32edaaf1c70cd26d1da6ab2b39c32f3c7b4c4a31957e37
LABEL org.opencontainers.image.revision=e2b39d5ae8da74525eafb58bc39b9a614c756a73
COPY --from=builder /src/target/release/rgb-lightning-node /usr/local/bin/rgb-lightning-node
RUN mkdir /data && chown node:node /data
USER node
ENTRYPOINT ["rgb-lightning-node"]
