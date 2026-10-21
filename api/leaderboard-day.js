export default async function handler(req, res) {
  try {
    const response = await fetch(
      "https://api.pangolinworks.dev/blast-buddies",
      {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(15000),
      }
    );

    const body = await response.text();

    res.setHeader("Cache-Control", "no-store");
    res.status(response.status).send(body);
  } catch (error) {
    res.status(502).json({
      error: "Could not reach Pangolin Works API",
      message: error.message,
    });
  }
}
