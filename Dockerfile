FROM node:20-bullseye

# Install FFmpeg for remuxing (needs root)
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

# Set working directory and change owner of the root folder before switching user
WORKDIR /app
RUN chown node:node /app

# Switch to non-root user early so all npm installs are naturally owned by node
USER node

# Install backend dependencies
COPY --chown=node:node backend/package*.json ./backend/
RUN cd backend && npm install --omit=dev

# Install frontend dependencies
COPY --chown=node:node frontend/package*.json ./frontend/
RUN cd frontend && npm install

# Copy all source files
COPY --chown=node:node backend/ ./backend/
COPY --chown=node:node frontend/ ./frontend/

# Build the React frontend
RUN cd frontend && npm run build

# Hugging Face Spaces expects port 7860
EXPOSE 7860
ENV PORT=7860

# Start the Node backend
CMD ["node", "backend/server.js"]
