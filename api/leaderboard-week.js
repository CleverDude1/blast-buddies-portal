export default async function handler(req, res) {
    try {
        const playerId = req.query.playerId || "";

        const url =
            "https://eu1-ping.blastbuddies.io/api/leaderboard/week" +
            (playerId ? `?playerId=${encodeURIComponent(playerId)}` : "");

        const response = await fetch(url, {
            headers: {
                "Accept": "application/json"
            }
        });

        const data = await response.json();

        return res.status(response.status).json({
            success: response.ok,
            source: "blast-buddies",
            leaderboard: "week",
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
