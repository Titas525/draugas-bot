const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3001;
const ACTIVITY_LOG_PATH = path.join(__dirname, 'activity.json');

app.use(cors());
app.use(express.json());

app.get('/api/status', (req, res) => {
    if (fs.existsSync(ACTIVITY_LOG_PATH)) {
        try {
            const data = JSON.parse(fs.readFileSync(ACTIVITY_LOG_PATH, 'utf8'));
            res.json(data);
        } catch (e) {
            res.status(500).json({ error: 'Failed to parse activity log' });
        }
    } else {
        res.json({
            active: false,
            stats: { profilesVisited: 0, messagesSent: 0, approvals: 0, crashes: 0 },
            logs: []
        });
    }
});

app.listen(PORT, () => {
    console.log(`Dashboard server running at http://localhost:${PORT}`);
});
