FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts

# Default: Render web service mode
CMD ["npx", "tsx", "scripts/render-server.ts"]
