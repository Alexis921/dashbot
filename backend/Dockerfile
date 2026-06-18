FROM python:3.11-slim

WORKDIR /app

# Dependencias del sistema para Playwright + Chromium
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc libpq-dev \
    # Chromium dependencies
    libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 \
    libdrm2 libdbus-1-3 libxkbcommon0 libxcomposite1 libxdamage1 \
    libxfixes3 libxrandr2 libgbm1 libasound2 libpangocairo-1.0-0 \
    libpango-1.0-0 libcairo2 libatspi2.0-0 libgtk-3-0 \
    fonts-liberation wget ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Instalar Playwright con Chromium
RUN pip install --no-cache-dir playwright==1.44.0 && \
    playwright install chromium

COPY . .

EXPOSE 8080

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
