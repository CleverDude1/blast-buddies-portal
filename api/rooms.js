export default async function handler(req, res) {
    if (req.method !== "GET") {
        res.setHeader("Allow", "GET");
        return res.status(405).json({
            success: false,
            error: "Method not allowed"
        });
    }

    const regions = {
        na: "https://na1-ping.blastbuddies.io/api/rooms",
        as: "https://as1-ping.blastbuddies.io/api/rooms",
        eu: "https://eu1-ping.blastbuddies.io/api/rooms"
    };

    try {
        const results = await Promise.all(
            Object.entries(regions).map(async ([region, url]) => {
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
                        region,
                        data
                    };
                } catch (error) {
                    return {
                        success: false,
                        region,
                        error: error.message
                    };
                }
            })
        );

        const allSuccessful = results.every(
            result => result.success
        );

        const rooms = {};

        for (const result of results) {
            rooms[result.region] = result;
        }

        return res.status(200).json({
            success: allSuccessful,
            source: "blast-buddies",
            endpoint: "rooms",
            retrievedAt: new Date().toISOString(),
            regions: rooms
        });

    } catch (error) {
        return res.status(500).json({
            success: false,
            error: error.message
        });
    }
}
