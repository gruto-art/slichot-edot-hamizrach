# סליחות עדות המזרח — תמונת ריצה עם ffmpeg + yt-dlp למעקב החי מהכותל
FROM node:24-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg python3 ca-certificates curl tzdata \
    && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev
COPY . .

ENV NODE_ENV=production PORT=10000 DATA_DIR=/var/data TZ=Asia/Jerusalem
EXPOSE 10000

# הדף נבנה בעלייה ולא בבניית התמונה: GA_MEASUREMENT_ID ו-GOOGLE_SITE_VERIFICATION
# הם משתני סביבה של השירות, ואינם קיימים בזמן docker build. הבנייה אורכת פחות משנייה.
CMD ["sh", "-c", "npm run build && node server/index.js"]
