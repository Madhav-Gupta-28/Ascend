FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
COPY check-balance.ts ./check-balance.ts
COPY test-commit-revert.ts ./test-commit-revert.ts

CMD ["npm", "run", "run:orchestrator"]
