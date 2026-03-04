require('dotenv').config();
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const DB = require('./db');

// ============================================================================
// GRIEŽTA ŽINUČIŲ SIUNTIMO TAISYKLĖ (PAGAL VARTOTOJO REIKALAVIMĄ):
// Nesiusk zinutes i thread siusk:
// 1. Atsidarome kontakta (Profilio URL, pvz: narys.cfm?narys=...)
// 2. Spaudziame: <div class="button-write-message ...">Rašyti žinutę</div>
// 3. Atsidariuseme lange: <textarea id="ui_text" ...></textarea> irasome zinute
// 4. Spaudziame siusti: <div class="ui-button-sendmessage button ...">Siųsti</div>
// ============================================================================

const USER_EMAIL = process.env.DRAUGAS_EMAIL;
const USER_PASS = process.env.DRAUGAS_PASS;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3-flash-preview';

const COOKIES_PATH = path.join(__dirname, 'cookies.json');
const THREAD_LIST_URL = 'https://pazintys.draugas.lt/zinutes/thread/list';

if (!GEMINI_API_KEY) {
    console.error('KLAIDA: GEMINI_API_KEY nerastas .env faile!');
    process.exit(1);
}

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });

const PERSONA_CONTEXT = `
Tavo vardas Artūras. Tavo charakteris: nuoširdus, paprastas, šiek tiek šmaikštus, nevengiantis atvirumo.
Tavo situacija: Gyveni vienas su šunimi (tai tavo geriausias draugas šiuo metu). 
Tavo tikslas: Ieškai moters kompanijos - kartu nueiti į kiną, išgerti kavos, pažiūrėti serialą ar tiesiog pasivaikščioti/paplepėti.

STILIUS:
- Rašyk GLAUSTAI (apie 30% trumpiau nei įprastai). 
- Naudok subtilius EMOJI (po 1-2 žinutėje), kad suteiktum gyvumo.
- Venk "copy-paste" stiliaus. Skambėk gyvai ir natūraliai.
- Kadangi ji tau atsakė, reaguok į jos atsakymą autentiškai. Skatink dialogą užduodamas lengvą klausimą.
`;

const JUNK_KEYWORDS = ['Pagalba', 'Turite klausimų', 'helpbox', 'Tapk VIP', 'Tapk patvirtintu', 'VIP paštas', 'Tapk nariu', 'reklamos', 'ads_id'];

// --- HELPERS ---
async function notifyTelegram(message, retries = 2) {
    if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) return;
    for (let i = 0; i <= retries; i++) {
        try {
            const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: message })
            });
            if (response.ok) return;
        } catch (err) {
            if (i === retries) console.error('Telegram klaida:', err.message);
            await new Promise(r => setTimeout(r, 2000));
        }
    }
}

async function waitForTelegramApproval(contextInfo) {
    const sentAt = Math.floor(Date.now() / 1000) - 2;
    await notifyTelegram(contextInfo);

    let lastUpdateId = 0;
    try {
        const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/getUpdates?offset=-1&limit=1`);
        const data = await res.json();
        if (data.ok && data.result.length > 0) lastUpdateId = data.result[0].update_id;
    } catch (e) { }

    console.log(`[REPLIES] Laukiama Telegram patvirtinimo...`);
    const startTime = Date.now();
    const timeout = 24 * 60 * 60 * 1000; // 24 hours

    while (Date.now() - startTime < timeout) {
        try {
            const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/getUpdates?offset=${lastUpdateId + 1}&timeout=30&limit=10`);
            const data = await res.json();
            if (data.ok && data.result.length > 0) {
                for (const update of data.result) {
                    lastUpdateId = update.update_id;
                    const msg = update.message;
                    if (!msg || !msg.text || msg.date < sentAt) continue;
                    if (msg.chat.id.toString() !== TELEGRAM_CHAT_ID.toString()) continue;

                    const text = msg.text.trim().toUpperCase();
                    if (text === 'OK') return true;
                    if (text === 'NO' || text === 'STOP' || text === 'NE') return false;
                }
            }
        } catch (e) {
            await new Promise(r => setTimeout(r, 3000));
        }
    }
    return false;
}

async function gotoWithRetry(page, url, retries = 3) {
    for (let i = 0; i <= retries; i++) {
        try {
            console.log(`Navigacija į ${url}...`);
            return await page.goto(url, { timeout: 60000, waitUntil: 'domcontentloaded' });
        } catch (err) {
            if (i === retries) throw err;
            await page.waitForTimeout(5000);
        }
    }
}

async function closeHelpBox(page) {
    try {
        const helpClose = page.locator('.helpbox-close, a[title="Uždaryti"]').first();
        if (await helpClose.count() > 0 && await helpClose.isVisible()) await helpClose.click();
    } catch (e) { }
}

