FROM node:20-bullseye

# Install FFmpeg for remuxing
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

# Set working directory and use the built-in 'node' user (UID 1000)
WORKDIR /app
RUN chown -R node:node /app

# Install backend dependencies
COPY backend/package*.json ./backend/
RUN cd backend && npm install --omit=dev

# Install frontend dependencies
COPY frontend/package*.json ./frontend/
RUN cd frontend && npm install

# Copy all source files
COPY backend/ ./backend/
COPY frontend/ ./frontend/

# Build the React frontend
RUN cd frontend && npm run build

# Hugging Face Spaces expects port 7860
EXPOSE 7860
ENV PORT=7860

# Switch to non-root user
USER node

# Start the Node backend
CMD ["node", "backend/server.js"]
