# ---- Stage 1: build the React frontend ----
FROM node:20-bookworm-slim AS frontend
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ---- Stage 2: backend runtime ----
FROM node:20-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app

# Install production deps only. better-sqlite3 pulls a prebuilt binary for
# linux x64, so no compiler is needed on this base image.
COPY package*.json ./
RUN npm ci --omit=dev

# App source + the built frontend from stage 1.
COPY . .
COPY --from=frontend /app/frontend/dist ./frontend/dist

# The DB lives on a mounted persistent volume in the cloud (see DEPLOY.md).
# DB_PATH is overridden by the host to point at that volume, e.g. /data/...
ENV DB_PATH=/data/data_logger.db
ENV PORT=8080
EXPOSE 8080

CMD ["node", "server.js"]