async function handleConsent(page) {
    try {
        const consentSelectors = ['button:has-text("SUTINKU")', 'button:has-text("Sutinkame")'];
        for (const sel of consentSelectors) {
            const btn = page.locator(sel).first();
            if (await btn.count() > 0 && await btn.isVisible()) {
                await btn.click({ force: true, timeout: 3000 }).catch(() => { });
                await page.waitForTimeout(1000);
            }
        }
    } catch (e) { }
}

// --- MAIN AI LOGIC ---
async function generateReply(profile, history) {
    let prompt = `${PERSONA_CONTEXT}\n\n`;

    const historyText = history.map(m => {
        const who = m.direction === 'sent' ? 'Artūras' : profile.name;
        return `[${who}]: ${m.text || m.content}`;
    }).join('\n');

    prompt += `POKALBIO ISTORIJA su ${profile.name} (iš Kauno):\n`;
    prompt += `-------------------\n${historyText}\n-------------------\n\n`;
    prompt += `Sugeneruok natūralų, trumpą atsakymą (Artūro vardu) į paskutinę ${profile.name} žinutę.`;

    try {
        const result = await model.generateContent(prompt);
        return result.response.text().trim();
    } catch (err) {
        console.error('AI generavimo klaida:', err.message);
        return null;
    }
}

