export default async function handler(req, res) {
    try {
        const response = await fetch(
            "https://eu1-ping.blastbuddies.io/api/leaderboard/clans",
            {
                headers: {
                    "Accept": "application/json"
                }
            }
        );

        if (!response.ok) {
            return res.status(response.status).json({
                success: false,
                error: `Blast Buddies returned HTTP ${response.status}`
            });
        }

        const data = await response.json();

        return res.status(200).json({
            success: true,
            source: "blast-buddies",
            retrievedAt: new Date().toISOString(),
            data: data
        });

    } catch (error) {
        return res.status(500).json({
            success: false,
            error: error.message
        });
    }
}
