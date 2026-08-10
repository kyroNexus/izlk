FROM node:20-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates poppler-utils tesseract-ocr tesseract-ocr-rus \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

COPY --chown=node:node . .
RUN npx prisma generate && npm run build

RUN mkdir -p /app/storage /app/inbox /app/.next/cache/images \
    && touch /app/.inbox-watcher.json \
    && chown -R node:node /app/storage /app/inbox /app/.inbox-watcher.json /app/.next/cache

USER node
EXPOSE 3000

CMD ["npm", "run", "start"]
