// --- PROCESS DB CONTACTS ---

async function processDatabaseContacts(page) {
    console.log('--- APDOROJAMI DB KONTAKTAI ---');

    const contacts = DB.getContactsByStatus('new');
    console.log(`[DB] Rasta naujų kontaktų: ${contacts.length}`);

    if (contacts.length === 0) {
        console.log('[DB] Nėra naujų kontaktų. Fone turėtų veikti search-contacts.js');
        return;
    }

    for (const c of contacts) {
        if (isBlacklisted(c.name, c.fullText)) {
            logActivity(`Praleidžiamas juodajame sąraše: ${c.name}`, 'warn');
            DB.updateStatus(c.id, 'skipped');
            continue;
        }

        botStatus.stats.profilesVisited++;
        try {
            await gotoWithRetry(page, c.profileUrl);
            await page.waitForTimeout(3000);
            await closeHelpBox(page);

            const profile = await page.evaluate(() => {
                const nameMatch = document.querySelector('h1')?.innerText.trim() || 'Narys';
                const allText = document.body.innerText;

                let city = '';
                const cityMatch = allText.match(/Miestas:\s*([^\n]+)/i) || allText.match(/Vietovė:\s*([^\n]+)/i);
                if (cityMatch) city = cityMatch[1].trim();
                const nm = nameMatch.match(/\(.*?,\s*(\w+)\)/);
                if (!city && nm) city = nm[1];

                let age = '';
                const ageMatch = nameMatch.match(/(\d+)\s*m\./) || allText.match(/Amžius:\s*(\d+)/i);
                if (ageMatch) age = ageMatch[1];

                const name = nameMatch.split(' ')[0] || nameMatch;

                const parseDetail = (regex) => (allText.match(regex) || [])[1]?.trim() || '';
                const vaikai = parseDetail(/Vaikai:\s*([^\n]+)/i);
                const domina = parseDetail(/Domina:\s*([^\n]+)/i);
                const ugis = parseDetail(/Ūgis:\s*([^\n]+)/i);
                const sudejimas = parseDetail(/Sudėjimas:\s*([^\n]+)/i);
                const akys = parseDetail(/Akys:\s*([^\n]+)/i);
                const plaukai = parseDetail(/Plaukai:\s*([^\n]+)/i);
                const gimtadienis = parseDetail(/Gimtadienis:\s*([^\n]+)/i);
                const zodiakas = parseDetail(/Zodiakas:\s*([^\n]+)/i);
                const zalingi = parseDetail(/Žalingi įpročiai:\s*([^\n]+)/i);

                const bio = document.querySelector('.nario-informacija, .profile-info, .about-me')?.innerText.trim() || '';
                const interests = Array.from(document.querySelectorAll('.pomegis, .hobby, .interest')).map(el => el.innerText.trim()).join(', ');

                const photoImg = document.querySelector('.nario-foto img, .profile-photo img, img.user-photo');
                const photoUrl = photoImg ? photoImg.src : '';

                return {
                    name, city, age, bio, interests, photoUrl,
                    vaikai, domina, ugis, sudejimas, akys, plaukai, gimtadienis, zodiakas, zalingi
                };
            });

            logActivity(`Kaunas kontaktas iš DB: ${profile.name} (${profile.city})`, 'info');

            const profileData = {
                name: profile.name,
                fullText: c.fullText || profile.name,
                city: profile.city || c.city || 'Kaunas',
                age: profile.age,
                bio: profile.bio || c.bio,
                interests: profile.interests || c.interests,
                photoUrl: profile.photoUrl || c.photoUrl,
                profileUrl: c.profileUrl,
                source: c.source,
                vaikai: profile.vaikai,
                domina: profile.domina,
                ugis: profile.ugis,
                sudejimas: profile.sudejimas,
                akys: profile.akys,
                plaukai: profile.plaukai,
                gimtadienis: profile.gimtadienis,
                zodiakas: profile.zodiakas,
                zalingi: profile.zalingi
            };

            console.log(`[PAIEŠKA] Trinamas senas pokalbis iš DB kontaktui ${profile.name}...`);
            DB.deleteConversation(c.id);

            let history = [];
            console.log(`[PAIEŠKA] Atidaromas Pop-up istorijai patikrinti...`);
            const writeBtn = page.locator('.button-write-message, .button-new-message, .__callNewMessage').first();
            if (await writeBtn.count() > 0 && await writeBtn.isVisible()) {
                await writeBtn.click();
                await page.waitForTimeout(2000);

                history = await page.evaluate((junkList) => {
                    const isJunk = (txt) => junkList.some(j => txt.includes(j));
                    const msgs = Array.from(document.querySelectorAll('.message-text, .msg-content, .text-content, .message-bubble, .msg_text, .chat-message, .view-message'));
                    if (msgs.length > 0) return msgs.slice(-15).map(m => m.innerText.trim()).filter(t => t.length > 0 && !isJunk(t));
                    return [];
                }, JUNK_KEYWORDS);

                console.log(`[PAIEŠKA] Atsisiųsta nauja istorija. Ilgis: ${history.length}`);
                await page.keyboard.press('Escape');
                await page.waitForTimeout(1000);
            } else {
                console.log(`[PAIEŠKA] ⚠️ Nerastas mygtukas "Rašyti žinutę".`);
            }

            let reply = null;
            let keepTrying = true;

            while (keepTrying) {
                reply = await analyzeAndRespond(profileData, history);

                if (reply === 'TIMEOUT') {
                    console.log(`[PAIEŠKA] Negautas patvirtinimas per 15 min. Užmiegame 30 min ir bandysime dar kartą...`);
                    await notifyTelegram(`💤 Negautas patvirtinimas. Robotas eina miegoti 30 minučių. Po to vėl atsiųs šį kontaktą (${profile.name}).`);
                    await page.waitForTimeout(30 * 60 * 1000);
                } else {
                    keepTrying = false;
                }
            }

            if (reply) {
                const sent = await sendMessage(page, reply, profileData.profileUrl, profile.name);
                if (sent) {
                    logActivity(`✅ Pirma žinutė išsiųsta: ${profile.name}`, 'success');

                    await page.waitForTimeout(2000);
                    console.log('[VERIFY] Tikrinamas išsiuntimo statusas per Pop-up...');

                    const writeBtnV = page.locator('.button-write-message, .button-new-message, .__callNewMessage').first();
                    if (await writeBtnV.count() > 0 && await writeBtnV.isVisible()) {
                        await writeBtnV.click();
                        await page.waitForTimeout(1500);
                    }

                    const postSendHistory = await page.evaluate((junkList) => {
                        const isJunk = (txt) => junkList.some(j => txt.includes(j));
                        const blocks = Array.from(document.querySelectorAll('.message, .msg, .chat-item, .thread-message, .message-bubble'));

                        if (blocks.length === 0) {
                            const msgs = Array.from(document.querySelectorAll('.message-text, .msg-content, .text-content'));
                            return msgs.map(m => {
                                const txt = m.innerText.trim();
                                if (!txt || isJunk(txt)) return null;
                                const isSent = m.className.includes('sent') || m.innerHTML.includes('Artūras') || m.innerHTML.includes('Arturas');
                                return { text: txt, direction: isSent ? 'sent' : 'received' };
                            }).filter(Boolean);
                        }

                        return blocks.map(el => {
                            const txt = el.innerText.trim();
                            if (!txt || isJunk(txt)) return null;
                            const isSent = el.className.includes('sent') || el.className.includes('my-message')
                                || el.innerHTML.includes('Artūras') || el.innerHTML.includes('Arturas');
                            return { text: txt, direction: isSent ? 'sent' : 'received' };
                        }).filter(Boolean);
                    }, JUNK_KEYWORDS);

                    const isSentSuccessfully = postSendHistory.some(m => m.direction === 'sent' && m.text.includes(reply.substring(0, 15)));

                    if (isSentSuccessfully) {
                        const existingMsgs = DB.getConversation(c.id);
                        const existingTexts = new Set(existingMsgs.map(m => m.content.trim()));

                        for (const msg of postSendHistory) {
                            if (!existingTexts.has(msg.text.trim())) {
                                DB.saveMessage(c.id, msg.direction, msg.text);
                                existingTexts.add(msg.text.trim());
                            }
                        }
                        DB.updateStatus(c.id, 'messaged');
                        logActivity(`Telegram patvirtinimas išsiųstas po įrašo.`, 'info');
                        await notifyTelegram(`✅ Pirmoji žinutė sėkmingai pristatyta kontaktui: ${profile.name}!\nIstorija ir išsiųsta žinutė įrašyta į duomenų bazę.`);
                    } else {
                        console.log(`[VERIFY] Nepavyko rasti išsiųstos žinutės istorijoje iš Pop-up. Galimas false negative.`);
                        await notifyTelegram(`⚠️ Žinutė kontaktui ${profile.name} buvo "išsiųsta", bet programos naršyklė nemato jos naujo įrašo pokalbio lange po 4s.`);
                        DB.updateStatus(c.id, 'messaged');
                    }
                    await page.keyboard.press('Escape');

                    console.log('[PAIEŠKA] Kontaktas apdorotas iš DB.');
                    // Tęsiame ciklą su sekančiu
                } else {
                    logActivity(`Klaida siunčiant žinutę: ${profile.name}`, 'error');
                    await notifyTelegram(`⚠️ Žinutė patvirtinta, bet NEIŠSIŲSTA: ${profile.name}`);
                }
            } else {
                DB.updateStatus(c.id, 'skipped');
                console.log('[PAIEŠKA] Kontaktas pažymėtas kaip skipped, apdorojamas kitas.');
            }

        } catch (e) {
            console.error(`[PAIEŠKA] Klaida profilyje ${c.profileUrl}:`, e.message);
        }
    }
}
