# Usa uma imagem base oficial do Node
FROM node:18-bookworm-slim

# Instala as dependências do Puppeteer
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates fonts-liberation gconf-service libappindicator1 libasound2 \
    libatk1.0-0 libatomic1 libc6 libcairo2 libcups2 libdbus-1-3 libexpat1 \
    libfontconfig1 libgbm1 libgcc1 libgconf-2-4 libgdk-pixbuf2.0-0 libglib2.0-0 \
    libgtk-3-0 libnspr4 libnss3 libpango-1.0-0 libpangocairo-1.0-0 libstdc++6 \
    libx11-6 libx11-xcb1 libxcb1 libxcomposite1 libxcursor1 libxdamage1 libxext6 \
    libxfixes3 libxi6 libxrandr2 libxrender1 libxss1 libxtst6 lsb-release wget \
    xdg-utils xvfb && apt-get clean && rm -rf /var/lib/apt/lists/*

# Define o diretório de trabalho
WORKDIR /app

# Copia os arquivos de dependência
COPY package*.json ./

# Instala as dependências do Node
RUN npm ci

# Copia o restante do código
COPY . .

# Comando para iniciar (ajuste se o caminho do seu arquivo js for diferente)
CMD ["node", "dist/rpaWorker.js"]