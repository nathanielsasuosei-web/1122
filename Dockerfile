# Bassline Studio — production image.
# The SQLite database and uploaded audio/video live in a volume mounted at /data,
# so redeploys never wipe the catalogue or the orders.
FROM node:22-alpine

ENV NODE_ENV=production \
    STUDIO_STORAGE_DIR=/data \
    UPLOAD_DIR=/data/uploads \
    PORT=3000

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY . .

RUN apk add --no-cache su-exec \
 && mkdir -p /data/uploads \
 && chown -R node:node /data

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "server.js"]
