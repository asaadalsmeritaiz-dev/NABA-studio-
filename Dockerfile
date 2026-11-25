FROM oven/bun:1.4.5@sha256:3aa040e5445efa09d75bb428a64ba50db13e2b3ac9b6b0c7f145615f62b2ee18 AS build

WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun run build

FROM node:24-bookworm-slim@sha256:32e57b5784e8875d2cc0112dcaf13f9100f2d0d9446187808738e99aee29a5a2

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    g++ \
    fonts-noto-core \
    fonts-dejavu-core \
    fontconfig \
    && fc-cache -f \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=build /app /app

ENV NODE_ENV=production
ENV PORT=3000
ENV DATABASE_PATH=/app/data/naba_studio.sqlite
ENV STORAGE_DIR=/app/storage

EXPOSE 3000

CMD ["./node_modules/.bin/tsx", "server.ts"]
