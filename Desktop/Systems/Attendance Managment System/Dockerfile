FROM node:24-alpine

ENV NODE_ENV=production \
    PORT=3000 \
    DB_PATH=/app/data/attendance.db \
    BACKUP_DIR=/app/backups

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server ./server
COPY public ./public
COPY scripts ./scripts

# Data and backups live in volumes so they survive container rebuilds.
RUN mkdir -p /app/data /app/backups && chown -R node:node /app
VOLUME ["/app/data", "/app/backups"]

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "server/index.js"]
