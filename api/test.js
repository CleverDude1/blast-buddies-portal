export default async function handler(req, res) {
    try {
        const response = await fetch(
            "https://eu1-ping.blastbuddies.io/api/leaderboard/clans"
        );

        const text = await response.text();

        res.status(response.status).json({
            success: response.ok,
            blastBuddiesStatus: response.status,
            response: JSON.parse(text)
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
}
