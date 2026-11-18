# The Muster match server, with the built game served from the same port.
#   docker build -t muster . && docker run -p 8787:8787 -v muster-data:/app/server/data muster
FROM node:24-slim
WORKDIR /app
COPY package.json package-lock.json ./
COPY ios/MusterStore ./ios/MusterStore
RUN npm ci --no-audit --no-fund
COPY . .
RUN npx vite build
ENV PORT=8787 TRUST_PROXY=1
EXPOSE 8787
VOLUME /app/server/data
CMD ["npx", "vite-node", "server/main.ts"]
