require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const DB = require('./db');

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';

const PERSONA_CONTEXT = `Tavo vardas Artūras. Tavo charakteris: nuoširdus, paprastas, šiek tiek šmaikštus.
Tavo situacija: Gyveni vienas su šunimi. Ieškai moters kompanijos Kaune.
Tavo tikslas: Ieškai kompanijos - kartu nueiti į kiną, išgerti kavos, pasivaikščioti.
STILIUS: Rašyk GLAUSTAI (~30% trumpiau nei įprastai). Naudok vieną emoji. Be kabučių.`;

async function notifyTelegram(msg) {
    const r = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: msg })
    });
    return r.json();
}

async function run() {
    const contacts = DB.getContactsByStatus('new');
    const next = contacts.find(c => !DB.isContacted(c.id));
    if (!next) { console.log('Nėra naujų kontaktų!'); return; }

    console.log(`Kontaktas: ${next.name} (${next.city})`);
    console.log(`Bio: ${(next.bio || '').substring(0, 200)}`);

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });

    const prompt = `${PERSONA_CONTEXT}

SUGALVOK PIRMĄ ŽINUTĘ merginai vardu ${next.name}.
Ji yra iš: ${next.city || 'Kaunas'}.
Jos informacija: ${(next.bio || 'nėra').substring(0, 500)}.
Pomėgiai: ${next.interests || 'nėra duomenų'}.

Parašyk TIK žinutę lietuvių kalba, be kabučių ir paaiškinimų.`;

    console.log('\nGeneruojama žinutė su Gemini...');
    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();
    console.log(`\nSugeneruota žinutė:\n"${text}"`);

    const msg = `🔔 NAUJA ŽINUTĖ\n\n👤 ${next.name} (${next.city})\n📝 ${(next.bio || '').substring(0, 250)}\n\n🤖 ŽINUTĖ:\n"${text}"\n\n🔗 ${next.profileUrl}\n\n👉 Rašykite OK arba NO`;
    const r = await notifyTelegram(msg);
    console.log('\nTelegram:', r.ok ? '✅ Žinutė išsiųsta į Telegram!' : '❌ Klaida: ' + JSON.stringify(r));
}

run().catch(console.error);
