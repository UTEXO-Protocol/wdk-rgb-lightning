FROM node:22-bookworm@sha256:5647be709086c696ff32edaaf1c70cd26d1da6ab2b39c32f3c7b4c4a31957e37
WORKDIR /app
RUN git clone https://github.com/janoside/btc-rpc-explorer.git . && \
    git checkout --detach 8ed77ab225f5507c521b570d5240624de597ad44 && \
    npm ci --omit=dev && rm -rf .git /root/.npm
USER node
CMD ["npm", "start"]
