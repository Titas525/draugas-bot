# Draugas.lt Bot 🤖

Automated bot for the [Draugas.lt](https://pazintys.draugas.lt) dating platform, powered by **Google Gemini AI** and **Playwright**.

## Features

- 🔍 **Profile Search** – Scans multiple search pages for compatible profiles (Kaunas, ages 39–49)
- 💬 **AI-powered Messaging** – Generates personalized first messages and follow-ups using Gemini
- ✅ **Telegram Approval** – Sends each message to Telegram for user approval before sending
- 📊 **Live Dashboard** – Real-time activity monitoring via a local web dashboard
- 🗄️ **SQLite Database** – Tracks all contacts and message history to avoid duplicates
- 🔁 **Continuous Loop** – Runs automatically every 35 minutes

## Tech Stack

- [Playwright](https://playwright.dev/) – Browser automation
- [Google Gemini AI](https://ai.google.dev/) – Message generation
- [Telegram Bot API](https://core.telegram.org/bots/api) – Notifications & approval
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) – Local database
- [Express](https://expressjs.com/) – Dashboard API server

## Setup

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   npx playwright install chromium
   ```
3. Create a `.env` file based on `.env.example`:
   ```env
   GEMINI_API_KEY=your_gemini_api_key
   DRAUGAS_EMAIL=your_email
   DRAUGAS_PASS=your_password
   TELEGRAM_TOKEN=your_bot_token
   TELEGRAM_CHAT_ID=your_chat_id
   GEMINI_MODEL=gemini-3-flash-preview
   ```
4. Run the bot:
   ```bash
   node index.js
   ```
5. (Optional) Start the dashboard server:
   ```bash
   node server.js
   ```
   Then open `dashboard/index.html` in your browser.

## How It Works

1. **Login** – The bot logs into Draugas.lt using saved cookies or credentials
2. **Check Replies** – Scans inbox for new replies and generates AI responses
3. **Search New Contacts** – Browses search results and sends first messages to new profiles
4. **Play Game** – Likes matching profiles on the "game" page
5. **Wait & Repeat** – Sleeps for 35 minutes then starts again

## Dashboard

The dashboard polls `http://localhost:3001/api/status` every 2 seconds and displays:
- Bot online/offline status
- Session statistics (profiles visited, messages sent, approvals, crashes)
- Live activity log

## ⚠️ Disclaimer

This bot is for educational purposes only. Use responsibly and in accordance with the platform's terms of service.
