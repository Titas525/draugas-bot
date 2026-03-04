const fs = require('fs');

function patchIndex() {
    let content = fs.readFileSync('index.js', 'utf8');
    const oldStr = `history = await page.evaluate((junkList) => {
              const isJunk = (txt) => junkList.some(j => txt.includes(j));
              const msgs = Array.from(document.querySelectorAll('.message-text, .msg-content, .text-content, .message-bubble, .msg_text, .chat-message, .view-message'));
              if (msgs.length > 0) return msgs.slice(-15).map(m => m.innerText.trim()).filter(t => t.length > 0 && !isJunk(t));
              return [];
            }, JUNK_KEYWORDS);`;

    const newStr = `history = await page.evaluate((junkList) => {
              const isJunk = (txt) => junkList.some(j => txt.includes(j));
              const blocks = Array.from(document.querySelectorAll('.message, .msg, .chat-item, .thread-message, .message-bubble'));
              if (blocks.length === 0) {
                const msgs = Array.from(document.querySelectorAll('.message-text, .msg-content, .text-content'));
                return msgs.slice(-15).map(m => m.innerText.trim()).filter(t => t.length > 0 && !isJunk(t));
              }
              return blocks.slice(-15).map(m => m.innerText.trim()).filter(t => t.length > 0 && !isJunk(t));
            }, JUNK_KEYWORDS);`;

    content = content.replace(oldStr, newStr);
    fs.writeFileSync('index.js', content);
    console.log('index.js patched');
}

function patchReplyHandler() {
    let content = fs.readFileSync('reply-handler.js', 'utf8');
    const oldStr = `            const history = await page.evaluate((junkList) => {
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
            }, JUNK_KEYWORDS);`;

    const newStr = `            const history = await page.evaluate((junkList) => {
                const isJunk = (txt) => junkList.some(j => txt.includes(j));
                const msgs = Array.from(document.querySelectorAll('.message, .msg, .chat-item, .thread-message, .message-bubble'));

                if (msgs.length === 0) {
                    const fallbackMsgs = Array.from(document.querySelectorAll('.message-text, .msg-content, .text-content, .msg_text, .chat-message, .view-message'));
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
            }, JUNK_KEYWORDS);`;

    content = content.replace(oldStr, newStr);
    fs.writeFileSync('reply-handler.js', content);
    console.log('reply-handler.js patched');
}

patchIndex();
patchReplyHandler();
