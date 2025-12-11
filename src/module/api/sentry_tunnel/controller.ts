export async function tunnel(req, res) {
  try {
    const header = JSON.parse(req.body.toString().split('\n')[0]);
    const {host, pathname} = new URL(header.dsn);
    const projectId = pathname.replace('/', '');
    const sentryIngestUrl = `https://${host}/api/${projectId}/envelope/`;

    const upstreamRes = await fetch(sentryIngestUrl, {
      method: 'POST',
      body: req.body,
      headers: {'Content-Type': 'application/x-sentry-envelope'},
    });

    res.status(upstreamRes.status).end();
  } catch (e) {
    console.log(e);
    res.sendStatus(500);
  }
}
