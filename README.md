# 🎤 SpeakApp

Conference Q&A with WebRTC audio streaming. Deploy to Render in 2 minutes.

## Deploy to Render

### Step 1: Push to GitHub
```bash
git init
git add .
git commit -m "SpeakApp"
git remote add origin https://github.com/YOUR_USERNAME/speakapp.git
git push -u origin main
```

### Step 2: Deploy on Render
1. Go to [render.com](https://render.com) → New → Web Service
2. Connect your GitHub repo
3. Settings:
   - **Build Command:** `npm install && npm run build`
   - **Start Command:** `npm start`
4. Click **Deploy**
5. Wait 2-3 minutes → your app is live!

### Login
```
admin@speakapp.io / admin123
```

## Local Development
```bash
npm install
npm run build
npm start
# Open http://localhost:3001
```

## How It Works
- Host creates event → gets QR code + room code
- Attendees scan QR → join queue → speak via WebRTC
- Audio streams P2P from phone to host speakers
