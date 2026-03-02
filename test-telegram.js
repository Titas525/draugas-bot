require('dotenv').config();

async function testTelegram() {
    const token = process.env.TELEGRAM_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;

    console.log(`Testing Telegram with Token: ${token.substring(0, 10)}... and ChatID: ${chatId}`);

    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                text: '🚀 Draugas.lt Botas sėkmingai prisijungė prie Telegram! Pradedama dirbti...'
            })
        });
        const data = await response.json();
        if (data.ok) {
            console.log('✅ Telegram pranešimas išsiųstas sėkmingai!');
        } else {
            console.error('❌ Telegram klaida:', data);
        }
    } catch (err) {
        console.error('❌ Kritinė Telegram klaida:', err);
    }
}

testTelegram();
