FROM node:22-bookworm@sha256:5647be709086c696ff32edaaf1c70cd26d1da6ab2b39c32f3c7b4c4a31957e37
ARG TARGETARCH
RUN case "$TARGETARCH" in \
      arm64) arch=aarch64; sum=dcf1873f2208ba4f962f3398d47e154c39c0084be8f4553e05c940d0ace3d004 ;; \
      amd64) arch=x86_64; sum=b80d9c3e04da78fb6f0569685673418cf686fadba9042d926d13fb87ff503f9e ;; \
      *) exit 1 ;; \
    esac && \
    curl --fail --location --retry 3 "https://bitcoincore.org/bin/bitcoin-core-31.1/bitcoin-31.1-$arch-linux-gnu.tar.gz" -o /tmp/bitcoin.tar.gz && \
    echo "$sum  /tmp/bitcoin.tar.gz" | sha256sum --check && \
    tar -xzf /tmp/bitcoin.tar.gz -C /tmp && \
    install /tmp/bitcoin-31.1/bin/bitcoind /tmp/bitcoin-31.1/bin/bitcoin-cli /usr/local/bin/ && \
    rm -rf /tmp/bitcoin.tar.gz /tmp/bitcoin-31.1 && \
    mkdir /data && chown node:node /data
USER node
ENTRYPOINT ["bitcoind"]
