require('dotenv').config();
const express = require('express');
const WebSocket = require('ws');

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const {
  PORT = 3000,
  ELEVENLABS_API_KEY,
  ELEVENLABS_AGENT_ID,
  ELEVENLABS_ORIGINATOR = 'telegram-assistant',
  TELEGRAM_BOT_TOKEN,
  REQUEST_TIMEOUT_MS = '20000'
} = process.env;

if (!ELEVENLABS_API_KEY || !ELEVENLABS_AGENT_ID || !TELEGRAM_BOT_TOKEN) {
  console.error('Missing required environment variables. Copy .env.example to .env and fill required values.');
  process.exit(1);
}

const sessionByChatId = new Map();
const TELEGRAM_API_BASE = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;
let updateOffset = 0;

function makeWebsocketUrl(agentId) {
  return `wss://api.elevenlabs.io/v1/convai/conversation?agent_id=${encodeURIComponent(agentId)}`;
}

function waitForAgentResponse({ chatId, text }) {
  return new Promise((resolve, reject) => {
    const wsUrl = makeWebsocketUrl(ELEVENLABS_AGENT_ID);
    const ws = new WebSocket(wsUrl, {
      headers: {
        'xi-api-key': ELEVENLABS_API_KEY
      }
    });

    let settled = false;
    let timeoutId;
    let responseTimer;
    let finalText = '';
    let userMessageSent = false;

    const done = (fn) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      clearTimeout(responseTimer);
      try {
        ws.close();
      } catch (_) {}
      fn();
    };

    timeoutId = setTimeout(() => {
      done(() => reject(new Error('Timed out waiting for ElevenLabs response')));
    }, Number(REQUEST_TIMEOUT_MS));

    ws.on('open', () => {
      const existingConversationId = sessionByChatId.get(chatId);
      const initPayload = {
        type: 'conversation_initiation_client_data',
        dynamic_variables: {
          channel: 'telegram',
          originator: ELEVENLABS_ORIGINATOR,
          chat_id: chatId
        }
      };

      // Continue same conversation for this Telegram chat when available.
      if (existingConversationId) {
        initPayload.conversation_id = existingConversationId;
      }

      ws.send(JSON.stringify({
        ...initPayload
      }));
    });

    ws.on('message', (data) => {
      let event;
      try {
        event = JSON.parse(data.toString('utf8'));
      } catch (_) {
        return;
      }

      const conversationId =
        event.conversation_initiation_metadata_event?.conversation_id ||
        event.conversation_metadata_event?.conversation_id ||
        event.conversation_id;
      if (conversationId) {
        sessionByChatId.set(chatId, conversationId);
      }

      if (!userMessageSent && (event.type === 'conversation_initiation_metadata' || event.type === 'conversation_metadata')) {
        userMessageSent = true;
        ws.send(JSON.stringify({
          type: 'user_message',
          text
        }));
      }

      if (event.type === 'agent_response') {
        const chunk = event.agent_response_event?.agent_response || event.text || '';
        finalText += chunk;
        clearTimeout(responseTimer);
        responseTimer = setTimeout(() => {
          const output = finalText.trim();
          done(() => resolve(output || 'I am here. Can you rephrase that?'));
        }, 600);
      }

      if (event.type === 'error') {
        done(() => reject(new Error(event.message || 'ElevenLabs returned an error')));
      }
    });

    setTimeout(() => {
      if (!settled && !userMessageSent && ws.readyState === WebSocket.OPEN) {
        userMessageSent = true;
        ws.send(JSON.stringify({
          type: 'user_message',
          text
        }));
      }
    }, 500);

    ws.on('error', (err) => {
      done(() => reject(err));
    });

    ws.on('close', (code, reasonBuffer) => {
      if (!settled) {
        const reason = reasonBuffer ? reasonBuffer.toString('utf8') : '';
        done(() => reject(new Error(`WebSocket closed before final response (code=${code}, reason=${reason || 'n/a'})`)));
      }
    });
  });
}

async function telegramRequest(method, payload) {
  const response = await fetch(`${TELEGRAM_API_BASE}/${method}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`Telegram API HTTP ${response.status}`);
  }

  const data = await response.json();
  if (!data.ok) {
    throw new Error(`Telegram API error: ${data.description || 'unknown error'}`);
  }
  return data.result;
}

async function sendTelegramMessage(chatId, text) {
  return telegramRequest('sendMessage', {
    chat_id: chatId,
    text
  });
}

async function processTelegramUpdate(update) {
  const message = update.message;
  if (!message || !message.chat || !message.chat.id) {
    return;
  }

  const chatId = String(message.chat.id);
  const text = (message.text || '').trim();
  if (!text) {
    return;
  }

  try {
    const reply = await waitForAgentResponse({ chatId, text });
    await sendTelegramMessage(chatId, reply);
  } catch (error) {
    console.error('Telegram handling error:', error.message);
    await sendTelegramMessage(chatId, 'Sorry, I hit an issue processing that. Please try again in a moment.');
  }
}

async function pollTelegram() {
  while (true) {
    try {
      const updates = await telegramRequest('getUpdates', {
        timeout: 30,
        offset: updateOffset
      });

      for (const update of updates) {
        updateOffset = update.update_id + 1;
        await processTelegramUpdate(update);
      }
    } catch (error) {
      console.error('Telegram polling error:', error.message);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Telegram assistant listening on port ${PORT}`);
  pollTelegram().catch((error) => {
    console.error('Fatal polling error:', error.message);
    process.exit(1);
  });
});
