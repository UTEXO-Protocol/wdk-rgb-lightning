FROM rust:1.94-slim-bookworm@sha256:cf9dd0ec73e75f827fe59123fff9dc65af1a1c8363c3c31ee8d7f8ad0b6a5fb2 AS builder
RUN apt-get update && apt-get install -y --no-install-recommends pkg-config libssl-dev ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY . .
RUN cargo build --release --locked --bin rgb-lightning-node -j 4
FROM node:22-bookworm@sha256:5647be709086c696ff32edaaf1c70cd26d1da6ab2b39c32f3c7b4c4a31957e37
LABEL org.opencontainers.image.revision=af03c7f1a65135a429f05a5820600338215954dc
COPY --from=builder /src/target/release/rgb-lightning-node /usr/local/bin/rgb-lightning-node
RUN mkdir /data && chown node:node /data
USER node
ENTRYPOINT ["rgb-lightning-node"]