// --- MAIN LOOP ---
async function checkReplies() {
    console.log('=== ATRAŠYMO CIKLAS STARTUOJA ===');

    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext();
    if (fs.existsSync(COOKIES_PATH)) {
        const cookies = JSON.parse(fs.readFileSync(COOKIES_PATH, 'utf-8'));
        await context.addCookies(cookies);
    }

    const page = await context.newPage();

    try {
        // 1. Nueiti į gautuosius
        await gotoWithRetry(page, THREAD_LIST_URL);
        await handleConsent(page);
        await closeHelpBox(page);

        // Patikrinam ar reikia prisijungti
        if (page.url().includes('login') || (await page.locator('input[name="email"]').count() > 0)) {
            console.log('Reikia prisijungti iš naujo...');
            await page.fill('input[name="email"]', USER_EMAIL);
            await page.fill('input[name="password"]', USER_PASS);
            await page.click('button[type="submit"], input[type="submit"]');
            await page.waitForTimeout(4000);
            fs.writeFileSync(COOKIES_PATH, JSON.stringify(await context.cookies()));
            await gotoWithRetry(page, THREAD_LIST_URL);
        }

        // Atsisiunčiam sąrašą naujausių threadų
        const threads = await page.evaluate(() => {
            const items = Array.from(document.querySelectorAll('.thread, .message-list-item, .chat-row, .list-item, tr.message'));
            return items.map(el => {
                const linkEl = el.querySelector('a');
                const href = linkEl ? linkEl.href : null;
                let isUnread = el.className.includes('unread') || el.className.includes('new-message');
                const snippet = el.innerText.toLowerCase();

                // Ištraukti narys id iš profilio linko, jei yra šalia
                const profileLink = Array.from(el.querySelectorAll('a')).find(a => a.href.includes('narys='));
                let narysId = null;
                if (profileLink) {
                    const match = profileLink.href.match(/narys=(\d+)/);
                    if (match) narysId = match[1];
                }

                // Bandome nuspėti kryptį iš piktogramų
                const isReplied = snippet.includes('atsakė') || !el.innerHTML.includes('icon-reply');

                return { href, isUnread, isReplied, narysId };
            }).filter(t => t.href);
        });

        console.log(`[REPLIES] Rasta ${threads.length} pokalbių gautuosiuose.`);

        for (const thread of threads) {
            if (!thread.narysId) continue;

            const profileUrl = `https://pazintys.draugas.lt/narys.cfm?narys=${thread.narysId}`;
            const contact = DB.findContactByUrl(profileUrl);

            if (!contact) {
                console.log(`[REPLIES] Kontaktas ${thread.narysId} nerastas DB. Praleidžiama.`);
                continue;
            }

            console.log(`[REPLIES] Tikrinamas profilis: ${contact.name}`);

            // 2. TIKRINAM ISTORIJĄ PER PROFILIO POPUP (Kaip reikalaujama)
            await gotoWithRetry(page, profileUrl);
            await page.waitForTimeout(3000);
            await closeHelpBox(page);

            const writeBtn = page.locator('.button-write-message, .button-new-message, .__callNewMessage').first();
            if (await writeBtn.count() === 0 || !(await writeBtn.isVisible())) {
                console.log(`[REPLIES] ${contact.name} profilyje nerastas "Rašyti žinutę" mygtukas.`);
                continue;
            }

            await writeBtn.click();
            await page.waitForTimeout(2000);

            // Skaitom istoriją iš popupo
            const history = await page.evaluate((junkList) => {
                const isJunk = (txt) => junkList.some(j => txt.includes(j));
                const msgs = Array.from(document.querySelectorAll('.message, .msg, .chat-item, .thread-message, .message-bubble'));

                if (msgs.length === 0) {
                    const fallbackMsgs = Array.from(document.querySelectorAll('.message-text, .msg-content, .text-content'));
                    return fallbackMsgs.map(m => {
                        const txt = m.innerText.trim();
                        if (!txt || isJunk(txt)) return null;
                        const isSent = m.className.includes('sent') || m.innerHTML.includes('Artūras') || m.innerHTML.includes('Arturas');
                        return { text: txt, direction: isSent ? 'sent' : 'received' };
                    }).filter(Boolean);
                }

                return msgs.map(el => {
                    const txt = el.innerText.trim();
                    if (!txt || isJunk(txt)) return null;
                    const isSent = el.className.includes('sent') || el.className.includes('my-message')
                        || el.innerHTML.includes('Artūras') || el.innerHTML.includes('Arturas');
                    return { text: txt, direction: isSent ? 'sent' : 'received' };
                }).filter(Boolean);
            }, JUNK_KEYWORDS);

            if (history.length === 0) {
                console.log(`[REPLIES] ${contact.name} pop-up lange nematyti istorijos.`);
                await page.keyboard.press('Escape');
                continue;
            }

            // 3. Patikrinam ar paskutinė žinutė gauta iš jos
            const lastMsg = history[history.length - 1];
            if (lastMsg.direction === 'sent') {
                console.log(`[REPLIES] Paskutinė žinutė kontaktui ${contact.name} buvo mūsų išsiųsta. Nereikia atrašyti.`);
                await page.keyboard.press('Escape');
                continue;
            }

            // Vadinasi, TAI YRA ATSAKYMAS
            console.log(`[REPLIES] NAUJAS ATSAKYMAS nuo ${contact.name}: "${lastMsg.text}"`);

            // Išsaugom visas gautas DB (Overwrite history)
            DB.deleteConversation(contact.id);
            for (const msg of history) {
                DB.saveMessage(contact.id, msg.direction, msg.text);
            }

            // Uždaryti popupą, kad neapsunkintų AI generavimo metu (nors galim ir palikti atidarytą)
            await page.keyboard.press('Escape');

            // 4. Generuojam atsakymą su AI
            const replyText = await generateReply(contact, history);
            if (!replyText) continue;

            let tgMsg = `💬 NAUJAS ATSAKYMAS NUO ${contact.name}\n\n`;
            tgMsg += `Tiesiog dabar ji parašė:\n"${lastMsg.text}"\n\n`;
            tgMsg += `🤖 SUGENERUOTAS ATSAKYMAS:\n"${replyText}"\n\n`;
            tgMsg += `👉 Rašykite "OK" siuntimui.`;

            const approved = await waitForTelegramApproval(tgMsg);
            if (approved) {
                // Siunčiam (vėl per profilį)
                console.log(`[REPLIES] Siunčiama: ${replyText}`);

                const writeBtnV = page.locator('.button-write-message, .button-new-message, .__callNewMessage').first();
                if (await writeBtnV.count() > 0 && await writeBtnV.isVisible()) {
                    await writeBtnV.click();
                    await page.waitForTimeout(1500);
                }

                const textarea = page.locator('#ui_text, textarea.ui-text, textarea.__smileTarget').first();
                if (await textarea.count() > 0) {
                    await textarea.fill(replyText);
                    await page.waitForTimeout(1000);
                    const sendBtn = page.locator('.ui-button-sendmessage').first();
                    await sendBtn.click();
                    console.log(`[REPLIES] ✅ Išsiųsta (per pop-up) kontaktui ${contact.name}`);

                    DB.saveMessage(contact.id, 'sent', replyText);
                    await notifyTelegram(`✅ Išsiųsta ${contact.name}: ${replyText}`);

                    // Laukiam šiek tiek prieš tikrinant kitą
                    await page.waitForTimeout(5000);
                } else {
                    console.log(`[REPLIES] Klaida: Nerastas tekstinis laukas #ui_text.`);
                }
            } else {
                console.log(`[REPLIES] Siuntimas atšauktas.`);
            }
        }

    } catch (err) {
        console.error('Klaida cikle:', err);
    } finally {
        await browser.close();
        console.log('=== ATRAŠYMO CIKLAS BAIGTAS ===');
    }
}

// Paleisti ciklą kas X minučių
(async () => {
    while (true) {
        await checkReplies();
        const waitMins = 15;
        console.log(`[REPLIES] Laukiama ${waitMins} min...`);
        await new Promise(r => setTimeout(r, waitMins * 60 * 1000));
    }
})();
