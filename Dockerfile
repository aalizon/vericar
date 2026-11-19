# ==============================================================================
# Stage 1 — Build React/Vite production bundle
# ==============================================================================
FROM node:24-slim AS client-builder

WORKDIR /app/client
COPY client/package.json client/package-lock.json ./
RUN npm ci

COPY client/ ./
RUN npm run build

# ==============================================================================
# Stage 2 — Production Express + Node 24 native SQLite runtime
# ==============================================================================
FROM node:24-slim AS runtime

ENV NODE_ENV=production \
    PORT=3001 \
    DATA_DIR=/app/data \
    TRUST_PROXY=1

WORKDIR /app

COPY server/package.json server/package-lock.json ./server/
RUN npm --prefix server ci --omit=dev && npm cache clean --force

COPY server/src ./server/src
COPY --from=client-builder /app/client/dist ./client/dist

RUN mkdir -p /app/data && chown -R node:node /app

USER node

EXPOSE 3001
VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "const port = process.env.PORT || 3001; fetch('http://127.0.0.1:' + port + '/api/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1));"

CMD ["node", "server/src/index.js"]
