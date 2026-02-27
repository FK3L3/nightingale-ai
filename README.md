# Nightingale AI

Standalone backend on your Desktop. Message your Telegram bot and get replies from your ElevenLabs Agent.

## 1) Requirements

- Node.js 18+
- Telegram bot token (from BotFather)
- ElevenLabs account with a configured Agent

## 2) Setup

```bash
cd /Users/fk3l3/Desktop/elevenlabs-sms-assistant
cp .env.example .env
npm install
```

Fill `.env`:

- `ELEVENLABS_API_KEY`
- `ELEVENLABS_AGENT_ID`
- `TELEGRAM_BOT_TOKEN`

## 3) Run

```bash
npm run dev
```

Health check:

```bash
curl http://localhost:3000/health
```

## 4) Create Telegram Bot

In Telegram:

1. Open `@BotFather`
2. Run `/newbot`
3. Name your bot and set a username ending in `bot`
4. Copy the bot token into `.env`

## 5) Test

- Open your bot chat in Telegram
- Press `Start`
- Send a message

This server long-polls Telegram updates, sends your text to ElevenLabs, and replies in the same chat.

## Notes

- Per-chat `conversation_id` is kept in memory for continuity; restart resets sessions.
- For production, store sessions in Redis/Postgres.
