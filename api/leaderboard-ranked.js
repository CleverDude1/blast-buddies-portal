
export default async function handler(req, res) {
    try {
        const season = req.query.season || "3";

        const response = await fetch(
            `https://na1-ping.blastbuddies.io/api/leaderboard/ranked?season=${encodeURIComponent(season)}`,
            {
                headers: {
                    "Accept": "application/json"
                }
            }
        );

        const text = await response.text();

        let data;

        try {
            data = JSON.parse(text);
        } catch {
            data = text;
        }

        return res.status(response.status).json({
            success: response.ok,
            blastBuddiesStatus: response.status,
            source: "blast-buddies",
            leaderboard: "ranked",
            season: season,
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

