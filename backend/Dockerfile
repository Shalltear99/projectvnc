# CloudJava VNC — control plane API
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime
# docker CLI + iptables/nsenter are required at runtime: the API shells out to
# `nsenter -t <pid> -n iptables` for egress freezing, and to `nginx -s reload`
# for the upstream map (nginx is a sibling container sharing the socket dir).
RUN apt-get update && apt-get install -y --no-install-recommends \
        dumb-init iptables util-linux ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY agent-daemon.js ./
COPY src/db/schema.sql ./schema.sql

# Non-root. The docker socket is group-writable on the host; the container joins
# that group via the compose `group_add`/socket ownership convention.
RUN useradd -m -u 10001 -s /bin/bash cloudjava \
    && chown -R cloudjava:cloudjava /app
USER 10001

EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:4000/api/admin/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "dist/index.js"]
