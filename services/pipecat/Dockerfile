# services/pipecat/Dockerfile — v66 Phase 16
FROM python:3.11-slim

WORKDIR /app

# Install system dependencies for audio processing
RUN apt-get update && apt-get install -y \
    ffmpeg \
    portaudio19-dev \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the service code
COPY . .

# Expose the Pipecat HTTP/WebSocket port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD python -c "import httpx; r = httpx.get('http://localhost:8080/health'); exit(0 if r.status_code == 200 else 1)"

# Start the Pipecat service
CMD ["python", "main.py"]
