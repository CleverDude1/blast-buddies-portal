```js
export default async function handler(req, res) {
    try {
        const response = await fetch(
            "https://eu1-ping.blastbuddies.io/api/leaderboard/day",
            {
                headers: {
                    "Accept": "application/json"
                }
            }
        );

        const data = await response.json();

        return res.status(response.status).json({
            success: response.ok,
            source: "blast-buddies",
            leaderboard: "day",
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
```
