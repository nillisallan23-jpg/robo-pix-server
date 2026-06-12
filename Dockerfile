FROM node:18-bookworm-slim

# Instala o tini + dependências do Puppeteer
RUN apt-get update && apt-get install -y --no-install-recommends \
    tini \
    ca-certificates fonts-liberation gconf-service libappindicator1 libasound2 \
    libatk1.0-0 libatomic1 libc6 libcairo2 libcups2 libdbus-1-3 libexpat1 \
    libfontconfig1 libgbm1 libgcc1 libgconf-2-4 libgdk-pixbuf2.0-0 libglib2.0-0 \
    libgtk-3-0 libnspr4 libnss3 libpango-1.0-0 libpangocairo-1.0-0 libstdc++6 \
    libx11-6 libx11-xcb1 libxcb1 libxcomposite1 libxcursor1 libxdamage1 libxext6 \
    libxfixes3 libxi6 libxrandr2 libxrender1 libxss1 libxtst6 lsb-release wget \
    xdg-utils xvfb && apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

# Usar o Tini como entrypoint garante que nenhum processo do Chromium trave o container
ENTRYPOINT ["/usr/bin/tini", "--"]

CMD ["node", "dist/rpaWorker.js"]