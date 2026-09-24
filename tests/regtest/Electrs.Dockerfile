FROM rust:1.94-slim-bookworm@sha256:cf9dd0ec73e75f827fe59123fff9dc65af1a1c8363c3c31ee8d7f8ad0b6a5fb2 AS builder
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates clang libclang-dev cmake && rm -rf /var/lib/apt/lists/*
WORKDIR /src
RUN git clone https://github.com/romanz/electrs.git . && git checkout --detach 37501cc4b94aea99e50670a6524fa3ad4ac9aabb
RUN cargo build --release --locked -j 4
FROM node:22-bookworm@sha256:5647be709086c696ff32edaaf1c70cd26d1da6ab2b39c32f3c7b4c4a31957e37
COPY --from=builder /src/target/release/electrs /usr/local/bin/electrs
ENTRYPOINT ["electrs"]
