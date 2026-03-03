require('dotenv').config();

async function testTelegram() {
    const token = process.env.TELEGRAM_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;

    console.log(`Testing Telegram with Token: ${token.substring(0, 10)}... and ChatID: ${chatId}`);

    const message = `[2026-03-03 08:15] Draugas.lt: 👤 ****** (40 m., Kaunas)
[2026-03-03 08:15] Draugas.lt: 🔔 NAUJA ŽINUTĖ (Laukia patvirtinimo)

👤 GAVĖJA: ****** (40 m., Kaunas)
📝 Apie ją: Pagrindinė info
Amžius: 40 m.
Miestas: Kaunas
Vaikai: du
Domina: susipažinusi su tinkamu žmogumi, sutikčiau susitikti
Išvaizda
Ūgis: 175 - 179 cm
Sudėjimas: vidutinis
Akys: mėlynos
Plaukai: tamsiai rudi
Gimtadienis
Gimtadienis: spalio 22 d.
Zodiakas: svarstyklės
Asmenybė pagal žvaigždes
Žalingi įpro...

💬 PASKUTINĖS ŽINUTĖS:
🟢 Artūras: Sveika. Atrodai moteris, kuri moka rasti balansą, o tavo mėlynos akys Kauno gatvėse tikrai nelieka nepastebėtos. Galbūt tavo planuose atsirastų laiko puodeliui kavos ir paprastam, nuoširdžiam pokalbiui? ☕✨

🤖 SUGENERUOTAS ATSAKYMAS:
"Džiugu. Pasakok, kas tave džiugina po darbų? Esi labiau už aktyvų judesį mieste, ar tuos jaukius vakarus su geru serialu? 🎬🐕"

🔗 Profilis: https://pazintys.draugas.lt/narys.cfm?narys=7492899
👉 Rašykite "OK" siuntimui arba "NO" atšaukimui.
[2026-03-03 08:30] Draugas.lt: ⏰ Baigėsi laukimo laikas (15 min). Praleidžiama.`;

    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                text: message
            })
        });
        const data = await response.json();
        if (data.ok) {
            console.log('✅ Telegram pranešimas (su spec. struktūra) išsiųstas sėkmingai!');
        } else {
            console.error('❌ Telegram klaida:', data);
        }
    } catch (err) {
        console.error('❌ Kritinė Telegram klaida:', err);
    }
}

testTelegram();
