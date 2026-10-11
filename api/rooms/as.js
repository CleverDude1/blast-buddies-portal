export default async function handler(req, res) {
    try {
        const response = await fetch(
            "https://as1-ping.blastbuddies.io/api/rooms",
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
            region: "as",
            endpoint: "rooms",
            retrievedAt: new Date().toISOString(),
            data: data
        });

    } catch (error) {
        return res.status(500).json({
            success: false,
            error: error.message,
            stack: error.stack
        });
    }
}
