const API_URL = 'http://localhost:3001/api/status';

async function updateDashboard() {
    try {
        const response = await fetch(API_URL);
        const data = await response.json();

        // Update Status Badge
        const statusBadge = document.getElementById('status-badge');
        if (data.active) {
            statusBadge.innerText = 'Online';
            statusBadge.className = 'badge online';
        } else {
            statusBadge.innerText = 'Offline';
            statusBadge.className = 'badge offline';
        }

        // Update Stats
        document.getElementById('stat-visited').innerText = data.stats.profilesVisited;
        document.getElementById('stat-sent').innerText = data.stats.messagesSent;
        document.getElementById('stat-approvals').innerText = data.stats.approvals;
        document.getElementById('stat-crashes').innerText = data.stats.crashes;

        // Update Logs
        const logContainer = document.getElementById('log-container');
        logContainer.innerHTML = '';
        data.logs.forEach(log => {
            const entry = document.createElement('div');
            entry.className = `log-entry ${log.type}`;

            const time = new Date(log.timestamp).toLocaleTimeString();
            entry.innerHTML = `<span class="log-time">[${time}]</span> ${log.message}`;
            logContainer.appendChild(entry);
        });

    } catch (error) {
        console.error('Error fetching dashboard data:', error);
    }
}

// Initial update and poll every 2 seconds
updateDashboard();
setInterval(updateDashboard, 2000);
