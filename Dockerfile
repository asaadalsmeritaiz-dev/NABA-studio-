FROM node:22-bookworm-slim

# Install FFmpeg (with libass/libfribidi/libx264), g++ for deterministic C++ syntax checks, and Noto Arabic fonts
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    g++ \
    fonts-noto-core \
    fonts-dejavu-core \
    fontconfig \
    && fc-cache -f -v \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci || npm install

COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV PORT=3000
ENV DATABASE_PATH=/app/data/naba_studio.sqlite
ENV STORAGE_DIR=/app/storage

EXPOSE 3000

CMD ["npx", "tsx", "server.ts"]
