require('dotenv').config();
const { GoogleGenerativeAI } = require("@google/generative-ai");

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

if (!GEMINI_API_KEY || !TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) {
    console.error('KLAIDA: Trūksta aplinkos kintamųjų (.env)!');
    process.exit(1);
}

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });

async function notifyTelegram(message) {
    const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: message })
    });
    return response.ok;
}

async function sendTelegramPhoto(photoUrl, caption) {
    const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendPhoto`;
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            chat_id: TELEGRAM_CHAT_ID,
            photo: photoUrl,
            caption: caption ? caption.substring(0, 1024) : ''
        })
    });
    return response.ok;
}

async function runTest() {
    console.log('--- TESTINIS TELEGRAM PRANEŠIMAS ---');

    const profile = {
        name: 'Deimantė',
        fullText: 'Deimantė (50 m., Kaunas)',
        city: 'Kaunas',
        bio: 'Esu pozityvi, mėgstu gamtą, ilgus pasivaikščiojimus ir gerą kiną. Ieškau žmogaus, su kuriuo būtų gera tiesiog patylėti arba diskutuoti valandų valandas.',
        interests: 'Kinas, Gamta, Kelionės, Klasikinė muzika',
        photoUrl: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?q=80&w=1000&auto=format&fit=crop'
    };

    const dbMessages = [
        { direction: 'received', content: 'Labas, Artūrai. Mačiau tavo nuotraukas su šunimi, labai mielas. 🐕' },
        { direction: 'sent', content: 'Labas, Deimante! Taip, jis mano ištikimiausias kompanionas. O tu labiau žmogus-šuo ar žmogus-katė? 😊' },
        { direction: 'received', content: 'Tikrai labiau šuo! Nors ir katės fains, bet ištikimybė man svarbiausia.' }
    ];

    const prompt = `Tavo vardas Artūras. Tavo charakteris: nuoširdus, paprastas, šiek tiek šmaikštus.
Gyveni vienas su šunimi. Ieškai kompanijos Kaune.

ANALIZUOK SUSIRAŠINĖJIMĄ su ${profile.fullText} ir PARAŠYK ATSAKYMĄ.
Istorija:
${dbMessages.map(m => `${m.direction === 'sent' ? 'Artūras' : profile.name}: ${m.content}`).join('\n')}

Tikslas: Kadangi jau aptarėt šunis, pasiūlyk kurį vakarą pasivaikščioti Kaune (pvz. Pažaislyje ar prie Nemuno) kartu su šunim.

Parašyk TIK žinutę lietuvių kalba, be kabučių ir paaiškinimų.`;

    console.log('Generuojama žinutė...');
    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();

    console.log('Siunčiama nuotrauka...');
    await sendTelegramPhoto(profile.photoUrl, `👤 ${profile.fullText}`);

    let contextMsg = `🔔 TESTINIS PRANEŠIMAS (Pavyzdinis)\n\n`;
    contextMsg += `👤 GAVĖJA: ${profile.fullText}\n`;
    contextMsg += `📝 Apie ją: ${profile.bio}\n`;
    contextMsg += `🎯 Pomėgiai: ${profile.interests}\n\n`;

    contextMsg += `💬 PASKUTINĖS ŽINUTĖS:\n`;
    contextMsg += dbMessages.map(m => {
        const who = m.direction === 'sent' ? '🟢 Artūras' : '🔵 ' + profile.name;
        return `${who}: ${m.content}`;
    }).join('\n');

    contextMsg += `\n\n🤖 SUGENERUOTAS ATSAKYMAS:\n"${text}"\n\n`;
    contextMsg += `👉 Tai yra TESTAS parodantis, kaip atrodys tikros žinutės.`;

    console.log('Siunčiamas tekstas...');
    const ok = await notifyTelegram(contextMsg);

    if (ok) {
        console.log('✅ Testas sėkmingai išsiųstas į Telegram!');
    } else {
        console.log('❌ Klaida siunčiant į Telegram.');
    }
}

runTest();
