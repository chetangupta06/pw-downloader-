FROM node:18-bullseye

# Install FFmpeg for remuxing
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

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

# Expose Render default port
EXPOSE 3000

# Start the Node backend
CMD ["node", "backend/server.js"]
