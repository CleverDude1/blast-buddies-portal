export default async function handler(req, res) {
    try {
        const authorization = req.headers.authorization;

        if (!authorization) {
            return res.status(400).json({
                success: false,
                error: "Missing Authorization header"
            });
        }

        const response = await fetch(
            "https://eu1-ping.blastbuddies.io/player/clan",
            {
                method: "GET",
                headers: {
                    "Accept": "application/json",
                    "Authorization": authorization
                }
            }
        );

        const data = await response.json();

        return res.status(response.status).json({
            success: response.ok,
            blastBuddiesStatus: response.status,
            data: data
        });

    } catch (error) {
        return res.status(500).json({
            success: false,
            error: error.message
        });
    }
}
