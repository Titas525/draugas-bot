const fs = require('fs'); let c = fs.readFileSync('reply-handler.js', 'utf8'); c = c.replace(/\\\/g, '\').replace(/\\\$/g, '$'); fs.writeFileSync('reply-handler.js', c);
