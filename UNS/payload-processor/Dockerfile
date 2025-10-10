FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./
RUN npm install

# Copy source code and configuration
COPY . .

# Create directories for schemas and configs if they don't exist
RUN mkdir -p config schemas/input schemas/output schemas/enterprise lib docs

# Environment variables for configuration
ENV PROCESSOR_MODE=flexible
ENV CONFIG_PATH=./config/processor-config.json

# Support both legacy and flexible modes
CMD ["sh", "-c", "if [ \"$PROCESSOR_MODE\" = \"legacy\" ]; then node processor.js; else node flexible-processor.js $CONFIG_PATH; fi"]