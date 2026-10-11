export default async function handler(req, res) {
    if (req.method !== "GET") {
        res.setHeader("Allow", "GET");
        return res.status(405).json({
            success: false,
            error: "Method not allowed"
        });
    }

    const endpoints = {
        popular: "https://na1-ping.blastbuddies.io/api/custom-maps/popular",
        trending: "https://na1-ping.blastbuddies.io/api/custom-maps/trending",
        random: "https://na1-ping.blastbuddies.io/api/custom-maps/random"
    };

    try {
        const results = await Promise.all(
            Object.entries(endpoints).map(async ([type, url]) => {
                try {
                    const response = await fetch(url, {
                        headers: {
                            "Accept": "application/json"
                        }
                    });

                    const text = await response.text();

                    let data;

                    try {
                        data = JSON.parse(text);
                    } catch {
                        data = text;
                    }

                    return {
                        success: response.ok,
                        blastBuddiesStatus: response.status,
                        data
                    };
                } catch (error) {
                    return {
                        success: false,
                        error: error.message
                    };
                }
            })
        );

        const maps = {};

        Object.keys(endpoints).forEach((type, index) => {
            maps[type] = results[index];
        });

        const allSuccessful = results.every(
            result => result.success
        );

        return res.status(200).json({
            success: allSuccessful,
            source: "blast-buddies",
            endpoint: "custom-maps",
            retrievedAt: new Date().toISOString(),
            maps
        });

    } catch (error) {
        return res.status(500).json({
            success: false,
            error: error.message
        });
    }
}
